import { createHash } from "node:crypto";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Order = {
  id: string; source_id: string; supplier_id: string; project_id: string;
  order_number: string; status: string; received_amount: number;
};
type OrderItem = {
  id: string; order_id: string; input_id: string; source_id: string | null;
  input_code: string; input_name: string; unit_snapshot: string;
  cost_center_service_id: string | null; cost_center_code: string; cost_center_name: string;
  ordered_quantity: number; received_quantity: number; accepted_quantity: number;
  rejected_quantity: number; unit_price: number; delivered_unit_cost: number;
};
type Input = { id: string; source_id: string | null };
type Actor = { user_id: string };

type ResolvedItem = {
  entryId: string;
  entryItemId: string;
  entryPayload: Json;
  itemPayload: Json;
  order: Order;
  orderItem: OrderItem;
  sourcePurchaseItemId: string;
  sourceGroupKey: string;
  quantity: number;
  unitCost: number;
  invoiceIds: string[];
  receiptDate: string;
  receiptTimestamp: string;
};

type AggregatedReceiptItem = {
  orderItem: OrderItem;
  movementIds: string[];
  deliveredQuantity: number;
  unitCost: number;
  acceptedAmount: number;
  previouslyAcceptedQuantity: number;
};

type ReceiptPlan = {
  entryId: string;
  entryPayload: Json;
  order: Order;
  groupIndex: number;
  receiptId: string;
  receiptNumber: string;
  sequenceNo: number;
  receiptDate: string;
  receiptTimestamp: string;
  invoiceIds: string[];
  invoicePayload: Json;
  items: AggregatedReceiptItem[];
};

const object = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};

const identifier = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result || null;
};

const numberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const identifierArray = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.flatMap((item) => identifier(item) ? [identifier(item)!] : []))]
  : [];

function dateOnly(value: unknown): string | null {
  const raw = identifier(value);
  if (!raw) return null;
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

function timestamp(value: unknown, date: string): string {
  const raw = identifier(value);
  if (raw) {
    const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  return `${date}T12:00:00.000Z`;
}

function stableUuid(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0, 32), "hex");
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function quotedIn(values: string[]): string {
  return `in.(${values.map((value) => `\"${value.replaceAll("\"", "\\\"")}\"`).join(",")})`;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(0.000001, Math.abs(right) * 0.000001);
}

function integerEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
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

async function verifyIds(resource: string, ids: string[]): Promise<number> {
  let found = 0;
  for (const batch of chunks(ids, 100)) {
    if (batch.length === 0) continue;
    const rows = await requestSupabase<Array<{ id: string }>>(resource, {
      query: new URLSearchParams({ select: "id", id: quotedIn(batch), limit: "1000" }),
    });
    found += rows.length;
  }
  return found;
}

function sourceProductIds(payload: Json): string[] {
  return [...new Set([
    identifier(payload.mainProductId),
    identifier(payload.productId),
    identifier(payload.inputId),
    identifier(payload.genericProdSeq),
  ].filter((value): value is string => Boolean(value)))];
}

function baseSourceId(value: string | null): string | null {
  return identifier(value)?.split(":")[0] ?? null;
}

function orderInvariant(
  beforeOrders: Map<string, number>,
  beforeItems: Map<string, [number, number, number]>,
  afterOrders: Order[],
  afterItems: OrderItem[],
): void {
  for (const order of afterOrders) {
    const before = beforeOrders.get(order.id);
    if (before === undefined || !approximatelyEqual(before, Number(order.received_amount ?? 0))) {
      throw new Error(`Receipt batch changed order ${order.id}`);
    }
  }
  for (const item of afterItems) {
    const before = beforeItems.get(item.id);
    if (!before) throw new Error(`Receipt batch changed order item set at ${item.id}`);
    const current: [number, number, number] = [
      Number(item.received_quantity ?? 0),
      Number(item.accepted_quantity ?? 0),
      Number(item.rejected_quantity ?? 0),
    ];
    if (before.some((value, index) => !approximatelyEqual(value, current[index]!))) {
      throw new Error(`Receipt batch changed quantities for order item ${item.id}`);
    }
  }
}

await import("./index.js");

try {
  const batchOffset = integerEnv("KOPER_MATERIAL_RECEIPT_BATCH_OFFSET", 0, 0, 100_000);
  const batchSize = integerEnv("KOPER_MATERIAL_RECEIPT_BATCH_SIZE", 25, 1, 200);
  const writeEnabled = process.env.KOPER_MATERIAL_RECEIPT_DIRECT_BATCH_WRITE_ENABLED === "true";

  const [entryRows, entryItemRows, invoiceRows, orders, orderItems, inputs, actors, existingReceipts] = await Promise.all([
    readAll<StagingRow>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper", entity: "eq.stock_entry", sync_state: "eq.present", order: "koper_id.asc",
    }),
    readAll<StagingRow>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper", entity: "eq.stock_entry_item", sync_state: "eq.present", order: "koper_id.asc",
    }),
    readAll<StagingRow>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper", entity: "eq.xml_invoice", sync_state: "eq.present", order: "koper_id.asc",
    }),
    readAll<Order>("procurement_purchase_orders", {
      select: "id,source_id,supplier_id,project_id,order_number,status,received_amount",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", order: "source_id.asc",
    }),
    readAll<OrderItem>("procurement_purchase_order_items", {
      select: "id,order_id,input_id,source_id,input_code,input_name,unit_snapshot,cost_center_service_id,cost_center_code,cost_center_name,ordered_quantity,received_quantity,accepted_quantity,rejected_quantity,unit_price,delivered_unit_cost",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", order: "order_id.asc,sort_order.asc",
    }),
    readAll<Input>("engineering_inputs", {
      select: "id,source_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper", order: "source_id.asc",
    }),
    requestSupabase<Actor[]>("company_memberships", { query: new URLSearchParams({
      select: "user_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      status: "eq.active", order: "created_at.asc", limit: "1",
    }) }),
    readAll<{ id: string; notes: string | null }>("procurement_material_receipts", {
      select: "id,notes", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc",
    }),
  ]);

  const actor = actors[0];
  if (!actor) throw new Error("No technical actor is available");
  const entryById = new Map(entryRows.map((row) => [row.koper_id, row]));
  const invoiceById = new Map(invoiceRows.map((row) => [row.koper_id, row]));
  const orderBySource = new Map(orders.flatMap((row) => row.source_id ? [[row.source_id, row] as const] : []));
  const inputBySource = new Map(inputs.flatMap((row) => row.source_id ? [[row.source_id, row] as const] : []));
  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const row of orderItems) itemsByOrder.set(row.order_id, [...(itemsByOrder.get(row.order_id) ?? []), row]);

  const programmedEntryIds = new Set(entryRows
    .filter((row) => identifier(object(row.payload).originType) === "0")
    .map((row) => row.koper_id));
  const programmedItems = entryItemRows.filter((row) => row.koper_parent_id && programmedEntryIds.has(row.koper_parent_id));

  const sourceItemCountByEntry = new Map<string, number>();
  const resolvedCountByEntry = new Map<string, number>();
  const resolvedItems: ResolvedItem[] = [];
  const excluded = {
    missingEntry: 0, missingOrder: 0, missingInput: 0, missingOrderItem: 0,
    ambiguousSourceItem: 0, allocationSplit: 0, invalidQuantity: 0, invalidDate: 0,
  };

  for (const source of programmedItems) {
    const entryId = source.koper_parent_id!;
    sourceItemCountByEntry.set(entryId, (sourceItemCountByEntry.get(entryId) ?? 0) + 1);
    const entry = entryById.get(entryId);
    if (!entry) { excluded.missingEntry += 1; continue; }
    const entryPayload = object(entry.payload);
    const payload = object(source.payload);
    const candidateOrders = identifierArray(payload.candidatePurchaseOrderIds).flatMap((sourceId) => {
      const order = orderBySource.get(sourceId);
      return order ? [order] : [];
    });
    if (candidateOrders.length === 0) { excluded.missingOrder += 1; continue; }
    const inputIds = new Set(sourceProductIds(payload).flatMap((sourceId) => {
      const input = inputBySource.get(sourceId);
      return input ? [input.id] : [];
    }));
    if (inputIds.size === 0) { excluded.missingInput += 1; continue; }

    const groups = new Map<string, { order: Order; sourcePurchaseItemId: string; rows: OrderItem[] }>();
    for (const order of candidateOrders) {
      for (const row of itemsByOrder.get(order.id) ?? []) {
        if (!inputIds.has(row.input_id)) continue;
        const sourcePurchaseItemId = baseSourceId(row.source_id);
        if (!sourcePurchaseItemId) continue;
        const key = `${order.id}:${sourcePurchaseItemId}`;
        const existing = groups.get(key);
        if (existing) existing.rows.push(row);
        else groups.set(key, { order, sourcePurchaseItemId, rows: [row] });
      }
    }
    if (groups.size === 0) { excluded.missingOrderItem += 1; continue; }
    if (groups.size > 1) { excluded.ambiguousSourceItem += 1; continue; }
    const group = [...groups.values()][0]!;
    if (group.rows.length !== 1) { excluded.allocationSplit += 1; continue; }
    const quantity = numberValue(payload.productAmount) ?? 0;
    if (quantity <= 0) { excluded.invalidQuantity += 1; continue; }
    const receiptDate = dateOnly(entryPayload.movementDate) ?? dateOnly(entryPayload.entryDate);
    if (!receiptDate) { excluded.invalidDate += 1; continue; }
    const orderItem = group.rows[0]!;
    const unitCost = Math.max(0,
      numberValue(payload.averageProductValue)
      ?? numberValue(payload.productValue)
      ?? Number(orderItem.delivered_unit_cost ?? orderItem.unit_price ?? 0),
    );
    resolvedItems.push({
      entryId, entryItemId: source.koper_id, entryPayload, itemPayload: payload,
      order: group.order, orderItem, sourcePurchaseItemId: group.sourcePurchaseItemId,
      sourceGroupKey: `${group.order.id}:${group.sourcePurchaseItemId}`,
      quantity, unitCost, invoiceIds: identifierArray(payload.invoiceIds), receiptDate,
      receiptTimestamp: timestamp(entryPayload.movementDate ?? entryPayload.entryDate, receiptDate),
    });
    resolvedCountByEntry.set(entryId, (resolvedCountByEntry.get(entryId) ?? 0) + 1);
  }

  const entryQuantityBySourceGroup = new Map<string, number>();
  for (const item of resolvedItems) {
    entryQuantityBySourceGroup.set(item.sourceGroupKey, (entryQuantityBySourceGroup.get(item.sourceGroupKey) ?? 0) + item.quantity);
  }
  const nativeAcceptedBySourceGroup = new Map<string, number>();
  const nativeReceivedBySourceGroup = new Map<string, number>();
  for (const item of orderItems) {
    const sourcePurchaseItemId = baseSourceId(item.source_id);
    if (!sourcePurchaseItemId) continue;
    const key = `${item.order_id}:${sourcePurchaseItemId}`;
    nativeAcceptedBySourceGroup.set(key, (nativeAcceptedBySourceGroup.get(key) ?? 0) + Number(item.accepted_quantity ?? 0));
    nativeReceivedBySourceGroup.set(key, (nativeReceivedBySourceGroup.get(key) ?? 0) + Number(item.received_quantity ?? 0));
  }
  const exactSourceGroups = new Set([...entryQuantityBySourceGroup.entries()].flatMap(([key, quantity]) =>
    approximatelyEqual(quantity, nativeAcceptedBySourceGroup.get(key) ?? 0)
      && approximatelyEqual(quantity, nativeReceivedBySourceGroup.get(key) ?? 0)
      ? [key]
      : [],
  ));

  const resolvedItemsByEntry = new Map<string, ResolvedItem[]>();
  for (const item of resolvedItems) resolvedItemsByEntry.set(item.entryId, [...(resolvedItemsByEntry.get(item.entryId) ?? []), item]);
  const safeEntryIds = new Set<string>();
  for (const entryId of programmedEntryIds) {
    const sourceCount = sourceItemCountByEntry.get(entryId) ?? 0;
    const resolved = resolvedItemsByEntry.get(entryId) ?? [];
    if (sourceCount > 0 && resolved.length === sourceCount && resolved.every((item) => exactSourceGroups.has(item.sourceGroupKey))) {
      safeEntryIds.add(entryId);
    }
  }

  const priorByEntryItemAndOrderItem = new Map<string, number>();
  const runningByOrderItem = new Map<string, number>();
  const chronologicalResolved = [...resolvedItems].sort((left, right) =>
    left.receiptTimestamp.localeCompare(right.receiptTimestamp)
      || Number(left.entryId) - Number(right.entryId)
      || Number(left.entryItemId) - Number(right.entryItemId),
  );
  for (const item of chronologicalResolved) {
    const prior = runningByOrderItem.get(item.orderItem.id) ?? 0;
    priorByEntryItemAndOrderItem.set(`${item.entryItemId}:${item.orderItem.id}`, prior);
    runningByOrderItem.set(item.orderItem.id, prior + item.quantity);
  }

  const plans: ReceiptPlan[] = [];
  for (const entryId of [...safeEntryIds].sort((left, right) => Number(left) - Number(right))) {
    const entryItems = resolvedItemsByEntry.get(entryId) ?? [];
    const byOrder = new Map<string, ResolvedItem[]>();
    for (const item of entryItems) byOrder.set(item.order.id, [...(byOrder.get(item.order.id) ?? []), item]);
    const sortedOrders = [...byOrder.entries()].sort(([, left], [, right]) => Number(left[0]!.order.source_id) - Number(right[0]!.order.source_id));
    for (let groupIndex = 0; groupIndex < sortedOrders.length; groupIndex += 1) {
      const [, sourceRows] = sortedOrders[groupIndex]!;
      const order = sourceRows[0]!.order;
      const aggregateByOrderItem = new Map<string, ResolvedItem[]>();
      for (const row of sourceRows) aggregateByOrderItem.set(row.orderItem.id, [...(aggregateByOrderItem.get(row.orderItem.id) ?? []), row]);
      const aggregatedItems: AggregatedReceiptItem[] = [...aggregateByOrderItem.values()].map((rows) => {
        const deliveredQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
        const acceptedAmount = rows.reduce((sum, row) => sum + row.quantity * row.unitCost, 0);
        const movementIds = rows.map((row) => row.entryItemId).sort((left, right) => Number(left) - Number(right));
        const previousValues = rows.map((row) => priorByEntryItemAndOrderItem.get(`${row.entryItemId}:${row.orderItem.id}`) ?? 0);
        return {
          orderItem: rows[0]!.orderItem,
          movementIds,
          deliveredQuantity,
          unitCost: deliveredQuantity > 0 ? acceptedAmount / deliveredQuantity : 0,
          acceptedAmount,
          previouslyAcceptedQuantity: Math.min(...previousValues),
        };
      }).sort((left, right) => left.orderItem.id.localeCompare(right.orderItem.id));
      const invoiceIds = [...new Set(sourceRows.flatMap((row) => row.invoiceIds))];
      const invoicePayload = invoiceIds.length === 1 ? object(invoiceById.get(invoiceIds[0]!)?.payload) : {};
      const receiptId = stableUuid(`elos:koper:stock-entry:${entryId}:order:${order.id}`);
      plans.push({
        entryId, entryPayload: sourceRows[0]!.entryPayload, order, groupIndex,
        receiptId, receiptNumber: `KOPER-REC-${entryId}-${order.source_id}`,
        sequenceNo: 4_000_000 + Number(entryId) * 100 + groupIndex,
        receiptDate: sourceRows[0]!.receiptDate,
        receiptTimestamp: sourceRows[0]!.receiptTimestamp,
        invoiceIds, invoicePayload, items: aggregatedItems,
      });
    }
  }
  plans.sort((left, right) => Number(left.entryId) - Number(right.entryId) || left.groupIndex - right.groupIndex);

  const selected = plans.slice(batchOffset, batchOffset + batchSize);
  const plannedItemCount = plans.reduce((sum, plan) => sum + plan.items.length, 0);
  const existingKoperReceipts = existingReceipts.filter((receipt) => /Koper stockMovementId=/i.test(receipt.notes ?? "")).length;

  if (!writeEnabled) {
    console.log("KOPER_MATERIAL_RECEIPT_BATCH_PLAN", JSON.stringify({
      ok: true, writeEnabled: false,
      source: { programmedEntries: programmedEntryIds.size, programmedItems: programmedItems.length },
      resolution: {
        resolvedItems: resolvedItems.length, exactSourceGroups: exactSourceGroups.size,
        safeEntries: safeEntryIds.size, safeReceiptGroups: plans.length, plannedReceiptItems: plannedItemCount,
        excluded,
      },
      idempotency: { existingNativeReceipts: existingReceipts.length, existingKoperReceipts },
      batch: {
        batchOffset, batchSize, selectedReceipts: selected.length,
        first: selected[0] ? { entryId: selected[0].entryId, orderSourceId: selected[0].order.source_id } : null,
        last: selected.at(-1) ? { entryId: selected.at(-1)!.entryId, orderSourceId: selected.at(-1)!.order.source_id } : null,
        nextOffset: batchOffset + selected.length,
        complete: batchOffset + selected.length >= plans.length,
      },
    }));
  } else {
    if (selected.length === 0) {
      console.log("KOPER_MATERIAL_RECEIPT_BATCH_RESULT", JSON.stringify({
        ok: true, selectedReceipts: 0, nextOffset: batchOffset, complete: true,
      }));
    } else {
      const affectedOrderIds = [...new Set(selected.map((plan) => plan.order.id))];
      const beforeOrders = new Map(orders.filter((order) => affectedOrderIds.includes(order.id)).map((order) => [order.id, Number(order.received_amount ?? 0)]));
      const beforeItems = new Map(orderItems.filter((item) => affectedOrderIds.includes(item.order_id)).map((item) => [item.id, [
        Number(item.received_quantity ?? 0), Number(item.accepted_quantity ?? 0), Number(item.rejected_quantity ?? 0),
      ] as [number, number, number]]));
      const now = new Date().toISOString();
      const headers = selected.map((plan) => ({
        id: plan.receiptId, company_id: env.BOSSA_COMPANY_ID, project_id: plan.order.project_id,
        order_id: plan.order.id, supplier_id: plan.order.supplier_id,
        sequence_no: plan.sequenceNo, receipt_number: plan.receiptNumber, status: "draft",
        receipt_date: plan.receiptDate, arrival_time: null,
        invoice_number: identifier(plan.invoicePayload.invoiceNumber), invoice_series: null, invoice_access_key: null,
        invoice_date: dateOnly(plan.invoicePayload.emitDate),
        invoice_amount: plan.items.reduce((sum, item) => sum + item.acceptedAmount, 0),
        carrier_name: null, vehicle_plate: null, driver_name: null, delivery_document: null,
        warehouse_location: "Estoque Flow Aptos", general_condition: null,
        notes: `Importado do Koper · Koper stockMovementId=${plan.entryId} · histórico em rascunho · não recalcular pedido${plan.invoiceIds.length > 1 ? ` · invoices=${plan.invoiceIds.join(",")}` : ""}`,
        receiver_user_id: actor.user_id, receiver_name: "Importação histórica Koper",
        created_by: actor.user_id, updated_by: actor.user_id,
        created_at: plan.receiptTimestamp, updated_at: now,
      }));
      const receiptItems = selected.flatMap((plan) => plan.items.map((item, index) => ({
        id: stableUuid(`elos:koper:receipt:${plan.receiptId}:movements:${item.movementIds.join(",")}:order-item:${item.orderItem.id}`),
        company_id: env.BOSSA_COMPANY_ID, project_id: plan.order.project_id,
        receipt_id: plan.receiptId, order_id: plan.order.id, order_item_id: item.orderItem.id,
        input_id: item.orderItem.input_id, cost_center_service_id: item.orderItem.cost_center_service_id,
        input_code: item.orderItem.input_code, input_name: item.orderItem.input_name,
        unit_snapshot: item.orderItem.unit_snapshot, cost_center_code: item.orderItem.cost_center_code,
        cost_center_name: item.orderItem.cost_center_name,
        ordered_quantity: Number(item.orderItem.ordered_quantity),
        previously_accepted_quantity: item.previouslyAcceptedQuantity,
        delivered_quantity: item.deliveredQuantity, accepted_quantity: item.deliveredQuantity, rejected_quantity: 0,
        unit_cost: item.unitCost, accepted_amount: item.acceptedAmount,
        batch_number: null, expiration_date: null, condition: "good",
        rejection_reason: null, destination_location: "Estoque Flow Aptos",
        notes: `Importado do Koper · productMovementIds=${item.movementIds.join(",")}`,
        sort_order: index, created_at: plan.receiptTimestamp, updated_at: now,
      })));

      for (const batch of chunks(headers, 100)) await requestSupabase("procurement_material_receipts", {
        method: "POST", body: batch, prefer: "resolution=merge-duplicates,return=minimal",
        query: new URLSearchParams({ on_conflict: "id" }),
      });
      for (const batch of chunks(receiptItems, 100)) await requestSupabase("procurement_material_receipt_items", {
        method: "POST", body: batch, prefer: "resolution=merge-duplicates,return=minimal",
        query: new URLSearchParams({ on_conflict: "id" }),
      });

      const [verifiedReceipts, verifiedItems, afterOrders, afterItems] = await Promise.all([
        verifyIds("procurement_material_receipts", headers.map((row) => row.id)),
        verifyIds("procurement_material_receipt_items", receiptItems.map((row) => row.id)),
        requestSupabase<Order[]>("procurement_purchase_orders", { query: new URLSearchParams({
          select: "id,source_id,supplier_id,project_id,order_number,status,received_amount",
          id: quotedIn(affectedOrderIds), limit: "1000",
        }) }),
        requestSupabase<OrderItem[]>("procurement_purchase_order_items", { query: new URLSearchParams({
          select: "id,order_id,input_id,source_id,input_code,input_name,unit_snapshot,cost_center_service_id,cost_center_code,cost_center_name,ordered_quantity,received_quantity,accepted_quantity,rejected_quantity,unit_price,delivered_unit_cost",
          order_id: quotedIn(affectedOrderIds), limit: "5000",
        }) }),
      ]);
      if (verifiedReceipts !== headers.length || verifiedItems !== receiptItems.length) {
        throw new Error(`Receipt batch verification failed: ${verifiedReceipts}/${headers.length}, ${verifiedItems}/${receiptItems.length}`);
      }
      orderInvariant(beforeOrders, beforeItems, afterOrders, afterItems);

      const nextOffset = batchOffset + selected.length;
      console.log("KOPER_MATERIAL_RECEIPT_BATCH_RESULT", JSON.stringify({
        ok: true, batchOffset, batchSize,
        totalSafeEntries: safeEntryIds.size, totalSafeReceiptGroups: plans.length,
        selectedReceipts: headers.length, selectedReceiptItems: receiptItems.length,
        verifiedReceipts, verifiedItems, affectedOrders: affectedOrderIds.length,
        orderQuantitiesUnchanged: true, inventoryMovementsCreated: 0,
        nextOffset, complete: nextOffset >= plans.length,
      }));
    }
  }
} catch (error: unknown) {
  console.error("KOPER_MATERIAL_RECEIPT_BATCH_FAILED", {
    message: error instanceof Error ? error.message.slice(0, 1_200) : "unknown",
  });
}
