import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type RecordValue = Record<string, unknown>;

function objectValue(value: unknown): RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : {};
}

function identifier(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

async function readAll<T>(resource: string, query: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(resource, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
      timeoutMs: 30_000,
    });
    rows.push(...page);
    if (page.length < 1_000) break;
  }
  return rows;
}

async function readStaging(entity: "stock_request_item" | "purchase_order_item"): Promise<StagingRow[]> {
  return readAll<StagingRow>("koper_staging_records", {
    select: "koper_id,koper_parent_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: `eq.${entity}`,
    sync_state: "eq.present",
    order: "koper_id.asc",
  });
}

function addKeys(counts: Record<string, number>, value: RecordValue): void {
  for (const key of Object.keys(value)) counts[key] = (counts[key] ?? 0) + 1;
}

async function main(): Promise<void> {
  try {
    const [stockRows, purchaseRows] = await Promise.all([
      readStaging("stock_request_item"),
      readStaging("purchase_order_item"),
    ]);
    const stockById = new Map(stockRows.map((row) => [row.koper_id, row]));
    const multiAllocationStock = new Set<string>();
    for (const row of stockRows) {
      const payload = objectValue(row.payload);
      const services = Array.isArray(payload.services) ? payload.services.map(objectValue) : [];
      const allocationIds = new Set(services.map((link) => identifier(link.itemMonitInputId)).filter(Boolean));
      if (allocationIds.size > 1) multiAllocationStock.add(row.koper_id);
    }

    const purchasePayloadKeyCounts: Record<string, number> = {};
    const requestLinkKeyCounts: Record<string, number> = {};
    const multiSamples: Array<Record<string, unknown>> = [];
    const missingStockSamples: Array<Record<string, unknown>> = [];
    let positiveRequestLinks = 0;
    let linksToMultiAllocationStock = 0;
    let linksWithoutStockItem = 0;

    for (const purchaseRow of purchaseRows) {
      const payload = objectValue(purchaseRow.payload);
      const requests = Array.isArray(payload.requests) ? payload.requests.map(objectValue) : [];
      for (const link of requests) {
        if ((numeric(link.requestAmount) ?? 0) <= 0) continue;
        positiveRequestLinks += 1;
        const productRequestId = identifier(link.productRequestId);
        if (!productRequestId) continue;
        const stockRow = stockById.get(productRequestId);
        if (!stockRow) {
          linksWithoutStockItem += 1;
          if (missingStockSamples.length < 20) missingStockSamples.push({
            orderProductId: purchaseRow.koper_id,
            orderId: purchaseRow.koper_parent_id,
            productRequestId,
            requestLink: link,
          });
          continue;
        }
        if (!multiAllocationStock.has(productRequestId)) continue;
        linksToMultiAllocationStock += 1;
        addKeys(purchasePayloadKeyCounts, payload);
        addKeys(requestLinkKeyCounts, link);
        if (multiSamples.length >= 100) continue;
        const stockPayload = objectValue(stockRow.payload);
        const services = Array.isArray(stockPayload.services) ? stockPayload.services.map(objectValue) : [];
        multiSamples.push({
          orderProductId: purchaseRow.koper_id,
          orderId: purchaseRow.koper_parent_id,
          productRequestId,
          purchase: {
            costCenterId: payload.costCenterId ?? null,
            amount: payload.amount ?? null,
            amountReceived: payload.amountReceived ?? null,
            inputId: payload.inputId ?? null,
            productId: payload.productId ?? null,
            mainProductId: payload.mainProductId ?? null,
            productName: payload.productName ?? payload.productFullName ?? null,
            requests,
          },
          requestLink: link,
          stock: {
            requestId: stockRow.koper_parent_id,
            inputId: stockPayload.inputId ?? null,
            productAmount: stockPayload.productAmount ?? null,
            productName: stockPayload.productName ?? stockPayload.productFullName ?? null,
            services,
          },
        });
      }
    }

    const result = {
      ok: true,
      mode: "read-only",
      stockItems: stockRows.length,
      purchaseItems: purchaseRows.length,
      stockItemsWithMultipleAllocationIds: multiAllocationStock.size,
      positiveRequestLinks,
      linksToMultiAllocationStock,
      linksWithoutStockItem,
      purchasePayloadKeyCounts,
      requestLinkKeyCounts,
      missingStockSamples,
      multiSamples,
    };
    console.log("KOPER_PO_MULTITARGET_SHAPES_RESULT", JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("KOPER_PO_MULTITARGET_SHAPES_FAILED", message);
    process.exitCode = 1;
  }
}

void main();
