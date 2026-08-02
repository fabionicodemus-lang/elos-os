import { env } from "../config/env.js";
import { saveKoperStagingBatch } from "../elos/koper-staging-repository.js";
import { createKoperStagingRecord } from "../sync/staging-record.js";
import type { KoperStagingRecord } from "../sync/staging-record.js";
import { collectFlowPurchaseOrderBatch } from "./collect-flow-purchase-orders.js";

const FLOW_ENTERPRISE_ID = "6d3b4724-5880-11ee-827d-1219c832db49";

function identifier(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stagingRecords(details: Array<{ orderId: string; payload: Record<string, unknown> }>): {
  orders: KoperStagingRecord[];
  items: KoperStagingRecord[];
  suppliers: KoperStagingRecord[];
  requestLinks: number;
} {
  const orders: KoperStagingRecord[] = [];
  const items: KoperStagingRecord[] = [];
  const suppliers = new Map<string, KoperStagingRecord>();
  let requestLinks = 0;
  for (const detail of details) {
    const orderId = identifier(detail.payload.orderId) ?? detail.orderId;
    orders.push(createKoperStagingRecord({
      companyId: env.BOSSA_COMPANY_ID,
      entity: "purchase_order",
      koperId: orderId,
      sanitizedPayload: { enterpriseId: FLOW_ENTERPRISE_ID, ...detail.payload },
      koperCreatedAt: text(detail.payload.orderDate),
      koperUpdatedAt: text(detail.payload.responseDate),
      mappingVersion: 1,
    }));
    const supplierId = identifier(detail.payload.supplierId);
    if (supplierId !== null) suppliers.set(String(supplierId), createKoperStagingRecord({
      companyId: env.BOSSA_COMPANY_ID,
      entity: "supplier",
      koperId: supplierId,
      sanitizedPayload: {
        enterpriseId: FLOW_ENTERPRISE_ID,
        supplierId,
        supplierName: detail.payload.supplierName,
        companyName: detail.payload.companyName,
        supplierCnpj: detail.payload.supplierCnpj,
        supplierCpf: detail.payload.supplierCpf,
        cnpjType: detail.payload.cnpjType,
        cpfType: detail.payload.cpfType,
        email: detail.payload.email,
        supPhone: detail.payload.supPhone,
        supCellphone: detail.payload.supCellphone,
        addressSupplier: detail.payload.addressSupplier,
      },
      mappingVersion: 1,
    }));
    const products = Array.isArray(detail.payload.products) ? detail.payload.products : [];
    for (const value of products) {
      const product = objectValue(value);
      if (!product) continue;
      const orderProductId = identifier(product.orderProductId);
      if (orderProductId === null) continue;
      const requests = Array.isArray(product.requests) ? product.requests : [];
      requestLinks += requests.length;
      items.push(createKoperStagingRecord({
        companyId: env.BOSSA_COMPANY_ID,
        entity: "purchase_order_item",
        koperId: orderProductId,
        koperParentId: orderId,
        sanitizedPayload: { enterpriseId: FLOW_ENTERPRISE_ID, orderId, ...product },
        koperCreatedAt: text(detail.payload.orderDate),
        mappingVersion: 1,
      }));
    }
  }
  return { orders, items, suppliers: [...suppliers.values()], requestLinks };
}

export async function writeFlowPurchaseOrderBatch(): Promise<{
  ok: true;
  batchIndex: number;
  total: number;
  extractedOrders: number;
  extractedItems: number;
  extractedSuppliers: number;
  requestLinks: number;
  blockedWrites: number;
  orders: { inserted: number; unchanged: number; updated: number };
  items: { inserted: number; unchanged: number; updated: number };
  suppliers: { inserted: number; unchanged: number; updated: number };
}> {
  if (process.env.KOPER_STAGING_WRITE_ENABLED !== "true"
    || process.env.KOPER_PURCHASE_ORDER_STAGING_WRITE_ENABLED !== "true") {
    throw new Error("Koper purchase order staging write is not explicitly enabled");
  }
  const batchIndex = Number(process.env.KOPER_PURCHASE_ORDER_BATCH ?? "0");
  const batchSize = 100;
  const collection = await collectFlowPurchaseOrderBatch(batchIndex, batchSize);
  if (!collection.authenticated || !collection.flowSelected || collection.message) {
    throw new Error("Flow purchase orders were not collected");
  }
  const expected = Math.max(0, Math.min(batchSize, collection.total - batchIndex * batchSize));
  if (collection.details.length !== expected) throw new Error("Koper purchase order batch count mismatch");
  const records = stagingRecords(collection.details);
  const [orders, items, suppliers] = await Promise.all([
    saveKoperStagingBatch(records.orders),
    saveKoperStagingBatch(records.items),
    saveKoperStagingBatch(records.suppliers),
  ]);
  return {
    ok: true,
    batchIndex,
    total: collection.total,
    extractedOrders: records.orders.length,
    extractedItems: records.items.length,
    extractedSuppliers: records.suppliers.length,
    requestLinks: records.requestLinks,
    blockedWrites: collection.blockedWrites,
    orders,
    items,
    suppliers,
  };
}
