import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Receipt = { id:string; order_id:string; receipt_number:string; receipt_date:string; invoice_number:string|null; invoice_amount:number|null; notes:string|null };
type ReceiptItem = { receipt_id:string; order_item_id:string; delivered_quantity:number; accepted_quantity:number; accepted_amount:number; unit_cost:number };
type Order = { id:string; source_id:string; supplier_id:string|null; order_number:string; status:string; received_amount:number };
type OrderItem = { id:string; order_id:string; source_id:string|null; input_code:string; input_name:string; ordered_quantity:number; received_quantity:number; accepted_quantity:number; rejected_quantity:number; unit_price:number; delivered_unit_cost:number };

await import("./index.js");
const orderSourceId = "1321";
const orderItemId = "35b36cd6-9c7a-45a5-b7bf-41029088c475";
const orders = await requestSupabase<Order[]>("procurement_purchase_orders", { query:new URLSearchParams({ select:"id,source_id,supplier_id,order_number,status,received_amount", company_id:`eq.${env.BOSSA_COMPANY_ID}`, source_system:"eq.koper", source_id:`eq.${orderSourceId}`, limit:"5" }) });
const order = orders[0] ?? null;
const items = await requestSupabase<OrderItem[]>("procurement_purchase_order_items", { query:new URLSearchParams({ select:"id,order_id,source_id,input_code,input_name,ordered_quantity,received_quantity,accepted_quantity,rejected_quantity,unit_price,delivered_unit_cost", company_id:`eq.${env.BOSSA_COMPANY_ID}`, source_system:"eq.koper", id:`eq.${orderItemId}`, limit:"5" }) });
const receiptItems = await requestSupabase<ReceiptItem[]>("procurement_material_receipt_items", { query:new URLSearchParams({ select:"receipt_id,order_item_id,delivered_quantity,accepted_quantity,accepted_amount,unit_cost", company_id:`eq.${env.BOSSA_COMPANY_ID}`, order_item_id:`eq.${orderItemId}`, limit:"100" }) });
const receiptIds = [...new Set(receiptItems.map((r)=>r.receipt_id))];
const receipts = receiptIds.length ? await requestSupabase<Receipt[]>("procurement_material_receipts", { query:new URLSearchParams({ select:"id,order_id,receipt_number,receipt_date,invoice_number,invoice_amount,notes", company_id:`eq.${env.BOSSA_COMPANY_ID}`, id:`in.(${receiptIds.map((id)=>`\"${id}\"`).join(",")})`, limit:"100" }) }) : [];
console.log("KOPER_ENTRY_3783_ORDER_1321_COVERAGE", JSON.stringify({ok:true,readOnly:true,order,orderItem:items[0]??null,receiptItems,receipts,totalAcceptedInReceipts:receiptItems.reduce((s,r)=>s+Number(r.accepted_quantity??0),0)}));
