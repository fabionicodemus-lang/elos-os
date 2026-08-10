import type { Response } from "playwright-core";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

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
const str = (value: unknown): string | null => (typeof value === "string" || typeof value === "number") && String(value).trim() ? String(value).trim() : null;
const num = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const quotedIn = (values: string[]): string => `in.(${values.map((v) => `\"${v}\"`).join(",")})`;

await import("./index.js");

const entryIds = targets.map((t) => t[0]);
const itemIds = targets.map((t) => t[1]);
const [entries, items] = await Promise.all([
  requestSupabase<StagingRow[]>("koper_staging_records", { query: new URLSearchParams({ select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.stock_entry", sync_state: "eq.present", koper_id: quotedIn(entryIds), limit: "100" }) }),
  requestSupabase<StagingRow[]>("koper_staging_records", { query: new URLSearchParams({ select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.stock_entry_item", sync_state: "eq.present", koper_id: quotedIn(itemIds), limit: "100" }) }),
]);
const entriesById = new Map(entries.map((r) => [r.koper_id, r]));
const itemsById = new Map(items.map((r) => [r.koper_id, r]));

const live = await withBrowserless(async ({ page }) => {
  const login = await performKoperLogin(page);
  if (!login.authenticated) throw new Error(login.message ?? "KOPER_LOGIN_FAILED");
  let blockedWrites = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    try {
      const url = new URL(request.url());
      const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
      if (isKoper && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !isAllowedFlowSwitch(url, request.method(), request.postData())) {
        blockedWrites += 1;
        await route.abort("blockedbyclient");
        return;
      }
    } catch {}
    await route.continue();
  });
  if (!await selectFlow(page)) throw new Error("KOPER_FLOW_COMPANY_NOT_SELECTED");
  let headers: Record<string,string> | null = null;
  const capture = (response: Response): void => {
    try {
      const url = new URL(response.url());
      if (!headers && response.request().method() === "GET" && url.hostname === "api.koper.com.br" && url.pathname === "/financial/v1/receipt") headers = response.request().headers();
    } catch {}
  };
  page.on("response", capture);
  await page.goto("https://app.koper.com.br/financeiro/notas_manuais/view/458", { waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => undefined);
  for (let i=0; i<12 && !headers; i+=1) await page.waitForTimeout(350);
  page.off("response", capture);
  if (!headers) throw new Error("KOPER_MISSING_ALLOC_RECEIPT_TRANSPORT_NOT_CAPTURED");
  const receipts = [] as Array<{ receiptId:string; payload:Json }>;
  for (const receiptId of targets.map((t) => t[2])) {
    const response = await page.request.get(`https://api.koper.com.br/financial/v1/receipt?receiptId=${encodeURIComponent(receiptId)}`, { headers, timeout: 8000 });
    if (response.status() !== 200) throw new Error(`receipt_${receiptId}_status_${response.status()}`);
    receipts.push({ receiptId, payload: objectValue(await response.json()) });
  }
  return { blockedWrites, receipts };
}, { sessionTimeoutMs: 58000 });
const receiptById = new Map(live.receipts.map((r) => [r.receiptId, r.payload]));

const seeds = targets.map(([entryId,itemId,receiptId,receiptProductId]) => {
  const entryPayload = objectValue(entriesById.get(entryId)?.payload);
  const itemPayload = objectValue(itemsById.get(itemId)?.payload);
  const receipt = receiptById.get(receiptId) ?? {};
  const products = Array.isArray(receipt.products) ? receipt.products.map(objectValue) : [];
  const product = products.find((p) => str(p.receiptProductId) === receiptProductId) ?? null;
  return { entryId,itemId,receiptId,receiptProductId,entryPayload,itemPayload,receipt,product,productId: product ? str(product.productId) : str(itemPayload.productId), quantity: product ? num(product.productAmount) : num(itemPayload.productAmount) };
});
const inputCodes = [...new Set(seeds.flatMap((s) => s.productId ? [`KOPER-${s.productId}`] : []))];
const nativeItems = inputCodes.length ? await requestSupabase<OrderItem[]>("procurement_purchase_order_items", { query: new URLSearchParams({ select: "id,order_id,source_id,input_code,input_name,ordered_quantity,received_quantity,accepted_quantity,rejected_quantity,unit_price,delivered_unit_cost", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", input_code: quotedIn(inputCodes), limit: "1000" }) }) : [];
const orderIds = [...new Set(nativeItems.map((r) => r.order_id))];
const orders = orderIds.length ? await requestSupabase<Order[]>("procurement_purchase_orders", { query: new URLSearchParams({ select: "id,source_id,supplier_id,project_id,order_number,status,received_amount", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", id: quotedIn(orderIds), limit: "1000" }) }) : [];
const orderById = new Map(orders.map((r) => [r.id, r]));

const details = seeds.map((seed) => {
  const candidates = nativeItems.filter((native) => seed.productId && native.input_code === `KOPER-${seed.productId}`).map((native) => ({
    order: orderById.get(native.order_id) ?? null,
    item: native,
    quantityDelta: seed.quantity === null ? null : Math.abs(Number(native.accepted_quantity ?? 0) - seed.quantity),
    exactAcceptedQuantity: seed.quantity !== null && Math.abs(Number(native.accepted_quantity ?? 0) - seed.quantity) < 1e-9,
  })).sort((a,b) => (a.quantityDelta ?? 1e12) - (b.quantityDelta ?? 1e12));
  return {
    target: { entryId:seed.entryId,itemId:seed.itemId,receiptId:seed.receiptId,receiptProductId:seed.receiptProductId },
    entryPayload:seed.entryPayload,
    itemPayload:seed.itemPayload,
    financialReceiptSummary:{ receiptNumber:str(seed.receipt.receiptNumber), receiptEmitDate:str(seed.receipt.receiptEmitDate), totalValue:num(seed.receipt.totalValue) },
    financialProduct:seed.product,
    productId:seed.productId,
    financialQuantity:seed.quantity,
    candidateNativeOrderItems:candidates.slice(0,25),
  };
});
console.log("KOPER_MISSING_ORDER_ALLOCATION_12_DIAGNOSTIC", JSON.stringify({ ok:true, readOnly:true, blockedWrites:live.blockedWrites, targetCount:targets.length, inputCodes, nativeCandidateItems:nativeItems.length, nativeCandidateOrders:orders.length, details }));
