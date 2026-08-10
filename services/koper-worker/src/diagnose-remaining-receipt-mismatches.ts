import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Order = { id: string; source_id: string; order_number: string; received_amount: number };
type OrderItem = { id: string; order_id: string; source_id: string | null; input_code: string; input_name: string; ordered_quantity: number; received_quantity: number; accepted_quantity: number; rejected_quantity: number; unit_price: number; delivered_unit_cost: number };
type ReceiptItem = { receipt_id: string; order_item_id: string; ordered_quantity: number; delivered_quantity: number; accepted_quantity: number; rejected_quantity: number; unit_cost: number };
type ReceiptHeader = { id: string; receipt_date: string; receipt_number: string | null; notes: string | null };

const targets = [
  { entryId: "10299", itemId: "11652", financialReceiptId: "10304", orderSourceId: "8581", orderProductSourceId: "9836", financialQuantity: 10 },
  { entryId: "5354", itemId: "6614", financialReceiptId: "5851", orderSourceId: "4359", orderProductSourceId: "5482", financialQuantity: 20 },
  { entryId: "6173", itemId: "7398", financialReceiptId: "6518", orderSourceId: "4886", orderProductSourceId: "5975", financialQuantity: 10 },
] as const;
const objectValue = (value: unknown): Json => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};
const identifier = (value: unknown): string | null => (typeof value === "string" || typeof value === "number") && String(value).trim() ? String(value).trim() : null;
const numberValue = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const quotedIn = (values: string[]): string => `in.(${values.map((value) => `\"${value}\"`).join(",")})`;
const receiptIds = (payload: Json): string[] => (Array.isArray(payload.receipts) ? payload.receipts : []).flatMap((raw) => {
  const id = identifier(objectValue(raw).receiptId);
  return id ? [id] : [];
});
const identity = (payload: Json) => ({ productId: identifier(payload.productId), mainProductId: identifier(payload.mainProductId), genericProdSeq: identifier(payload.genericProdSeq), inputId: identifier(payload.inputId) });
const matches = (a: ReturnType<typeof identity>, b: ReturnType<typeof identity>): boolean => [
  [a.productId, b.productId], [a.productId, b.mainProductId], [a.mainProductId, b.productId], [a.mainProductId, b.mainProductId], [a.genericProdSeq, b.genericProdSeq], [a.inputId, b.inputId],
].some(([left, right]) => Boolean(left && right && left === right));

const [targetItems, orders, ...pages] = await Promise.all([
  requestSupabase<StagingRow[]>("koper_staging_records", { query: new URLSearchParams({ select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.stock_entry_item", sync_state: "eq.present", koper_id: quotedIn(targets.map((target) => target.itemId)), limit: "10" }) }),
  requestSupabase<Order[]>("procurement_purchase_orders", { query: new URLSearchParams({ select: "id,source_id,order_number,received_amount", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", source_id: quotedIn(targets.map((target) => target.orderSourceId)), limit: "10" }) }),
  ...[0, 1000, 2000, 3000, 4000].map((offset) => requestSupabase<StagingRow[]>("koper_staging_records", { query: new URLSearchParams({ select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.stock_entry_item", sync_state: "eq.present", order: "koper_id.asc", limit: "1000", offset: String(offset) }) })),
]);
const allItems = pages.flat();
const orderIds = orders.map((order) => order.id);
const orderItems = orderIds.length ? await requestSupabase<OrderItem[]>("procurement_purchase_order_items", { query: new URLSearchParams({ select: "id,order_id,source_id,input_code,input_name,ordered_quantity,received_quantity,accepted_quantity,rejected_quantity,unit_price,delivered_unit_cost", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", order_id: quotedIn(orderIds), limit: "1000" }) }) : [];
const relevantOrderItems = orderItems.filter((item) => targets.some((target) => (item.source_id?.split(":")[0] ?? null) === target.orderProductSourceId));
const relevantIds = relevantOrderItems.map((item) => item.id);
const receiptItems = relevantIds.length ? await requestSupabase<ReceiptItem[]>("procurement_material_receipt_items", { query: new URLSearchParams({ select: "receipt_id,order_item_id,ordered_quantity,delivered_quantity,accepted_quantity,rejected_quantity,unit_cost", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order_item_id: quotedIn(relevantIds), limit: "1000" }) }) : [];
const nativeReceiptIds = [...new Set(receiptItems.map((row) => row.receipt_id))];
const headers = nativeReceiptIds.length ? await requestSupabase<ReceiptHeader[]>("procurement_material_receipts", { query: new URLSearchParams({ select: "id,receipt_date,receipt_number,notes", company_id: `eq.${env.BOSSA_COMPANY_ID}`, id: quotedIn(nativeReceiptIds), limit: "1000" }) }) : [];
const headerById = new Map(headers.map((header) => [header.id, header]));

const details = targets.map((target) => {
  const targetRow = targetItems.find((row) => row.koper_id === target.itemId);
  const targetPayload = objectValue(targetRow?.payload);
  const targetIdentity = identity(targetPayload);
  const sameReceipt = allItems.filter((row) => {
    if (row.koper_id === target.itemId) return false;
    const payload = objectValue(row.payload);
    return receiptIds(payload).includes(target.financialReceiptId) && matches(targetIdentity, identity(payload));
  }).map((row) => ({ itemId: row.koper_id, entryId: row.koper_parent_id, productAmount: numberValue(objectValue(row.payload).productAmount), receiptIds: receiptIds(objectValue(row.payload)), identity: identity(objectValue(row.payload)) }));
  const sameProduct = allItems.filter((row) => row.koper_id !== target.itemId && matches(targetIdentity, identity(objectValue(row.payload)))).map((row) => ({ itemId: row.koper_id, entryId: row.koper_parent_id, productAmount: numberValue(objectValue(row.payload).productAmount), receiptIds: receiptIds(objectValue(row.payload)) }));
  const order = orders.find((row) => row.source_id === target.orderSourceId);
  const nativeItem = relevantOrderItems.find((row) => row.order_id === order?.id && (row.source_id?.split(":")[0] ?? null) === target.orderProductSourceId);
  const historical = nativeItem ? receiptItems.filter((row) => row.order_item_id === nativeItem.id).map((row) => ({ ...row, header: headerById.get(row.receipt_id) ?? null })) : [];
  const sourceQuantity = numberValue(targetPayload.productAmount);
  return { target, sourceQuantity, missingToFinancial: sourceQuantity === null ? null : target.financialQuantity - sourceQuantity, targetPayload, identity: targetIdentity, sameReceiptAndProduct: sameReceipt, sameProductAnywhereCount: sameProduct.length, sameProductAnywhere: sameProduct, nativeOrder: order ?? null, nativeOrderItem: nativeItem ?? null, historicalReceipts: historical };
});
console.log("KOPER_REMAINING_MISMATCH_DIAGNOSTIC", JSON.stringify({ ok: true, readOnly: true, pageSizes: pages.map((page) => page.length), allItems: allItems.length, details }));
