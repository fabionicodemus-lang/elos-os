import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type UnknownRecord = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type NativeOrder = { id: string; source_id: string; supplier_id: string; project_id: string; order_number: string; status: string };
type NativeOrderItem = {
  id: string; order_id: string; input_id: string; source_id: string | null;
  input_code: string; input_name: string; unit_snapshot: string;
  ordered_quantity: number; received_quantity: number; accepted_quantity: number;
  unit_price: number; delivered_unit_cost: number; cost_center_service_id: string | null;
  cost_center_code: string; cost_center_name: string;
};
type InputRow = { id: string; source_id: string | null };

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
  const date = new Date(raw.replace(" ", "T"));
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
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

function responseId(value: unknown): string | null {
  const direct = identifier(value);
  if (direct && /^[0-9a-f-]{36}$/i.test(direct)) return direct;
  if (Array.isArray(value)) return responseId(value[0]);
  const object = objectValue(value);
  return identifier(object.id) ?? identifier(object.receipt_id) ?? identifier(object.receiptId);
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

await import("./index.js");

try {
  if (process.env.KOPER_MATERIAL_RECEIPT_PILOT_WRITE_ENABLED !== "true") {
    console.log("KOPER_MATERIAL_RECEIPT_PILOT_SKIPPED", JSON.stringify({ reason: "WRITE_DISABLED" }));
  } else {
    const entryId = "13372";
    const marker = `Koper stockMovementId=${entryId}`;
    const existing = await requestSupabase<Array<{ id: string; status: string; receipt_number: string }>>(
      "procurement_material_receipts",
      { query: new URLSearchParams({
        select: "id,status,receipt_number",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        notes: `like.*${marker}*`,
        limit: "2",
      }) },
    );
    if (existing.length > 1) throw new Error("Pilot receipt identity is ambiguous");
    if (existing[0]) {
      console.log("KOPER_MATERIAL_RECEIPT_PILOT_RESULT", JSON.stringify({
        ok: true,
        idempotent: true,
        entryId,
        receiptId: existing[0].id,
        status: existing[0].status,
        receiptNumber: existing[0].receipt_number,
      }));
    } else {
      const [entryRows, entryItems, invoices, orders, orderItems, inputs] = await Promise.all([
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
          select: "id,source_id,supplier_id,project_id,order_number,status",
          company_id: `eq.${env.BOSSA_COMPANY_ID}`,
          source_system: "eq.koper",
          order: "source_id.asc",
        }),
        readAll<NativeOrderItem>("procurement_purchase_order_items", {
          select: "id,order_id,input_id,source_id,input_code,input_name,unit_snapshot,ordered_quantity,received_quantity,accepted_quantity,unit_price,delivered_unit_cost,cost_center_service_id,cost_center_code,cost_center_name",
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
      ]);

      const entry = entryRows[0];
      if (!entry || entryItems.length === 0) throw new Error("Pilot stock entry is unavailable");
      const entryPayload = objectValue(entry.payload);
      if (identifier(entryPayload.originType) !== "0") throw new Error("Pilot entry is not a programmed purchase entry");

      const orderBySource = new Map(orders.map((order) => [order.source_id, order]));
      const itemsByOrder = new Map<string, NativeOrderItem[]>();
      for (const item of orderItems) itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), item]);
      const inputBySource = new Map(inputs.flatMap((input) => input.source_id ? [[input.source_id, input] as const] : []));

      const resolvedRows: Array<{ source: StagingRow; order: NativeOrder; item: NativeOrderItem; quantity: number; unitCost: number }> = [];
      for (const source of entryItems) {
        const payload = objectValue(source.payload);
        const orderCandidates = identifierArray(payload.candidatePurchaseOrderIds).flatMap((sourceId) => {
          const order = orderBySource.get(sourceId);
          return order ? [order] : [];
        });
        const inputIds = new Set([
          identifier(payload.mainProductId), identifier(payload.productId), identifier(payload.inputId), identifier(payload.genericProdSeq),
        ].filter((value): value is string => Boolean(value)).flatMap((sourceId) => {
          const input = inputBySource.get(sourceId);
          return input ? [input.id] : [];
        }));
        const candidates = orderCandidates.flatMap((order) =>
          (itemsByOrder.get(order.id) ?? []).filter((item) => inputIds.has(item.input_id)).map((item) => ({ order, item })),
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
        const unitCost = Math.max(0, numeric(payload.averageProductValue) ?? numeric(payload.productValue) ?? Number(group[0]!.item.delivered_unit_cost ?? group[0]!.item.unit_price ?? 0));
        resolvedRows.push({ source, order: group[0]!.order, item: group[0]!.item, quantity, unitCost });
      }

      const orderIds = [...new Set(resolvedRows.map((row) => row.order.id))];
      if (orderIds.length !== 1) throw new Error("Pilot entry spans multiple orders");
      const order = resolvedRows[0]!.order;
      const invoiceIds = [...new Set(entryItems.flatMap((row) => identifierArray(objectValue(row.payload).invoiceIds)))];
      const invoice = invoiceIds.length === 1 ? invoices.find((row) => row.koper_id === invoiceIds[0]) : null;
      const invoicePayload = objectValue(invoice?.payload);
      const receiptDate = dateOnly(entryPayload.movementDate) ?? dateOnly(entryPayload.entryDate);
      if (!receiptDate) throw new Error("Pilot receipt date is unavailable");

      const pItems = resolvedRows.map((row, index) => ({
        order_item_id: row.item.id,
        delivered_quantity: row.quantity,
        accepted_quantity: row.quantity,
        rejected_quantity: 0,
        unit_cost: row.unitCost,
        batch_number: null,
        expiration_date: null,
        condition: "accepted",
        rejection_reason: null,
        destination_location: "Estoque Flow Aptos",
        notes: `Importado do Koper · productMovementId=${row.source.koper_id}`,
        sort_order: index,
      }));
      const invoiceAmount = resolvedRows.reduce((total, row) => total + row.quantity * row.unitCost, 0);

      const rpcResult = await requestSupabase<unknown>("rpc/save_procurement_material_receipt", {
        method: "POST",
        body: {
          p_company_id: env.BOSSA_COMPANY_ID,
          p_project_id: order.project_id,
          p_receipt_id: null,
          p_order_id: order.id,
          p_receipt_date: receiptDate,
          p_arrival_time: null,
          p_invoice_number: identifier(invoicePayload.invoiceNumber),
          p_invoice_series: null,
          p_invoice_access_key: null,
          p_invoice_date: dateOnly(invoicePayload.emitDate),
          p_invoice_amount: invoiceAmount,
          p_carrier_name: null,
          p_vehicle_plate: null,
          p_driver_name: null,
          p_delivery_document: null,
          p_warehouse_location: "Estoque Flow Aptos",
          p_general_condition: "accepted",
          p_notes: `Importado do Koper · ${marker} · piloto em rascunho`,
          p_items: pItems,
        },
      });
      const receiptId = responseId(rpcResult);
      if (!receiptId) throw new Error(`Pilot save returned no receipt identity: ${JSON.stringify(rpcResult).slice(0, 300)}`);

      const [savedReceipts, savedItems] = await Promise.all([
        requestSupabase<Array<{ id: string; status: string; receipt_number: string; order_id: string; notes: string | null }>>(
          "procurement_material_receipts",
          { query: new URLSearchParams({ select: "id,status,receipt_number,order_id,notes", id: `eq.${receiptId}`, limit: "1" }) },
        ),
        requestSupabase<Array<{ id: string; order_item_id: string; delivered_quantity: number; accepted_quantity: number; condition: string }>>(
          "procurement_material_receipt_items",
          { query: new URLSearchParams({ select: "id,order_item_id,delivered_quantity,accepted_quantity,condition", receipt_id: `eq.${receiptId}`, order: "sort_order.asc", limit: "100" }) },
        ),
      ]);
      const savedReceipt = savedReceipts[0];
      if (!savedReceipt || savedReceipt.order_id !== order.id || savedItems.length !== pItems.length) {
        throw new Error("Pilot receipt verification failed");
      }

      console.log("KOPER_MATERIAL_RECEIPT_PILOT_RESULT", JSON.stringify({
        ok: true,
        idempotent: false,
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
        inventoryMovementCreated: false,
      }));
    }
  }
} catch (error: unknown) {
  console.error("KOPER_MATERIAL_RECEIPT_PILOT_FAILED", {
    message: error instanceof Error ? error.message.slice(0, 1_000) : "unknown",
  });
}
