import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Order = { id: string; source_id: string; order_number: string; received_amount: number };
type OrderItem = { id: string; order_id: string; source_id: string | null; input_code: string; input_name: string; ordered_quantity: number; received_quantity: number; accepted_quantity: number; rejected_quantity: number; unit_price: number; delivered_unit_cost: number };
type ReceiptItem = { receipt_id: string; order_item_id: string; delivered_quantity: number; accepted_quantity: number; rejected_quantity: number; unit_cost: number };
type Receipt = { id: string; receipt_number: string | null; receipt_date: string; notes: string | null };
const orderSources = ["8581", "4359", "4859", "4886"];
const targetProductSources = ["9835", "9836", "5482", "5948", "5975"];
const quotedIn = (values: string[]): string => `in.(${values.map((value) => `\"${value}\"`).join(",")})`;
const orders = await requestSupabase<Order[]>("procurement_purchase_orders", { query: new URLSearchParams({ select: "id,source_id,order_number,received_amount", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", source_id: quotedIn(orderSources), limit: "100" }) });
const orderItems = await requestSupabase<OrderItem[]>("procurement_purchase_order_items", { query: new URLSearchParams({ select: "id,order_id,source_id,input_code,input_name,ordered_quantity,received_quantity,accepted_quantity,rejected_quantity,unit_price,delivered_unit_cost", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", order_id: quotedIn(orders.map((order) => order.id)), limit: "1000" }) });
const relevant = orderItems.filter((item) => targetProductSources.includes(item.source_id?.split(":")[0] ?? ""));
const receiptItems = relevant.length ? await requestSupabase<ReceiptItem[]>("procurement_material_receipt_items", { query: new URLSearchParams({ select: "receipt_id,order_item_id,delivered_quantity,accepted_quantity,rejected_quantity,unit_cost", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order_item_id: quotedIn(relevant.map((item) => item.id)), limit: "1000" }) }) : [];
const receiptIds = [...new Set(receiptItems.map((item) => item.receipt_id))];
const receipts = receiptIds.length ? await requestSupabase<Receipt[]>("procurement_material_receipts", { query: new URLSearchParams({ select: "id,receipt_number,receipt_date,notes", company_id: `eq.${env.BOSSA_COMPANY_ID}`, id: quotedIn(receiptIds), limit: "1000" }) }) : [];
const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
console.log("KOPER_MISMATCH_NATIVE_SUPPORT", JSON.stringify({ ok: true, readOnly: true, orders, items: relevant.map((item) => ({ ...item, historicalReceipts: receiptItems.filter((row) => row.order_item_id === item.id).map((row) => ({ ...row, header: receiptById.get(row.receipt_id) ?? null })) })) }));
