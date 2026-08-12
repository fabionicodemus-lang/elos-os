import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
import { groupRequestItemsByProductId } from "./purchase-order-request-item-resolution.js";
import { resolvePurchaseRequestAllocations } from "./purchase-order-request-allocations.js";

type RecordValue = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type ServiceRow = { id: string; source_id: string | null };
type RequestRow = { id: string; request_number: string };
type RequestItemRow = {
  id: string;
  request_id: string;
  cost_center_service_id: string | null;
  requested_quantity: number;
  cost_center_code: string;
  cost_center_name: string;
  notes: string | null;
};
type PurchaseItemRow = {
  id: string;
  source_id: string;
  request_id: string | null;
  request_item_id: string | null;
  ordered_quantity: number;
  cost_center_service_id: string | null;
  request_number: string | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
};
type AllocationRow = {
  id: string;
  source_id: string | null;
  purchase_order_item_id: string;
  request_id: string;
  request_item_id: string;
  allocated_quantity: number;
};

type PlannedUpdate = {
  id: string;
  request_id: string | null;
  request_item_id: string | null;
  cost_center_service_id: string | null;
  request_number: string;
  cost_center_code: string;
  cost_center_name: string;
  updated_at: string;
};

type PlannedAllocation = {
  company_id: string;
  project_id: string;
  purchase_order_item_id: string;
  request_id: string;
  request_item_id: string;
  allocated_quantity: number;
  source_system: "koper";
  source_id: string;
  updated_at: string;
};

type Plan = {
  projectId: string;
  updates: PlannedUpdate[];
  allocations: PlannedAllocation[];
  direct: number;
  multi: number;
  orphan: number;
  v1RequestItemIds: Set<string>;
  purchaseItemCountBefore: number;
  orderedQuantityBefore: number;
};

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

function productRequestIds(notes: string | null): string[] {
  const match = notes?.match(/Koper productRequestIds=([^·]+)/);
  return match?.[1]?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
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

async function readPurchaseStaging(): Promise<StagingRow[]> {
  return readAll<StagingRow>("koper_staging_records", {
    select: "koper_id,koper_parent_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: "eq.purchase_order_item",
    sync_state: "eq.present",
    order: "koper_id.asc",
  });
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

async function buildPlan(): Promise<Plan> {
  const projectId = await readFlowProjectId();
  const [purchaseSourceItems, purchaseItems, requestItems, requests, services] = await Promise.all([
    readPurchaseStaging(),
    readAll<PurchaseItemRow>("procurement_purchase_order_items", {
      select: "id,source_id,request_id,request_item_id,ordered_quantity,cost_center_service_id,request_number,cost_center_code,cost_center_name",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${projectId}`,
      source_system: "eq.koper",
      order: "source_id.asc",
    }),
    readAll<RequestItemRow>("execution_material_request_items", {
      select: "id,request_id,cost_center_service_id,requested_quantity,cost_center_code,cost_center_name,notes",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${projectId}`,
      notes: "like.Koper productRequestIds=*",
      order: "id.asc",
    }),
    readAll<RequestRow>("execution_material_requests", {
      select: "id,request_number",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${projectId}`,
      request_number: "like.KOPER-*",
      order: "request_number.asc",
    }),
    readAll<ServiceRow>("engineering_services", {
      select: "id,source_id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      order: "source_id.asc",
    }),
  ]);

  const currentBySource = new Map(purchaseItems.map((row) => [row.source_id, row]));
  if (currentBySource.size !== purchaseItems.length) throw new Error("Duplicate Koper purchase source_id in Elos");
  const requestById = new Map(requests.map((row) => [row.id, row]));
  const candidatesByProduct = groupRequestItemsByProductId(requestItems, (row) => productRequestIds(row.notes));
  const serviceSourceIdByServiceId = new Map(services.map((row) => [row.id, row.source_id]));
  const v1RequestItemIds = new Set(requestItems
    .filter((row) => !row.notes?.includes("resolution=v2"))
    .map((row) => row.id));
  const updates: PlannedUpdate[] = [];
  const allocations: PlannedAllocation[] = [];
  const now = new Date().toISOString();
  let direct = 0;
  let multi = 0;
  let orphan = 0;
  const plannedPurchaseItemIds = new Set<string>();

  for (const source of purchaseSourceItems) {
    const payload = objectValue(source.payload);
    const links = Array.isArray(payload.requests) ? payload.requests.map(objectValue) : [];
    const positiveLinks = links.filter((link) => (numeric(link.requestAmount) ?? 0) > 0);
    if (!positiveLinks.length) continue;
    const linkTotal = positiveLinks.reduce((sum, link) => sum + (numeric(link.requestAmount) ?? 0), 0);
    const sourceOrdered = Math.max(0, numeric(payload.amount) ?? 0);

    for (const link of positiveLinks) {
      const productRequestId = identifier(link.productRequestId);
      if (!productRequestId) continue;
      const sourceId = `${source.koper_id}:${productRequestId}`;
      const purchaseItem = currentBySource.get(sourceId);
      if (!purchaseItem) throw new Error(`Koper purchase item missing in Elos for source_id=${sourceId}`);
      if (plannedPurchaseItemIds.has(purchaseItem.id)) throw new Error(`Purchase item planned twice for source_id=${sourceId}`);
      plannedPurchaseItemIds.add(purchaseItem.id);

      const splitQuantity = sourceOrdered > 0 && linkTotal > 0
        ? sourceOrdered * (numeric(link.requestAmount) ?? 0) / linkTotal
        : purchaseItem.ordered_quantity;
      if (Math.abs(splitQuantity - purchaseItem.ordered_quantity) > 0.00001) {
        throw new Error(`Purchase split quantity changed for source_id=${sourceId}`);
      }

      const resolution = resolvePurchaseRequestAllocations(
        productRequestId,
        purchaseItem.ordered_quantity,
        identifier(payload.costCenterId),
        candidatesByProduct,
        serviceSourceIdByServiceId,
      );
      if (resolution.status === "invalid") throw new Error(resolution.reason);

      if (resolution.status === "missing") {
        orphan += 1;
        updates.push({
          id: purchaseItem.id,
          request_id: null,
          request_item_id: null,
          cost_center_service_id: null,
          request_number: "KOPER-SEM-SOLICITACAO",
          cost_center_code: "KOPER-OC-ORPHAN",
          cost_center_name: `Compra histórica com productRequestId=${productRequestId} ausente do staging atual`,
          updated_at: now,
        });
        continue;
      }

      if (resolution.status === "direct") {
        direct += 1;
        const item = resolution.item;
        const requestNumber = requestById.get(item.request_id)?.request_number;
        if (!requestNumber) throw new Error(`Request number missing for request item ${item.id}`);
        updates.push({
          id: purchaseItem.id,
          request_id: item.request_id,
          request_item_id: item.id,
          cost_center_service_id: item.cost_center_service_id,
          request_number: requestNumber,
          cost_center_code: item.cost_center_code,
          cost_center_name: item.cost_center_name,
          updated_at: now,
        });
        continue;
      }

      multi += 1;
      const requestNumber = requestById.get(resolution.requestId)?.request_number;
      if (!requestNumber) throw new Error(`Request number missing for multi allocation productRequestId=${productRequestId}`);
      updates.push({
        id: purchaseItem.id,
        request_id: resolution.requestId,
        request_item_id: null,
        cost_center_service_id: null,
        request_number: requestNumber,
        cost_center_code: "KOPER-OC-MULTI",
        cost_center_name: "Compra histórica rateada entre múltiplos serviços",
        updated_at: now,
      });
      for (const allocation of resolution.allocations) {
        allocations.push({
          company_id: env.BOSSA_COMPANY_ID,
          project_id: projectId,
          purchase_order_item_id: purchaseItem.id,
          request_id: allocation.item.request_id,
          request_item_id: allocation.item.id,
          allocated_quantity: allocation.quantity,
          source_system: "koper",
          source_id: `${source.koper_id}:${productRequestId}:${allocation.item.id}`,
          updated_at: now,
        });
      }
    }
  }

  if (updates.length !== direct + multi + orphan) throw new Error("Purchase reconciliation plan counters do not balance");
  const allocationSourceIds = new Set(allocations.map((row) => row.source_id));
  if (allocationSourceIds.size !== allocations.length) throw new Error("Duplicate planned Koper allocation source_id");
  const purchaseItemCountBefore = purchaseItems.length;
  const orderedQuantityBefore = round6(purchaseItems.reduce((sum, row) => sum + row.ordered_quantity, 0));

  return {
    projectId,
    updates,
    allocations,
    direct,
    multi,
    orphan,
    v1RequestItemIds,
    purchaseItemCountBefore,
    orderedQuantityBefore,
  };
}

async function verifyAndCleanup(plan: Plan): Promise<{
  purchaseItems: number;
  orderedQuantity: number;
  v1References: number;
  allocations: number;
  staleAllocationsDeleted: number;
}> {
  const [purchaseItems, currentAllocations] = await Promise.all([
    readAll<PurchaseItemRow>("procurement_purchase_order_items", {
      select: "id,source_id,request_id,request_item_id,ordered_quantity,cost_center_service_id,request_number,cost_center_code,cost_center_name",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${plan.projectId}`,
      source_system: "eq.koper",
      order: "id.asc",
    }),
    readAll<AllocationRow>("procurement_purchase_order_item_request_allocations", {
      select: "id,source_id,purchase_order_item_id,request_id,request_item_id,allocated_quantity",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${plan.projectId}`,
      source_system: "eq.koper",
      order: "id.asc",
    }),
  ]);

  const orderedQuantity = round6(purchaseItems.reduce((sum, row) => sum + row.ordered_quantity, 0));
  if (purchaseItems.length !== plan.purchaseItemCountBefore) {
    throw new Error(`Purchase item count changed: before=${plan.purchaseItemCountBefore} after=${purchaseItems.length}`);
  }
  if (Math.abs(orderedQuantity - plan.orderedQuantityBefore) > 0.000001) {
    throw new Error(`Purchase ordered quantity changed: before=${plan.orderedQuantityBefore} after=${orderedQuantity}`);
  }

  const purchaseById = new Map(purchaseItems.map((row) => [row.id, row]));
  for (const expected of plan.updates) {
    const actual = purchaseById.get(expected.id);
    if (!actual) throw new Error(`Updated purchase item disappeared: ${expected.id}`);
    if (actual.request_id !== expected.request_id
      || actual.request_item_id !== expected.request_item_id
      || actual.cost_center_service_id !== expected.cost_center_service_id
      || actual.request_number !== expected.request_number
      || actual.cost_center_code !== expected.cost_center_code
      || actual.cost_center_name !== expected.cost_center_name) {
      throw new Error(`Purchase reconciliation verification mismatch for item=${expected.id}`);
    }
  }

  const v1References = purchaseItems.filter((row) => row.request_item_id && plan.v1RequestItemIds.has(row.request_item_id)).length;
  if (v1References !== 0) throw new Error(`Purchase items still reference v1 request items: ${v1References}`);

  const intendedBySource = new Map(plan.allocations.map((row) => [row.source_id, row]));
  for (const expected of plan.allocations) {
    const actual = currentAllocations.find((row) => row.source_id === expected.source_id);
    if (!actual) throw new Error(`Planned allocation missing after upsert: ${expected.source_id}`);
    if (actual.purchase_order_item_id !== expected.purchase_order_item_id
      || actual.request_id !== expected.request_id
      || actual.request_item_id !== expected.request_item_id
      || Math.abs(actual.allocated_quantity - expected.allocated_quantity) > 0.000001) {
      throw new Error(`Allocation verification mismatch for source_id=${expected.source_id}`);
    }
  }

  const staleAllocations = currentAllocations.filter((row) => !row.source_id || !intendedBySource.has(row.source_id));
  for (const batch of chunks(staleAllocations, 100)) {
    if (!batch.length) continue;
    await requestSupabase("procurement_purchase_order_item_request_allocations", {
      method: "DELETE",
      prefer: "return=minimal",
      query: new URLSearchParams({
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        project_id: `eq.${plan.projectId}`,
        source_system: "eq.koper",
        id: `in.(${batch.map((row) => row.id).join(",")})`,
      }),
    });
  }

  const verifiedAllocations = await readAll<AllocationRow>("procurement_purchase_order_item_request_allocations", {
    select: "id,source_id,purchase_order_item_id,request_id,request_item_id,allocated_quantity",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    project_id: `eq.${plan.projectId}`,
    source_system: "eq.koper",
    order: "id.asc",
  });
  if (verifiedAllocations.length !== plan.allocations.length) {
    throw new Error(`Final allocation count mismatch: expected=${plan.allocations.length} actual=${verifiedAllocations.length}`);
  }
  for (const row of verifiedAllocations) {
    if (!row.source_id || !intendedBySource.has(row.source_id)) {
      throw new Error(`Unexpected final Koper allocation source_id=${row.source_id ?? "null"}`);
    }
  }

  return {
    purchaseItems: purchaseItems.length,
    orderedQuantity,
    v1References,
    allocations: verifiedAllocations.length,
    staleAllocationsDeleted: staleAllocations.length,
  };
}

export async function previewKoperPurchaseOrderRequestReconciliationV2(): Promise<{
  ok: true;
  mode: "read-only";
  updates: number;
  direct: number;
  multi: number;
  orphan: number;
  allocations: number;
  purchaseItems: number;
  orderedQuantity: number;
  v1ReferencesBefore: number;
}> {
  const plan = await buildPlan();
  const purchaseItems = await readAll<PurchaseItemRow>("procurement_purchase_order_items", {
    select: "id,source_id,request_id,request_item_id,ordered_quantity,cost_center_service_id,request_number,cost_center_code,cost_center_name",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    project_id: `eq.${plan.projectId}`,
    source_system: "eq.koper",
    order: "id.asc",
  });
  const v1ReferencesBefore = purchaseItems.filter((row) => row.request_item_id && plan.v1RequestItemIds.has(row.request_item_id)).length;
  return {
    ok: true,
    mode: "read-only",
    updates: plan.updates.length,
    direct: plan.direct,
    multi: plan.multi,
    orphan: plan.orphan,
    allocations: plan.allocations.length,
    purchaseItems: plan.purchaseItemCountBefore,
    orderedQuantity: plan.orderedQuantityBefore,
    v1ReferencesBefore,
  };
}

export async function reconcileKoperPurchaseOrderRequestLinksV2(): Promise<{
  ok: true;
  updates: number;
  direct: number;
  multi: number;
  orphan: number;
  allocations: number;
  purchaseItems: number;
  orderedQuantity: number;
  v1References: number;
  staleAllocationsDeleted: number;
}> {
  if (process.env.KOPER_PURCHASE_ORDER_REQUEST_RECONCILIATION_ENABLED !== "true") {
    throw new Error("Koper purchase order request reconciliation is not explicitly enabled");
  }

  const plan = await buildPlan();

  // Rerun-safe order: establish intended allocations first, then repoint purchase items.
  for (const batch of chunks(plan.allocations, 100)) {
    await requestSupabase("procurement_purchase_order_item_request_allocations", {
      method: "POST",
      body: batch,
      prefer: "resolution=merge-duplicates,return=minimal",
      query: new URLSearchParams({ on_conflict: "company_id,source_system,source_id" }),
    });
  }

  for (const batch of chunks(plan.updates, 25)) {
    await Promise.all(batch.map(async (row) => {
      const { id, ...body } = row;
      await requestSupabase("procurement_purchase_order_items", {
        method: "PATCH",
        body,
        prefer: "return=minimal",
        query: new URLSearchParams({
          id: `eq.${id}`,
          company_id: `eq.${env.BOSSA_COMPANY_ID}`,
          project_id: `eq.${plan.projectId}`,
          source_system: "eq.koper",
        }),
      });
    }));
  }

  const verified = await verifyAndCleanup(plan);
  return {
    ok: true,
    updates: plan.updates.length,
    direct: plan.direct,
    multi: plan.multi,
    orphan: plan.orphan,
    allocations: verified.allocations,
    purchaseItems: verified.purchaseItems,
    orderedQuantity: verified.orderedQuantity,
    v1References: verified.v1References,
    staleAllocationsDeleted: verified.staleAllocationsDeleted,
  };
}
