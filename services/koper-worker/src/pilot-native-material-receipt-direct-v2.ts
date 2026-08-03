import { createHash } from "node:crypto";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Order = { id: string; source_id: string; supplier_id: string; project_id: string; order_number: string; received_amount: number };
type OrderItem = {
  id: string; order_id: string; input_id: string; source_id: string | null;
  input_code: string; input_name: string; unit_snapshot: string;
  cost_center_service_id: string | null; cost_center_code: string; cost_center_name: string;
  ordered_quantity: number; received_quantity: number; accepted_quantity: number; rejected_quantity: number;
  unit_price: number; delivered_unit_cost: number;
};

const object = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};

const id = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result || null;
};

const numberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const stringIds = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.flatMap((item) => id(item) ? [id(item)!] : []))]
  : [];

function dateOnly(value: unknown): string | null {
  const raw = id(value);
  if (!raw) return null;
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

function timestamp(value: unknown, date: string): string {
  const raw = id(value);
  if (raw) {
    const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  return `${date}T12:00:00.000Z`;
}

function uuid(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0, 32), "hex");
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function quotedIn(values: string[]): string {
  return `in.(${values.map((value) => `\"${value.replaceAll("\"", "\\\"")}\"`).join(",")})`;
}

function same(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(0.000001, Math.abs(right) * 0.000001);
}

async function snapshot(orderId: string): Promise<{ amount: number; items: Map<string, [number, number, number]> }> {
  const [headers, rows] = await Promise.all([
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
  if (!headers[0]) throw new Error("Order snapshot unavailable");
  return {
    amount: Number(headers[0].received_amount ?? 0),
    items: new Map(rows.map((row) => [row.id, [
      Number(row.received_quantity ?? 0),
      Number(row.accepted_quantity ?? 0),
      Number(row.rejected_quantity ?? 0),
    ]])),
  };
}

await import("./index.js");

try {
  if (process.env.KOPER_MATERIAL_RECEIPT_DIRECT_PILOT_WRITE_ENABLED !== "true") {
    console.log("KOPER_MATERIAL_RECEIPT_DIRECT_V2_SKIPPED", JSON.stringify({ reason: "WRITE_DISABLED" }));
  } else {
    const entryId = "13372";
    const [entries, entryItems, actors] = await Promise.all([
      requestSupabase<StagingRow[]>("koper_staging_records", { query: new URLSearchParams({
        select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper", entity: "eq.stock_entry", koper_id: `eq.${entryId}`,
        sync_state: "eq.present", limit: "1",
      }) }),
      requestSupabase<StagingRow[]>("koper_staging_records", { query: new URLSearchParams({
        select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper", entity: "eq.stock_entry_item", koper_parent_id: `eq.${entryId}`,
        sync_state: "eq.present", order: "koper_id.asc", limit: "100",
      }) }),
      requestSupabase<Array<{ user_id: string }>>("company_memberships", { query: new URLSearchParams({
        select: "user_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        status: "eq.active", order: "created_at.asc", limit: "1",
      }) }),
    ]);
    const entry = entries[0];
    const actor = actors[0];
    if (!entry || !actor || entryItems.length !== 1) throw new Error("Pilot entry context is not uniquely resolvable");
    const entryPayload = object(entry.payload);
    const itemPayload = object(entryItems[0]!.payload);
    if (id(entryPayload.originType) !== "0") throw new Error("Pilot entry is not a programmed entry");

    const orderSourceIds = stringIds(itemPayload.candidatePurchaseOrderIds);
    if (orderSourceIds.length !== 1) throw new Error("Pilot order source is not unique");
    const nativeOrders = await requestSupabase<Order[]>("procurement_purchase_orders", {
      query: new URLSearchParams({
        select: "id,source_id,supplier_id,project_id,order_number,received_amount",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper",
        source_id: `eq.${orderSourceIds[0]}`, limit: "2",
      }),
    });
    const order = nativeOrders[0];
    if (nativeOrders.length !== 1 || !order) throw new Error("Pilot native order is not unique");

    const sourceProductIds = [
      id(itemPayload.mainProductId), id(itemPayload.productId), id(itemPayload.inputId), id(itemPayload.genericProdSeq),
    ].filter((value): value is string => Boolean(value));
    if (sourceProductIds.length === 0) throw new Error("Pilot source product is unavailable");
    const inputs = await requestSupabase<Array<{ id: string; source_id: string }>>("engineering_inputs", {
      query: new URLSearchParams({
        select: "id,source_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper", source_id: quotedIn(sourceProductIds), limit: "20",
      }),
    });
    const inputIds = new Set(inputs.map((input) => input.id));
    const nativeItems = await requestSupabase<OrderItem[]>("procurement_purchase_order_items", {
      query: new URLSearchParams({
        select: "id,order_id,input_id,source_id,input_code,input_name,unit_snapshot,cost_center_service_id,cost_center_code,cost_center_name,ordered_quantity,received_quantity,accepted_quantity,rejected_quantity,unit_price,delivered_unit_cost",
        order_id: `eq.${order.id}`, input_id: quotedIn([...inputIds]), order: "id.asc", limit: "100",
      }),
    });
    const groups = new Map<string, OrderItem[]>();
    for (const row of nativeItems) {
      const base = id(row.source_id)?.split(":")[0];
      if (base) groups.set(base, [...(groups.get(base) ?? []), row]);
    }
    if (groups.size !== 1) throw new Error("Pilot purchase item source group is not unique");
    const group = [...groups.values()][0]!;
    if (group.length !== 1) throw new Error("Pilot purchase item is split across allocations");
    const orderItem = group[0]!;

    const quantity = numberValue(itemPayload.productAmount) ?? 0;
    if (quantity <= 0) throw new Error("Pilot quantity is invalid");
    const unitCost = Math.max(0,
      numberValue(itemPayload.averageProductValue)
      ?? numberValue(itemPayload.productValue)
      ?? Number(orderItem.delivered_unit_cost ?? orderItem.unit_price ?? 0),
    );
    const receiptDate = dateOnly(entryPayload.movementDate) ?? dateOnly(entryPayload.entryDate);
    if (!receiptDate) throw new Error("Pilot receipt date unavailable");
    const sourceTimestamp = timestamp(entryPayload.movementDate ?? entryPayload.entryDate, receiptDate);

    const invoiceIds = stringIds(itemPayload.invoiceIds);
    const invoiceRows = invoiceIds.length === 1
      ? await requestSupabase<StagingRow[]>("koper_staging_records", { query: new URLSearchParams({
          select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
          source: "eq.koper", entity: "eq.xml_invoice", koper_id: `eq.${invoiceIds[0]}`,
          sync_state: "eq.present", limit: "1",
        }) })
      : [];
    const invoice = object(invoiceRows[0]?.payload);

    const receiptId = uuid(`elos:koper:stock-entry:${entryId}:order:${order.id}`);
    const receiptNumber = `KOPER-REC-${entryId}-${order.source_id}`;
    const now = new Date().toISOString();
    const before = await snapshot(order.id);

    await requestSupabase("procurement_material_receipts", {
      method: "POST",
      body: {
        id: receiptId, company_id: env.BOSSA_COMPANY_ID, project_id: order.project_id,
        order_id: order.id, supplier_id: order.supplier_id,
        sequence_no: 3_000_000 + Number(entryId), receipt_number: receiptNumber,
        status: "draft", receipt_date: receiptDate, arrival_time: null,
        invoice_number: id(invoice.invoiceNumber), invoice_series: null, invoice_access_key: null,
        invoice_date: dateOnly(invoice.emitDate), invoice_amount: quantity * unitCost,
        carrier_name: null, vehicle_plate: null, driver_name: null, delivery_document: null,
        warehouse_location: "Estoque Flow Aptos", general_condition: null,
        notes: `Importado do Koper · Koper stockMovementId=${entryId} · histórico em rascunho · não recalcular pedido`,
        receiver_user_id: actor.user_id, receiver_name: "Importação histórica Koper",
        created_by: actor.user_id, updated_by: actor.user_id,
        created_at: sourceTimestamp, updated_at: now,
      },
      prefer: "resolution=merge-duplicates,return=minimal",
      query: new URLSearchParams({ on_conflict: "id" }),
    });

    const itemId = uuid(`elos:koper:receipt:${receiptId}:movement:${entryItems[0]!.koper_id}:order-item:${orderItem.id}`);
    const conditionCandidates = ["good", "accepted", "ok", "conforming", "normal", "intact"];
    let acceptedCondition: string | null = null;
    const conditionFailures: string[] = [];
    for (const condition of conditionCandidates) {
      try {
        await requestSupabase("procurement_material_receipt_items", {
          method: "POST",
          body: {
            id: itemId, company_id: env.BOSSA_COMPANY_ID, project_id: order.project_id,
            receipt_id: receiptId, order_id: order.id, order_item_id: orderItem.id,
            input_id: orderItem.input_id, cost_center_service_id: orderItem.cost_center_service_id,
            input_code: orderItem.input_code, input_name: orderItem.input_name,
            unit_snapshot: orderItem.unit_snapshot, cost_center_code: orderItem.cost_center_code,
            cost_center_name: orderItem.cost_center_name,
            ordered_quantity: Number(orderItem.ordered_quantity),
            previously_accepted_quantity: Math.max(0, Number(orderItem.accepted_quantity) - quantity),
            delivered_quantity: quantity, accepted_quantity: quantity, rejected_quantity: 0,
            unit_cost: unitCost, accepted_amount: quantity * unitCost,
            batch_number: null, expiration_date: null, condition,
            rejection_reason: null, destination_location: "Estoque Flow Aptos",
            notes: `Importado do Koper · productMovementId=${entryItems[0]!.koper_id}`,
            sort_order: 0, created_at: sourceTimestamp, updated_at: now,
          },
          prefer: "resolution=merge-duplicates,return=minimal",
          query: new URLSearchParams({ on_conflict: "id" }),
        });
        acceptedCondition = condition;
        break;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown";
        conditionFailures.push(`${condition}:${/23514/.test(message) ? "constraint" : "other"}`);
        if (!/23514/.test(message)) throw error;
      }
    }
    if (!acceptedCondition) throw new Error(`No accepted item condition: ${conditionFailures.join(",")}`);

    const [headers, savedItems, after] = await Promise.all([
      requestSupabase<Array<{ id: string; receipt_number: string; status: string; general_condition: string | null }>>(
        "procurement_material_receipts",
        { query: new URLSearchParams({
          select: "id,receipt_number,status,general_condition", id: `eq.${receiptId}`, limit: "1",
        }) },
      ),
      requestSupabase<Array<{ id: string; condition: string; delivered_quantity: number; accepted_quantity: number }>>(
        "procurement_material_receipt_items",
        { query: new URLSearchParams({
          select: "id,condition,delivered_quantity,accepted_quantity", receipt_id: `eq.${receiptId}`, limit: "10",
        }) },
      ),
      snapshot(order.id),
    ]);
    if (headers.length !== 1 || savedItems.length !== 1) throw new Error("Pilot verification count failed");
    if (!same(before.amount, after.amount) || before.items.size !== after.items.size) {
      throw new Error("Pilot changed order totals");
    }
    for (const [nativeId, quantities] of before.items) {
      const current = after.items.get(nativeId);
      if (!current || quantities.some((value, index) => !same(value, current[index]!))) {
        throw new Error(`Pilot changed native order item ${nativeId}`);
      }
    }

    console.log("KOPER_MATERIAL_RECEIPT_DIRECT_V2_RESULT", JSON.stringify({
      ok: true, entryId, orderSourceId: order.source_id, orderNumber: order.order_number,
      receiptId, receiptNumber: headers[0]!.receipt_number, status: headers[0]!.status,
      generalCondition: headers[0]!.general_condition, itemCondition: savedItems[0]!.condition,
      deliveredQuantity: Number(savedItems[0]!.delivered_quantity),
      acceptedQuantity: Number(savedItems[0]!.accepted_quantity),
      orderQuantitiesUnchanged: true, inventoryMovementCreated: false,
      rejectedConditionCandidates: conditionFailures,
    }));
  }
} catch (error: unknown) {
  console.error("KOPER_MATERIAL_RECEIPT_DIRECT_V2_FAILED", {
    message: error instanceof Error ? error.message.slice(0, 1_000) : "unknown",
  });
}
