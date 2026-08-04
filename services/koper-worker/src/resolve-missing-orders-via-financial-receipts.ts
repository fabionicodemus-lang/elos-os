import type { Response } from "playwright-core";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type OrderRow = { source_id: string | null; order_number: string };

const object = (value: unknown): Json => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};
const identifier = (value: unknown): string | null => typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null;
const identifierArray = (value: unknown): string[] => Array.isArray(value) ? value.flatMap((item) => { const id = identifier(item); return id ? [id] : []; }) : [];

async function readAll<T>(resource: string, query: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await requestSupabase<T[]>(resource, { query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }) });
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

function receiptIds(payload: Json): string[] {
  const receipts = Array.isArray(payload.receipts) ? payload.receipts : [];
  return receipts.flatMap((value) => {
    const id = identifier(object(value).receiptId);
    return id ? [id] : [];
  });
}

const batchOffset = Math.max(0, Number(process.env.KOPER_FINANCIAL_RECEIPT_BATCH_OFFSET ?? "0") || 0);
const batchSize = Math.min(40, Math.max(1, Number(process.env.KOPER_FINANCIAL_RECEIPT_BATCH_SIZE ?? "20") || 20));

try {
  const [entries, items, nativeOrders] = await Promise.all([
    readAll<StagingRow>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper", entity: "eq.stock_entry", sync_state: "eq.present", order: "koper_id.asc",
    }),
    readAll<StagingRow>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper", entity: "eq.stock_entry_item", sync_state: "eq.present", order: "koper_id.asc",
    }),
    readAll<OrderRow>("procurement_purchase_orders", {
      select: "source_id,order_number", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", order: "source_id.asc",
    }),
  ]);

  const programmed = new Set(entries.filter((row) => identifier(object(row.payload).originType) === "0").map((row) => row.koper_id));
  const missingOrderEntries = new Map<string, Set<string>>();
  for (const row of items) {
    if (!row.koper_parent_id || !programmed.has(row.koper_parent_id)) continue;
    const payload = object(row.payload);
    if (identifierArray(payload.candidatePurchaseOrderIds).length > 0) continue;
    const ids = receiptIds(payload);
    if (!ids.length) continue;
    const set = missingOrderEntries.get(row.koper_parent_id) ?? new Set<string>();
    ids.forEach((id) => set.add(id));
    missingOrderEntries.set(row.koper_parent_id, set);
  }

  const receiptToEntries = new Map<string, Set<string>>();
  for (const [entryId, ids] of missingOrderEntries) for (const id of ids) {
    const set = receiptToEntries.get(id) ?? new Set<string>();
    set.add(entryId);
    receiptToEntries.set(id, set);
  }
  const receiptIdsAll = [...receiptToEntries.keys()].sort((a, b) => Number(a) - Number(b));
  const selected = receiptIdsAll.slice(batchOffset, batchOffset + batchSize);
  const nativeOrderBySource = new Map(nativeOrders.flatMap((row) => row.source_id ? [[row.source_id, row.order_number] as const] : []));

  const live = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ok: false, message: login.message };
    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (isKoper && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !isAllowedFlowSwitch(url, request.method(), request.postData())) {
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {}
      await route.continue();
    });
    const flowSelected = await selectFlow(page);
    if (!flowSelected) return { ok: false, message: "KOPER_FLOW_COMPANY_NOT_SELECTED", blockedWrites };

    let headers: Record<string, string> | null = null;
    const onResponse = (response: Response): void => {
      try {
        const url = new URL(response.url());
        if (!headers && response.request().method() === "GET" && url.hostname === "api.koper.com.br" && url.pathname === "/financial/v1/receipt") headers = response.request().headers();
      } catch {}
    };
    page.on("response", onResponse);
    await page.goto("https://app.koper.com.br/financeiro/notas_manuais/view/458", { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    for (let i = 0; i < 10 && !headers; i += 1) await page.waitForTimeout(400);
    page.off("response", onResponse);
    if (!headers) return { ok: false, message: "KOPER_FINANCIAL_RECEIPT_TRANSPORT_NOT_CAPTURED", blockedWrites };

    const results: Json[] = [];
    const concurrency = 8;
    for (let index = 0; index < selected.length; index += concurrency) {
      const group = selected.slice(index, index + concurrency);
      results.push(...await Promise.all(group.map(async (receiptId) => {
        try {
          const response = await page.request.get(`https://api.koper.com.br/financial/v1/receipt?receiptId=${encodeURIComponent(receiptId)}`, { headers: headers!, timeout: 8_000 });
          const body = object(await response.json().catch(() => null));
          const products = Array.isArray(body.products) ? body.products : [];
          const orderIds = [...new Set(products.flatMap((product) => {
            const orders = Array.isArray(object(product).orders) ? object(product).orders as unknown[] : [];
            return orders.flatMap((order) => { const id = identifier(object(order).orderId); return id ? [id] : []; });
          }))];
          return {
            receiptId, status: response.status(), entries: [...(receiptToEntries.get(receiptId) ?? [])], orderIds,
            importedOrderIds: orderIds.filter((id) => nativeOrderBySource.has(id)),
            missingNativeOrderIds: orderIds.filter((id) => !nativeOrderBySource.has(id)),
            products: products.length,
          };
        } catch (error: unknown) {
          return { receiptId, entries: [...(receiptToEntries.get(receiptId) ?? [])], error: error instanceof Error ? error.message.slice(0, 300) : "unknown" };
        }
      })));
    }
    return { ok: true, readOnly: true, blockedWrites, results };
  }, { sessionTimeoutMs: 58_000 });

  const resultRows = object(live).results as Json[] | undefined;
  const mappedEntries = new Set((resultRows ?? []).flatMap((row) => identifierArray(row.entries)).filter((entryId) => identifierArray(row.orderIds).length > 0));
  console.log("KOPER_FINANCIAL_RECEIPT_ORDER_RESOLUTION", JSON.stringify({
    ok: true, readOnly: true,
    source: { programmedEntries: programmed.size, missingOrderEntriesWithReceipts: missingOrderEntries.size, uniqueReceiptIds: receiptIdsAll.length },
    batch: { offset: batchOffset, size: batchSize, selected: selected.length },
    result: { mappedEntries: mappedEntries.size },
    live,
  }));
} catch (error: unknown) {
  console.error("KOPER_FINANCIAL_RECEIPT_ORDER_RESOLUTION_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1500) : "unknown" }));
}

await import("./index.js");
