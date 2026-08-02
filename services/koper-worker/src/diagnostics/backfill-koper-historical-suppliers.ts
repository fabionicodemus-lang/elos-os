import { env } from "../config/env.js";
import { saveKoperStagingBatch } from "../elos/koper-staging-repository.js";
import { requestSupabase } from "../elos/supabase.js";
import { createKoperStagingRecord } from "../sync/staging-record.js";

type StagingRow = {
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
        select: "koper_id,payload",
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
  inserted: number;
  updated: number;
  unchanged: number;
  suppliersAfter: number;
  ordersWithoutSupplierId: number;
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
  const ordersWithoutSupplierId: string[] = [];

  for (const order of orders) {
    const payload = objectValue(order.payload);
    const supplierId = identifier(payload.supplierId);
    if (!supplierId) {
      ordersWithoutSupplierId.push(order.koper_id);
      continue;
    }
    if (!supplierIds.has(supplierId) && !missingBySupplierId.has(supplierId)) {
      missingBySupplierId.set(supplierId, payload);
    }
  }

  if (ordersWithoutSupplierId.length > 0) {
    throw new Error(
      `Purchase orders without supplierId: ${ordersWithoutSupplierId.slice(0, 20).join(",")}`,
    );
  }

  const records = [...missingBySupplierId.entries()].map(([supplierId, payload]) =>
    createKoperStagingRecord({
      companyId: env.BOSSA_COMPANY_ID,
      entity: "supplier",
      koperId: supplierId,
      sanitizedPayload: {
        ...payload,
        historicalSupplierReconstructed: true,
        historicalSupplierSource: "purchase_order_header",
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
    inserted: saved.inserted,
    updated: saved.updated,
    unchanged: saved.unchanged,
    suppliersAfter: verifiedSuppliers.length,
    ordersWithoutSupplierId: ordersWithoutSupplierId.length,
    unresolvedSupplierIds,
  };
}
