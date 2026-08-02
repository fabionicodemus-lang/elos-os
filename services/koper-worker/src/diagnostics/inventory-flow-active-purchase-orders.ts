import type { Page, Response } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type UnknownRecord = Record<string, unknown>;

type OrderSummary = {
  orderId: string;
  status: string | null;
  orderDate: string | null;
  productsAmount: number | null;
  orderValue: number | null;
};

const ENTRY_UNMATCHED_SAMPLE = [
  "9607", "398", "5678", "3368", "6733", "7066", "2146", "4720", "465", "8760",
  "71", "7004", "9578", "365", "79", "665", "9248", "9577", "4132", "829",
  "8087", "9360", "9472", "563", "765", "660", "6601", "9346", "9357", "9358",
];

function objectValue(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function identifier(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function captureTransport(page: Page): Promise<{ url: string; headers: Record<string, string> }> {
  let transport: { url: string; headers: Record<string, string> } | null = null;
  const capture = (response: Response): void => {
    try {
      const url = new URL(response.url());
      if (
        response.request().method() === "GET"
        && url.hostname === "api.koper.com.br"
        && url.pathname === "/purchase/v1/purchase_order"
        && url.searchParams.get("orderId") === "all"
      ) transport ??= { url: response.url(), headers: response.request().headers() };
    } catch {
      // Ignora URLs inválidas.
    }
  };
  page.on("response", capture);
  await page.goto("https://app.koper.com.br/compras/ordens_compra", {
    waitUntil: "domcontentloaded",
    timeout: 18_000,
  }).catch(() => undefined);
  for (let attempt = 0; attempt < 8 && !transport; attempt += 1) await page.waitForTimeout(750);
  page.off("response", capture);
  if (!transport) throw new Error("Koper purchase order transport was not captured");
  return transport;
}

function listUrl(template: string, offset: number, limit: number): string {
  const url = new URL(template);
  url.searchParams.set("orderId", "all");
  url.searchParams.set("open", "yes");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("cb", String(Date.now()));
  return url.toString();
}

function detailUrl(template: string, orderId: string): string {
  const url = new URL(template);
  for (const key of ["open", "limit", "offset", "orderFlag", "orderby", "typeDate", "page"]) {
    url.searchParams.delete(key);
  }
  url.searchParams.set("orderId", orderId);
  url.searchParams.set("cb", String(Date.now()));
  return url.toString();
}

function orderSummary(value: unknown): OrderSummary | null {
  const order = objectValue(value);
  const orderId = identifier(order?.orderId);
  if (!orderId || !order) return null;
  return {
    orderId,
    status: text(order.status) ?? text(order.orderStatus),
    orderDate: text(order.orderDate),
    productsAmount: numeric(order.productsAmount) ?? numeric(order.itemsAmount),
    orderValue: numeric(order.orderValue) ?? numeric(order.totalValue) ?? numeric(order.finalValue),
  };
}

export async function inventoryFlowActivePurchaseOrders(): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  declaredTotal: number;
  collected: number;
  uniqueOrderIds: number;
  entryUnmatchedSampleMatches: string[];
  entryUnmatchedSampleMissing: string[];
  statusCounts: Record<string, number>;
  samples: OrderSummary[];
  detailChecks: Array<{ orderId: string; status: number; returnedOrderId: string | null; products: number | null }>;
  blockedWrites: number;
  message: string | null;
}> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return {
      ok: true,
      authenticated: false,
      flowSelected: false,
      declaredTotal: 0,
      collected: 0,
      uniqueOrderIds: 0,
      entryUnmatchedSampleMatches: [],
      entryUnmatchedSampleMissing: ENTRY_UNMATCHED_SAMPLE,
      statusCounts: {},
      samples: [],
      detailChecks: [],
      blockedWrites: 0,
      message: login.message,
    };

    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (
          isKoper
          && !["GET", "HEAD", "OPTIONS"].includes(request.method())
          && !isAllowedFlowSwitch(url, request.method(), request.postData())
        ) {
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {
        // Ignora URLs inválidas.
      }
      await route.continue();
    });

    const flowSelected = await selectFlow(page);
    if (!flowSelected) return {
      ok: true,
      authenticated: true,
      flowSelected: false,
      declaredTotal: 0,
      collected: 0,
      uniqueOrderIds: 0,
      entryUnmatchedSampleMatches: [],
      entryUnmatchedSampleMissing: ENTRY_UNMATCHED_SAMPLE,
      statusCounts: {},
      samples: [],
      detailChecks: [],
      blockedWrites,
      message: "KOPER_FLOW_COMPANY_NOT_SELECTED",
    };

    const transport = await captureTransport(page);
    const summaries: OrderSummary[] = [];
    let declaredTotal = 0;
    for (let offset = 0; offset < 10_000; offset += 1_000) {
      const response = await page.request.get(listUrl(transport.url, offset, 1_000), {
        headers: transport.headers,
        timeout: 15_000,
      });
      if (!response.ok()) throw new Error(`Koper active order list failed (HTTP ${response.status()})`);
      const body = objectValue(await response.json());
      declaredTotal = numeric(body?.ordersAmount) ?? declaredTotal;
      const orders = Array.isArray(body?.orders) ? body.orders : [];
      for (const value of orders) {
        const parsed = orderSummary(value);
        if (parsed) summaries.push(parsed);
      }
      if (orders.length < 1_000 || (declaredTotal > 0 && summaries.length >= declaredTotal)) break;
    }

    const orderIds = new Set(summaries.map((item) => item.orderId));
    const entryUnmatchedSampleMatches = ENTRY_UNMATCHED_SAMPLE.filter((id) => orderIds.has(id));
    const entryUnmatchedSampleMissing = ENTRY_UNMATCHED_SAMPLE.filter((id) => !orderIds.has(id));
    const statusCounts: Record<string, number> = {};
    for (const item of summaries) {
      const status = item.status ?? "(missing)";
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    }

    const detailChecks = [] as Array<{
      orderId: string;
      status: number;
      returnedOrderId: string | null;
      products: number | null;
    }>;
    for (const orderId of ["9607", "398", "5678", "4097"]) {
      const response = await page.request.get(detailUrl(transport.url, orderId), {
        headers: transport.headers,
        timeout: 12_000,
      });
      let returnedOrderId: string | null = null;
      let products: number | null = null;
      if (response.ok()) {
        const payload = objectValue(await response.json());
        returnedOrderId = identifier(payload?.orderId);
        products = Array.isArray(payload?.products) ? payload.products.length : null;
      }
      detailChecks.push({ orderId, status: response.status(), returnedOrderId, products });
    }

    return {
      ok: true,
      authenticated: true,
      flowSelected: true,
      declaredTotal,
      collected: summaries.length,
      uniqueOrderIds: orderIds.size,
      entryUnmatchedSampleMatches,
      entryUnmatchedSampleMissing,
      statusCounts,
      samples: summaries.slice(0, 15),
      detailChecks,
      blockedWrites,
      message: null,
    };
  }, { sessionTimeoutMs: 58_000 });
}
