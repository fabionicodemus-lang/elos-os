// Deploy marker: auditoria pós-seed somente leitura.
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type RequestItemRow = {
  id: string;
  cost_center_service_id: string | null;
  requested_quantity: number;
  notes: string | null;
};
type PurchaseItemRow = { id: string; request_item_id: string | null };
type AllocationRow = { id: string };
type ServiceRow = { id: string };

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

async function main(): Promise<void> {
  const projects = await requestSupabase<Array<{ id: string }>>("projects", {
    query: new URLSearchParams({
      select: "id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      name: "ilike.*Flow*",
      status: "neq.archived",
      limit: "10",
    }),
  });
  const project = projects[0];
  if (projects.length !== 1 || !project) throw new Error("Flow project is ambiguous");

  const [requestItems, purchaseItems, allocations, fallbackRows] = await Promise.all([
    readAll<RequestItemRow>("execution_material_request_items", {
      select: "id,cost_center_service_id,requested_quantity,notes",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${project.id}`,
      notes: "like.Koper productRequestIds=*",
      order: "id.asc",
    }),
    readAll<PurchaseItemRow>("procurement_purchase_order_items", {
      select: "id,request_item_id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${project.id}`,
      source_system: "eq.koper",
      order: "id.asc",
    }),
    readAll<AllocationRow>("procurement_purchase_order_item_request_allocations", {
      select: "id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${project.id}`,
      order: "id.asc",
    }),
    readAll<ServiceRow>("engineering_services", {
      select: "id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      source_id: "eq.stock-request-legacy-cost-center",
    }),
  ]);

  const fallback = fallbackRows[0];
  if (fallbackRows.length !== 1 || !fallback) throw new Error("KOPER-SR-LEGACY service is ambiguous");
  const v2 = requestItems.filter((row) => row.notes?.includes("resolution=v2"));
  const v1 = requestItems.filter((row) => !row.notes?.includes("resolution=v2"));
  const v1Ids = new Set(v1.map((row) => row.id));
  const purchaseRowsOnV1 = purchaseItems.filter((row) => row.request_item_id && v1Ids.has(row.request_item_id));
  const distinctV1PurchaseRefs = new Set(purchaseRowsOnV1.map((row) => row.request_item_id).filter(Boolean));
  const v2Legacy = v2.filter((row) => row.cost_center_service_id === fallback.id);
  const v2Real = v2.filter((row) => row.cost_center_service_id !== fallback.id);
  const v2Quantity = v2.reduce((sum, row) => sum + row.requested_quantity, 0);

  const result = {
    ok: true,
    mode: "read-only",
    currentKoperRequestItems: requestItems.length,
    v2Rows: v2.length,
    v1RowsRemaining: v1.length,
    v2RealRows: v2Real.length,
    v2LegacyRows: v2Legacy.length,
    v2TotalQuantity: v2Quantity,
    purchaseItems: purchaseItems.length,
    purchaseRowsStillReferencingV1: purchaseRowsOnV1.length,
    distinctV1RowsReferencedByPurchase: distinctV1PurchaseRefs.size,
    allocationRows: allocations.length,
  };

  const failures: string[] = [];
  if (result.currentKoperRequestItems !== 6942) failures.push(`currentKoperRequestItems=${result.currentKoperRequestItems}`);
  if (result.v2Rows !== 3769) failures.push(`v2Rows=${result.v2Rows}`);
  if (result.v1RowsRemaining !== 3173) failures.push(`v1RowsRemaining=${result.v1RowsRemaining}`);
  if (result.v2RealRows !== 3245) failures.push(`v2RealRows=${result.v2RealRows}`);
  if (result.v2LegacyRows !== 524) failures.push(`v2LegacyRows=${result.v2LegacyRows}`);
  if (Math.abs(result.v2TotalQuantity - 673513.6992) > 0.00001) failures.push(`v2TotalQuantity=${result.v2TotalQuantity}`);
  if (result.allocationRows !== 0) failures.push(`allocationRows=${result.allocationRows}`);
  if (failures.length) throw new Error(`Koper v2 post-seed audit mismatch: ${failures.join(", ")}`);

  console.log("KOPER_STOCK_REQUEST_V2_POST_AUDIT", JSON.stringify(result));
}

void main().catch((error) => {
  console.error("KOPER_STOCK_REQUEST_V2_POST_AUDIT_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
