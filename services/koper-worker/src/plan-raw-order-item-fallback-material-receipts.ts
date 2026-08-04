import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type Stage = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Order = { id: string; source_id: string | null; order_number: string };
type OrderItem = { id: string; order_id: string; input_id: string; source_id: string | null; received_quantity: number; accepted_quantity: number };
type Input = { id: string; source_id: string | null };
type Receipt = { notes: string | null };
type Mapping = { entryId: string; stockItemId: string; groupKey: string; quantity: number; mode: "native_input" | "raw_product_id" };

type EntryPlan = {
  entryId: string;
  originId: string | null;
  orderNumber: string | null;
  itemCount: number;
  mappedCount: number;
  rawMappedCount: number;
  reasons: string[];
  safe: boolean;
};

const object = (value: unknown): Json => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};
const identifier = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
};
const numeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};
const identifiers = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.flatMap((item) => {
      const id = identifier(item);
      return id ? [id] : [];
    }))]
  : [];

function sourceProductIds(payload: Json): string[] {
  return [...new Set([
    identifier(payload.mainProductId), identifier(payload.productId), identifier(payload.inputId), identifier(payload.genericProdSeq),
  ].filter((value): value is string => Boolean(value)))];
}
function purchaseItemProductIds(payload: Json): string[] {
  return [...new Set([
    identifier(payload.mainProductId), identifier(payload.productId), identifier(payload.inputId), identifier(payload.genericProdSeq), identifier(payload.sourceId),
  ].filter((value): value is string => Boolean(value)))];
}
function baseSourceId(value: string | null): string | null { return identifier(value)?.split(":")[0] ?? null; }
function dateOnly(value: unknown): string | null {
  const raw = identifier(value);
  if (!raw) return null;
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}
function markerEntryId(notes: string | null): string | null { return notes?.match(/Koper stockMovementId=(\d+)/i)?.[1] ?? null; }
function approximatelyEqual(left: number, right: number): boolean { return Math.abs(left - right) <= Math.max(0.000001, Math.abs(right) * 0.000001); }
async function readAll<T>(resource: string, query: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await requestSupabase<T[]>(resource, { query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }), timeoutMs: 30000 });
    rows.push(...page);
    console.log("KOPER_RAW_ITEM_FALLBACK_PROGRESS", JSON.stringify({ resource, offset, pageRows: page.length, totalRows: rows.length }));
    if (page.length < 1000) return rows;
  }
}
function summarize(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

try {
  console.log("KOPER_RAW_ITEM_FALLBACK_PLAN_START", JSON.stringify({ readOnly: true, companyId: env.BOSSA_COMPANY_ID }));
  const entries = await readAll<Stage>("koper_staging_records", { select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.stock_entry", sync_state: "eq.present", order: "koper_id.asc" });
  const stockItems = await readAll<Stage>("koper_staging_records", { select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.stock_entry_item", sync_state: "eq.present", order: "koper_parent_id.asc,koper_id.asc" });
  const purchaseItems = await readAll<Stage>("koper_staging_records", { select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.purchase_order_item", sync_state: "eq.present", order: "koper_parent_id.asc,koper_id.asc" });
  const orders = await readAll<Order>("procurement_purchase_orders", { select: "id,source_id,order_number", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", order: "source_id.asc" });
  const orderItems = await readAll<OrderItem>("procurement_purchase_order_items", { select: "id,order_id,input_id,source_id,received_quantity,accepted_quantity", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", order: "order_id.asc,id.asc" });
  const inputs = await readAll<Input>("engineering_inputs", { select: "id,source_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", order: "source_id.asc" });
  const receipts = await readAll<Receipt>("procurement_material_receipts", { select: "notes", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" });

  const programmedEntries = entries.filter((row) => identifier(object(row.payload).originType) === "0");
  const entryById = new Map(programmedEntries.map((row) => [row.koper_id, row]));
  const programmedIds = new Set(entryById.keys());
  const stockItemsByEntry = new Map<string, Stage[]>();
  for (const item of stockItems) if (item.koper_parent_id && programmedIds.has(item.koper_parent_id)) stockItemsByEntry.set(item.koper_parent_id, [...(stockItemsByEntry.get(item.koper_parent_id) ?? []), item]);
  const purchaseItemsByOrder = new Map<string, Stage[]>();
  for (const item of purchaseItems) if (item.koper_parent_id) purchaseItemsByOrder.set(item.koper_parent_id, [...(purchaseItemsByOrder.get(item.koper_parent_id) ?? []), item]);
  const orderBySource = new Map(orders.flatMap((row) => row.source_id ? [[row.source_id, row] as const] : []));
  const nativeItemsByOrder = new Map<string, OrderItem[]>();
  for (const item of orderItems) nativeItemsByOrder.set(item.order_id, [...(nativeItemsByOrder.get(item.order_id) ?? []), item]);
  const inputBySource = new Map(inputs.flatMap((row) => row.source_id ? [[row.source_id, row] as const] : []));
  const promotedIds = new Set(receipts.flatMap((row) => { const id = markerEntryId(row.notes); return id ? [id] : []; }));

  const mappings: Mapping[] = [];
  const reasonsByEntry = new Map<string, Set<string>>();
  const originFallbackIds = new Set<string>();

  for (const entry of programmedEntries) {
    const entryPayload = object(entry.payload);
    const originId = identifier(entryPayload.originId);
    const originOrder = originId ? orderBySource.get(originId) : undefined;
    const items = stockItemsByEntry.get(entry.koper_id) ?? [];
    const reasons = new Set<string>();
    if (items.length === 0) reasons.add("no_items");
    const receiptDate = dateOnly(entryPayload.movementDate) ?? dateOnly(entryPayload.entryDate);

    for (const stockItem of items) {
      const payload = object(stockItem.payload);
      const directOrders = identifiers(payload.candidatePurchaseOrderIds).flatMap((sourceId) => {
        const order = orderBySource.get(sourceId);
        return order ? [order] : [];
      });
      const uniqueDirectOrders = [...new Map(directOrders.map((row) => [row.id, row])).values()];
      const candidateOrders = uniqueDirectOrders.length > 0 ? uniqueDirectOrders : originOrder ? [originOrder] : [];
      const usedOrigin = uniqueDirectOrders.length === 0 && Boolean(originOrder);
      if (usedOrigin) originFallbackIds.add(entry.koper_id);
      if (candidateOrders.length === 0) { reasons.add("missing_order"); continue; }

      const mappedInputIds = new Set(sourceProductIds(payload).flatMap((sourceId) => {
        const input = inputBySource.get(sourceId);
        return input ? [input.id] : [];
      }));
      const nativeGroups = new Map<string, OrderItem[]>();
      for (const order of candidateOrders) {
        for (const nativeItem of nativeItemsByOrder.get(order.id) ?? []) {
          if (!mappedInputIds.has(nativeItem.input_id)) continue;
          const sourceItemId = baseSourceId(nativeItem.source_id);
          if (!sourceItemId) continue;
          const key = `${order.id}:${sourceItemId}`;
          nativeGroups.set(key, [...(nativeGroups.get(key) ?? []), nativeItem]);
        }
      }

      let selectedGroup: [string, OrderItem[]] | null = null;
      let mode: Mapping["mode"] = "native_input";
      if (nativeGroups.size === 1) selectedGroup = [...nativeGroups.entries()][0]!;
      else if (nativeGroups.size > 1) { reasons.add("ambiguous_native_input_match"); continue; }
      else if (usedOrigin && originId && originOrder) {
        const stockIds = new Set(sourceProductIds(payload));
        const rawCandidates = (purchaseItemsByOrder.get(originId) ?? []).filter((purchaseItem) =>
          purchaseItemProductIds(object(purchaseItem.payload)).some((id) => stockIds.has(id)),
        );
        const uniqueRaw = [...new Map(rawCandidates.map((row) => [row.koper_id, row])).values()];
        if (uniqueRaw.length === 0) { reasons.add("no_raw_product_id_match"); continue; }
        if (uniqueRaw.length > 1) { reasons.add("ambiguous_raw_product_id_match"); continue; }
        const sourcePurchaseItemId = uniqueRaw[0]!.koper_id;
        const nativeRows = (nativeItemsByOrder.get(originOrder.id) ?? []).filter((row) => baseSourceId(row.source_id) === sourcePurchaseItemId);
        if (nativeRows.length === 0) { reasons.add("raw_item_missing_native_row"); continue; }
        selectedGroup = [`${originOrder.id}:${sourcePurchaseItemId}`, nativeRows];
        mode = "raw_product_id";
      } else {
        reasons.add("missing_order_item");
        continue;
      }

      if (selectedGroup[1].length !== 1) { reasons.add("allocation_split"); continue; }
      const quantity = numeric(payload.productAmount) ?? 0;
      if (quantity <= 0) { reasons.add("invalid_quantity"); continue; }
      if (!receiptDate) { reasons.add("invalid_date"); continue; }
      mappings.push({ entryId: entry.koper_id, stockItemId: stockItem.koper_id, groupKey: selectedGroup[0], quantity, mode });
    }
    reasonsByEntry.set(entry.koper_id, reasons);
  }

  const sourceQuantityByGroup = new Map<string, number>();
  for (const row of mappings) sourceQuantityByGroup.set(row.groupKey, (sourceQuantityByGroup.get(row.groupKey) ?? 0) + row.quantity);
  const nativeReceivedByGroup = new Map<string, number>();
  const nativeAcceptedByGroup = new Map<string, number>();
  for (const item of orderItems) {
    const sourceItemId = baseSourceId(item.source_id);
    if (!sourceItemId) continue;
    const key = `${item.order_id}:${sourceItemId}`;
    nativeReceivedByGroup.set(key, (nativeReceivedByGroup.get(key) ?? 0) + Number(item.received_quantity ?? 0));
    nativeAcceptedByGroup.set(key, (nativeAcceptedByGroup.get(key) ?? 0) + Number(item.accepted_quantity ?? 0));
  }
  const exactGroups = new Set([...sourceQuantityByGroup.entries()].flatMap(([key, quantity]) =>
    approximatelyEqual(quantity, nativeReceivedByGroup.get(key) ?? 0) && approximatelyEqual(quantity, nativeAcceptedByGroup.get(key) ?? 0) ? [key] : [],
  ));
  const mappingsByEntry = new Map<string, Mapping[]>();
  for (const row of mappings) mappingsByEntry.set(row.entryId, [...(mappingsByEntry.get(row.entryId) ?? []), row]);

  const plans: EntryPlan[] = [];
  for (const entryId of originFallbackIds) {
    if (promotedIds.has(entryId)) continue;
    const entry = entryById.get(entryId)!;
    const entryPayload = object(entry.payload);
    const originId = identifier(entryPayload.originId);
    const order = originId ? orderBySource.get(originId) : undefined;
    const sourceItems = stockItemsByEntry.get(entryId) ?? [];
    const entryMappings = mappingsByEntry.get(entryId) ?? [];
    const reasons = new Set(reasonsByEntry.get(entryId) ?? []);
    if (sourceItems.length > 0 && entryMappings.length === sourceItems.length && !entryMappings.every((row) => exactGroups.has(row.groupKey))) reasons.add("quantity_reconciliation_mismatch");
    const safe = sourceItems.length > 0 && entryMappings.length === sourceItems.length && reasons.size === 0 && entryMappings.every((row) => exactGroups.has(row.groupKey));
    plans.push({ entryId, originId, orderNumber: order?.order_number ?? null, itemCount: sourceItems.length, mappedCount: entryMappings.length, rawMappedCount: entryMappings.filter((row) => row.mode === "raw_product_id").length, reasons: [...reasons].sort(), safe });
  }
  plans.sort((a, b) => Number(a.entryId) - Number(b.entryId));

  console.log("KOPER_RAW_ITEM_FALLBACK_PLAN", JSON.stringify({
    ok: true,
    readOnly: true,
    source: { programmedEntries: programmedEntries.length, stockItems: stockItems.length, stagedPurchaseItems: purchaseItems.length, nativeOrders: orders.length, nativeOrderItems: orderItems.length },
    result: {
      originFallbackEntries: plans.length,
      safeEntries: plans.filter((row) => row.safe).length,
      entriesUsingRawMapping: plans.filter((row) => row.rawMappedCount > 0).length,
      rawMappedItems: plans.reduce((sum, row) => sum + row.rawMappedCount, 0),
      countsByReason: summarize(plans.flatMap((row) => row.reasons.length ? row.reasons : ["safe"])),
    },
    safeCandidates: plans.filter((row) => row.safe).slice(0, 50),
    rawMappedCandidates: plans.filter((row) => row.rawMappedCount > 0).slice(0, 50),
    blockedExamples: plans.filter((row) => !row.safe).slice(0, 50),
  }));
} catch (error: unknown) {
  console.error("KOPER_RAW_ITEM_FALLBACK_PLAN_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1200) : "unknown" }));
  process.exitCode = 1;
}
