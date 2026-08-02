import { env } from "../config/env.js";
import { saveKoperStagingBatch } from "../elos/koper-staging-repository.js";
import { requestSupabase } from "../elos/supabase.js";
import { hashKoperPayload, normalizeKoperPayload } from "../koper/payload-hash.js";
import { createKoperStagingRecord } from "../sync/staging-record.js";

type StagingRow = {
  id: string;
  koper_id: string;
  payload: unknown;
};

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function identifier(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

async function readAll(entity: "purchase_order" | "supplier"): Promise<StagingRow[]> {
  const rows: StagingRow[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<StagingRow[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "id,koper_id,payload",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: `eq.${entity}`,
        sync_state: "eq.present",
        order: "koper_id.asc",
        limit: "1000",
        offset: String(offset),
      }),
    });
    rows.push(...page);
    if (page.length < 1_000) break;
  }
  return rows;
}

export async function backfillKoperHistoricalSuppliers(): Promise<{
  ok: true;
  orders: number;
  suppliersBefore: number;
  missingSupplierIds: string[];
  missingSuppliers: number;
  syntheticSupplierOrderIds: string[];
  inserted: number;
  updated: number;
  unchanged: number;
  suppliersAfter: number;
  unresolvedSupplierIds: string[];
}> {
  if (process.env.KOPER_BACKFILL_HISTORICAL_SUPPLIERS_ENABLED !== "true") {
    throw new Error("Koper historical supplier backfill is not explicitly enabled");
  }

  const [orders, suppliers] = await Promise.all([
    readAll("purchase_order"),
    readAll("supplier"),
  ]);

  const supplierIds = new Set(suppliers.map((row) => row.koper_id));
  const missingBySupplierId = new Map<string, Record<string, unknown>>();
  const syntheticSupplierOrderIds: string[] = [];
  const now = new Date().toISOString();

  for (const order of orders) {
    const originalPayload = objectValue(order.payload);
    let payload = originalPayload;
    let supplierId = identifier(payload.supplierId);

    if (!supplierId) {
      supplierId = `historical-order-${order.koper_id}`;
      syntheticSupplierOrderIds.push(order.koper_id);
      payload = normalizeKoperPayload({
        ...payload,
        supplierId,
        supplierName: identifier(payload.supplierName)
          ?? identifier(payload.companyName)
          ?? `Fornecedor histórico não identificado — pedido Koper ${order.koper_id}`,
        historicalSupplierReconstructed: true,
        historicalSupplierSource: "purchase_order_header_missing_supplier_id",
      }) as Record<string, unknown>;

      const patched = await requestSupabase<Array<{ id: string }>>("koper_staging_records", {
        method: "PATCH",
        body: {
          payload,
          payload_hash: hashKoperPayload(payload),
          processing_status: "pending",
          processing_error: null,
          mapping_version: 1,
          sync_state: "present",
          updated_at: now,
        },
        prefer: "return=representation",
        query: new URLSearchParams({ id: `eq.${order.id}`, select: "id" }),
      });
      if (patched.length !== 1) {
        throw new Error(`Could not patch synthetic supplier into Koper order ${order.koper_id}`);
      }
    }

    if (!supplierIds.has(supplierId) && !missingBySupplierId.has(supplierId)) {
      missingBySupplierId.set(supplierId, payload);
    }
  }

  const records = [...missingBySupplierId.entries()].map(([supplierId, payload]) =>
    createKoperStagingRecord({
      companyId: env.BOSSA_COMPANY_ID,
      entity: "supplier",
      koperId: supplierId,
      sanitizedPayload: {
        ...payload,
        supplierId,
        historicalSupplierReconstructed: true,
        historicalSupplierSource: identifier(payload.historicalSupplierSource)
          ?? "purchase_order_header",
      },
      mappingVersion: 1,
    }),
  );

  const saved = await saveKoperStagingBatch(records);
  const verifiedSuppliers = await readAll("supplier");
  const verifiedSupplierIds = new Set(verifiedSuppliers.map((row) => row.koper_id));
  const unresolvedSupplierIds = [...missingBySupplierId.keys()].filter(
    (supplierId) => !verifiedSupplierIds.has(supplierId),
  );

  if (unresolvedSupplierIds.length > 0) {
    throw new Error(`Historical suppliers were not persisted: ${unresolvedSupplierIds.join(",")}`);
  }

  return {
    ok: true,
    orders: orders.length,
    suppliersBefore: suppliers.length,
    missingSupplierIds: [...missingBySupplierId.keys()],
    missingSuppliers: missingBySupplierId.size,
    syntheticSupplierOrderIds,
    inserted: saved.inserted,
    updated: saved.updated,
    unchanged: saved.unchanged,
    suppliersAfter: verifiedSuppliers.length,
    unresolvedSupplierIds,
  };
}
