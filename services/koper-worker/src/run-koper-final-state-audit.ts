import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { previewKoperStockRequestV1Cleanup } from "./diagnostics/cleanup-koper-stock-request-items-v1.js";
import { previewKoperPurchaseOrderRequestReconciliationV2 } from "./diagnostics/reconcile-koper-purchase-order-request-links-v2.js";

type RequestRow = { id: string };
type RequestItemRow = { id: string; requested_quantity: number; notes: string | null };
type PurchaseItemRow = {
  id: string;
  request_item_id: string | null;
  ordered_quantity: number;
  cost_center_code: string | null;
};
type AllocationRow = { id: string; request_item_id: string; allocated_quantity: number };

function almostEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.00001;
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

async function readFlowProjectId(): Promise<string> {
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
  return project.id;
}

async function main(): Promise<void> {
  const [cleanup, purchasePreview, projectId] = await Promise.all([
    previewKoperStockRequestV1Cleanup(),
    previewKoperPurchaseOrderRequestReconciliationV2(),
    readFlowProjectId(),
  ]);

  const [requests, requestItems, purchaseItems, allocations] = await Promise.all([
    readAll<RequestRow>("execution_material_requests", {
      select: "id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${projectId}`,
      request_number: "like.KOPER-*",
      order: "id.asc",
    }),
    readAll<RequestItemRow>("execution_material_request_items", {
      select: "id,requested_quantity,notes",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${projectId}`,
      notes: "like.Koper productRequestIds=*",
      order: "id.asc",
    }),
    readAll<PurchaseItemRow>("procurement_purchase_order_items", {
      select: "id,request_item_id,ordered_quantity,cost_center_code",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${projectId}`,
      source_system: "eq.koper",
      order: "id.asc",
    }),
    readAll<AllocationRow>("procurement_purchase_order_item_request_allocations", {
      select: "id,request_item_id,allocated_quantity",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${projectId}`,
      source_system: "eq.koper",
      order: "id.asc",
    }),
  ]);

  const v2Rows = requestItems.filter((row) => row.notes?.includes("resolution=v2"));
  const v2Ids = new Set(v2Rows.map((row) => row.id));
  const staleRows = requestItems.filter((row) => !row.notes?.includes("resolution=v2"));
  const v2Quantity = v2Rows.reduce((sum, row) => sum + row.requested_quantity, 0);
  const purchaseOrderedQuantity = purchaseItems.reduce((sum, row) => sum + row.ordered_quantity, 0);
  const directPurchaseItems = purchaseItems.filter((row) => row.request_item_id !== null).length;
  const multiPurchaseItems = purchaseItems.filter((row) => row.cost_center_code === "KOPER-OC-MULTI").length;
  const orphanPurchaseItems = purchaseItems.filter((row) => row.cost_center_code === "KOPER-OC-ORPHAN").length;
  const purchaseNonV2References = purchaseItems.filter((row) => row.request_item_id && !v2Ids.has(row.request_item_id)).length;
  const allocationNonV2References = allocations.filter((row) => !v2Ids.has(row.request_item_id)).length;

  const result = {
    ok: true,
    requests: requests.length,
    requestItems: requestItems.length,
    v2Rows: v2Rows.length,
    staleRows: staleRows.length,
    v2Quantity,
    purchaseItems: purchaseItems.length,
    purchaseOrderedQuantity,
    directPurchaseItems,
    multiPurchaseItems,
    orphanPurchaseItems,
    allocationRows: allocations.length,
    purchaseNonV2References,
    allocationNonV2References,
    plannedUpdates: purchasePreview.updates,
    plannedDirect: purchasePreview.direct,
    plannedMulti: purchasePreview.multi,
    plannedOrphan: purchasePreview.orphan,
    plannedAllocations: purchasePreview.allocations,
    purchaseV1References: purchasePreview.v1ReferencesBefore,
    cleanupPurchaseReferences: cleanup.purchaseReferences,
    cleanupQuotationReferences: cleanup.quotationReferences,
    cleanupAllocationReferences: cleanup.allocationReferences,
  };

  const failures: string[] = [];
  if (requests.length !== 903) failures.push(`requests=${requests.length}`);
  if (requestItems.length !== 3_769) failures.push(`requestItems=${requestItems.length}`);
  if (v2Rows.length !== 3_769) failures.push(`v2Rows=${v2Rows.length}`);
  if (staleRows.length !== 0) failures.push(`staleRows=${staleRows.length}`);
  if (!almostEqual(v2Quantity, 673_513.6992)) failures.push(`v2Quantity=${v2Quantity}`);
  if (purchaseItems.length !== 4_610) failures.push(`purchaseItems=${purchaseItems.length}`);
  if (!almostEqual(purchaseOrderedQuantity, 846_641.9392)) failures.push(`purchaseOrderedQuantity=${purchaseOrderedQuantity}`);
  if (directPurchaseItems !== 3_480) failures.push(`directPurchaseItems=${directPurchaseItems}`);
  if (multiPurchaseItems !== 72) failures.push(`multiPurchaseItems=${multiPurchaseItems}`);
  if (orphanPurchaseItems !== 1) failures.push(`orphanPurchaseItems=${orphanPurchaseItems}`);
  if (allocations.length !== 144) failures.push(`allocationRows=${allocations.length}`);
  if (purchaseNonV2References !== 0) failures.push(`purchaseNonV2References=${purchaseNonV2References}`);
  if (allocationNonV2References !== 0) failures.push(`allocationNonV2References=${allocationNonV2References}`);
  if (purchasePreview.updates !== 3_553 || purchasePreview.direct !== 3_480 || purchasePreview.multi !== 72 || purchasePreview.orphan !== 1) {
    failures.push(`purchasePlan=${purchasePreview.updates}/${purchasePreview.direct}/${purchasePreview.multi}/${purchasePreview.orphan}`);
  }
  if (purchasePreview.allocations !== 144) failures.push(`plannedAllocations=${purchasePreview.allocations}`);
  if (purchasePreview.v1ReferencesBefore !== 0) failures.push(`purchaseV1References=${purchasePreview.v1ReferencesBefore}`);
  if (cleanup.staleRows !== 0) failures.push(`cleanupStaleRows=${cleanup.staleRows}`);
  if (cleanup.purchaseReferences || cleanup.quotationReferences || cleanup.allocationReferences) {
    failures.push(`cleanupRefs=${cleanup.purchaseReferences}/${cleanup.quotationReferences}/${cleanup.allocationReferences}`);
  }

  if (failures.length) {
    console.error("KOPER_FINAL_STATE_AUDIT_FAILED", JSON.stringify({ ...result, failures }));
    process.exitCode = 1;
    return;
  }

  console.log("KOPER_FINAL_STATE_AUDIT_RESULT", JSON.stringify(result));
}

void main().catch((error) => {
  console.error("KOPER_FINAL_STATE_AUDIT_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
