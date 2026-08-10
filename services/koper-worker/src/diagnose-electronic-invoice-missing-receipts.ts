import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type Stage = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Order = { id: string; source_id: string | null; order_number: string };
type Receipt = { id: string; order_id: string; receipt_number: string; notes: string | null };

const object = (value: unknown): Json => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};
const identifier = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const valueString = String(value).trim();
  return valueString || null;
};
const arrayObjects = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : [];
function uniqueIds(value: unknown, key: string): string[] {
  return [...new Set(arrayObjects(value).flatMap((row) => {
    const found = identifier(row[key]);
    return found ? [found] : [];
  }))];
}
function invoiceIdsFromStockItem(payload: Json): string[] {
  const nested = uniqueIds(payload.invoices, "invoiceId");
  if (nested.length > 0) return nested;
  if (!Array.isArray(payload.invoiceIds)) return [];
  return [...new Set(payload.invoiceIds.flatMap((value) => {
    const found = identifier(value);
    return found ? [found] : [];
  }))];
}
function entryMarker(notes: string | null): string | null {
  return notes?.match(/Koper stockMovementId=(\d+)/i)?.[1] ?? null;
}
async function readAll<T>(table: string, query: Record<string,string>): Promise<T[]> {
  const rows:T[]=[];
  for (let offset=0;;offset+=1000) {
    const page = await requestSupabase<T[]>(table,{query:new URLSearchParams({...query,limit:"1000",offset:String(offset)})});
    rows.push(...page);
    if (page.length<1000) return rows;
  }
}

await import("./index.js");

const [invoices, stockItems, orders, receipts] = await Promise.all([
  readAll<Stage>("koper_staging_records", {select:"koper_id,koper_parent_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.xml_invoice",sync_state:"eq.present",order:"koper_id.asc"}),
  readAll<Stage>("koper_staging_records", {select:"koper_id,koper_parent_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.stock_entry_item",sync_state:"eq.present",order:"koper_parent_id.asc,koper_id.asc"}),
  readAll<Order>("procurement_purchase_orders", {select:"id,source_id,order_number",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper",order:"source_id.asc"}),
  readAll<Receipt>("procurement_material_receipts", {select:"id,order_id,receipt_number,notes",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
]);

const orderBySource = new Map(orders.flatMap((row)=>row.source_id ? [[row.source_id,row] as const] : []));
const entryIdsByInvoice = new Map<string,Set<string>>();
for (const item of stockItems) {
  if (!item.koper_parent_id) continue;
  for (const invoiceId of invoiceIdsFromStockItem(object(item.payload))) {
    const set = entryIdsByInvoice.get(invoiceId) ?? new Set<string>();
    set.add(item.koper_parent_id);
    entryIdsByInvoice.set(invoiceId,set);
  }
}
const receiptsByEntry = new Map<string,Receipt[]>();
for (const receipt of receipts) {
  const entryId=entryMarker(receipt.notes);
  if (!entryId) continue;
  receiptsByEntry.set(entryId,[...(receiptsByEntry.get(entryId)??[]),receipt]);
}

const rows:any[]=[];
for (const invoice of invoices) {
  const payload=object(invoice.payload);
  const sourceOrderIds=uniqueIds(payload.purchaseOrders,"purchaseOrderId");
  const nativeOrders=[...new Map(sourceOrderIds.flatMap((sourceId)=>{const order=orderBySource.get(sourceId); return order?[[order.id,order] as const]:[]})).values()];
  if (nativeOrders.length!==1) continue;
  const order=nativeOrders[0]!;
  const entryIds=[...(entryIdsByInvoice.get(invoice.koper_id)??new Set<string>())];
  const allEntryReceipts=entryIds.flatMap((entryId)=>(receiptsByEntry.get(entryId)??[]).map((receipt)=>({entryId,receiptId:receipt.id,receiptNumber:receipt.receipt_number,receiptOrderId:receipt.order_id})));
  const matching=allEntryReceipts.filter((receipt)=>receipt.receiptOrderId===order.id);
  if (matching.length!==0) continue;
  let category:string;
  if (entryIds.length===0) category="no_stock_entry_link";
  else if (allEntryReceipts.length===0) category="linked_entries_without_native_receipt";
  else category="linked_receipts_belong_to_other_order";
  rows.push({invoiceId:invoice.koper_id,invoiceNumber:identifier(payload.invoiceNumber),sourceOrderIds,nativeOrderId:order.id,orderNumber:order.order_number,entryIds,category,otherReceipts:allEntryReceipts});
}

const quarantineEntries=new Set(["10566","182","3672","3773","3774","3783","3831","4532","4993","500","68","9476","13145"]);
const categoryCounts=rows.reduce<Record<string,number>>((acc,row)=>{acc[row.category]=(acc[row.category]??0)+1;return acc;},{});
const uniqueEntryIds=[...new Set(rows.flatMap((row)=>row.entryIds))];
const quarantineOverlap=uniqueEntryIds.filter((entryId)=>quarantineEntries.has(entryId));
console.log("KOPER_ELECTRONIC_INVOICE_MISSING_RECEIPT_DIAG",JSON.stringify({
  ok:true,readOnly:true,
  missingReceiptInvoices:rows.length,
  categoryCounts,
  uniqueEntryIds:uniqueEntryIds.length,
  quarantineOverlap,
  quarantineOverlapCount:quarantineOverlap.length,
  examples:rows.slice(0,40),
}));
