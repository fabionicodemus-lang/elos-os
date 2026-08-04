import type { Response } from "playwright-core";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type NativeOrderRow = { source_id: string | null };
type Resolution = {
  receiptId: string;
  entries: string[];
  status?: number;
  products?: number;
  orderIds: string[];
  importedOrderIds: string[];
  missingNativeOrderIds: string[];
  orderProductIds: string[];
  error?: string;
};

const objectValue = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};

const identifier = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const identifiers = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
      const id = identifier(item);
      return id ? [id] : [];
    })
    : [];

const unique = (values: string[]): string[] => [...new Set(values)];

async function readAll<T>(resource: string, query: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(resource, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
    });
    rows.push(...page);
    if (page.length < 1_000) break;
  }
  return rows;
}

function receiptIds(payload: Json): string[] {
  const receipts = Array.isArray(payload.receipts) ? payload.receipts : [];
  return unique(receipts.flatMap((receipt) => {
    const id = identifier(objectValue(receipt).receiptId);
    return id ? [id] : [];
  }));
}

function receiptOrderIds(payload: Json): string[] {
  const products = Array.isArray(payload.products) ? payload.products : [];
  return unique(products.flatMap((product) => {
    const orders = Array.isArray(objectValue(product).orders)
      ? objectValue(product).orders as unknown[]
      : [];
    return orders.flatMap((order) => {
      const id = identifier(objectValue(order).orderId);
      return id ? [id] : [];
    });
  }));
}

function receiptOrderProductIds(payload: Json): string[] {
  const products = Array.isArray(payload.products) ? payload.products : [];
  return unique(products.flatMap((product) => {
    const orders = Array.isArray(objectValue(product).orders)
      ? objectValue(product).orders as unknown[]
      : [];
    return orders.flatMap((order) => {
      const id = identifier(objectValue(order).orderProductId);
      return id ? [id] : [];
    });
  }));
}

const batchOffset = Math.max(0, Number(process.env.KOPER_FINANCIAL_RECEIPT_BATCH_OFFSET ?? "0") || 0);
const batchSize = Math.min(30, Math.max(1, Number(process.env.KOPER_FINANCIAL_RECEIPT_BATCH_SIZE ?? "20") || 20));

console.log("KOPER_FINANCIAL_RECEIPT_RESOLVER_V3_START", JSON.stringify({
  readOnly: true,
  batchOffset,
  batchSize,
}));

try {
  const [entries, items, nativeOrders] = await Promise.all([
    readAll<StagingRow>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.stock_entry",
      sync_state: "eq.present",
      order: "koper_id.asc",
    }),
    readAll<StagingRow>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.stock_entry_item",
      sync_state: "eq.present",
      order: "koper_id.asc",
    }),
    readAll<NativeOrderRow>("procurement_purchase_orders", {
      select: "source_id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      order: "source_id.asc",
    }),
  ]);

  const programmedEntries = new Set(
    entries
      .filter((row) => identifier(objectValue(row.payload).originType) === "0")
      .map((row) => row.koper_id),
  );
  const itemsByEntry = new Map<string, StagingRow[]>();
  for (const item of items) {
    const entryId = item.koper_parent_id;
    if (!entryId || !programmedEntries.has(entryId)) continue;
    const group = itemsByEntry.get(entryId) ?? [];
    group.push(item);
    itemsByEntry.set(entryId, group);
  }

  const entryReceipts = new Map<string, string[]>();
  for (const entryId of programmedEntries) {
    const entryItems = itemsByEntry.get(entryId) ?? [];
    if (!entryItems.length) continue;
    if (entryItems.some((item) => identifiers(objectValue(item.payload).candidatePurchaseOrderIds).length > 0)) continue;
    const ids = unique(entryItems.flatMap((item) => receiptIds(objectValue(item.payload))));
    if (ids.length) entryReceipts.set(entryId, ids);
  }

  const receiptToEntries = new Map<string, Set<string>>();
  for (const [entryId, ids] of entryReceipts) {
    for (const receiptId of ids) {
      const linked = receiptToEntries.get(receiptId) ?? new Set<string>();
      linked.add(entryId);
      receiptToEntries.set(receiptId, linked);
    }
  }

  const allReceiptIds = [...receiptToEntries.keys()].sort((a, b) => Number(a) - Number(b));
  const selectedReceiptIds = allReceiptIds.slice(batchOffset, batchOffset + batchSize);
  const nativeOrderIds = new Set(nativeOrders.flatMap((row) => row.source_id ? [row.source_id] : []));

  console.log("KOPER_FINANCIAL_RECEIPT_RESOLVER_V3_SOURCE", JSON.stringify({
    programmedEntries: programmedEntries.size,
    entriesWithoutCandidateOrderWithReceipt: entryReceipts.size,
    uniqueReceiptIds: allReceiptIds.length,
    nativeOrders: nativeOrderIds.size,
    selectedReceiptIds: selectedReceiptIds.length,
    firstSelectedReceiptId: selectedReceiptIds[0] ?? null,
    lastSelectedReceiptId: selectedReceiptIds.at(-1) ?? null,
  }));

  const resolutions = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) throw new Error(login.message ?? "KOPER_LOGIN_FAILED");

    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (
          isKoper
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

    let headers: Record<string, string> | null = null;
    const capture = (response: Response): void => {
      try {
        const url = new URL(response.url());
        if (
          !headers
          && response.request().method() === "GET"
          && url.hostname === "api.koper.com.br"
          && url.pathname === "/financial/v1/receipt"
        ) headers = response.request().headers();
      } catch {
        // Ignore malformed URLs.
      }
    };
    page.on("response", capture);
    await page.goto("https://app.koper.com.br/financeiro/notas_manuais/view/458", {
      waitUntil: "domcontentloaded",
      timeout: 12_000,
    }).catch(() => undefined);
    for (let attempt = 0; attempt < 10 && !headers; attempt += 1) await page.waitForTimeout(350);
    page.off("response", capture);
    if (!headers) throw new Error("KOPER_FINANCIAL_RECEIPT_TRANSPORT_NOT_CAPTURED");

    console.log("KOPER_FINANCIAL_RECEIPT_RESOLVER_V3_TRANSPORT", JSON.stringify({
      captured: true,
      blockedWrites,
    }));

    const results: Resolution[] = [];
    const concurrency = 8;
    for (let index = 0; index < selectedReceiptIds.length; index += concurrency) {
      const group = selectedReceiptIds.slice(index, index + concurrency);
      const groupResults = await Promise.all(group.map(async (receiptId): Promise<Resolution> => {
        const linkedEntries = [...(receiptToEntries.get(receiptId) ?? [])].sort((a, b) => Number(a) - Number(b));
        try {
          const response = await page.request.get(
            `https://api.koper.com.br/financial/v1/receipt?receiptId=${encodeURIComponent(receiptId)}`,
            { headers: headers!, timeout: 8_000 },
          );
          const payload = objectValue(await response.json().catch(() => null));
          const orderIds = receiptOrderIds(payload);
          return {
            receiptId,
            entries: linkedEntries,
            status: response.status(),
            products: Array.isArray(payload.products) ? payload.products.length : 0,
            orderIds,
            importedOrderIds: orderIds.filter((orderId) => nativeOrderIds.has(orderId)),
            missingNativeOrderIds: orderIds.filter((orderId) => !nativeOrderIds.has(orderId)),
            orderProductIds: receiptOrderProductIds(payload),
          };
        } catch (error: unknown) {
          return {
            receiptId,
            entries: linkedEntries,
            orderIds: [],
            importedOrderIds: [],
            missingNativeOrderIds: [],
            orderProductIds: [],
            error: error instanceof Error ? error.message.slice(0, 240) : "unknown",
          };
        }
      }));
      for (const result of groupResults) {
        console.log("KOPER_FINANCIAL_RECEIPT_RESOLVER_V3_ROW", JSON.stringify(result));
        results.push(result);
      }
    }
    return { blockedWrites, results };
  }, { sessionTimeoutMs: 58_000 });

  const mappedEntries = new Set<string>();
  const importedEntries = new Set<string>();
  const missingNativeEntries = new Set<string>();
  let failedReceipts = 0;
  for (const result of resolutions.results) {
    if (result.error) failedReceipts += 1;
    if (result.orderIds.length) result.entries.forEach((entryId) => mappedEntries.add(entryId));
    if (result.importedOrderIds.length) result.entries.forEach((entryId) => importedEntries.add(entryId));
    if (result.missingNativeOrderIds.length) result.entries.forEach((entryId) => missingNativeEntries.add(entryId));
  }

  console.log("KOPER_FINANCIAL_RECEIPT_RESOLVER_V3_DONE", JSON.stringify({
    readOnly: true,
    batch: {
      offset: batchOffset,
      selected: selectedReceiptIds.length,
      nextOffset: batchOffset + selectedReceiptIds.length,
      hasMore: batchOffset + selectedReceiptIds.length < allReceiptIds.length,
    },
    result: {
      mappedEntries: mappedEntries.size,
      entriesWithImportedOrder: importedEntries.size,
      entriesWithMissingNativeOrder: missingNativeEntries.size,
      failedReceipts,
      blockedWrites: resolutions.blockedWrites,
    },
  }));
} catch (error: unknown) {
  console.error("KOPER_FINANCIAL_RECEIPT_RESOLVER_V3_FAILED", JSON.stringify({
    message: error instanceof Error ? error.message.slice(0, 1_200) : "unknown",
  }));
}

await import("./index.js");
