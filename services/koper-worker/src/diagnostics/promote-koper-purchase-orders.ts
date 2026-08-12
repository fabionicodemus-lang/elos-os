import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
import { groupRequestItemsByProductId } from "./purchase-order-request-item-resolution.js";
import { resolvePurchaseRequestAllocations } from "./purchase-order-request-allocations.js";

type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type InputRow = { id: string; source_id: string | null; code: string; description: string; unit: string };
type ServiceRow = { id: string; source_id: string | null; code: string; description: string };
type RequestRow = { id: string; request_number: string };
type RequestItemRow = {
  id: string; request_id: string; input_id: string; cost_center_service_id: string | null;
  input_code: string; input_name: string; unit_snapshot: string;
  cost_center_code: string; cost_center_name: string; requested_quantity: number; notes: string | null;
};
type PurchaseItemRow = { id: string; source_id: string };
type AllocationRow = {
  id: string;
  source_id: string | null;
  purchase_order_item_id: string;
  request_id: string;
  request_item_id: string;
  allocated_quantity: number;
};
type PlannedAllocation = {
  purchaseItemSourceId: string;
  request_id: string;
  request_item_id: string;
  allocated_quantity: number;
  source_id: string;
};

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function identifier(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function normalize(value: unknown): string {
  return (textValue(value) ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function sourceDate(value: unknown): string | null {
  const raw = textValue(value);
  if (!raw) return null;
  const normalized = raw.replace(" ", "T");
  return Number.isNaN(Date.parse(normalized)) ? null : new Date(normalized).toISOString();
}

function dateOnly(value: unknown): string | null {
  return sourceDate(value)?.slice(0, 10) ?? null;
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
    });
    rows.push(...page);
    if (page.length < 1_000) break;
  }
  return rows;
}

async function readStaging(entity: "purchase_order" | "purchase_order_item" | "supplier"): Promise<StagingRow[]> {
  return readAll<StagingRow>("koper_staging_records", {
    select: "koper_id,koper_parent_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: `eq.${entity}`,
    sync_state: "eq.present",
    order: "koper_id.asc",
  });
}

function productRequestIds(notes: string | null): string[] {
  const match = notes?.match(/Koper productRequestIds=([^·]+)/);
  return match?.[1]?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
}

function supplierTaxId(payload: Record<string, unknown>): string | null {
  return textValue(payload.supplierCnpj) ?? textValue(payload.supplierCpf);
}

function addressText(value: unknown): string | null {
  const direct = textValue(value);
  if (direct) return direct;
  const object = objectValue(value);
  const parts = Object.values(object).flatMap((part) => {
    const text = typeof part === "string" || typeof part === "number" ? String(part).trim() : "";
    return text ? [text] : [];
  });
  return parts.length ? parts.join(", ") : null;
}

type PreparedContext = {
  orderRows: StagingRow[];
  itemRows: StagingRow[];
  supplierRows: StagingRow[];
  inputs: InputRow[];
  services: ServiceRow[];
  requestRows: RequestRow[];
  requestItems: RequestItemRow[];
  project: { id: string };
  actor: { user_id: string };
};

async function context(): Promise<PreparedContext> {
  const [orderRows, itemRows, supplierRows, inputs, services, requestRows, requestItems, projects, memberships] = await Promise.all([
    readStaging("purchase_order"), readStaging("purchase_order_item"), readStaging("supplier"),
    readAll<InputRow>("engineering_inputs", { select: "id,source_id,code,description,unit", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", order: "source_id.asc" }),
    readAll<ServiceRow>("engineering_services", { select: "id,source_id,code,description", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", order: "source_id.asc" }),
    readAll<RequestRow>("execution_material_requests", { select: "id,request_number", company_id: `eq.${env.BOSSA_COMPANY_ID}`, request_number: "like.KOPER-*", order: "request_number.asc" }),
    readAll<RequestItemRow>("execution_material_request_items", { select: "id,request_id,input_id,cost_center_service_id,input_code,input_name,unit_snapshot,cost_center_code,cost_center_name,requested_quantity,notes", company_id: `eq.${env.BOSSA_COMPANY_ID}`, notes: "like.Koper productRequestIds=*", order: "id.asc" }),
    requestSupabase<Array<{ id: string }>>("projects", { query: new URLSearchParams({ select: "id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, name: "ilike.*Flow*", status: "neq.archived", limit: "10" }) }),
    requestSupabase<Array<{ user_id: string }>>("company_memberships", { query: new URLSearchParams({ select: "user_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, status: "eq.active", order: "created_at.asc", limit: "1" }) }),
  ]);
  const project = projects[0];
  const actor = memberships[0];
  if (projects.length !== 1 || !project || !actor) throw new Error("Flow project or actor is ambiguous");
  return { orderRows, itemRows, supplierRows, inputs, services, requestRows, requestItems, project, actor };
}

export async function checkPurchaseOrderPromotionReadiness(): Promise<{
  ok: true; orders: number; sourceItems: number; suppliers: number; requestLinks: number;
  mappedInputs: number; missingInputs: number; mappedRequestLinks: number; missingRequestLinks: number;
  unlinkedItems: number; statuses: Record<string, number>;
}> {
  const data = await context();
  const inputBySource = new Map(data.inputs.map((row) => [row.source_id, row]));
  const requestItemsByProduct = groupRequestItemsByProductId(data.requestItems, (row) => productRequestIds(row.notes));
  let mappedInputs = 0; let missingInputs = 0; let mappedRequestLinks = 0; let missingRequestLinks = 0; let unlinkedItems = 0; let requestLinks = 0;
  for (const row of data.itemRows) {
    const payload = objectValue(row.payload);
    const sourceIds = [identifier(payload.productId), identifier(payload.mainProductId), identifier(payload.inputId)].filter(Boolean);
    if (sourceIds.some((id) => inputBySource.has(id))) mappedInputs += 1; else missingInputs += 1;
    const links = Array.isArray(payload.requests) ? payload.requests.map(objectValue) : [];
    if (!links.length) unlinkedItems += 1;
    requestLinks += links.length;
    for (const link of links) {
      const id = identifier(link.productRequestId);
      if (id && (requestItemsByProduct.get(id)?.length ?? 0) > 0) mappedRequestLinks += 1; else missingRequestLinks += 1;
    }
  }
  const statuses = data.orderRows.reduce<Record<string, number>>((counts, row) => {
    const status = textValue(objectValue(row.payload).status) ?? "sem status";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  return { ok: true, orders: data.orderRows.length, sourceItems: data.itemRows.length, suppliers: data.supplierRows.length, requestLinks, mappedInputs, missingInputs, mappedRequestLinks, missingRequestLinks, unlinkedItems, statuses };
}

export async function promotePurchaseOrderInputs(): Promise<{
  ok: true; sourceItems: number; historicalInputs: number; promoted: number; verifiedCatalogInputs: number;
}> {
  if (process.env.KOPER_ENGINEERING_INPUTS_WRITE_ENABLED !== "true"
    || process.env.KOPER_PURCHASE_ORDER_INPUT_PROMOTION_ENABLED !== "true") {
    throw new Error("Koper purchase order input promotion is not explicitly enabled");
  }
  const data = await context();
  const existing = new Set(data.inputs.map((row) => row.source_id).filter(Boolean));
  const missing = new Map<string, Record<string, unknown>>();
  for (const row of data.itemRows) {
    const payload = objectValue(row.payload);
    const candidates = [identifier(payload.productId), identifier(payload.mainProductId), identifier(payload.inputId)].filter((value): value is string => Boolean(value));
    if (candidates.some((id) => existing.has(id))) continue;
    const sourceId = candidates[0];
    if (!sourceId) throw new Error(`Purchase item ${row.koper_id} has no source input identity`);
    missing.set(sourceId, payload);
  }
  const now = new Date().toISOString();
  const payloads = [...missing.entries()].map(([sourceId, payload]) => ({
    company_id: env.BOSSA_COMPANY_ID,
    code: `KOPER-${sourceId}`,
    description: textValue(payload.productFullName) ?? textValue(payload.productName) ?? textValue(payload.inputName) ?? `Produto histórico Koper ${sourceId}`,
    unit: (textValue(payload.symbol) ?? textValue(payload.inputUnit) ?? "un").toLocaleLowerCase("pt-BR"),
    category: "material",
    family_code: "KOPER-PURCHASE-HISTORY",
    family_label: "Produtos históricos dos pedidos Koper",
    source_system: "koper",
    source_code: sourceId,
    source_id: sourceId,
    notes: "Produto histórico referenciado por pedido de compra do Flow Aptos.",
    status: "active",
    updated_at: now,
  }));
  let promoted = 0;
  for (const batch of chunks(payloads, 100)) {
    const rows = await requestSupabase<Array<{ id: string }>>("engineering_inputs", {
      method: "POST", body: batch, prefer: "resolution=merge-duplicates,return=representation",
      query: new URLSearchParams({ on_conflict: "company_id,source_system,source_id", select: "id" }),
    });
    promoted += rows.length;
  }
  const verifiedCatalogInputs = (await readAll<{ id: string }>("engineering_inputs", { select: "id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", order: "id.asc" })).length;
  if (verifiedCatalogInputs !== data.inputs.length + payloads.length) throw new Error("Historical purchase order input verification failed");
  return { ok: true, sourceItems: data.itemRows.length, historicalInputs: payloads.length, promoted, verifiedCatalogInputs };
}

type OrderStatus = "draft" | "confirmed" | "partially_received" | "received" | "closed" | "cancelled";

function orderStatus(payload: Record<string, unknown>, products: Record<string, unknown>[]): OrderStatus {
  const status = normalize(payload.status);
  if (status.includes("cancel")) return "cancelled";
  if (booleanValue(payload.isDraft)) return "draft";
  if (status.includes("finaliz") || status.includes("fechad") || status.includes("encerr")) return "closed";
  const quantities = products.map((product) => ({ amount: numeric(product.amount) ?? 0, received: numeric(product.amountReceived) ?? 0 }));
  if (quantities.length && quantities.every((value) => value.amount > 0 && value.received + 0.000001 >= value.amount)) return "received";
  if (quantities.some((value) => value.received > 0)) return "partially_received";
  return "confirmed";
}

export async function promoteKoperPurchaseOrders(): Promise<{
  ok: true; orders: number; items: number; suppliers: number; linkedItems: number; unlinkedItems: number;
  directItems: number; multiItems: number; orphanItems: number; allocations: number; staleAllocationsDeleted: number;
  verifiedOrders: number; verifiedItems: number; statuses: Record<string, number>;
}> {
  if (process.env.KOPER_PURCHASE_ORDER_PROMOTION_ENABLED !== "true") throw new Error("Koper purchase order promotion is not explicitly enabled");
  const data = await context();
  if (data.orderRows.length !== 1_649) throw new Error("Koper purchase order source count mismatch");

  const now = new Date().toISOString();
  const supplierPayloads = data.supplierRows.map((row) => {
    const payload = objectValue(row.payload);
    const legalName = textValue(payload.companyName) ?? textValue(payload.supplierName) ?? `Fornecedor Koper ${row.koper_id}`;
    return {
      company_id: env.BOSSA_COMPANY_ID, person_type: textValue(payload.supplierCpf) ? "individual" : "company",
      legal_name: legalName, trade_name: textValue(payload.supplierName), tax_id: supplierTaxId(payload),
      phone: textValue(payload.supCellphone) ?? textValue(payload.supPhone), email: textValue(payload.email),
      address: addressText(payload.addressSupplier), status: "active", notes: `Importado do Koper · supplierId=${row.koper_id}`,
      source_system: "koper", source_id: row.koper_id, created_by: data.actor.user_id, updated_at: now,
    };
  });
  const suppliers: Array<{ id: string; source_id: string }> = [];
  for (const batch of chunks(supplierPayloads, 100)) suppliers.push(...await requestSupabase<Array<{ id: string; source_id: string }>>("suppliers", {
    method: "POST", body: batch, prefer: "resolution=merge-duplicates,return=representation",
    query: new URLSearchParams({ on_conflict: "company_id,source_system,source_id", select: "id,source_id" }),
  }));
  const supplierBySource = new Map(suppliers.map((row) => [row.source_id, row.id]));
  const inputBySource = new Map(data.inputs.map((row) => [row.source_id, row]));
  const serviceBySource = new Map(data.services.map((row) => [row.source_id, row]));
  const serviceSourceIdByServiceId = new Map(data.services.map((row) => [row.id, row.source_id]));
  const requestBySource = new Map(data.requestRows.map((row) => [row.request_number.replace(/^KOPER-/, ""), row]));
  const requestById = new Map(data.requestRows.map((row) => [row.id, row]));
  const requestItemsByProduct = groupRequestItemsByProductId(data.requestItems, (row) => productRequestIds(row.notes));
  const itemsByOrder = new Map<string, StagingRow[]>();
  for (const row of data.itemRows) itemsByOrder.set(row.koper_parent_id ?? "", [...(itemsByOrder.get(row.koper_parent_id ?? "") ?? []), row]);

  const headerPayloads = data.orderRows.map((row) => {
    const payload = objectValue(row.payload);
    const sourceSupplier = identifier(payload.supplierId);
    const supplierId = sourceSupplier ? supplierBySource.get(sourceSupplier) : null;
    if (!supplierId) throw new Error(`Supplier mapping missing for Koper order ${row.koper_id}`);
    const products = (itemsByOrder.get(row.koper_id) ?? []).map((item) => objectValue(item.payload));
    const status = orderStatus(payload, products);
    const issueAt = sourceDate(payload.orderDate) ?? now;
    const productBase = products.reduce((sum, product) => sum + Math.max(0, numeric(product.price) ?? numeric(product.finalPrice) ?? 0) * Math.max(0, numeric(product.amount) ?? 0), 0);
    const productNet = products.reduce((sum, product) => sum + Math.max(0, numeric(product.finalPrice) ?? numeric(product.price) ?? 0) * Math.max(0, numeric(product.amount) ?? 0), 0);
    const freight = Math.max(0, numeric(payload.costShipping) ?? 0);
    const discount = Math.max(0, productBase - productNet);
    const received = products.reduce((sum, product) => sum + Math.min(Math.max(0, numeric(product.amountReceived) ?? 0), Math.max(0, numeric(product.amount) ?? 0)) * Math.max(0, numeric(product.finalPrice) ?? numeric(product.price) ?? 0), 0);
    const numericId = Number(row.koper_id);
    if (!Number.isInteger(numericId) || numericId <= 0) throw new Error(`Invalid Koper order id ${row.koper_id}`);
    return {
      company_id: env.BOSSA_COMPANY_ID, project_id: data.project.id, quotation_id: null, supplier_id: supplierId,
      sequence_no: 2_000_000 + numericId, order_number: `KOPER-OC-${row.koper_id}`, status,
      issue_date: issueAt.slice(0, 10), expected_delivery_date: dateOnly(payload.deliveryDate),
      delivery_address: addressText(payload.deliveryPlace) ?? addressText(payload.deliveryAddress),
      payment_terms: textValue(payload.paymentCondition) ?? textValue(payload.paymentTerms),
      freight_terms: freight > 0 ? `Frete Koper: R$ ${freight.toFixed(2)}` : null,
      supplier_contact_name: textValue(payload.supplierContactName), supplier_contact_email: textValue(payload.email),
      supplier_contact_phone: textValue(payload.supCellphone) ?? textValue(payload.supPhone), buyer_name: textValue(payload.userName),
      subtotal_amount: productBase, freight_amount: freight, tax_amount: 0, other_cost_amount: 0, discount_amount: discount,
      total_amount: productNet + freight, received_amount: received, invoiced_amount: 0,
      notes: `Importado do Koper · orderId=${row.koper_id} · status original=${textValue(payload.status) ?? "n/a"} · desconto negociado=${numeric(payload.negotiatedDiscount) ?? 0} · desconto total=${numeric(payload.totalDiscount) ?? 0}`,
      issued_by: data.actor.user_id, issued_at: issueAt, confirmed_by: status === "draft" ? null : data.actor.user_id,
      confirmed_at: status === "draft" ? null : sourceDate(payload.responseDate) ?? issueAt,
      closed_by: status === "closed" ? data.actor.user_id : null, closed_at: status === "closed" ? sourceDate(payload.responseDate) ?? issueAt : null,
      cancelled_by: status === "cancelled" ? data.actor.user_id : null, cancelled_at: status === "cancelled" ? sourceDate(payload.responseDate) ?? issueAt : null,
      cancellation_reason: status === "cancelled" ? `Status original no Koper: ${textValue(payload.status) ?? "Cancelado"}` : null,
      created_by: data.actor.user_id, updated_by: data.actor.user_id, created_at: issueAt, updated_at: now,
      source_system: "koper", source_id: row.koper_id,
    };
  });
  const orders: Array<{ id: string; source_id: string; status: OrderStatus }> = [];
  for (const batch of chunks(headerPayloads, 100)) orders.push(...await requestSupabase<Array<{ id: string; source_id: string; status: OrderStatus }>>("procurement_purchase_orders", {
    method: "POST", body: batch, prefer: "resolution=merge-duplicates,return=representation",
    query: new URLSearchParams({ on_conflict: "company_id,source_system,source_id", select: "id,source_id,status" }),
  }));
  const orderBySource = new Map(orders.map((row) => [row.source_id, row.id]));

  const itemPayloads: Array<Record<string, unknown>> = [];
  const plannedAllocations: PlannedAllocation[] = [];
  let directItems = 0; let multiItems = 0; let orphanItems = 0; let unlinkedItems = 0;
  for (const row of data.itemRows) {
    const payload = objectValue(row.payload);
    const orderSource = row.koper_parent_id ?? identifier(payload.orderId);
    const orderId = orderSource ? orderBySource.get(orderSource) : null;
    const inputSource = [identifier(payload.productId), identifier(payload.mainProductId), identifier(payload.inputId)].find((id) => id && inputBySource.has(id));
    const input = inputSource ? inputBySource.get(inputSource) : null;
    if (!orderId || !input) throw new Error(`Purchase item mapping missing for ${row.koper_id}`);
    const ordered = Math.max(0, numeric(payload.amount) ?? 0);
    if (ordered <= 0) throw new Error(`Invalid ordered quantity for ${row.koper_id}`);
    const receivedTotal = Math.min(ordered, Math.max(0, numeric(payload.amountReceived) ?? 0));
    const unitPrice = Math.max(0, numeric(payload.price) ?? numeric(payload.finalPrice) ?? 0);
    const deliveredUnitCost = Math.max(0, numeric(payload.finalPrice) ?? unitPrice);
    const discountPercent = Math.min(100, Math.max(0, numeric(payload.discount) ?? (unitPrice > 0 ? (unitPrice - deliveredUnitCost) / unitPrice * 100 : 0)));
    const requests = Array.isArray(payload.requests) ? payload.requests.map(objectValue) : [];
    const positiveLinks = requests.filter((link) => (numeric(link.requestAmount) ?? 0) > 0);
    const linkTotal = positiveLinks.reduce((sum, link) => sum + (numeric(link.requestAmount) ?? 0), 0);
    const splits = positiveLinks.length ? positiveLinks.map((link) => ({ link, quantity: ordered * (numeric(link.requestAmount) ?? 0) / linkTotal })) : [{ link: {}, quantity: ordered }];
    let receivedRemaining = receivedTotal;
    for (let index = 0; index < splits.length; index += 1) {
      const split = splits[index];
      if (!split) continue;
      const productRequestId = identifier(split.link.productRequestId);
      const requestSource = identifier(split.link.requestId);
      const purchaseItemSourceId = productRequestId ? `${row.koper_id}:${productRequestId}` : row.koper_id;
      const purchaseCostCenterSourceId = identifier(payload.costCenterId);

      let requestId: string | null = null;
      let requestItem: RequestItemRow | null = null;
      let costCenterServiceId: string | null = null;
      let requestNumber = "KOPER-SEM-SOLICITACAO";
      let costCenterCode = "KOPER-OC-LEGACY";
      let costCenterName = "Compra histórica sem centro de custo recuperável";

      if (productRequestId) {
        const resolution = resolvePurchaseRequestAllocations(
          productRequestId,
          split.quantity,
          purchaseCostCenterSourceId,
          requestItemsByProduct,
          serviceSourceIdByServiceId,
        );
        if (resolution.status === "invalid") {
          throw new Error(`Invalid request allocation for Koper orderProductId=${row.koper_id} productRequestId=${productRequestId}: ${resolution.reason}`);
        }
        if (resolution.status === "missing") {
          orphanItems += 1;
          unlinkedItems += 1;
          costCenterCode = "KOPER-OC-ORPHAN";
          costCenterName = `Compra histórica com productRequestId=${productRequestId} ausente do staging atual`;
        } else if (resolution.status === "direct") {
          directItems += 1;
          requestItem = resolution.item;
          requestId = requestItem.request_id;
          costCenterServiceId = requestItem.cost_center_service_id;
          requestNumber = requestById.get(requestItem.request_id)?.request_number ?? "KOPER-SOLICITACAO-LEGADA";
          costCenterCode = requestItem.cost_center_code;
          costCenterName = requestItem.cost_center_name;
        } else {
          multiItems += 1;
          requestId = resolution.requestId;
          requestNumber = requestById.get(resolution.requestId)?.request_number ?? "KOPER-SOLICITACAO-LEGADA";
          costCenterCode = "KOPER-OC-MULTI";
          costCenterName = "Compra histórica rateada entre múltiplos serviços";
          for (const allocation of resolution.allocations) {
            plannedAllocations.push({
              purchaseItemSourceId,
              request_id: allocation.item.request_id,
              request_item_id: allocation.item.id,
              allocated_quantity: allocation.quantity,
              source_id: `${row.koper_id}:${productRequestId}:${allocation.item.id}`,
            });
          }
        }
      } else {
        unlinkedItems += 1;
        const request = requestSource ? requestBySource.get(requestSource) : null;
        const service = serviceBySource.get(purchaseCostCenterSourceId ?? "") ?? null;
        requestId = request?.id ?? null;
        costCenterServiceId = service?.id ?? null;
        requestNumber = requestSource ? `KOPER-${requestSource}` : "KOPER-SEM-SOLICITACAO";
        costCenterCode = service?.code ?? "KOPER-OC-LEGACY";
        costCenterName = service?.description ?? "Compra histórica sem centro de custo recuperável";
      }

      const received = Math.min(split.quantity, receivedRemaining);
      receivedRemaining -= received;
      itemPayloads.push({
        company_id: env.BOSSA_COMPANY_ID, project_id: data.project.id, order_id: orderId,
        quotation_id: null, quotation_item_id: null, award_id: null, offer_item_id: null,
        request_id: requestId, request_item_id: requestItem?.id ?? null, input_id: input.id,
        cost_center_service_id: costCenterServiceId,
        request_number: requestNumber,
        input_code: requestItem?.input_code ?? input.code, input_name: requestItem?.input_name ?? input.description,
        unit_snapshot: requestItem?.unit_snapshot ?? input.unit, cost_center_code: costCenterCode, cost_center_name: costCenterName,
        brand: textValue(payload.brand), manufacturer: textValue(payload.manufacturer), ordered_quantity: split.quantity,
        received_quantity: received, accepted_quantity: received, rejected_quantity: 0,
        cancelled_quantity: booleanValue(payload.prodCanceled) ? Math.max(0, split.quantity - received) : 0,
        unit_price: unitPrice, discount_percent: discountPercent, tax_percent: 0, freight_amount: 0, other_cost_amount: 0,
        delivered_unit_cost: deliveredUnitCost, total_amount: deliveredUnitCost * split.quantity,
        expected_delivery_date: null, notes: `Koper orderProductId=${row.koper_id}${productRequestId ? ` · productRequestId=${productRequestId}` : " · sem solicitação vinculada"}`,
        sort_order: itemPayloads.length, created_at: now, updated_at: now,
        source_system: "koper", source_id: purchaseItemSourceId,
      });
    }
  }

  const purchaseItems: PurchaseItemRow[] = [];
  for (const batch of chunks(itemPayloads, 100)) purchaseItems.push(...await requestSupabase<PurchaseItemRow[]>("procurement_purchase_order_items", {
    method: "POST", body: batch, prefer: "resolution=merge-duplicates,return=representation",
    query: new URLSearchParams({ on_conflict: "company_id,source_system,source_id", select: "id,source_id" }),
  }));
  const purchaseItemBySource = new Map(purchaseItems.map((row) => [row.source_id, row.id]));
  if (purchaseItemBySource.size !== itemPayloads.length) throw new Error("Duplicate or missing Koper purchase item source_id after upsert");

  const allocationPayloads = plannedAllocations.map((allocation) => {
    const purchaseOrderItemId = purchaseItemBySource.get(allocation.purchaseItemSourceId);
    if (!purchaseOrderItemId) throw new Error(`Purchase item missing for allocation source=${allocation.source_id}`);
    return {
      company_id: env.BOSSA_COMPANY_ID,
      project_id: data.project.id,
      purchase_order_item_id: purchaseOrderItemId,
      request_id: allocation.request_id,
      request_item_id: allocation.request_item_id,
      allocated_quantity: allocation.allocated_quantity,
      source_system: "koper",
      source_id: allocation.source_id,
      updated_at: now,
    };
  });
  for (const batch of chunks(allocationPayloads, 100)) await requestSupabase("procurement_purchase_order_item_request_allocations", {
    method: "POST", body: batch, prefer: "resolution=merge-duplicates,return=minimal",
    query: new URLSearchParams({ on_conflict: "company_id,source_system,source_id" }),
  });

  const currentPurchaseItemIds = new Set(purchaseItems.map((row) => row.id));
  const intendedAllocationSourceIds = new Set(allocationPayloads.map((row) => row.source_id));
  const currentAllocations = await readAll<AllocationRow>("procurement_purchase_order_item_request_allocations", {
    select: "id,source_id,purchase_order_item_id,request_id,request_item_id,allocated_quantity",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    project_id: `eq.${data.project.id}`,
    source_system: "eq.koper",
    order: "id.asc",
  });
  const staleAllocations = currentAllocations.filter((row) => currentPurchaseItemIds.has(row.purchase_order_item_id)
    && (!row.source_id || !intendedAllocationSourceIds.has(row.source_id)));
  for (const batch of chunks(staleAllocations, 100)) {
    await requestSupabase("procurement_purchase_order_item_request_allocations", {
      method: "DELETE",
      prefer: "return=minimal",
      query: new URLSearchParams({
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        project_id: `eq.${data.project.id}`,
        source_system: "eq.koper",
        id: `in.(${batch.map((row) => row.id).join(",")})`,
      }),
    });
  }

  const verifiedOrders = await readAll<{ id: string; status: OrderStatus }>("procurement_purchase_orders", { select: "id,status", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", order: "id.asc" });
  const verifiedItems = await readAll<PurchaseItemRow>("procurement_purchase_order_items", { select: "id,source_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", order: "id.asc" });
  const verifiedAllocations = await readAll<AllocationRow>("procurement_purchase_order_item_request_allocations", {
    select: "id,source_id,purchase_order_item_id,request_id,request_item_id,allocated_quantity",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    project_id: `eq.${data.project.id}`,
    source_system: "eq.koper",
    order: "id.asc",
  });
  if (verifiedOrders.length !== headerPayloads.length || verifiedItems.length !== itemPayloads.length) throw new Error("Koper purchase order verification failed");

  const verifiedCurrentAllocations = verifiedAllocations.filter((row) => currentPurchaseItemIds.has(row.purchase_order_item_id));
  if (verifiedCurrentAllocations.length !== allocationPayloads.length) {
    throw new Error(`Koper purchase allocation count mismatch expected=${allocationPayloads.length} actual=${verifiedCurrentAllocations.length}`);
  }
  const allocationBySource = new Map(verifiedCurrentAllocations.map((row) => [row.source_id, row]));
  for (const expected of allocationPayloads) {
    const actual = allocationBySource.get(expected.source_id);
    if (!actual
      || actual.purchase_order_item_id !== expected.purchase_order_item_id
      || actual.request_id !== expected.request_id
      || actual.request_item_id !== expected.request_item_id
      || Math.abs(actual.allocated_quantity - expected.allocated_quantity) > 0.000001) {
      throw new Error(`Koper purchase allocation verification failed for source=${expected.source_id}`);
    }
  }

  const linkedItems = directItems + multiItems;
  return {
    ok: true,
    orders: headerPayloads.length,
    items: itemPayloads.length,
    suppliers: suppliers.length,
    linkedItems,
    unlinkedItems,
    directItems,
    multiItems,
    orphanItems,
    allocations: allocationPayloads.length,
    staleAllocationsDeleted: staleAllocations.length,
    verifiedOrders: verifiedOrders.length,
    verifiedItems: verifiedItems.length,
    statuses: verifiedOrders.reduce<Record<string, number>>((counts, row) => { counts[row.status] = (counts[row.status] ?? 0) + 1; return counts; }, {}),
  };
}
