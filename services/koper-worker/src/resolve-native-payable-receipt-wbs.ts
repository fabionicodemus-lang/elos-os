import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { env } from "./config/env.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type StageRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Evidence = {
  billId: string;
  billToPayId: string | null;
  value: number;
  receiptId: string | null;
  receiptStatus: number | null;
  purchaseIds: string[];
  purchaseStatuses: number[];
  serviceOrderIds: string[];
  serviceOrderStatuses: number[];
  serviceIds: string[];
  serviceNames: string[];
  itemMonitoringIds: string[];
  wbsReferences: string[];
  costCenterIds: string[];
  buildMonitoringIds: string[];
  evidencePath: string[];
  resolution: "exact_wbs" | "service_only" | "cost_center_only" | "receipt_only" | "not_receipt" | "failed";
  error?: string;
};

const objectValue = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};

const identifier = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text && text !== "0" ? text : null;
};

const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];

async function readAll<T>(table: string, query: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await requestSupabase<T[]>(table, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
      timeoutMs: 30_000,
    });
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function collectByKeys(value: unknown, keys: Set<string>, depth = 0): string[] {
  if (depth > 10 || value === null || value === undefined) return [];
  if (Array.isArray(value)) return unique(value.flatMap((item) => collectByKeys(item, keys, depth + 1)));
  if (typeof value !== "object") return [];
  const row = value as Json;
  const found: string[] = [];
  for (const [key, child] of Object.entries(row)) {
    if (keys.has(key)) {
      const id = identifier(child);
      if (id) found.push(id);
    }
    if (child && typeof child === "object") found.push(...collectByKeys(child, keys, depth + 1));
  }
  return unique(found);
}

function collectServiceNames(value: unknown, depth = 0): string[] {
  if (depth > 10 || value === null || value === undefined) return [];
  if (Array.isArray(value)) return unique(value.flatMap((item) => collectServiceNames(item, depth + 1)));
  if (typeof value !== "object") return [];
  const row = value as Json;
  const found: string[] = [];
  for (const [key, child] of Object.entries(row)) {
    if (["serviceName", "service_name", "serviceDescription", "service_description"].includes(key)) {
      const text = identifier(child);
      if (text) found.push(text);
    }
    if (child && typeof child === "object") found.push(...collectServiceNames(child, depth + 1));
  }
  return unique(found);
}

function detailReceiptId(detail: Json): string | null {
  const origins = objectValue(detail.origins);
  return identifier(origins.receipt_id ?? origins.receiptId ?? detail.receipt_id ?? detail.receiptId);
}

function selectedRows(rows: StageRow[]): StageRow[] {
  const forced = new Set((process.env.KOPER_RECEIPT_WBS_IDS ?? "").split(",").map((v) => v.trim()).filter(Boolean));
  if (forced.size) return rows.filter((row) => forced.has(row.koper_id));
  const rawOffset = Number(process.env.KOPER_RECEIPT_WBS_OFFSET ?? 0);
  const rawSize = Number(process.env.KOPER_RECEIPT_WBS_SIZE ?? 80);
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const size = Number.isInteger(rawSize) && rawSize > 0 ? Math.min(rawSize, 120) : 80;
  return rows.slice(offset, offset + size);
}

async function run(stages: StageRow[]): Promise<{ blockedWrites: number; evidence: Evidence[] }> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) throw new Error(login.message ?? "KOPER_LOGIN_FAILED");

    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const koper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (koper && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !isAllowedFlowSwitch(url, request.method(), request.postData())) {
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {
        // Ignore malformed URLs.
      }
      await route.continue();
    });

    if (!await selectFlow(page)) throw new Error("KOPER_FLOW_COMPANY_NOT_SELECTED");

    const seedPromise = page.waitForResponse((response: Response) => {
      try {
        const url = new URL(response.url());
        return response.request().method() === "GET"
          && url.hostname === "api.koper.com.br"
          && url.pathname === "/financial/v1/bills_to_pay"
          && !url.searchParams.has("billId");
      } catch {
        return false;
      }
    }, { timeout: 20_000 }).catch(() => null);

    await page.goto("https://app.koper.com.br/financeiro/contas_pagar", { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
    const seed = await seedPromise;
    if (!seed) throw new Error("KOPER_PAYABLE_SEED_NOT_FOUND");
    const seedHeaders = seed.request().headers();
    const headers: Record<string, string> = {};
    for (const key of ["accept", "origin", "referer", "x-accesstoken", "x-koper"]) if (seedHeaders[key]) headers[key] = seedHeaders[key];

    const fetchJson = async (url: URL): Promise<{ status: number; body: Json }> => {
      url.searchParams.set("cb", String(Date.now()));
      const response = await page.request.get(url.toString(), { headers, timeout: 10_000 });
      return { status: response.status(), body: objectValue(await response.json().catch(() => null)) };
    };

    const result: Evidence[] = [];
    const concurrency = 8;
    for (let offset = 0; offset < stages.length; offset += concurrency) {
      const batch = stages.slice(offset, offset + concurrency);
      result.push(...await Promise.all(batch.map(async (stage): Promise<Evidence> => {
        const payload = objectValue(stage.payload);
        const billId = identifier(payload.billId) ?? stage.koper_id;
        const base = {
          billId,
          billToPayId: identifier(payload.billToPayId) ?? stage.koper_parent_id,
          value: Number(payload.billValue ?? 0) || 0,
        };
        try {
          const detailUrl = new URL("https://api.koper.com.br/financial/v1/bills_to_pay");
          detailUrl.searchParams.set("billId", billId);
          const detailResponse = await fetchJson(detailUrl);
          const detail = detailResponse.body;
          const receiptId = detailReceiptId(detail);
          if (!receiptId) {
            return {
              ...base,
              receiptId: null,
              receiptStatus: null,
              purchaseIds: [],
              purchaseStatuses: [],
              serviceOrderIds: [],
              serviceOrderStatuses: [],
              serviceIds: [],
              serviceNames: [],
              itemMonitoringIds: [],
              wbsReferences: [],
              costCenterIds: [],
              buildMonitoringIds: [],
              evidencePath: ["bill"],
              resolution: "not_receipt",
            };
          }

          const receiptUrl = new URL("https://api.koper.com.br/financial/v1/receipt");
          receiptUrl.searchParams.set("receiptId", receiptId);
          const receiptResponse = await fetchJson(receiptUrl);
          const receipt = receiptResponse.body;

          const purchaseIds = unique(collectByKeys(receipt, new Set(["purchaseId", "purchase_id"])));
          const purchases = await Promise.all(purchaseIds.map(async (purchaseId) => {
            const url = new URL("https://api.koper.com.br/purchase/v1/purchase");
            url.searchParams.set("purchaseId", purchaseId);
            return fetchJson(url);
          }));
          const purchaseBodies = purchases.map((row) => row.body);

          const directServiceOrderIds = unique([
            ...collectByKeys(receipt.servicesOrders, new Set(["serviceOrderId", "service_order_id", "orderId", "order_id"])),
            ...collectByKeys(receipt, new Set(["serviceOrderId", "service_order_id"])),
          ]);
          const purchaseServiceOrderIds = unique(purchaseBodies.flatMap((body) => collectByKeys(body, new Set(["serviceOrderId", "service_order_id"]))));
          const serviceOrderIds = unique([...directServiceOrderIds, ...purchaseServiceOrderIds]);

          const serviceOrders = await Promise.all(serviceOrderIds.map(async (orderId) => {
            const url = new URL("https://api.koper.com.br/purchase/v1/service_order");
            url.searchParams.set("orderId", orderId);
            return fetchJson(url);
          }));
          const serviceOrderBodies = serviceOrders.map((row) => row.body);
          const evidenceBodies = [receipt, ...purchaseBodies, ...serviceOrderBodies];

          const serviceIds = unique(evidenceBodies.flatMap((body) => collectByKeys(body, new Set(["serviceId", "service_id"]))));
          const serviceNames = unique(evidenceBodies.flatMap((body) => collectServiceNames(body)));
          const itemMonitoringIds = unique(evidenceBodies.flatMap((body) => collectByKeys(body, new Set(["itemMonitoringId", "item_monitoring_id", "itemMonitContractId"]))));
          const wbsReferences = unique(evidenceBodies.flatMap((body) => collectByKeys(body, new Set(["monItemReference", "itemReference", "item_reference"]))));
          const costCenterIds = unique(evidenceBodies.flatMap((body) => collectByKeys(body, new Set(["costCenterId", "cost_center_id", "stockPlaceId", "stock_place_id"]))));
          const buildMonitoringIds = unique(evidenceBodies.flatMap((body) => collectByKeys(body, new Set(["buildMonitoringId", "build_monitoring_id"]))));

          const resolution: Evidence["resolution"] = wbsReferences.length > 0
            ? "exact_wbs"
            : serviceIds.length > 0
              ? "service_only"
              : (costCenterIds.length > 0 || buildMonitoringIds.length > 0)
                ? "cost_center_only"
                : "receipt_only";

          const evidencePath = ["bill", "receipt"];
          if (purchaseIds.length) evidencePath.push("purchase");
          if (serviceOrderIds.length) evidencePath.push("service_order");

          return {
            ...base,
            receiptId,
            receiptStatus: receiptResponse.status,
            purchaseIds,
            purchaseStatuses: purchases.map((row) => row.status),
            serviceOrderIds,
            serviceOrderStatuses: serviceOrders.map((row) => row.status),
            serviceIds,
            serviceNames,
            itemMonitoringIds,
            wbsReferences,
            costCenterIds,
            buildMonitoringIds,
            evidencePath,
            resolution,
          };
        } catch (error: unknown) {
          return {
            ...base,
            receiptId: null,
            receiptStatus: null,
            purchaseIds: [],
            purchaseStatuses: [],
            serviceOrderIds: [],
            serviceOrderStatuses: [],
            serviceIds: [],
            serviceNames: [],
            itemMonitoringIds: [],
            wbsReferences: [],
            costCenterIds: [],
            buildMonitoringIds: [],
            evidencePath: ["bill"],
            resolution: "failed",
            error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
          };
        }
      })));
    }
    return { blockedWrites, evidence: result };
  }, { sessionTimeoutMs: 110_000 });
}

try {
  const rows = await readAll<StageRow>("koper_staging_records", {
    select: "koper_id,koper_parent_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: "eq.bill_to_pay",
    sync_state: "eq.present",
    order: "koper_id.asc",
  });
  const selected = selectedRows(rows);
  console.log("KOPER_RECEIPT_WBS_START", JSON.stringify({ readOnly: true, stagedBills: rows.length, selectedBills: selected.length }));
  const resolved = await run(selected);
  const receiptRows = resolved.evidence.filter((row) => row.receiptId);
  const byResolution = new Map<string, { count: number; value: number }>();
  for (const row of resolved.evidence) {
    const stats = byResolution.get(row.resolution) ?? { count: 0, value: 0 };
    stats.count += 1;
    stats.value += row.value;
    byResolution.set(row.resolution, stats);
  }
  console.log("KOPER_RECEIPT_WBS_RESULT", JSON.stringify({
    ok: !resolved.evidence.some((row) => row.resolution === "failed"),
    readOnly: true,
    selectedBills: selected.length,
    blockedWrites: resolved.blockedWrites,
    receiptBills: receiptRows.length,
    receiptValue: receiptRows.reduce((sum, row) => sum + row.value, 0),
    resolutions: Object.fromEntries([...byResolution.entries()]),
    unique: {
      receipts: unique(receiptRows.flatMap((row) => row.receiptId ? [row.receiptId] : [])).length,
      purchases: unique(receiptRows.flatMap((row) => row.purchaseIds)).length,
      serviceOrders: unique(receiptRows.flatMap((row) => row.serviceOrderIds)).length,
      services: unique(receiptRows.flatMap((row) => row.serviceIds)).length,
      itemMonitoringIds: unique(receiptRows.flatMap((row) => row.itemMonitoringIds)).length,
      wbsReferences: unique(receiptRows.flatMap((row) => row.wbsReferences)).length,
      costCenters: unique(receiptRows.flatMap((row) => row.costCenterIds)).length,
      buildMonitorings: unique(receiptRows.flatMap((row) => row.buildMonitoringIds)).length,
    },
    purchaseBridge: {
      receiptBillsWithPurchase: receiptRows.filter((row) => row.purchaseIds.length > 0).length,
      exactWbsWithPurchase: receiptRows.filter((row) => row.purchaseIds.length > 0 && row.resolution === "exact_wbs").length,
      serviceOnlyWithPurchase: receiptRows.filter((row) => row.purchaseIds.length > 0 && row.resolution === "service_only").length,
      costCenterOnlyWithPurchase: receiptRows.filter((row) => row.purchaseIds.length > 0 && row.resolution === "cost_center_only").length,
    },
    exceptions: resolved.evidence.filter((row) => ["receipt_only", "cost_center_only", "service_only", "failed"].includes(row.resolution)).slice(0, 50),
    wbsSample: receiptRows.filter((row) => row.resolution === "exact_wbs").slice(0, 30),
  }));
} catch (error: unknown) {
  console.error("KOPER_RECEIPT_WBS_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1200) : "unknown" }));
  process.exitCode = 1;
}
