import type { Response } from "playwright-core";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-koper-purchase-orders.js";

type Json = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Order = { id: string; source_id: string; supplier_id: string | null; project_id: string; order_number: string; status: string; received_amount: number };
type OrderItem = { id: string; order_id: string; source_id: string | null; input_code: string; input_name: string; ordered_quantity: number; received_quantity: number; accepted_quantity: number; rejected_quantity: number; unit_price: number; delivered_unit_cost: number };

const targets = [
  ["10566","11919","10066","5710"], ["182","264","459","118"], ["3672","4690","3976","2938"],
  ["3773","4934","4194","3106"], ["3774","4940","4201","3120"], ["3783","4971","4216","3129"],
  ["3831","5022","4324","3136"], ["4532","5769","5120","3501"], ["4993","6252","5497","3763"],
  ["500","771","816","298"], ["68","68","100","67"], ["9476","10895","9386","5384"],
] as const;

const objectValue = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const str = (value: unknown): string | null => typeof value === "string" || typeof value === "number" ? String(value) : null;
const num = (value: unknown): number | null => { const n = Number(value); return Number.isFinite(n) ? n : null; };
const quotedIn = (values: string[]): string => `in.(${values.map((v) => `"${v.replaceAll('"','\\"')}"`).join(",")})`;

await import("./index.js");

const entryIds = targets.map((t) => t[0]);
const itemIds = targets.map((t) => t[1]);
const [entries, items, nativeItems] = await Promise.all([
  requestSupabase<StagingRow[]>("koper_staging_records", { query: new URLSearchParams({ select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.stock_entry", koper_id: quotedIn(entryIds), limit: "100" }) }),
  requestSupabase<StagingRow[]>("koper_staging_records", { query: new URLSearchParams({ select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.stock_entry_item", koper_id: quotedIn(itemIds), limit: "100" }) }),
  requestSupabase<OrderItem[]>("procurement_purchase_order_items", { query: new URLSearchParams({ select: "id,order_id,source_id,input_code,input_name,ordered_quantity,received_quantity,accepted_quantity,rejected_quantity,unit_price,delivered_unit_cost", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", limit: "5000" }) }),
]);
const entriesById = new Map(entries.map((r) => [r.koper_id, r]));
const itemsById = new Map(items.map((r) => [r.koper_id, r]));
const orderIds = [...new Set(nativeItems.map((r) => r.order_id))];
const orders = await requestSupabase<Order[]>("procurement_purchase_orders", { query: new URLSearchParams({ select: "id,source_id,supplier_id,project_id,order_number,status,received_amount", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", id: quotedIn(orderIds), limit: "5000" }) });
const orderById = new Map(orders.map((r) => [r.id, r]));

let capturedHeaders: Record<string,string> | null = null;
const rawReceipts = new Map<string, Json>();
let blockedWrites = 0;
await withBrowserless(async (page) => {
  const onResponse = (response: Response): void => {
    try {
      const url = new URL(response.url());
      if (!capturedHeaders && response.request().method() === "GET" && url.hostname === "api.koper.com.br" && url.pathname === "/financial/v1/receipt") capturedHeaders = response.request().headers();
    } catch {}
  };
  page.on("response", onResponse);
  await performKoperLogin(page);
  await selectFlow(page, isAllowedFlowSwitch);
  await page.goto("https://app.koper.com.br/financeiro/notas_manuais/view/458", { waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => undefined);
  for (let i=0; i<12 && !capturedHeaders; i+=1) await page.waitForTimeout(350);
  page.off("response", onResponse);
  if (!capturedHeaders) throw new Error("KOPER_MISSING_ALLOC_RECEIPT_TRANSPORT_NOT_CAPTURED");
  for (const receiptId of targets.map((t) => t[2])) {
    const response = await page.request.get(`https://api.koper.com.br/financial/v1/receipt?receiptId=${encodeURIComponent(receiptId)}`, { headers: capturedHeaders, timeout: 8000 });
    if (response.status() !== 200) throw new Error(`receipt_${receiptId}_status_${response.status()}`);
    rawReceipts.set(receiptId, objectValue(await response.json()));
  }
  return null;
}, { sessionTimeoutMs: 58000 });

function collectProducts(root: Json): Json[] {
  const candidates: unknown[] = [];
  const walk = (value: unknown, depth=0): void => {
    if (depth > 5 || value == null) return;
    if (Array.isArray(value)) { for (const x of value) walk(x, depth+1); return; }
    if (typeof value !== "object") return;
    const o = value as Json;
    if (("receiptProductId" in o || "receipt_product_id" in o) && ("productId" in o || "product_id" in o)) candidates.push(o);
    for (const v of Object.values(o)) walk(v, depth+1);
  };
  walk(root);
  return candidates as Json[];
}

const details = targets.map(([entryId,itemId,receiptId,receiptProductId]) => {
  const entryPayload = objectValue(entriesById.get(entryId)?.payload);
  const itemPayload = objectValue(itemsById.get(itemId)?.payload);
  const receipt = rawReceipts.get(receiptId) ?? {};
  const products = collectProducts(receipt);
  const product = products.find((p) => str(p.receiptProductId ?? p.receipt_product_id) === receiptProductId) ?? null;
  const productId = product ? str(product.productId ?? product.product_id) : str(itemPayload.productId);
  const quantity = product ? num(product.productAmount ?? product.amount ?? product.quantity) : num(itemPayload.productAmount);
  const candidates = nativeItems.filter((native) => productId && native.input_code === `KOPER-${productId}`).map((native) => ({
    order: orderById.get(native.order_id) ?? null,
    item: native,
    quantityDelta: quantity === null ? null : Math.abs(Number(native.accepted_quantity ?? 0) - quantity),
  })).sort((a,b) => (a.quantityDelta ?? 1e12) - (b.quantityDelta ?? 1e12));
  return {
    target: { entryId,itemId,receiptId,receiptProductId },
    entryPayload,
    itemPayload,
    financialReceiptSummary: {
      receiptNumber: str(receipt.receiptNumber ?? receipt.number),
      receiptEmitDate: str(receipt.receiptEmitDate ?? receipt.emitDate ?? receipt.date),
      totalValue: num(receipt.totalValue ?? receipt.value),
      topLevelKeys: Object.keys(receipt).sort(),
    },
    financialProduct: product,
    productId,
    financialQuantity: quantity,
    candidateNativeOrderItems: candidates.slice(0, 25),
  };
});
console.log("KOPER_MISSING_ORDER_ALLOCATION_12_DIAGNOSTIC", JSON.stringify({ ok:true, readOnly:true, blockedWrites, targetCount:targets.length, details }));
