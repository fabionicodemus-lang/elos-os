import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { env } from "./config/env.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { requestSupabase } from "./elos/supabase.js";

// Read-only financial origin resolver. Keep native billId as the financial identity.
type Json = Record<string, unknown>;
type StageRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Route =
  | "service_order"
  | "receipt"
  | "measurement_release"
  | "invoice"
  | "tax_or_check"
  | "administrative"
  | "other_origin"
  | "unresolved";

type OriginResolution = {
  billId: string;
  billToPayId: string | null;
  valueCents: number;
  listOriginName: string | null;
  detailOriginId: string | null;
  detailOriginName: string | null;
  route: Route;
  evidence: Record<string, string>;
  status?: number;
  error?: string;
};

const objectValue = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};

const identifier = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const cents = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const money = (valueCents: number): number => valueCents / 100;

const firstId = (row: Json, keys: string[]): string | null => {
  for (const key of keys) {
    const value = identifier(row[key]);
    if (value) return value;
  }
  return null;
};

const normalize = (value: string | null): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

async function readAll<T>(table: string, query: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(table, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
      timeoutMs: 30_000,
    });
    rows.push(...page);
    if (page.length < 1_000) return rows;
  }
}

function evidenceFrom(detail: Json): Record<string, string> {
  const origins = objectValue(detail.origins);
  const billOrigin = objectValue(detail.bill_origin ?? detail.billOrigin);
  const candidates: Array<[string, string[]]> = [
    ["serviceOrderId", ["service_order_id", "serviceOrderId", "order_id", "orderId"]],
    ["receiptId", ["receipt_id", "receiptId"]],
    ["invoiceId", ["invoice_id", "invoiceId", "electronic_invoice_id", "electronicInvoiceId"]],
    ["fncReleaseId", ["fnc_release_id", "fncReleaseId"]],
    ["fncStageReleaseId", ["fnc_stage_release_id", "fncStageReleaseId"]],
    ["buildMonitoringId", ["build_monitoring_id", "buildMonitoringId"]],
    ["contractId", ["contract_id", "contractId"]],
    ["measurementId", ["measurement_id", "measurementId", "build_measurement_id", "buildMeasurementId"]],
    ["taxId", ["tax_id", "taxId"]],
    ["checkId", ["check_id", "checkId"]],
    ["payrollId", ["payroll_id", "payrollId"]],
    ["commissionId", ["commission_id", "commissionId"]],
  ];

  const result: Record<string, string> = {};
  for (const [label, keys] of candidates) {
    const value = firstId(origins, keys) ?? firstId(detail, keys) ?? firstId(billOrigin, keys);
    if (value) result[label] = value;
  }
  return result;
}

function classify(detail: Json, evidence: Record<string, string>): {
  route: Route;
  detailOriginId: string | null;
  detailOriginName: string | null;
} {
  const billOrigin = objectValue(detail.bill_origin ?? detail.billOrigin);
  const detailOriginId = firstId(billOrigin, ["origin_id", "originId", "id"]);
  const detailOriginName = firstId(billOrigin, ["origin_name", "originName", "name"]);
  const originText = normalize(detailOriginName);

  if (evidence.serviceOrderId) return { route: "service_order", detailOriginId, detailOriginName };
  if (evidence.receiptId) return { route: "receipt", detailOriginId, detailOriginName };
  if (
    evidence.fncReleaseId
    || evidence.fncStageReleaseId
    || evidence.measurementId
    || /medic|medicao|release|liberac/.test(originText)
  ) return { route: "measurement_release", detailOriginId, detailOriginName };
  if (
    evidence.invoiceId
    || /nota fiscal|nfe|nf-e|eletronica|eletronico|invoice/.test(originText)
  ) return { route: "invoice", detailOriginId, detailOriginName };
  if (
    evidence.taxId
    || evidence.checkId
    || /imposto|tribut|taxa|cheque/.test(originText)
  ) return { route: "tax_or_check", detailOriginId, detailOriginName };
  if (
    evidence.payrollId
    || evidence.commissionId
    || /folha|salario|comissao|administr|financeir|banc|tarifa/.test(originText)
  ) return { route: "administrative", detailOriginId, detailOriginName };
  if (detailOriginId || detailOriginName || Object.keys(evidence).length > 0) {
    return { route: "other_origin", detailOriginId, detailOriginName };
  }
  return { route: "unresolved", detailOriginId, detailOriginName };
}

function parsePositiveInt(raw: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, maximum);
}

function selectRows(rows: StageRow[]): { selected: StageRow[]; mode: string; offset: number; size: number } {
  const forcedIds = new Set(
    (process.env.KOPER_NATIVE_ORIGIN_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (forcedIds.size > 0) {
    return {
      selected: rows.filter((row) => forcedIds.has(row.koper_id)),
      mode: "ids",
      offset: 0,
      size: forcedIds.size,
    };
  }

  const offset = parsePositiveInt(process.env.KOPER_NATIVE_ORIGIN_OFFSET, 0, 100_000);
  const size = Math.max(1, parsePositiveInt(process.env.KOPER_NATIVE_ORIGIN_SIZE, 80, 250));
  return { selected: rows.slice(offset, offset + size), mode: "slice", offset, size };
}

async function resolveBatch(stages: StageRow[]): Promise<{ blockedWrites: number; results: OriginResolution[] }> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) throw new Error(login.message ?? "KOPER_LOGIN_FAILED");

    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const koper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (
          koper
          && !["GET", "HEAD", "OPTIONS"].includes(request.method())
          && !isAllowedFlowSwitch(url, request.method(), request.postData())
        ) {
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

    await page.goto("https://app.koper.com.br/financeiro/contas_pagar", {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    }).catch(() => undefined);

    const seed = await seedPromise;
    if (!seed) throw new Error("KOPER_PAYABLE_SEED_NOT_FOUND");
    const seedHeaders = seed.request().headers();
    const headers: Record<string, string> = {};
    for (const key of ["accept", "origin", "referer", "x-accesstoken", "x-koper"]) {
      const value = seedHeaders[key];
      if (value) headers[key] = value;
    }

    const results: OriginResolution[] = [];
    const concurrency = 8;
    for (let offset = 0; offset < stages.length; offset += concurrency) {
      const group = stages.slice(offset, offset + concurrency);
      results.push(...await Promise.all(group.map(async (stage): Promise<OriginResolution> => {
        const payload = objectValue(stage.payload);
        const billId = identifier(payload.billId) ?? stage.koper_id;
        const base = {
          billId,
          billToPayId: identifier(payload.billToPayId) ?? stage.koper_parent_id,
          valueCents: cents(payload.billValue),
          listOriginName: identifier(payload.originName),
        };
        try {
          const url = new URL("https://api.koper.com.br/financial/v1/bills_to_pay");
          url.searchParams.set("billId", billId);
          url.searchParams.set("cb", String(Date.now()));
          const response = await page.request.get(url.toString(), { headers, timeout: 10_000 });
          if (!response.ok()) {
            return {
              ...base,
              detailOriginId: null,
              detailOriginName: null,
              route: "unresolved",
              evidence: {},
              status: response.status(),
              error: `DETAIL_HTTP_${response.status()}`,
            };
          }
          const detail = objectValue(await response.json().catch(() => null));
          const evidence = evidenceFrom(detail);
          const classification = classify(detail, evidence);
          return { ...base, ...classification, evidence, status: response.status() };
        } catch (error: unknown) {
          return {
            ...base,
            detailOriginId: null,
            detailOriginName: null,
            route: "unresolved",
            evidence: {},
            error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
          };
        }
      })));
    }

    return { blockedWrites, results };
  }, { sessionTimeoutMs: 110_000 });
}

function aggregate(results: OriginResolution[]): unknown {
  const routeMap = new Map<Route, { count: number; valueCents: number }>();
  const originMap = new Map<string, { count: number; valueCents: number }>();
  const evidenceSets = new Map<string, Set<string>>();

  for (const result of results) {
    const route = routeMap.get(result.route) ?? { count: 0, valueCents: 0 };
    route.count += 1;
    route.valueCents += result.valueCents;
    routeMap.set(result.route, route);

    const origin = result.detailOriginName ?? "(sem origem detalhada)";
    const originStats = originMap.get(origin) ?? { count: 0, valueCents: 0 };
    originStats.count += 1;
    originStats.valueCents += result.valueCents;
    originMap.set(origin, originStats);

    for (const [key, value] of Object.entries(result.evidence)) {
      const set = evidenceSets.get(key) ?? new Set<string>();
      set.add(value);
      evidenceSets.set(key, set);
    }
  }

  return {
    routes: Object.fromEntries([...routeMap.entries()].map(([key, value]) => [key, {
      count: value.count,
      value: money(value.valueCents),
    }])),
    origins: [...originMap.entries()]
      .map(([origin, value]) => ({ origin, count: value.count, value: money(value.valueCents) }))
      .sort((left, right) => right.count - left.count || right.value - left.value)
      .slice(0, 80),
    uniqueEvidence: Object.fromEntries([...evidenceSets.entries()].map(([key, values]) => [key, values.size])),
  };
}

try {
  const stages = await readAll<StageRow>("koper_staging_records", {
    select: "koper_id,koper_parent_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: "eq.bill_to_pay",
    sync_state: "eq.present",
    order: "koper_id.asc",
  });
  const selection = selectRows(stages);

  console.log("KOPER_NATIVE_ORIGIN_RESOLVER_START", JSON.stringify({
    readOnly: true,
    stagedBills: stages.length,
    selectedBills: selection.selected.length,
    mode: selection.mode,
    offset: selection.offset,
    size: selection.size,
  }));

  const resolved = await resolveBatch(selection.selected);
  const failed = resolved.results.filter((row) => Boolean(row.error));
  const unresolved = resolved.results.filter((row) => row.route === "unresolved");

  console.log("KOPER_NATIVE_ORIGIN_RESOLVER_RESULT", JSON.stringify({
    ok: failed.length === 0,
    readOnly: true,
    stagedBills: stages.length,
    selectedBills: selection.selected.length,
    resolvedBills: resolved.results.length - unresolved.length,
    unresolvedBills: unresolved.length,
    failedBills: failed.length,
    selectedValue: money(resolved.results.reduce((sum, row) => sum + row.valueCents, 0)),
    blockedWrites: resolved.blockedWrites,
    summary: aggregate(resolved.results),
    unresolvedSample: unresolved.slice(0, 40).map((row) => ({
      billId: row.billId,
      billToPayId: row.billToPayId,
      value: money(row.valueCents),
      listOriginName: row.listOriginName,
      detailOriginId: row.detailOriginId,
      detailOriginName: row.detailOriginName,
      evidence: row.evidence,
      status: row.status ?? null,
      error: row.error ?? null,
    })),
  }));
} catch (error: unknown) {
  console.error("KOPER_NATIVE_ORIGIN_RESOLVER_FAILED", JSON.stringify({
    message: error instanceof Error ? error.message.slice(0, 1_200) : "unknown",
  }));
  process.exitCode = 1;
}
