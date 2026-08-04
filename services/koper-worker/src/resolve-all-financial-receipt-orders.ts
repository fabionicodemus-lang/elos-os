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
type ReceiptResolution = {
  receiptId: string;
  entries: string[];
  status?: number;
  productCount: number;
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

function itemReceiptIds(payload: Json): string[] {
  const receipts = Array.isArray(payload.receipts) ? payload.receipts : [];
  return unique(receipts.flatMap((receipt) => {
    const id = identifier(objectValue(receipt).receiptId);
    return id ? [id] : [];
  }));
}

function receiptProducts(payload: Json): Json[] {
  return Array.isArray(payload.products)
    ? payload.products.map((product) => objectValue(product))
    : [];
}

function productOrders(product: Json): Json[] {
  return Array.isArray(product.orders)
    ? product.orders.map((order) => objectValue(order))
    : [];
}

function receiptOrderIds(payload: Json): string[] {
  return unique(receiptProducts(payload).flatMap((product) =>
    productOrders(product).flatMap((order) => {
      const id = identifier(order.orderId);
      return id ? [id] : [];
    }),
  ));
}

function receiptOrderProductIds(payload: Json): string[] {
  return unique(receiptProducts(payload).flatMap((product) =>
    productOrders(product).flatMap((order) => {
      const id = identifier(order.orderProductId);
      return id ? [id] : [];
    }),
  ));
}

async function resolveBatch(
  receiptIds: string[],
  receiptToEntries: Map<string, Set<string>>,
  nativeOrderIds: Set<string>,
  batchIndex: number,
): Promise<{ blockedWrites: number; results: ReceiptResolution[] }> {
  return withBrowserless(async ({ page }) => {
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

    const results: ReceiptResolution[] = [];
    const concurrency = 10;
    for (let index = 0; index < receiptIds.length; index += concurrency) {
      const group = receiptIds.slice(index, index + concurrency);
      results.push(...await Promise.all(group.map(async (receiptId): Promise<ReceiptResolution> => {
        const entries = [...(receiptToEntries.get(receiptId) ?? [])].sort((a, b) => Number(a) - Number(b));
        try {
          const response = await page.request.get(
            `https://api.koper.com.br/financial/v1/receipt?receiptId=${encodeURIComponent(receiptId)}`,
            { headers: headers!, timeout: 8_000 },
          );
          const payload = objectValue(await response.json().catch(() => null));
          const orderIds = receiptOrderIds(payload);
          return {
            receiptId,
            entries,
            status: response.status(),
            productCount: receiptProducts(payload).length,
            orderIds,
            importedOrderIds: orderIds.filter((orderId) => nativeOrderIds.has(orderId)),
            missingNativeOrderIds: orderIds.filter((orderId) => !nativeOrderIds.has(orderId)),
            orderProductIds: receiptOrderProductIds(payload),
          };
        } catch (error: unknown) {
          return {
            receiptId,
            entries,
            productCount: 0,
            orderIds: [],
            importedOrderIds: [],
            missingNativeOrderIds: [],
            orderProductIds: [],
            error: error instanceof Error ? error.message.slice(0, 240) : "unknown",
          };
        }
      })));
    }

    console.log("KOPER_FINANCIAL_RECEIPT_ALL_BATCH", JSON.stringify({
      batchIndex,
      selectedReceipts: receiptIds.length,
      mappedReceipts: results.filter((row) => row.orderIds.length > 0).length,
      receiptsWithoutOrder: results.filter((row) => !row.error && row.orderIds.length === 0).length,
      failedReceipts: results.filter((row) => Boolean(row.error)).length,
      entries: unique(results.flatMap((row) => row.entries)).length,
      mappedEntries: unique(results.filter((row) => row.orderIds.length > 0).flatMap((row) => row.entries)).length,
      entriesWithMissingNativeOrder: unique(results.filter((row) => row.missingNativeOrderIds.length > 0).flatMap((row) => row.entries)).length,
      blockedWrites,
      firstReceiptId: receiptIds[0] ?? null,
      lastReceiptId: receiptIds.at(-1) ?? null,
    }));

    for (const row of results.filter((result) =>
      result.error || result.orderIds.length === 0 || result.missingNativeOrderIds.length > 0
    )) {
      console.log("KOPER_FINANCIAL_RECEIPT_ALL_EXCEPTION", JSON.stringify(row));
    }

    return { blockedWrites, results };
  }, { sessionTimeoutMs: 58_000 });
}

await import("./index.js");
console.log("KOPER_FINANCIAL_RECEIPT_ALL_START", JSON.stringify({ readOnly: true }));

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
  const entriesWithoutReceipt: string[] = [];
  for (const entryId of programmedEntries) {
    const entryItems = itemsByEntry.get(entryId) ?? [];
    if (!entryItems.length) continue;
    if (entryItems.some((item) => identifiers(objectValue(item.payload).candidatePurchaseOrderIds).length > 0)) continue;
    const ids = unique(entryItems.flatMap((item) => itemReceiptIds(objectValue(item.payload))));
    if (ids.length) entryReceipts.set(entryId, ids);
    else entriesWithoutReceipt.push(entryId);
  }

  const receiptToEntries = new Map<string, Set<string>>();
  for (const [entryId, receiptIds] of entryReceipts) {
    for (const receiptId of receiptIds) {
      const linked = receiptToEntries.get(receiptId) ?? new Set<string>();
      linked.add(entryId);
      receiptToEntries.set(receiptId, linked);
    }
  }

  const allReceiptIds = [...receiptToEntries.keys()].sort((a, b) => Number(a) - Number(b));
  const nativeOrderIds = new Set(nativeOrders.flatMap((row) => row.source_id ? [row.source_id] : []));
  const batchSize = 30;

  console.log("KOPER_FINANCIAL_RECEIPT_ALL_SOURCE", JSON.stringify({
    programmedEntries: programmedEntries.size,
    entriesWithoutCandidateOrderWithReceipt: entryReceipts.size,
    entriesWithoutCandidateOrderAndWithoutReceipt: entriesWithoutReceipt.length,
    uniqueReceiptIds: allReceiptIds.length,
    nativeOrders: nativeOrderIds.size,
    batchSize,
  }));

  const allResults: ReceiptResolution[] = [];
  let totalBlockedWrites = 0;
  let failedBatches = 0;

  for (let offset = 0, batchIndex = 0; offset < allReceiptIds.length; offset += batchSize, batchIndex += 1) {
    const selected = allReceiptIds.slice(offset, offset + batchSize);
    try {
      const batch = await resolveBatch(selected, receiptToEntries, nativeOrderIds, batchIndex);
      totalBlockedWrites += batch.blockedWrites;
      allResults.push(...batch.results);
    } catch (error: unknown) {
      failedBatches += 1;
      console.error("KOPER_FINANCIAL_RECEIPT_ALL_BATCH_FAILED", JSON.stringify({
        batchIndex,
        offset,
        selectedReceipts: selected.length,
        firstReceiptId: selected[0] ?? null,
        lastReceiptId: selected.at(-1) ?? null,
        message: error instanceof Error ? error.message.slice(0, 500) : "unknown",
      }));
    }
  }

  const mappedEntries = unique(allResults.filter((row) => row.orderIds.length > 0).flatMap((row) => row.entries));
  const importedEntries = unique(allResults.filter((row) => row.importedOrderIds.length > 0).flatMap((row) => row.entries));
  const missingNativeEntries = unique(allResults.filter((row) => row.missingNativeOrderIds.length > 0).flatMap((row) => row.entries));
  const unresolvedReceiptEntries = unique(allResults.filter((row) => row.orderIds.length === 0).flatMap((row) => row.entries));
  const uniqueOrderIds = unique(allResults.flatMap((row) => row.orderIds));
  const uniqueOrderProductIds = unique(allResults.flatMap((row) => row.orderProductIds));

  console.log("KOPER_FINANCIAL_RECEIPT_ALL_DONE", JSON.stringify({
    ok: failedBatches === 0,
    readOnly: true,
    source: {
      programmedEntries: programmedEntries.size,
      entriesWithoutCandidateOrderWithReceipt: entryReceipts.size,
      entriesWithoutCandidateOrderAndWithoutReceipt: entriesWithoutReceipt.length,
      uniqueReceiptIds: allReceiptIds.length,
    },
    result: {
      processedReceipts: allResults.length,
      mappedReceipts: allResults.filter((row) => row.orderIds.length > 0).length,
      receiptsWithoutOrder: allResults.filter((row) => !row.error && row.orderIds.length === 0).length,
      failedReceipts: allResults.filter((row) => Boolean(row.error)).length,
      mappedEntries: mappedEntries.length,
      entriesWithImportedOrder: importedEntries.length,
      entriesWithMissingNativeOrder: missingNativeEntries.length,
      entriesLinkedOnlyToReceiptWithoutOrder: unresolvedReceiptEntries.length,
      uniqueOrderIds: uniqueOrderIds.length,
      uniqueOrderProductIds: uniqueOrderProductIds.length,
      failedBatches,
      blockedWrites: totalBlockedWrites,
    },
    entriesWithoutReceipt: entriesWithoutReceipt.slice(0, 50),
    missingNativeEntries: missingNativeEntries.slice(0, 50),
  }));
} catch (error: unknown) {
  console.error("KOPER_FINANCIAL_RECEIPT_ALL_FAILED", JSON.stringify({
    message: error instanceof Error ? error.message.slice(0, 1_200) : "unknown",
  }));
}
