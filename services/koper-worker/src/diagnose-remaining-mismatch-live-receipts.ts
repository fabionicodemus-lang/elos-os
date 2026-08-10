import type { Response } from "playwright-core";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
const targets = [
  { entryId: "10299", receiptId: "10304" },
  { entryId: "5354", receiptId: "5851" },
  { entryId: "6173", receiptId: "6518" },
] as const;
const objectValue = (value: unknown): Json => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};
const identifier = (value: unknown): string | null => (typeof value === "string" || typeof value === "number") && String(value).trim() ? String(value).trim() : null;
const numberValue = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const quotedIn = (values: string[]): string => `in.(${values.map((value) => `\"${value}\"`).join(",")})`;
const summarizeProduct = (raw: unknown) => {
  const product = objectValue(raw);
  return {
    receiptProductId: identifier(product.receiptProductId),
    productId: identifier(product.productId),
    mainProductId: identifier(product.mainProductId),
    genericProdSeq: identifier(product.genericProdSeq),
    inputId: identifier(product.inputId),
    productAmount: numberValue(product.productAmount),
    price: numberValue(product.price),
    totalProductValue: numberValue(product.totalProductValue),
    productName: identifier(product.productName) ?? identifier(product.name) ?? identifier(product.description),
    orders: (Array.isArray(product.orders) ? product.orders : []).map((rawOrder) => {
      const order = objectValue(rawOrder);
      return {
        orderId: identifier(order.orderId),
        orderProductId: identifier(order.orderProductId),
        productAmount: numberValue(order.productAmount),
        amountReceived: numberValue(order.amountReceived),
        amount: numberValue(order.amount),
      };
    }),
  };
};

const [entries, items] = await Promise.all([
  requestSupabase<StagingRow[]>("koper_staging_records", { query: new URLSearchParams({ select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.stock_entry", sync_state: "eq.present", koper_id: quotedIn(targets.map((target) => target.entryId)), limit: "20" }) }),
  requestSupabase<StagingRow[]>("koper_staging_records", { query: new URLSearchParams({ select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.stock_entry_item", sync_state: "eq.present", koper_parent_id: quotedIn(targets.map((target) => target.entryId)), order: "koper_parent_id.asc,koper_id.asc", limit: "1000" }) }),
]);

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
  let headers: Record<string, string> | null = null;
  const capture = (response: Response): void => {
    try {
      const url = new URL(response.url());
      if (!headers && response.request().method() === "GET" && url.hostname === "api.koper.com.br" && url.pathname === "/financial/v1/receipt") headers = response.request().headers();
    } catch {}
  };
  page.on("response", capture);
  await page.goto("https://app.koper.com.br/financeiro/notas_manuais/view/458", { waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => undefined);
  for (let index = 0; index < 10 && !headers; index += 1) await page.waitForTimeout(350);
  page.off("response", capture);
  if (!headers) throw new Error("KOPER_FINANCIAL_RECEIPT_TRANSPORT_NOT_CAPTURED");
  const receipts = [] as Array<{ receiptId: string; status: number; payload: Json }>;
  for (const target of targets) {
    const response = await page.request.get(`https://api.koper.com.br/financial/v1/receipt?receiptId=${target.receiptId}`, { headers, timeout: 8000 });
    receipts.push({ receiptId: target.receiptId, status: response.status(), payload: response.status() === 200 ? objectValue(await response.json()) : {} });
  }
  return { blockedWrites, receipts };
}, { sessionTimeoutMs: 58000 });

const details = targets.map((target) => {
  const entry = entries.find((row) => row.koper_id === target.entryId);
  const entryItems = items.filter((row) => row.koper_parent_id === target.entryId).map((row) => ({ itemId: row.koper_id, payload: objectValue(row.payload) }));
  const receipt = live.receipts.find((row) => row.receiptId === target.receiptId);
  return {
    target,
    entryPayload: objectValue(entry?.payload),
    stagedItems: entryItems,
    financialReceipt: receipt ? {
      status: receipt.status,
      receiptNumber: identifier(receipt.payload.receiptNumber),
      receiptEmitDate: identifier(receipt.payload.receiptEmitDate),
      totalValue: numberValue(receipt.payload.totalValue),
      products: (Array.isArray(receipt.payload.products) ? receipt.payload.products : []).map(summarizeProduct),
    } : null,
  };
});
console.log("KOPER_REMAINING_MISMATCH_LIVE", JSON.stringify({ ok: true, readOnly: true, blockedWrites: live.blockedWrites, details }));
