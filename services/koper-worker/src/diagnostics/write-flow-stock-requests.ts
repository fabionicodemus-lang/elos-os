import { env } from "../config/env.js";
import { saveKoperStagingBatch } from "../elos/koper-staging-repository.js";
import { createKoperStagingRecord } from "../sync/staging-record.js";
import type { KoperStagingRecord } from "../sync/staging-record.js";
import {
  collectFlowActiveStockRequests,
  collectFlowClosedStockRequests,
} from "./collect-flow-stock-requests.js";

const FLOW_ENTERPRISE_ID = "6d3b4724-5880-11ee-827d-1219c832db49";

function identifier(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function buildStockRequestStagingRecords(
  details: Array<{ requestId: string; payload: Record<string, unknown> }>,
): { requests: KoperStagingRecord[]; items: KoperStagingRecord[] } {
  const requests: KoperStagingRecord[] = [];
  const items: KoperStagingRecord[] = [];

  for (const detail of details) {
    const requestId = identifier(detail.payload.requestId) ?? detail.requestId;
    requests.push(createKoperStagingRecord({
      companyId: env.BOSSA_COMPANY_ID,
      entity: "stock_request",
      koperId: requestId,
      koperParentId: identifier(detail.payload.stockPlaceId),
      sanitizedPayload: { enterpriseId: FLOW_ENTERPRISE_ID, ...detail.payload },
      koperCreatedAt: text(detail.payload.requestDate),
      mappingVersion: 2,
    }));

    const products = Array.isArray(detail.payload.products) ? detail.payload.products : [];
    for (const value of products) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const product = value as Record<string, unknown>;
      const productRequestId = identifier(product.productRequestId);
      if (productRequestId === null) continue;
      items.push(createKoperStagingRecord({
        companyId: env.BOSSA_COMPANY_ID,
        entity: "stock_request_item",
        koperId: productRequestId,
        koperParentId: requestId,
        sanitizedPayload: {
          enterpriseId: FLOW_ENTERPRISE_ID,
          requestId,
          ...product,
        },
        koperUpdatedAt: text(product.approvedDate),
        mappingVersion: 1,
      }));
    }
  }

  return { requests, items };
}

export async function writeFlowActiveStockRequests(): Promise<{
  ok: true;
  extractedRequests: number;
  extractedItems: number;
  blockedWrites: number;
  requests: { inserted: number; unchanged: number; updated: number };
  items: { inserted: number; unchanged: number; updated: number };
}> {
  if (
    process.env.KOPER_STAGING_WRITE_ENABLED !== "true"
    || process.env.KOPER_STOCK_REQUEST_STAGING_WRITE_ENABLED !== "true"
    || process.env.KOPER_STOCK_REQUEST_ACTIVE_FULL_STAGING_WRITE_ENABLED !== "true"
  ) throw new Error("Full active Koper stock request staging write is not explicitly enabled");

  const collection = await collectFlowActiveStockRequests();
  if (!collection.authenticated || !collection.flowSelected || collection.message) {
    throw new Error("Flow active stock requests were not collected");
  }
  const records = buildStockRequestStagingRecords(collection.details);
  if (records.requests.length !== collection.total) {
    throw new Error("Active Koper stock request count does not match API total");
  }

  const requests = await saveKoperStagingBatch(records.requests);
  const items = await saveKoperStagingBatch(records.items);
  return {
    ok: true,
    extractedRequests: records.requests.length,
    extractedItems: records.items.length,
    blockedWrites: collection.blockedWrites,
    requests,
    items,
  };
}

export async function writeFlowClosedStockRequests(): Promise<{
  ok: true;
  extractedRequests: number;
  extractedItems: number;
  requestStatuses: Record<string, number>;
  blockedWrites: number;
  requests: { inserted: number; unchanged: number; updated: number };
  items: { inserted: number; unchanged: number; updated: number };
}> {
  if (
    process.env.KOPER_STAGING_WRITE_ENABLED !== "true"
    || process.env.KOPER_STOCK_REQUEST_STAGING_WRITE_ENABLED !== "true"
    || process.env.KOPER_STOCK_REQUEST_CLOSED_FULL_STAGING_WRITE_ENABLED !== "true"
  ) throw new Error("Full closed Koper stock request staging write is not explicitly enabled");

  const collection = await collectFlowClosedStockRequests();
  if (!collection.authenticated || !collection.flowSelected || collection.message) {
    throw new Error("Flow closed stock requests were not collected");
  }
  const records = buildStockRequestStagingRecords(collection.details);
  if (records.requests.length !== collection.total) {
    throw new Error("Closed Koper stock request count does not match API total");
  }

  const requestStatuses = collection.details.reduce<Record<string, number>>((counts, detail) => {
    const status = text(detail.payload.status) ?? "(ausente)";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  const requests = await saveKoperStagingBatch(records.requests);
  const items = await saveKoperStagingBatch(records.items);
  return {
    ok: true,
    extractedRequests: records.requests.length,
    extractedItems: records.items.length,
    requestStatuses,
    blockedWrites: collection.blockedWrites,
    requests,
    items,
  };
}
