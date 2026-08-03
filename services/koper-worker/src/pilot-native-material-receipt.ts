import { createHash } from "node:crypto";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type UnknownRecord = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type NativeOrder = {
  id: string;
  source_id: string;
  supplier_id: string;
  project_id: string;
  order_number: string;
  status: string;
  received_amount: number;
};
type NativeOrderItem = {
  id: string;
  order_id: string;
  input_id: string;
  source_id: string | null;
  input_code: string;
  input_name: string;
  unit_snapshot: string;
  ordered_quantity: number;
  received_quantity: number;
  accepted_quantity: number;
  rejected_quantity: number;
  unit_price: number;
  delivered_unit_cost: number;
  cost_center_service_id: string | null;
  cost_center_code: string;
  cost_center_name: string;
};
type InputRow = { id: string; source_id: string | null };
type ActorRow = { user_id: string };

type ResolvedRow = {
  source: StagingRow;
  order: NativeOrder;
  item: NativeOrderItem;
  quantity: number;
  unitCost: number;
};

function objectValue(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function identifier(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateOnly(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const date = new Date(normalized);
  if (!Number.isNaN(date.valueOf())) return date.toISOString().slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function timestamp(value: unknown, fallbackDate: string): string {
  const raw = text(value);
  if (raw) {
    const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
    const date = new Date(normalized);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  return `${fallbackDate}T12:00:00.000Z`;
}

function baseSourceId(value: string | null): string | null {
  return identifier(value)?.split(":")[0] ?? null;
}

function identifierArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    const id = identifier(item);
    return id ? [id] : [];
  }))];
}

function stableUuid(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0, 32), "hex");
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(0.000001, Math.abs(right) * 0.000001);
}

async function readAll<T>(resource: string, query: Record<string, string>): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(resource, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
    });
    result.push(...page);
    if (page.length < 1_000) break;
  }
  return result;
}

async function orderSnapshot(orderId: string): Promise<{
  orderReceivedAmount: number;
  items: Array<{ id: string; received: number; accepted: number; rejected: number }>;
}> {
  const [orders, items] = await Promise.all([
    requestSupabase<Array<{ received_amount: number }>>("procurement_purchase_orders", {
      query: new URLSearchParams({ select: "received_amount", id: `eq.${orderId}`, limit: "1" }),
    }),
    requestSupabase<Array<{ id: string; received_quantity: number; accepted_quantity: number; rejected_quantity: number }>>(
      "procurement_purchase_order_items",
      { query: new URLSearchParams({
        select: "id,received_quantity,accepted_quantity,rejected_quantity",
        order_id: `eq.${orderId}`,
        order: "id.asc",
        limit: "1000",
      }) },
    ),
  ]);
  const order = orders[0];
  if (!order) throw new Error("Pilot order snapshot is unavailable");
  return {
    orderReceivedAmount: Number(order.received_amount ?? 0),
    items: items.map((item) => ({
      id: item.id,
      received: Number(item.received_quantity ?? 0),
      accepted: Number(item.accepted_quantity ?? 0),
      rejected: Number(item.rejected_quantity ?? 0),
    })),
  };
}

await import("./index.js");

try {
  if (process.env.KOPER_MATERIAL_RECEIPT_DIRECT_PILOT_WRITE_ENABLED !== "true") {
    console.log("KOPER_MATERIAL_RECEIPT_DIRECT_PILOT_SKIPPED", JSON.stringify({ reason: "WRITE_DISABLED" }));
  } else {
    const entryId = "13372";
    const entryNumeric = Number(entryId);
    const marker = `Koper stockMovementId=${entryId}`;

    const [entryRows, entryItems, invoices, orders, orderItems, inputs, actors] = await Promise.all([
      requestSupabase<StagingRow[]>("koper_staging_records", { query: new URLSearchParams({
        select: "koper_id,koper_parent_id,payload",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: "eq.stock_entry",
        koper_id: `eq.${entryId}`,
        sync_state: "eq.present",
        limit: "1",
      }) }),
      requestSupabase<StagingRow[]>("koper_staging_records", { query: new URLSearchParams({
        select: "koper_id,koper_parent_id,payload",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: "eq.stock_entry_item",
        koper_parent_id: `eq.${entryId}`,
        sync_state: "eq.present",
        order: "koper_id.asc",
        limit: "100",
      }) }),
      readAll<StagingRow>("koper_staging_records", {
        select: "koper_id,koper_parent_id,payload",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: "eq.xml_invoice",
        sync_state: "eq.present",
        order: "koper_id.asc",
      }),
      readAll<NativeOrder>("procurement_purchase_orders", {
        select: "id,source_id,supplier_id,project_id,order_number,status,received_amount",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper",
        order: "source_id.asc",
      }),
      readAll<NativeOrderItem>("procurement_purchase_order_items", {
        select: "id,order_id,input_id,source_id,input_code,input_name,unit_snapshot,ordered_quantity,received_quantity,accepted_quantity,rejected_quantity,unit_price,delivered_unit_cost,cost_center_service_id,cost_center_code,cost_center_name",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper",
        order: "order_id.asc,sort_order.asc",
      }),
      readAll<InputRow>("engineering_inputs", {
        select: "id,source_id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper",
        order: "source_id.asc",
      }),
      requestSupabase<ActorRow[]>("company_memberships", {
        query: new URLSearchParams({
          select: "user_id",
          company_id: `eq.${env.BOSSA_COMPANY_ID}`,
          status: "eq.active",
          order: "created_at.asc",
          limit: "1",
        }),
      }),
    ]);

    const actor = actors[0];
    const entry = entryRows[0];
    if (!actor || !entry || entryItems.length === 0) throw new Error("Pilot context is unavailable");
    const entryPayload = objectValue(entry.payload);
    if (identifier(entryPayload.originType) !== "0") throw new Error("Pilot entry is not a programmed purchase entry");

    const orderBySource = new Map(orders.map((order) => [order.source_id, order]));
    const itemsByOrder = new Map<string, NativeOrderItem[]>();
    for (const item of orderItems) itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), item]);
    const inputBySource = new Map(inputs.flatMap((input) => input.source_id ? [[input.source_id, input] as const] : []));

    const resolvedRows: ResolvedRow[] = [];
    for (const source of entryItems) {
      const payload = objectValue(source.payload);
      const orderCandidates = identifierArray(payload.candidatePurchaseOrderIds).flatMap((sourceId) => {
        const order = orderBySource.get(sourceId);
        return order ? [order] : [];
      });
      const inputIds = new Set([
        identifier(payload.mainProductId),
        identifier(payload.productId),
        identifier(payload.inputId),
        identifier(payload.genericProdSeq),
      ].filter((value): value is string => Boolean(value)).flatMap((sourceId) => {
        const input = inputBySource.get(sourceId);
        return input ? [input.id] : [];
      }));
      const candidates = orderCandidates.flatMap((order) =>
        (itemsByOrder.get(order.id) ?? [])
          .filter((item) => inputIds.has(item.input_id))
          .map((item) => ({ order, item })),
      );
      const groups = new Map<string, Array<{ order: NativeOrder; item: NativeOrderItem }>>();
      for (const candidate of candidates) {
        const sourceItemId = baseSourceId(candidate.item.source_id);
        if (!sourceItemId) continue;
        const key = `${candidate.order.id}:${sourceItemId}`;
        groups.set(key, [...(groups.get(key) ?? []), candidate]);
      }
      if (groups.size !== 1) throw new Error(`Pilot item ${source.koper_id} does not have one source purchase item group`);
      const group = [...groups.values()][0]!;
      if (group.length !== 1) throw new Error(`Pilot item ${source.koper_id} is split across request allocations`);
      const quantity = numeric(payload.productAmount) ?? 0;
      if (quantity <= 0) throw new Error(`Pilot item ${source.koper_id} has invalid quantity`);
      const unitCost = Math.max(
        0,
        numeric(payload.averageProductValue)
          ?? numeric(payload.productValue)
          ?? Number(group[0]!.item.delivered_unit_cost ?? group[0]!.item.unit_price ?? 0),
      );
      resolvedRows.push({ source, order: group[0]!.order, item: group[0]!.item, quantity, unitCost });
    }

    const orderIds = [...new Set(resolvedRows.map((row) => row.order.id))];
    if (orderIds.length !== 1) throw new Error("Pilot entry spans multiple orders");
    const order = resolvedRows[0]!.order;
    const receiptDate = dateOnly(entryPayload.movementDate) ?? dateOnly(entryPayload.entryDate);
    if (!receiptDate) throw new Error("Pilot receipt date is unavailable");
    const sourceTimestamp = timestamp(entryPayload.movementDate ?? entryPayload.entryDate, receiptDate);
    const receiptId = stableUuid(`elos:koper:stock-entry:${entryId}:order:${order.id}`);
    const receiptNumber = `KOPER-REC-${entryId}-${order.source_id}`;

    const invoiceIds = [...new Set(entryItems.flatMap((row) => identifierArray(objectValue(row.payload).invoiceIds)))];
    const invoice = invoiceIds.length === 1 ? invoices.find((row) => row.koper_id === invoiceIds[0]) : null;
    const invoicePayload = objectValue(invoice?.payload);
    const invoiceAmount = resolvedRows.reduce((total, row) => total + row.quantity * row.unitCost, 0);

    const before = await orderSnapshot(order.id);

    const headerPayload = {
      id: receiptId,
      company_id: env.BOSSA_COMPANY_ID,
      project_id: order.project_id,
      order_id: order.id,
      supplier_id: order.supplier_id,
      sequence_no: 3_000_000 + entryNumeric,
      receipt_number: receiptNumber,
      status: "draft",
      receipt_date: receiptDate,
      arrival_time: null,
      invoice_number: identifier(invoicePayload.invoiceNumber),
      invoice_series: null,
      invoice_access_key: null,
      invoice_date: dateOnly(invoicePayload.emitDate),
      invoice_amount: invoiceAmount,
      carrier_name: null,
      vehicle_plate: null,
      driver_name: null,
      delivery_document: null,
      warehouse_location: "Estoque Flow Aptos",
      general_condition: "accepted",
      notes: `Importado do Koper · ${marker} · histórico em rascunho · não recalcular pedido`,
      receiver_user_id: actor.user_id,
      receiver_name: "Importação histórica Koper",
      created_by: actor.user_id,
      updated_by: actor.user_id,
      created_at: sourceTimestamp,
      updated_at: new Date().toISOString(),
    };

    await requestSupabase("procurement_material_receipts", {
      method: "POST",
      body: headerPayload,
      prefer: "resolution=merge-duplicates,return=minimal",
      query: new URLSearchParams({ on_conflict: "id" }),
    });

    const itemPayloads = resolvedRows.map((row, index) => ({
      id: stableUuid(`elos:koper:receipt:${receiptId}:movement:${row.source.koper_id}:order-item:${row.item.id}`),
      company_id: env.BOSSA_COMPANY_ID,
      project_id: order.project_id,
      receipt_id: receiptId,
      order_id: order.id,
      order_item_id: row.item.id,
      input_id: row.item.input_id,
      cost_center_service_id: row.item.cost_center_service_id,
      input_code: row.item.input_code,
      input_name: row.item.input_name,
      unit_snapshot: row.item.unit_snapshot,
      cost_center_code: row.item.cost_center_code,
      cost_center_name: row.item.cost_center_name,
      ordered_quantity: Number(row.item.ordered_quantity),
      previously_accepted_quantity: Math.max(0, Number(row.item.accepted_quantity) - row.quantity),
      delivered_quantity: row.quantity,
      accepted_quantity: row.quantity,
      rejected_quantity: 0,
      unit_cost: row.unitCost,
      accepted_amount: row.quantity * row.unitCost,
      batch_number: null,
      expiration_date: null,
      condition: "accepted",
      rejection_reason: null,
      destination_location: "Estoque Flow Aptos",
      notes: `Importado do Koper · productMovementId=${row.source.koper_id}`,
      sort_order: index,
      created_at: sourceTimestamp,
      updated_at: new Date().toISOString(),
    }));

    await requestSupabase("procurement_material_receipt_items", {
      method: "POST",
      body: itemPayloads,
      prefer: "resolution=merge-duplicates,return=minimal",
      query: new URLSearchParams({ on_conflict: "id" }),
    });

    const [savedReceipts, savedItems, after] = await Promise.all([
      requestSupabase<Array<{ id: string; status: string; receipt_number: string; order_id: string; notes: string | null }>>(
        "procurement_material_receipts",
        { query: new URLSearchParams({ select: "id,status,receipt_number,order_id,notes", id: `eq.${receiptId}`, limit: "1" }) },
      ),
      requestSupabase<Array<{ id: string; order_item_id: string; delivered_quantity: number; accepted_quantity: number; condition: string }>>(
        "procurement_material_receipt_items",
        { query: new URLSearchParams({
          select: "id,order_item_id,delivered_quantity,accepted_quantity,condition",
          receipt_id: `eq.${receiptId}`,
          order: "sort_order.asc",
          limit: "100",
        }) },
      ),
      orderSnapshot(order.id),
    ]);

    const savedReceipt = savedReceipts[0];
    if (!savedReceipt || savedReceipt.order_id !== order.id || savedItems.length !== itemPayloads.length) {
      throw new Error("Direct pilot receipt verification failed");
    }
    if (!approximatelyEqual(before.orderReceivedAmount, after.orderReceivedAmount)) {
      throw new Error("Direct pilot changed purchase order received amount");
    }
    if (before.items.length !== after.items.length) throw new Error("Direct pilot changed purchase order item count");
    for (let index = 0; index < before.items.length; index += 1) {
      const left = before.items[index]!;
      const right = after.items[index]!;
      if (
        left.id !== right.id
        || !approximatelyEqual(left.received, right.received)
        || !approximatelyEqual(left.accepted, right.accepted)
        || !approximatelyEqual(left.rejected, right.rejected)
      ) throw new Error(`Direct pilot changed purchase order item ${left.id}`);
    }

    console.log("KOPER_MATERIAL_RECEIPT_DIRECT_PILOT_RESULT", JSON.stringify({
      ok: true,
      entryId,
      orderSourceId: order.source_id,
      orderNumber: order.order_number,
      receiptId,
      receiptNumber: savedReceipt.receipt_number,
      status: savedReceipt.status,
      sourceItems: entryItems.length,
      savedItems: savedItems.length,
      deliveredQuantity: savedItems.reduce((total, item) => total + Number(item.delivered_quantity), 0),
      acceptedQuantity: savedItems.reduce((total, item) => total + Number(item.accepted_quantity), 0),
      orderQuantitiesUnchanged: true,
      inventoryMovementCreated: false,
    }));
  }
} catch (error: unknown) {
  console.error("KOPER_MATERIAL_RECEIPT_DIRECT_PILOT_FAILED", {
    message: error instanceof Error ? error.message.slice(0, 1_000) : "unknown",
  });
}
