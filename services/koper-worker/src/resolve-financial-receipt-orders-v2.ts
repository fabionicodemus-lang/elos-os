import type { Response } from "playwright-core";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
type StagingRow = {
  koper_id: string;
  koper_parent_id: string | null;
  payload: unknown;
};
type NativeOrderRow = {
  source_id: string | null;
  order_number: string;
};
type ReceiptResolution = {
  receiptId: string;
  entries: string[];
  status?: number;
  productCount?: number;
  orderIds?: string[];
  importedOrderIds?: string[];
  missingNativeOrderIds?: string[];
  orderProductIds?: string[];
  error?: string;
};

function objectValue(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Json
    : {};
}

function identifier(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const id = identifier(item);
    return id ? [id] : [];
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function readAll<T>(resource: string, query: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(resource, {
      query: new URLSearchParams({
        ...query,
        limit: "1000",
        offset: String(offset),
      }),
    });
    rows.push(...page);
    if (page.length < 1_000) break;
  }
  return rows;
}

function receiptIdsFromItem(payload: Json): string[] {
  const receipts = Array.isArray(payload.receipts) ? payload.receipts : [];
  return unique(receipts.flatMap((receipt) => {
    const id = identifier(objectValue(receipt).receiptId);
    return id ? [id] : [];
  }));
}

function orderIdsFromReceipt(payload: Json): string[] {
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

function orderProductIdsFromReceipt(payload: Json): string[] {
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

const batchOffset = Math.max(
  0,
  Number(process.env.KOPER_FINANCIAL_RECEIPT_BATCH_OFFSET ?? "0") || 0,
);
const batchSize = Math.min(
  30,
  Math.max(1, Number(process.env.KOPER_FINANCIAL_RECEIPT_BATCH_SIZE ?? "20") || 20),
);

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
      select: "source_id,order_number",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      order: "source_id.asc",
    }),
  ]);

  const programmedEntryIds = new Set(
    entries
      .filter((row) => identifier(objectValue(row.payload).originType) === "0")
      .map((row) => row.koper_id),
  );

  const itemsByEntry = new Map<string, StagingRow[]>();
  for (const item of items) {
    const entryId = item.koper_parent_id;
    if (!entryId || !programmedEntryIds.has(entryId)) continue;
    const group = itemsByEntry.get(entryId) ?? [];
    group.push(item);
    itemsByEntry.set(entryId, group);
  }

  const missingOrderReceiptIdsByEntry = new Map<string, string[]>();
  for (const entryId of programmedEntryIds) {
    const entryItems = itemsByEntry.get(entryId) ?? [];
    if (!entryItems.length) continue;

    const hasAnyCandidateOrder = entryItems.some((item) =>
      stringArray(objectValue(item.payload).candidatePurchaseOrderIds).length > 0,
    );
    if (hasAnyCandidateOrder) continue;

    const receiptIds = unique(entryItems.flatMap((item) =>
      receiptIdsFromItem(objectValue(item.payload)),
    ));
    if (receiptIds.length) missingOrderReceiptIdsByEntry.set(entryId, receiptIds);
  }

  const receiptToEntries = new Map<string, Set<string>>();
  for (const [entryId, receiptIds] of missingOrderReceiptIdsByEntry) {
    for (const receiptId of receiptIds) {
      const entryIds = receiptToEntries.get(receiptId) ?? new Set<string>();
      entryIds.add(entryId);
      receiptToEntries.set(receiptId, entryIds);
    }
  }

  const allReceiptIds = [...receiptToEntries.keys()].sort((left, right) =>
    Number(left) - Number(right),
  );
  const selectedReceiptIds = allReceiptIds.slice(batchOffset, batchOffset + batchSize);
  const nativeOrderSourceIds = new Set(
    nativeOrders.flatMap((row) => row.source_id ? [row.source_id] : []),
  );

  const live = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) {
      return { ok: false, message: login.message, blockedWrites: 0, results: [] };
    }

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

    const flowSelected = await selectFlow(page);
    if (!flowSelected) {
      return {
        ok: false,
        message: "KOPER_FLOW_COMPANY_NOT_SELECTED",
        blockedWrites,
        results: [],
      };
    }

    let financialHeaders: Record<string, string> | null = null;
    const capture = (response: Response): void => {
      try {
        const url = new URL(response.url());
        if (
          !financialHeaders
          && response.request().method() === "GET"
          && url.hostname === "api.koper.com.br"
          && url.pathname === "/financial/v1/receipt"
        ) {
          financialHeaders = response.request().headers();
        }
      } catch {
        // Ignore malformed URLs.
      }
    };

    page.on("response", capture);
    await page.goto("https://app.koper.com.br/financeiro/notas_manuais/view/458", {
      waitUntil: "domcontentloaded",
      timeout: 12_000,
    }).catch(() => undefined);
    for (let attempt = 0; attempt < 10 && !financialHeaders; attempt += 1) {
      await page.waitForTimeout(350);
    }
    page.off("response", capture);

    if (!financialHeaders) {
      return {
        ok: false,
        message: "KOPER_FINANCIAL_RECEIPT_TRANSPORT_NOT_CAPTURED",
        blockedWrites,
        results: [],
      };
    }

    const results: ReceiptResolution[] = [];
    const concurrency = 8;
    for (let index = 0; index < selectedReceiptIds.length; index += concurrency) {
      const group = selectedReceiptIds.slice(index, index + concurrency);
      const resolved = await Promise.all(group.map(async (receiptId): Promise<ReceiptResolution> => {
        const linkedEntries = [...(receiptToEntries.get(receiptId) ?? [])].sort(
          (left, right) => Number(left) - Number(right),
        );
        try {
          const response = await page.request.get(
            `https://api.koper.com.br/financial/v1/receipt?receiptId=${encodeURIComponent(receiptId)}`,
            { headers: financialHeaders!, timeout: 8_000 },
          );
          const payload = objectValue(await response.json().catch(() => null));
          const orderIds = orderIdsFromReceipt(payload);
          return {
            receiptId,
            entries: linkedEntries,
            status: response.status(),
            productCount: Array.isArray(payload.products) ? payload.products.length : 0,
            orderIds,
            importedOrderIds: orderIds.filter((orderId) => nativeOrderSourceIds.has(orderId)),
            missingNativeOrderIds: orderIds.filter((orderId) => !nativeOrderSourceIds.has(orderId)),
            orderProductIds: orderProductIdsFromReceipt(payload),
          };
        } catch (error: unknown) {
          return {
            receiptId,
            entries: linkedEntries,
            error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
          };
        }
      }));
      results.push(...resolved);
    }

    return {
      ok: true,
      readOnly: true,
      blockedWrites,
      results,
    };
  }, { sessionTimeoutMs: 58_000 });

  const liveObject = objectValue(live);
  const resultRows = Array.isArray(liveObject.results)
    ? liveObject.results.map((row) => objectValue(row))
    : [];

  const mappedEntryIds = new Set<string>();
  const entriesWithImportedOrder = new Set<string>();
  const entriesWithMissingNativeOrder = new Set<string>();
  let failedReceipts = 0;

  for (const row of resultRows) {
    const entryIds = stringArray(row.entries);
    const orderIds = stringArray(row.orderIds);
    const importedOrderIds = stringArray(row.importedOrderIds);
    const missingNativeOrderIds = stringArray(row.missingNativeOrderIds);
    if (identifier(row.error)) failedReceipts += 1;
    if (orderIds.length) entryIds.forEach((entryId) => mappedEntryIds.add(entryId));
    if (importedOrderIds.length) entryIds.forEach((entryId) => entriesWithImportedOrder.add(entryId));
    if (missingNativeOrderIds.length) {
      entryIds.forEach((entryId) => entriesWithMissingNativeOrder.add(entryId));
    }
  }

  console.log("KOPER_FINANCIAL_RECEIPT_ORDER_RESOLUTION_V2", JSON.stringify({
    ok: true,
    readOnly: true,
    source: {
      programmedEntries: programmedEntryIds.size,
      entriesWithoutCandidateOrderWithReceipt: missingOrderReceiptIdsByEntry.size,
      uniqueReceiptIds: allReceiptIds.length,
      nativeOrders: nativeOrders.length,
    },
    batch: {
      offset: batchOffset,
      size: batchSize,
      selectedReceiptIds: selectedReceiptIds.length,
      hasMore: batchOffset + selectedReceiptIds.length < allReceiptIds.length,
      nextOffset: batchOffset + selectedReceiptIds.length,
    },
    result: {
      mappedEntries: mappedEntryIds.size,
      entriesWithImportedOrder: entriesWithImportedOrder.size,
      entriesWithMissingNativeOrder: entriesWithMissingNativeOrder.size,
      failedReceipts,
    },
    live,
  }));
} catch (error: unknown) {
  console.error("KOPER_FINANCIAL_RECEIPT_ORDER_RESOLUTION_V2_FAILED", JSON.stringify({
    message: error instanceof Error ? error.message.slice(0, 1_500) : "unknown",
  }));
}

await import("./index.js");
