import type { Response } from "playwright-core";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type NativeOrder = { id: string; source_id: string | null; order_number: string };
type NativeOrderItem = {
  id: string;
  order_id: string;
  source_id: string | null;
  input_id: string;
  input_code: string;
  input_name: string;
  ordered_quantity: number;
  received_quantity: number;
  accepted_quantity: number;
  rejected_quantity: number;
};
type ExistingReceipt = { id: string; notes: string | null };
type FinancialProduct = {
  receiptId: string;
  receiptProductId: string | null;
  productId: string | null;
  mainProductId: string | null;
  genericProdSeq: string | null;
  inputId: string | null;
  productAmount: number | null;
  orders: Array<{
    orderId: string | null;
    orderProductId: string | null;
    productAmount: number | null;
    amountReceived: number | null;
    amount: number | null;
  }>;
};
type ReceiptResult = { receiptId: string; status?: number; products: FinancialProduct[]; error?: string };

type ItemPlan = {
  entryId: string;
  entryItemId: string;
  receiptId: string;
  receiptProductId: string | null;
  sourceQuantity: number;
  receiptQuantity: number;
  orderId: string;
  orderProductId: string;
  nativeOrderId: string;
  nativeOrderItemId: string;
  inputId: string;
};

const objectValue = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};

const identifier = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const numberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const identifiers = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.flatMap((item) => {
      const id = identifier(item);
      return id ? [id] : [];
    }))]
    : [];

const unique = (values: string[]): string[] => [...new Set(values)];
const baseSourceId = (value: string | null): string | null => identifier(value)?.split(":")[0] ?? null;
const approximatelyEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= Math.max(0.000001, Math.abs(right) * 0.000001);

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

function financialProducts(receiptId: string, payload: Json): FinancialProduct[] {
  const products = Array.isArray(payload.products) ? payload.products : [];
  return products.map((raw): FinancialProduct => {
    const product = objectValue(raw);
    const orders = Array.isArray(product.orders) ? product.orders : [];
    return {
      receiptId,
      receiptProductId: identifier(product.receiptProductId),
      productId: identifier(product.productId),
      mainProductId: identifier(product.mainProductId),
      genericProdSeq: identifier(product.genericProdSeq),
      inputId: identifier(product.inputId),
      productAmount: numberValue(product.productAmount),
      orders: orders.map((rawOrder) => {
        const order = objectValue(rawOrder);
        return {
          orderId: identifier(order.orderId),
          orderProductId: identifier(order.orderProductId),
          productAmount: numberValue(order.productAmount),
          amountReceived: numberValue(order.amountReceived),
          amount: numberValue(order.amount),
        };
      }),
    };
  });
}

function productScore(source: Json, candidate: FinancialProduct): number {
  const productId = identifier(source.productId);
  const mainProductId = identifier(source.mainProductId);
  const genericProdSeq = identifier(source.genericProdSeq);
  if (productId && candidate.productId === productId) return 100;
  if (mainProductId && candidate.productId === mainProductId) return 95;
  if (genericProdSeq && candidate.genericProdSeq === genericProdSeq) return 90;
  if (mainProductId && candidate.mainProductId === mainProductId) return 80;
  if (productId && candidate.mainProductId === productId) return 70;
  return 0;
}

async function fetchReceiptBatch(receiptIds: string[]): Promise<{ blockedWrites: number; results: ReceiptResult[] }> {
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

    const results: ReceiptResult[] = [];
    const concurrency = 10;
    for (let index = 0; index < receiptIds.length; index += concurrency) {
      const group = receiptIds.slice(index, index + concurrency);
      results.push(...await Promise.all(group.map(async (receiptId): Promise<ReceiptResult> => {
        try {
          const response = await page.request.get(
            `https://api.koper.com.br/financial/v1/receipt?receiptId=${encodeURIComponent(receiptId)}`,
            { headers: headers!, timeout: 8_000 },
          );
          const payload = objectValue(await response.json().catch(() => null));
          return {
            receiptId,
            status: response.status(),
            products: financialProducts(receiptId, payload),
          };
        } catch (error: unknown) {
          return {
            receiptId,
            products: [],
            error: error instanceof Error ? error.message.slice(0, 240) : "unknown",
          };
        }
      })));
    }
    return { blockedWrites, results };
  }, { sessionTimeoutMs: 58_000 });
}

await import("./index.js");
console.log("KOPER_FINANCIAL_RECEIPT_PROMOTION_PLAN_START", JSON.stringify({ readOnly: true }));

try {
  const [entries, items, orders, orderItems, existingReceipts] = await Promise.all([
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
    readAll<NativeOrder>("procurement_purchase_orders", {
      select: "id,source_id,order_number",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      order: "source_id.asc",
    }),
    readAll<NativeOrderItem>("procurement_purchase_order_items", {
      select: "id,order_id,source_id,input_id,input_code,input_name,ordered_quantity,received_quantity,accepted_quantity,rejected_quantity",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      order: "order_id.asc,sort_order.asc",
    }),
    readAll<ExistingReceipt>("procurement_material_receipts", {
      select: "id,notes",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      order: "id.asc",
    }),
  ]);

  const entryById = new Map(entries.map((entry) => [entry.koper_id, entry]));
  const programmedEntries = new Set(
    entries
      .filter((entry) => identifier(objectValue(entry.payload).originType) === "0")
      .map((entry) => entry.koper_id),
  );
  const itemsByEntry = new Map<string, StagingRow[]>();
  for (const item of items) {
    const entryId = item.koper_parent_id;
    if (!entryId || !programmedEntries.has(entryId)) continue;
    const group = itemsByEntry.get(entryId) ?? [];
    group.push(item);
    itemsByEntry.set(entryId, group);
  }

  const candidateEntries = new Map<string, string[]>();
  for (const entryId of programmedEntries) {
    const entryItems = itemsByEntry.get(entryId) ?? [];
    if (!entryItems.length) continue;
    if (entryItems.some((item) => identifiers(objectValue(item.payload).candidatePurchaseOrderIds).length > 0)) continue;
    const ids = unique(entryItems.flatMap((item) => receiptIds(objectValue(item.payload))));
    if (ids.length) candidateEntries.set(entryId, ids);
  }

  const allReceiptIds = unique([...candidateEntries.values()].flat()).sort((a, b) => Number(a) - Number(b));
  const productsByReceipt = new Map<string, FinancialProduct[]>();
  let blockedWrites = 0;
  let failedBatches = 0;
  const batchSize = 30;

  for (let offset = 0, batchIndex = 0; offset < allReceiptIds.length; offset += batchSize, batchIndex += 1) {
    const selected = allReceiptIds.slice(offset, offset + batchSize);
    try {
      const batch = await fetchReceiptBatch(selected);
      blockedWrites += batch.blockedWrites;
      for (const result of batch.results) productsByReceipt.set(result.receiptId, result.products);
      console.log("KOPER_FINANCIAL_RECEIPT_PROMOTION_PLAN_BATCH", JSON.stringify({
        batchIndex,
        selected: selected.length,
        fetched: batch.results.filter((row) => !row.error).length,
        failed: batch.results.filter((row) => Boolean(row.error)).length,
        products: batch.results.reduce((sum, row) => sum + row.products.length, 0),
        blockedWrites: batch.blockedWrites,
      }));
    } catch (error: unknown) {
      failedBatches += 1;
      console.error("KOPER_FINANCIAL_RECEIPT_PROMOTION_PLAN_BATCH_FAILED", JSON.stringify({
        batchIndex,
        message: error instanceof Error ? error.message.slice(0, 500) : "unknown",
      }));
    }
  }

  const orderBySource = new Map(orders.flatMap((order) => order.source_id ? [[order.source_id, order] as const] : []));
  const orderItemsByKey = new Map<string, NativeOrderItem[]>();
  for (const item of orderItems) {
    const sourceId = baseSourceId(item.source_id);
    if (!sourceId) continue;
    const key = `${item.order_id}:${sourceId}`;
    orderItemsByKey.set(key, [...(orderItemsByKey.get(key) ?? []), item]);
  }

  const alreadyPromoted = new Set<string>();
  for (const receipt of existingReceipts) {
    const match = receipt.notes?.match(/Koper stockMovementId=(\d+)/);
    if (match?.[1]) alreadyPromoted.add(match[1]);
  }

  const safeEntries: Array<{ entryId: string; itemCount: number; orderIds: string[] }> = [];
  const itemPlans: ItemPlan[] = [];
  const excluded: Record<string, number> = {
    alreadyPromoted: 0,
    missingEntry: 0,
    missingReceiptData: 0,
    missingReceiptProduct: 0,
    ambiguousReceiptProduct: 0,
    missingOrderAllocation: 0,
    allocationSplit: 0,
    missingNativeOrder: 0,
    missingNativeOrderItem: 0,
    nativeAllocationSplit: 0,
    invalidQuantity: 0,
    receiptQuantityMismatch: 0,
    allocationQuantityMismatch: 0,
  };

  for (const [entryId, linkedReceiptIds] of candidateEntries) {
    if (alreadyPromoted.has(entryId)) {
      excluded.alreadyPromoted += 1;
      continue;
    }
    const entry = entryById.get(entryId);
    if (!entry) {
      excluded.missingEntry += 1;
      continue;
    }
    const entryItems = itemsByEntry.get(entryId) ?? [];
    const entryPlans: ItemPlan[] = [];
    let entryReason: keyof typeof excluded | null = null;

    for (const item of entryItems) {
      const payload = objectValue(item.payload);
      const itemReceiptIds = receiptIds(payload).filter((receiptId) => linkedReceiptIds.includes(receiptId));
      const candidateProducts = itemReceiptIds.flatMap((receiptId) =>
        (productsByReceipt.get(receiptId) ?? []).map((product) => ({
          product,
          score: productScore(payload, product),
        })),
      ).filter((candidate) => candidate.score > 0);

      if (!itemReceiptIds.length || itemReceiptIds.some((receiptId) => !productsByReceipt.has(receiptId))) {
        entryReason = "missingReceiptData";
        break;
      }
      if (!candidateProducts.length) {
        entryReason = "missingReceiptProduct";
        break;
      }
      const bestScore = Math.max(...candidateProducts.map((candidate) => candidate.score));
      const bestProducts = candidateProducts.filter((candidate) => candidate.score === bestScore);
      if (bestProducts.length !== 1) {
        entryReason = "ambiguousReceiptProduct";
        break;
      }
      const financialProduct = bestProducts[0]!.product;
      const allocations = financialProduct.orders.filter((allocation) => allocation.orderId && allocation.orderProductId);
      if (!allocations.length) {
        entryReason = "missingOrderAllocation";
        break;
      }
      if (allocations.length !== 1) {
        entryReason = "allocationSplit";
        break;
      }
      const allocation = allocations[0]!;
      const order = orderBySource.get(allocation.orderId!);
      if (!order) {
        entryReason = "missingNativeOrder";
        break;
      }
      const nativeItems = orderItemsByKey.get(`${order.id}:${allocation.orderProductId}`) ?? [];
      if (!nativeItems.length) {
        entryReason = "missingNativeOrderItem";
        break;
      }
      if (nativeItems.length !== 1) {
        entryReason = "nativeAllocationSplit";
        break;
      }
      const sourceQuantity = numberValue(payload.productAmount);
      const receiptQuantity = financialProduct.productAmount;
      const allocationQuantity = allocation.productAmount ?? allocation.amountReceived ?? allocation.amount;
      if (!sourceQuantity || sourceQuantity <= 0 || !receiptQuantity || receiptQuantity <= 0 || !allocationQuantity || allocationQuantity <= 0) {
        entryReason = "invalidQuantity";
        break;
      }
      if (!approximatelyEqual(sourceQuantity, receiptQuantity)) {
        entryReason = "receiptQuantityMismatch";
        break;
      }
      if (!approximatelyEqual(sourceQuantity, allocationQuantity)) {
        entryReason = "allocationQuantityMismatch";
        break;
      }
      const nativeItem = nativeItems[0]!;
      entryPlans.push({
        entryId,
        entryItemId: item.koper_id,
        receiptId: financialProduct.receiptId,
        receiptProductId: financialProduct.receiptProductId,
        sourceQuantity,
        receiptQuantity,
        orderId: allocation.orderId!,
        orderProductId: allocation.orderProductId!,
        nativeOrderId: order.id,
        nativeOrderItemId: nativeItem.id,
        inputId: nativeItem.input_id,
      });
    }

    if (entryReason) {
      excluded[entryReason] += 1;
      continue;
    }
    if (entryPlans.length !== entryItems.length) {
      excluded.missingReceiptProduct += 1;
      continue;
    }
    itemPlans.push(...entryPlans);
    safeEntries.push({
      entryId,
      itemCount: entryPlans.length,
      orderIds: unique(entryPlans.map((plan) => plan.orderId)),
    });
  }

  console.log("KOPER_FINANCIAL_RECEIPT_PROMOTION_PLAN_DONE", JSON.stringify({
    ok: failedBatches === 0,
    readOnly: true,
    source: {
      programmedEntries: programmedEntries.size,
      candidateEntries: candidateEntries.size,
      receiptIds: allReceiptIds.length,
      nativeOrders: orders.length,
      nativeOrderItems: orderItems.length,
      existingReceipts: existingReceipts.length,
    },
    result: {
      safeEntries: safeEntries.length,
      safeItems: itemPlans.length,
      uniqueOrders: unique(itemPlans.map((plan) => plan.orderId)).length,
      failedBatches,
      blockedWrites,
      excluded,
    },
    safeEntryExamples: safeEntries.slice(0, 20),
  }));
} catch (error: unknown) {
  console.error("KOPER_FINANCIAL_RECEIPT_PROMOTION_PLAN_FAILED", JSON.stringify({
    message: error instanceof Error ? error.message.slice(0, 1_200) : "unknown",
  }));
}
