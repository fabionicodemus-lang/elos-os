import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";

type RequestItemRow = {
  id: string;
  requested_quantity: number;
  notes: string | null;
};
type IdReferenceRow = { request_item_id: string | null };

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

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

async function buildCleanupPlan(): Promise<{
  projectId: string;
  v2Rows: RequestItemRow[];
  staleRows: RequestItemRow[];
  staleIds: string[];
  purchaseReferences: number;
  quotationReferences: number;
  allocationReferences: number;
  v2Quantity: number;
}> {
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

  const allKoperItems = await readAll<RequestItemRow>("execution_material_request_items", {
    select: "id,requested_quantity,notes",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    project_id: `eq.${project.id}`,
    notes: "like.Koper productRequestIds=*",
    order: "id.asc",
  });
  const v2Rows = allKoperItems.filter((row) => row.notes?.includes("resolution=v2"));
  const staleRows = allKoperItems.filter((row) => !row.notes?.includes("resolution=v2"));
  const staleIds = staleRows.map((row) => row.id);
  const staleSet = new Set(staleIds);

  const [purchaseRows, quotationRows, allocationRows] = await Promise.all([
    readAll<IdReferenceRow>("procurement_purchase_order_items", {
      select: "request_item_id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      request_item_id: "not.is.null",
      order: "id.asc",
    }),
    readAll<IdReferenceRow>("procurement_material_quotation_items", {
      select: "request_item_id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      order: "id.asc",
    }),
    readAll<IdReferenceRow>("procurement_purchase_order_item_request_allocations", {
      select: "request_item_id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      order: "id.asc",
    }),
  ]);

  const purchaseReferences = purchaseRows.filter((row) => row.request_item_id && staleSet.has(row.request_item_id)).length;
  const quotationReferences = quotationRows.filter((row) => row.request_item_id && staleSet.has(row.request_item_id)).length;
  const allocationReferences = allocationRows.filter((row) => row.request_item_id && staleSet.has(row.request_item_id)).length;
  const v2Quantity = v2Rows.reduce((sum, row) => sum + row.requested_quantity, 0);

  return {
    projectId: project.id,
    v2Rows,
    staleRows,
    staleIds,
    purchaseReferences,
    quotationReferences,
    allocationReferences,
    v2Quantity,
  };
}

export async function previewKoperStockRequestV1Cleanup(): Promise<{
  ok: true;
  mode: "read-only";
  v2Rows: number;
  staleRows: number;
  purchaseReferences: number;
  quotationReferences: number;
  allocationReferences: number;
  safeToDelete: boolean;
  v2Quantity: number;
}> {
  const plan = await buildCleanupPlan();
  return {
    ok: true,
    mode: "read-only",
    v2Rows: plan.v2Rows.length,
    staleRows: plan.staleRows.length,
    purchaseReferences: plan.purchaseReferences,
    quotationReferences: plan.quotationReferences,
    allocationReferences: plan.allocationReferences,
    safeToDelete: plan.purchaseReferences === 0 && plan.quotationReferences === 0 && plan.allocationReferences === 0,
    v2Quantity: plan.v2Quantity,
  };
}

export async function cleanupKoperStockRequestItemsV1(): Promise<{
  ok: true;
  deleted: number;
  remainingV2: number;
  remainingQuantity: number;
}> {
  if (process.env.KOPER_STOCK_REQUEST_V1_CLEANUP_ENABLED !== "true") {
    throw new Error("Koper stock request v1 cleanup is not explicitly enabled");
  }

  const plan = await buildCleanupPlan();
  if (plan.v2Rows.length !== 3_769) {
    throw new Error(`Refusing cleanup: expected 3769 v2 request items, found ${plan.v2Rows.length}`);
  }
  if (!almostEqual(plan.v2Quantity, 673_513.6992)) {
    throw new Error(`Refusing cleanup: v2 quantity mismatch ${plan.v2Quantity}`);
  }
  if (plan.purchaseReferences || plan.quotationReferences || plan.allocationReferences) {
    throw new Error(
      `Refusing cleanup: stale references remain purchase=${plan.purchaseReferences}`
      + ` quotation=${plan.quotationReferences} allocation=${plan.allocationReferences}`,
    );
  }

  let deleted = 0;
  for (const batch of chunks(plan.staleIds, 100)) {
    if (!batch.length) continue;
    const rows = await requestSupabase<Array<{ id: string }>>("execution_material_request_items", {
      method: "DELETE",
      prefer: "return=representation",
      query: new URLSearchParams({
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        project_id: `eq.${plan.projectId}`,
        id: `in.(${batch.join(",")})`,
        select: "id",
      }),
    });
    deleted += rows.length;
  }

  const remaining = await readAll<RequestItemRow>("execution_material_request_items", {
    select: "id,requested_quantity,notes",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    project_id: `eq.${plan.projectId}`,
    notes: "like.Koper productRequestIds=*",
    order: "id.asc",
  });
  const remainingQuantity = remaining.reduce((sum, row) => sum + row.requested_quantity, 0);
  if (remaining.length !== 3_769 || remaining.some((row) => !row.notes?.includes("resolution=v2"))) {
    throw new Error(`Koper stock request cleanup verification failed: remaining=${remaining.length}`);
  }
  if (!almostEqual(remainingQuantity, 673_513.6992)) {
    throw new Error(`Koper stock request cleanup quantity verification failed: ${remainingQuantity}`);
  }
  return { ok: true, deleted, remainingV2: remaining.length, remainingQuantity };
}
