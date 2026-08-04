import type { Page, Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
type Transport = { url: string; headers: Record<string, string> };
type Scalar = { path: string; value: string };

const SAMPLES = [
  { entryId: "180", orderId: "333", case: "missing_order_item" },
  { entryId: "936", orderId: "1321", case: "quantity_mismatch" },
];

const object = (value: unknown): Json | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : null;
const identifier = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
};

function allowedHeaders(headers: Record<string, string>): Record<string, string> {
  const allow = new Set(["accept", "accept-language", "cache-control", "cookie", "origin", "referer", "user-agent", "x-accesstoken", "x-koper"]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => allow.has(key.toLowerCase())));
}

async function captureTransport(page: Page, target: "stock" | "purchase"): Promise<Transport> {
  let transport: Transport | null = null;
  const capture = (response: Response): void => {
    try {
      const url = new URL(response.url());
      const isTarget = target === "stock"
        ? url.hostname === "api.koper.com.br" && url.pathname.startsWith("/stock/v1/")
        : url.hostname === "api.koper.com.br" && url.pathname === "/purchase/v1/purchase_order";
      if (!transport && response.request().method() === "GET" && isTarget) {
        transport = { url: response.url(), headers: allowedHeaders(response.request().headers()) };
      }
    } catch {
      // Ignore malformed URLs.
    }
  };
  page.on("response", capture);
  await page.goto(
    target === "stock" ? "https://app.koper.com.br/suprimentos/entradas/" : "https://app.koper.com.br/compras/ordens_compra",
    { waitUntil: "domcontentloaded", timeout: 20_000 },
  ).catch(() => undefined);
  for (let attempt = 0; attempt < 15 && !transport; attempt += 1) await page.waitForTimeout(600);
  page.off("response", capture);
  const result = transport as Transport | null;
  if (!result) throw new Error(`KOPER_${target.toUpperCase()}_TRANSPORT_NOT_CAPTURED`);
  return result;
}

function stockUrl(template: string, entryId: string): string {
  const url = new URL(template);
  url.pathname = "/stock/v1/product_entry";
  url.searchParams.set("entryId", entryId);
  url.searchParams.set("pending", "false");
  url.searchParams.set("cb", String(Date.now()));
  return url.toString();
}

function orderUrl(template: string, orderId: string): string {
  const url = new URL(template);
  url.pathname = "/purchase/v1/purchase_order";
  for (const key of ["open", "limit", "offset", "orderFlag", "orderby", "typeDate", "page"]) url.searchParams.delete(key);
  url.searchParams.set("orderId", orderId);
  url.searchParams.set("cb", String(Date.now()));
  return url.toString();
}

function identityScalars(value: unknown, prefix = "", depth = 0): Scalar[] {
  if (depth > 3) return [];
  if (Array.isArray(value)) return value.slice(0, 50).flatMap((item, index) => identityScalars(item, `${prefix}[${index}]`, depth + 1));
  const row = object(value);
  if (!row) return [];
  const result: Scalar[] = [];
  for (const [key, child] of Object.entries(row)) {
    if (/token|cookie|authorization|password/i.test(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string" || typeof child === "number") {
      const scalar = identifier(child);
      if (scalar && /(^|_)(id|seq|code|number)$|id$|seq$|code$|number$|product|receipt|request|order|movement|generic/i.test(key)) {
        if (scalar !== "0" && scalar !== "1" && scalar.length >= 2) result.push({ path, value: scalar });
      }
    } else if (child && (Array.isArray(child) || object(child))) {
      result.push(...identityScalars(child, path, depth + 1));
    }
  }
  return result;
}

function matchingScalars(stockProduct: Json, orderProducts: Json[]): Array<{
  value: string;
  stockPaths: string[];
  orderCandidates: Array<{ index: number; paths: string[] }>;
}> {
  const stock = identityScalars(stockProduct);
  const order = orderProducts.map((product) => identityScalars(product));
  const matches = new Map<string, { stockPaths: Set<string>; candidates: Map<number, Set<string>> }>();
  for (const stockScalar of stock) {
    for (let index = 0; index < order.length; index += 1) {
      for (const orderScalar of order[index]!) {
        if (stockScalar.value !== orderScalar.value) continue;
        const current = matches.get(stockScalar.value) ?? { stockPaths: new Set<string>(), candidates: new Map<number, Set<string>>() };
        current.stockPaths.add(stockScalar.path);
        const paths = current.candidates.get(index) ?? new Set<string>();
        paths.add(orderScalar.path);
        current.candidates.set(index, paths);
        matches.set(stockScalar.value, current);
      }
    }
  }
  return [...matches.entries()].map(([value, row]) => ({
    value,
    stockPaths: [...row.stockPaths].sort(),
    orderCandidates: [...row.candidates.entries()].map(([index, paths]) => ({ index, paths: [...paths].sort() })),
  }));
}

function sampleProduct(product: Json): Json {
  return {
    keys: Object.keys(product).sort(),
    productId: identifier(product.productId),
    mainProductId: identifier(product.mainProductId),
    genericProdSeq: identifier(product.genericProdSeq),
    productMovementId: identifier(product.productMovementId),
    orderProductId: identifier(product.orderProductId),
    purchaseOrderItemId: identifier(product.purchaseOrderItemId),
    inputId: identifier(product.inputId),
    receiptKeys: Array.isArray(product.receipts) ? Object.keys(object(product.receipts[0]) ?? {}).sort() : [],
    invoiceKeys: Array.isArray(product.invoices) ? Object.keys(object(product.invoices[0]) ?? {}).sort() : [],
    identityScalars: identityScalars(product).slice(0, 100),
  };
}

const result = await withBrowserless(async ({ page }) => {
  const login = await performKoperLogin(page);
  if (!login.authenticated) return { ok: false, message: login.message };

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
    } catch {
      // Ignore malformed URLs.
    }
    await route.continue();
  });

  const flowSelected = await selectFlow(page);
  if (!flowSelected) return { ok: false, message: "KOPER_FLOW_COMPANY_NOT_SELECTED", blockedWrites };
  const stockTransport = await captureTransport(page, "stock");
  const purchaseTransport = await captureTransport(page, "purchase");

  const samples = [] as Json[];
  for (const sample of SAMPLES) {
    const [stockResponse, orderResponse] = await Promise.all([
      page.request.get(stockUrl(stockTransport.url, sample.entryId), { headers: stockTransport.headers, timeout: 30_000 }),
      page.request.get(orderUrl(purchaseTransport.url, sample.orderId), { headers: purchaseTransport.headers, timeout: 30_000 }),
    ]);
    const stockPayload = object(await stockResponse.json().catch(() => null)) ?? {};
    const orderPayload = object(await orderResponse.json().catch(() => null)) ?? {};
    const stockProducts = Array.isArray(stockPayload.products) ? stockPayload.products.map((value) => object(value) ?? {}) : [];
    const orderProducts = Array.isArray(orderPayload.products) ? orderPayload.products.map((value) => object(value) ?? {}) : [];
    samples.push({
      ...sample,
      stockStatus: stockResponse.status(),
      orderStatus: orderResponse.status(),
      stockTopLevelKeys: Object.keys(stockPayload).sort(),
      orderTopLevelKeys: Object.keys(orderPayload).sort(),
      stockProducts: stockProducts.map((product, index) => ({ index, ...sampleProduct(product), matches: matchingScalars(product, orderProducts) })),
      orderProducts: orderProducts.map((product, index) => ({ index, ...sampleProduct(product) })),
    });
  }
  return { ok: true, readOnly: true, flowSelected: true, blockedWrites, samples };
}, { sessionTimeoutMs: 75_000 });

console.log("KOPER_LIVE_STOCK_ORDER_LINKAGE", JSON.stringify(result));
