import type { Response } from "playwright-core";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
type StageRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };

const objectValue = (value: unknown): Json => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};
const identifier = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value).trim(); return s || null;
};
const numeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};
function productScore(source: Json, candidate: Json): number {
  const productId = identifier(source.productId);
  const mainProductId = identifier(source.mainProductId);
  const genericProdSeq = identifier(source.genericProdSeq);
  const inputId = identifier(source.inputId);
  if (productId && identifier(candidate.productId) === productId) return 120;
  if (mainProductId && identifier(candidate.productId) === mainProductId) return 110;
  if (inputId && identifier(candidate.inputId) === inputId) return 105;
  if (genericProdSeq && identifier(candidate.genericProdSeq) === genericProdSeq) return 100;
  if (mainProductId && identifier(candidate.mainProductId) === mainProductId) return 90;
  if (productId && identifier(candidate.mainProductId) === productId) return 80;
  return 0;
}

try {
  const items = await requestSupabase<StageRow[]>("koper_staging_records", {
    query: new URLSearchParams({
      select: "koper_id,koper_parent_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.stock_entry_item",
      sync_state: "eq.present",
      koper_parent_id: "in.(\"186\",\"208\")",
      order: "koper_parent_id.asc,koper_id.asc",
      limit: "100",
    }),
  });

  const live = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) throw new Error(login.message ?? "KOPER_LOGIN_FAILED");
    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const req = route.request();
      try {
        const url = new URL(req.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (isKoper && !["GET","HEAD","OPTIONS"].includes(req.method()) && !isAllowedFlowSwitch(url, req.method(), req.postData())) {
          blockedWrites += 1; await route.abort("blockedbyclient"); return;
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
    for (let i=0; i<10 && !headers; i++) await page.waitForTimeout(350);
    page.off("response", capture);
    if (!headers) throw new Error("KOPER_FINANCIAL_RECEIPT_TRANSPORT_NOT_CAPTURED");
    const response = await page.request.get("https://api.koper.com.br/financial/v1/receipt?receiptId=463", { headers, timeout: 8000 });
    if (response.status() !== 200) throw new Error(`receipt_463_status_${response.status()}`);
    return { payload: objectValue(await response.json()), blockedWrites };
  }, { sessionTimeoutMs: 58000 });

  const products = Array.isArray(live.payload.products) ? live.payload.products.map(objectValue) : [];
  const rows = items.map((item) => {
    const source = objectValue(item.payload);
    const scored = products.map((product) => ({ product, score: productScore(source, product) })).filter((x) => x.score > 0);
    const bestScore = scored.length ? Math.max(...scored.map((x) => x.score)) : 0;
    const best = scored.filter((x) => x.score === bestScore);
    return {
      entryId: item.koper_parent_id,
      itemId: item.koper_id,
      sourceQuantity: numeric(source.productAmount),
      matches: best.map(({ product, score }) => ({
        score,
        receiptProductId: identifier(product.receiptProductId),
        productId: identifier(product.productId),
        mainProductId: identifier(product.mainProductId),
        productAmount: numeric(product.productAmount),
        orders: (Array.isArray(product.orders) ? product.orders : []).map((raw) => {
          const o = objectValue(raw);
          return { orderId: identifier(o.orderId), orderProductId: identifier(o.orderProductId), productAmount: numeric(o.productAmount), amountReceived: numeric(o.amountReceived), amount: numeric(o.amount) };
        }),
      })),
    };
  });
  console.log("KOPER_PARTITION_463_DETAIL", JSON.stringify({ ok: true, readOnly: true, blockedWrites: live.blockedWrites, rows }));
} catch (error: unknown) {
  console.error("KOPER_PARTITION_463_DETAIL_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0,1200) : "unknown" }));
  process.exitCode = 1;
}
