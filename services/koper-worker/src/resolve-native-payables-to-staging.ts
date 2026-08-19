import { createHash } from "node:crypto";
import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { env } from "./config/env.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { requestSupabase } from "./elos/supabase.js";

type J = Record<string, unknown>;
type Stage = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Service = { id: string; source_id: string | null; description: string; code: string };
type Budget = { id: string; project_id: string; status: string };
type BudgetItem = { id: string; project_id: string; budget_id: string; service_id: string | null; code: string | null; description: string; status: string };
type Invoice = { id: string; registry_number: string; project_id: string; invoice_total: number };
type InvoiceItem = { id: string; invoice_id: string; total_amount: number; order_item_id: string | null };
type OrderItem = { id: string; project_id: string; cost_center_service_id: string | null; total_amount: number };

type Allocation = {
  serviceId: string | null;
  serviceSourceId: string | null;
  serviceName: string | null;
  budgetItemId: string | null;
  wbsCode: string | null;
  amount: number | null;
  method: string;
  evidence: J;
};

type Resolution = {
  version: 1;
  billId: string;
  billToPayId: string | null;
  billValue: number;
  route: "receipt" | "invoice" | "measurement" | "tax" | "admin" | "other" | "failed";
  originName: string | null;
  originId: string | null;
  ids: J;
  projectEvidence: J;
  serviceSourceIds: string[];
  wbsCodes: string[];
  allocations: Allocation[];
  status: "exact_allocated" | "exact_wbs_unallocated" | "service_only" | "project_only" | "administrative" | "unresolved" | "failed";
  error?: string;
};

const obj = (v: unknown): J => typeof v === "object" && v !== null && !Array.isArray(v) ? v as J : {};
const id = (v: unknown): string | null => (typeof v === "string" || typeof v === "number") ? (String(v).trim() || null) : null;
const uniq = <T>(values: T[]): T[] => [...new Set(values)];
const money = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const hash = (payload: unknown) => createHash("sha256").update(JSON.stringify(payload)).digest("hex");

async function all<T>(table: string, query: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await requestSupabase<T[]>(table, { query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }), timeoutMs: 30_000 });
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

function collect(value: unknown, keys: Set<string>, depth = 0): string[] {
  if (depth > 10 || value == null) return [];
  if (Array.isArray(value)) return uniq(value.flatMap((x) => collect(x, keys, depth + 1)));
  if (typeof value !== "object") return [];
  const row = obj(value); const found: string[] = [];
  for (const [key, child] of Object.entries(row)) {
    if (keys.has(key)) { const z = id(child); if (z && z !== "0") found.push(z); }
    if (child && typeof child === "object") found.push(...collect(child, keys, depth + 1));
  }
  return uniq(found);
}

function serviceNames(value: unknown, depth = 0): string[] {
  if (depth > 10 || value == null) return [];
  if (Array.isArray(value)) return uniq(value.flatMap((x) => serviceNames(x, depth + 1)));
  if (typeof value !== "object") return [];
  const row = obj(value); const found: string[] = [];
  for (const [key, child] of Object.entries(row)) {
    if (["serviceName", "service_name", "serviceDescription", "service_description"].includes(key)) { const z = id(child); if (z) found.push(z); }
    if (child && typeof child === "object") found.push(...serviceNames(child, depth + 1));
  }
  return uniq(found);
}

function pickOrigin(detail: J) {
  const billOrigin = obj(detail.bill_origin ?? detail.billOrigin);
  const origins = obj(detail.origins);
  const originName = id(billOrigin.origin_name ?? billOrigin.originName ?? detail.originName);
  const originId = id(billOrigin.origin_id ?? billOrigin.originId);
  const receiptId = id(origins.receipt_id ?? origins.receiptId ?? detail.receipt_id ?? detail.receiptId);
  const invoiceId = id(origins.invoice_id ?? origins.invoiceId ?? detail.invoice_id ?? detail.invoiceId);
  const releaseId = id(origins.fnc_release_id ?? origins.fncReleaseId ?? detail.fnc_release_id);
  const stageReleaseId = id(origins.fnc_stage_release_id ?? origins.fncStageReleaseId ?? detail.fnc_stage_release_id);
  const buildMonitoringId = id(origins.build_monitoring_id ?? origins.buildMonitoringId ?? detail.build_monitoring_id ?? detail.buildMonitoringId);
  const lower = (originName ?? "").toLowerCase();
  let route: Resolution["route"] = "other";
  if (receiptId || /nota manual|recibo/.test(lower)) route = "receipt";
  else if (invoiceId || /nf-e|nota fiscal|xml/.test(lower)) route = "invoice";
  else if (releaseId || stageReleaseId || /mediç|medic/.test(lower)) route = "measurement";
  else if (/imposto|tribut|tax|inss|iss|irrf|pis|cofins|csll/.test(lower)) route = "tax";
  else if (/comiss|folha|sal[aá]rio|credito|crédito|conta a pagar|administr/.test(lower)) route = "admin";
  return { route, originName, originId, receiptId, invoiceId, releaseId, stageReleaseId, buildMonitoringId };
}

function proportional(total: number, parts: { key: string; weight: number }[]): Map<string, number> {
  const positive = parts.filter((p) => p.weight > 0);
  const sum = positive.reduce((a, p) => a + p.weight, 0);
  const out = new Map<string, number>();
  if (!positive.length || sum <= 0 || total <= 0) return out;
  let assigned = 0;
  positive.forEach((p, index) => {
    const amount = index === positive.length - 1 ? Math.round((total - assigned) * 100) / 100 : Math.round((total * p.weight / sum) * 100) / 100;
    assigned += amount; out.set(p.key, amount);
  });
  return out;
}

async function main() {
  const [bills, existing, services, budgets, budgetItems, invoices, invoiceItems, orderItems] = await Promise.all([
    all<Stage>("koper_staging_records", { select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.bill_to_pay", sync_state: "eq.present", order: "koper_id.asc" }),
    all<{ koper_id: string }>("koper_staging_records", { select: "koper_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.bill_resolution", sync_state: "eq.present", order: "koper_id.asc" }),
    all<Service>("engineering_services", { select: "id,source_id,description,code", company_id: `eq.${env.BOSSA_COMPANY_ID}`, status: "eq.active", order: "id.asc" }),
    all<Budget>("engineering_budgets", { select: "id,project_id,status", company_id: `eq.${env.BOSSA_COMPANY_ID}`, status: "eq.approved", order: "id.asc" }),
    all<BudgetItem>("engineering_budget_items", { select: "id,project_id,budget_id,service_id,code,description,status", company_id: `eq.${env.BOSSA_COMPANY_ID}`, status: "eq.active", order: "id.asc" }),
    all<Invoice>("finance_electronic_invoices", { select: "id,registry_number,project_id,invoice_total", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
    all<InvoiceItem>("finance_electronic_invoice_items", { select: "id,invoice_id,total_amount,order_item_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
    all<OrderItem>("procurement_purchase_order_items", { select: "id,project_id,cost_center_service_id,total_amount", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
  ]);

  const done = new Set(existing.map((x) => x.koper_id));
  const rawSize = Number(process.env.KOPER_RESOLUTION_BATCH_SIZE ?? 100);
  const size = Number.isInteger(rawSize) && rawSize > 0 ? Math.min(rawSize, 160) : 100;
  const selected = bills.filter((b) => !done.has(b.koper_id)).slice(0, size);
  console.log("KOPER_RESOLUTION_BATCH_START", JSON.stringify({ stagedBills: bills.length, alreadyResolved: done.size, remainingBefore: bills.length - done.size, selected: selected.length, batchSize: size }));
  if (!selected.length) { console.log("KOPER_RESOLUTION_BATCH_DONE", JSON.stringify({ complete: true, resolved: done.size, total: bills.length })); return; }

  const serviceBySource = new Map(services.flatMap((s) => s.source_id ? [[s.source_id, s] as const] : []));
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const approvedBudgets = new Set(budgets.map((b) => b.id));
  const budgetByService = new Map<string, BudgetItem[]>();
  for (const item of budgetItems) if (item.service_id && approvedBudgets.has(item.budget_id)) budgetByService.set(item.service_id, [...(budgetByService.get(item.service_id) ?? []), item]);
  const currentWbs = (serviceId: string): BudgetItem | null => {
    const items = budgetByService.get(serviceId) ?? [];
    const codes = uniq(items.map((x) => x.code).filter((x): x is string => !!x));
    return codes.length === 1 ? items.find((x) => x.code === codes[0]) ?? null : null;
  };
  const invoiceByKoper = new Map<string, Invoice>();
  for (const inv of invoices) { const m = /^KOPER-NFE-(.+)$/.exec(inv.registry_number); if (m?.[1]) invoiceByKoper.set(m[1], inv); }
  const invoiceItemsByInvoice = new Map<string, InvoiceItem[]>();
  for (const item of invoiceItems) invoiceItemsByInvoice.set(item.invoice_id, [...(invoiceItemsByInvoice.get(item.invoice_id) ?? []), item]);
  const orderItemById = new Map(orderItems.map((x) => [x.id, x]));

  const results = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) throw new Error(login.message ?? "KOPER_LOGIN_FAILED");
    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const koper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (koper && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !isAllowedFlowSwitch(url, request.method(), request.postData())) {
          blockedWrites++; await route.abort("blockedbyclient"); return;
        }
      } catch {}
      await route.continue();
    });
    if (!await selectFlow(page)) throw new Error("KOPER_FLOW_COMPANY_NOT_SELECTED");

    const seedPromise = page.waitForResponse((response: Response) => {
      try { const u = new URL(response.url()); return response.request().method() === "GET" && u.hostname === "api.koper.com.br" && u.pathname === "/financial/v1/bills_to_pay" && !u.searchParams.has("billId"); } catch { return false; }
    }, { timeout: 20_000 }).catch(() => null);
    await page.goto("https://app.koper.com.br/financeiro/contas_pagar", { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
    const seed = await seedPromise; if (!seed) throw new Error("KOPER_PAYABLE_SEED_NOT_FOUND");
    const rawHeaders = seed.request().headers(); const headers: Record<string, string> = {};
    for (const key of ["accept", "origin", "referer", "x-accesstoken", "x-koper"]) if (rawHeaders[key]) headers[key] = rawHeaders[key];

    const jsonCache = new Map<string, Promise<J>>();
    const fetchJson = (url: URL): Promise<J> => {
      const key = url.toString(); const cached = jsonCache.get(key); if (cached) return cached;
      const promise = (async () => { url.searchParams.set("cb", String(Date.now())); const response = await page.request.get(url.toString(), { headers, timeout: 12_000 }); if (!response.ok()) throw new Error(`HTTP_${response.status()}_${new URL(key).pathname}`); return obj(await response.json().catch(() => null)); })();
      jsonCache.set(key, promise); return promise;
    };

    const resolveOne = async (stage: Stage): Promise<Resolution> => {
      const p = obj(stage.payload); const billId = id(p.billId) ?? stage.koper_id; const billValue = money(p.billValue); const billToPayId = id(p.billToPayId) ?? stage.koper_parent_id;
      try {
        const detailUrl = new URL("https://api.koper.com.br/financial/v1/bills_to_pay"); detailUrl.searchParams.set("billId", billId);
        const detail = await fetchJson(detailUrl); const origin = pickOrigin(detail);
        const base = { version: 1 as const, billId, billToPayId, billValue, route: origin.route, originName: origin.originName, originId: origin.originId };

        if (origin.route === "receipt" && origin.receiptId) {
          const receiptUrl = new URL("https://api.koper.com.br/financial/v1/receipt"); receiptUrl.searchParams.set("receiptId", origin.receiptId);
          const receipt = await fetchJson(receiptUrl);
          const purchaseIds = collect(receipt, new Set(["purchaseId", "purchase_id"]));
          const purchases = await Promise.all(purchaseIds.map((purchaseId) => { const u = new URL("https://api.koper.com.br/purchase/v1/purchase"); u.searchParams.set("purchaseId", purchaseId); return fetchJson(u); }));
          const serviceOrderIds = uniq([
            ...collect(receipt, new Set(["serviceOrderId", "service_order_id"])),
            ...purchases.flatMap((x) => collect(x, new Set(["serviceOrderId", "service_order_id"]))),
          ]);
          const serviceOrders = await Promise.all(serviceOrderIds.map((orderId) => { const u = new URL("https://api.koper.com.br/purchase/v1/service_order"); u.searchParams.set("orderId", orderId); return fetchJson(u); }));
          const evidenceBodies = [receipt, ...purchases, ...serviceOrders];
          const serviceSourceIds = uniq(evidenceBodies.flatMap((x) => collect(x, new Set(["serviceId", "service_id"]))));
          const names = uniq(evidenceBodies.flatMap(serviceNames));
          const directWbs = uniq(evidenceBodies.flatMap((x) => collect(x, new Set(["monItemReference", "itemReference", "item_reference"]))));
          const costCenterIds = uniq(evidenceBodies.flatMap((x) => collect(x, new Set(["costCenterId", "cost_center_id", "stockPlaceId", "stock_place_id"]))));
          const buildMonitoringIds = uniq(evidenceBodies.flatMap((x) => collect(x, new Set(["buildMonitoringId", "build_monitoring_id"]))));
          const allocations: Allocation[] = [];
          if (directWbs.length === 1) {
            const mappedService = serviceSourceIds.length === 1 ? serviceBySource.get(serviceSourceIds[0]!) : undefined;
            const budgetItem = mappedService ? currentWbs(mappedService.id) : null;
            allocations.push({ serviceId: mappedService?.id ?? null, serviceSourceId: serviceSourceIds.length === 1 ? serviceSourceIds[0]! : null, serviceName: mappedService?.description ?? names[0] ?? null, budgetItemId: budgetItem && budgetItem.code === directWbs[0] ? budgetItem.id : null, wbsCode: directWbs[0]!, amount: billValue, method: "koper_receipt_purchase", evidence: { receiptId: origin.receiptId, purchaseIds, serviceOrderIds } });
          }
          const status: Resolution["status"] = allocations.length ? "exact_allocated" : directWbs.length > 1 ? "exact_wbs_unallocated" : serviceSourceIds.length ? "service_only" : (costCenterIds.length || buildMonitoringIds.length) ? "project_only" : "unresolved";
          return { ...base, ids: { receiptId: origin.receiptId, purchaseIds, serviceOrderIds }, projectEvidence: { costCenterIds, buildMonitoringIds }, serviceSourceIds, wbsCodes: directWbs, allocations, status };
        }

        if (origin.route === "invoice" && origin.invoiceId) {
          const inv = invoiceByKoper.get(origin.invoiceId);
          if (inv) {
            const items = invoiceItemsByInvoice.get(inv.id) ?? [];
            const grouped = new Map<string, number>(); let mappedValue = 0;
            for (const item of items) {
              const orderItem = item.order_item_id ? orderItemById.get(item.order_item_id) : undefined;
              if (!orderItem?.cost_center_service_id) continue;
              const value = money(item.total_amount); mappedValue += value; grouped.set(orderItem.cost_center_service_id, (grouped.get(orderItem.cost_center_service_id) ?? 0) + value);
            }
            const weights = [...grouped.entries()].map(([key, weight]) => ({ key, weight }));
            const split = proportional(billValue, weights);
            const allocations: Allocation[] = [];
            for (const [serviceId, weight] of grouped) {
              const service = serviceById.get(serviceId); const budgetItem = currentWbs(serviceId); const amount = split.get(serviceId) ?? null;
              allocations.push({ serviceId, serviceSourceId: service?.source_id ?? null, serviceName: service?.description ?? null, budgetItemId: budgetItem?.id ?? null, wbsCode: budgetItem?.code ?? null, amount, method: "koper_invoice_purchase_order", evidence: { invoiceId: origin.invoiceId, elosInvoiceId: inv.id, invoiceLineWeight: money(weight), invoiceMappedValue: money(mappedValue), invoiceTotal: money(inv.invoice_total) } });
            }
            const fullyMapped = items.length > 0 && items.every((item) => { const oi = item.order_item_id ? orderItemById.get(item.order_item_id) : undefined; return !!oi?.cost_center_service_id; });
            const hasWbs = allocations.length > 0 && allocations.every((a) => !!a.wbsCode);
            const status: Resolution["status"] = allocations.length && fullyMapped && hasWbs ? "exact_allocated" : allocations.length ? "service_only" : "unresolved";
            return { ...base, ids: { invoiceId: origin.invoiceId, elosInvoiceId: inv.id }, projectEvidence: { projectId: inv.project_id, itemCount: items.length, fullyMapped }, serviceSourceIds: uniq(allocations.flatMap((a) => a.serviceSourceId ? [a.serviceSourceId] : [])), wbsCodes: uniq(allocations.flatMap((a) => a.wbsCode ? [a.wbsCode] : [])), allocations, status };
          }
          return { ...base, ids: { invoiceId: origin.invoiceId }, projectEvidence: {}, serviceSourceIds: [], wbsCodes: [], allocations: [], status: "unresolved" };
        }

        if (origin.route === "measurement") return { ...base, ids: { releaseId: origin.releaseId, stageReleaseId: origin.stageReleaseId }, projectEvidence: { buildMonitoringId: origin.buildMonitoringId }, serviceSourceIds: [], wbsCodes: [], allocations: [], status: "unresolved" };
        if (origin.route === "tax" || origin.route === "admin") return { ...base, ids: {}, projectEvidence: { buildMonitoringId: origin.buildMonitoringId }, serviceSourceIds: [], wbsCodes: [], allocations: [], status: "administrative" };
        return { ...base, ids: {}, projectEvidence: { buildMonitoringId: origin.buildMonitoringId }, serviceSourceIds: [], wbsCodes: [], allocations: [], status: "unresolved" };
      } catch (error: unknown) {
        return { version: 1, billId, billToPayId, billValue, route: "failed", originName: null, originId: null, ids: {}, projectEvidence: {}, serviceSourceIds: [], wbsCodes: [], allocations: [], status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "unknown" };
      }
    };

    const resolved: Resolution[] = [];
    const concurrency = 8;
    for (let offset = 0; offset < selected.length; offset += concurrency) resolved.push(...await Promise.all(selected.slice(offset, offset + concurrency).map(resolveOne)));
    return { blockedWrites, resolved };
  }, { sessionTimeoutMs: 180_000 });

  const now = new Date().toISOString();
  const rows = results.resolved.map((r) => ({
    company_id: env.BOSSA_COMPANY_ID, source: "koper", entity: "bill_resolution", koper_id: r.billId, koper_parent_id: r.billToPayId,
    payload: r, payload_hash: hash(r), koper_created_at: null, koper_updated_at: null, first_seen_at: now, last_seen_at: now,
    processing_status: r.status === "failed" ? "error" : "processed", processing_error: r.error ?? null, mapping_version: 1, sync_state: "present", elos_id: null, updated_at: now,
  }));
  await requestSupabase("koper_staging_records", { method: "POST", body: rows, prefer: "resolution=merge-duplicates,return=minimal", query: new URLSearchParams({ on_conflict: "company_id,source,entity,koper_id" }), timeoutMs: 60_000 });
  const counts: Record<string, { count: number; value: number }> = {};
  for (const r of results.resolved) { const s = counts[r.status] ?? { count: 0, value: 0 }; s.count++; s.value += r.billValue; counts[r.status] = s; }
  const after = done.size + rows.length;
  console.log("KOPER_RESOLUTION_BATCH_RESULT", JSON.stringify({ ok: !results.resolved.some((r) => r.status === "failed"), blockedWrites: results.blockedWrites, persisted: rows.length, resolvedAfter: after, total: bills.length, remainingAfter: Math.max(0, bills.length - after), counts }));
}

main().catch((error: unknown) => { console.error("KOPER_RESOLUTION_BATCH_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1200) : "unknown" })); process.exitCode = 1; });
