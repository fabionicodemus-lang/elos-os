import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Order = { id: string; source_id: string; order_number: string; received_amount: number };
type OrderItem = {
  id: string;
  order_id: string;
  source_id: string | null;
  input_code: string;
  input_name: string;
  ordered_quantity: number;
  received_quantity: number;
  accepted_quantity: number;
  rejected_quantity: number;
  unit_price: number;
  delivered_unit_cost: number;
};
type ReceiptHeader = { id: string; receipt_date: string; receipt_number: string | null; notes: string | null };
type ReceiptItem = { receipt_id: string; order_item_id: string; ordered_quantity: number; delivered_quantity: number; accepted_quantity: number; rejected_quantity: number; unit_cost: number };

const targets = [
  { entryId: "13145", itemId: "14851", financialReceiptId: "12408", receiptProductId: "7333", orderSourceId: "10289", orderProductSourceId: "11974" },
  { entryId: "3606", itemId: "4601", financialReceiptId: "3829", receiptProductId: "2707", orderSourceId: "3135", orderProductSourceId: "4097" },
] as const;

const objectValue = (value: unknown): Json => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};
const identifier = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
};
const numberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};
const quotedIn = (values: string[]): string => `in.(${values.map((value) => `\"${value}\"`).join(",")})`;
const receipts = (payload: Json): string[] => {
  const raw = Array.isArray(payload.receipts) ? payload.receipts : [];
  return [...new Set(raw.flatMap((row) => {
    const id = identifier(objectValue(row).receiptId);
    return id ? [id] : [];
  }))];
};
const productIdentity = (payload: Json) => ({
  productId: identifier(payload.productId),
  mainProductId: identifier(payload.mainProductId),
  genericProdSeq: identifier(payload.genericProdSeq),
  inputId: identifier(payload.inputId),
});
const quantitySnapshot = (payload: Json) => Object.fromEntries(
  Object.entries(payload)
    .filter(([key, value]) => /amount|quantity|received|productvalue|averageproductvalue|unit/i.test(key) && (typeof value === "string" || typeof value === "number" || value === null))
    .sort(([a], [b]) => a.localeCompare(b)),
);
const identityMatches = (left: ReturnType<typeof productIdentity>, right: ReturnType<typeof productIdentity>): boolean => {
  const pairs: Array<[string | null, string | null]> = [
    [left.productId, right.productId],
    [left.productId, right.mainProductId],
    [left.mainProductId, right.productId],
    [left.mainProductId, right.mainProductId],
    [left.genericProdSeq, right.genericProdSeq],
    [left.inputId, right.inputId],
  ];
  return pairs.some(([a, b]) => Boolean(a && b && a === b));
};

const [targetEntries, targetItems, allItems, orders] = await Promise.all([
  requestSupabase<StagingRow[]>("koper_staging_records", {
    query: new URLSearchParams({
      select: "koper_id,koper_parent_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.stock_entry",
      sync_state: "eq.present",
      koper_id: quotedIn(targets.map((target) => target.entryId)),
      limit: "10",
    }),
  }),
  requestSupabase<StagingRow[]>("koper_staging_records", {
    query: new URLSearchParams({
      select: "koper_id,koper_parent_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.stock_entry_item",
      sync_state: "eq.present",
      koper_id: quotedIn(targets.map((target) => target.itemId)),
      limit: "10",
    }),
  }),
  requestSupabase<StagingRow[]>("koper_staging_records", {
    query: new URLSearchParams({
      select: "koper_id,koper_parent_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.stock_entry_item",
      sync_state: "eq.present",
      limit: "10000",
    }),
  }),
  requestSupabase<Order[]>("procurement_purchase_orders", {
    query: new URLSearchParams({
      select: "id,source_id,order_number,received_amount",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      source_id: quotedIn(targets.map((target) => target.orderSourceId)),
      limit: "10",
    }),
  }),
]);

const orderIds = orders.map((order) => order.id);
const orderItems = orderIds.length ? await requestSupabase<OrderItem[]>("procurement_purchase_order_items", {
  query: new URLSearchParams({
    select: "id,order_id,source_id,input_code,input_name,ordered_quantity,received_quantity,accepted_quantity,rejected_quantity,unit_price,delivered_unit_cost",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source_system: "eq.koper",
    order_id: quotedIn(orderIds),
    limit: "100",
  }),
}) : [];

const relevantOrderItems = orderItems.filter((item) => targets.some((target) => (item.source_id?.split(":")[0] ?? null) === target.orderProductSourceId));
const relevantOrderItemIds = relevantOrderItems.map((item) => item.id);
const receiptItems = relevantOrderItemIds.length ? await requestSupabase<ReceiptItem[]>("procurement_material_receipt_items", {
  query: new URLSearchParams({
    select: "receipt_id,order_item_id,ordered_quantity,delivered_quantity,accepted_quantity,rejected_quantity,unit_cost",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    order_item_id: quotedIn(relevantOrderItemIds),
    limit: "1000",
  }),
}) : [];
const receiptIds = [...new Set(receiptItems.map((item) => item.receipt_id))];
const receiptHeaders = receiptIds.length ? await requestSupabase<ReceiptHeader[]>("procurement_material_receipts", {
  query: new URLSearchParams({
    select: "id,receipt_date,receipt_number,notes",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    id: quotedIn(receiptIds),
    limit: "1000",
  }),
}) : [];
const receiptHeaderById = new Map(receiptHeaders.map((header) => [header.id, header]));

const details = targets.map((target) => {
  const entry = targetEntries.find((row) => row.koper_id === target.entryId);
  const item = targetItems.find((row) => row.koper_id === target.itemId);
  const payload = objectValue(item?.payload);
  const identity = productIdentity(payload);
  const related = allItems
    .filter((row) => {
      if (row.koper_id === target.itemId) return false;
      const candidate = objectValue(row.payload);
      return receipts(candidate).includes(target.financialReceiptId) && identityMatches(identity, productIdentity(candidate));
    })
    .map((row) => {
      const candidate = objectValue(row.payload);
      return {
        itemId: row.koper_id,
        entryId: row.koper_parent_id,
        productAmount: numberValue(candidate.productAmount),
        identity: productIdentity(candidate),
        receiptIds: receipts(candidate),
        quantities: quantitySnapshot(candidate),
      };
    });
  const order = orders.find((row) => row.source_id === target.orderSourceId);
  const nativeItem = relevantOrderItems.find((row) => row.order_id === order?.id && (row.source_id?.split(":")[0] ?? null) === target.orderProductSourceId);
  const historicalReceipts = nativeItem ? receiptItems
    .filter((row) => row.order_item_id === nativeItem.id)
    .map((row) => ({ ...row, header: receiptHeaderById.get(row.receipt_id) ?? null })) : [];
  return {
    target,
    entryPayload: objectValue(entry?.payload),
    itemPayload: payload,
    sourceProductAmount: numberValue(payload.productAmount),
    identity,
    quantities: quantitySnapshot(payload),
    relatedSameFinancialReceiptAndProduct: related,
    nativeOrder: order ?? null,
    nativeOrderItem: nativeItem ?? null,
    historicalReceipts,
  };
});

console.log("KOPER_INVALID_QUANTITY_DIAGNOSTIC", JSON.stringify({
  ok: true,
  readOnly: true,
  allStagedItems: allItems.length,
  details,
}));
