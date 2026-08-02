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

async function captureTransport(page: Page): Promise<{
  url: string;
  headers: Record<string, string>;
  status: number;
  body: UnknownRecord;
}> {
  let captured: Promise<{
    url: string;
    headers: Record<string, string>;
    status: number;
    body: UnknownRecord;
  }> | null = null;
  const capture = (response: Response): void => {
    try {
      const url = new URL(response.url());
      if (
        !captured
        && response.request().method() === "GET"
        && url.hostname === "api.koper.com.br"
        && url.pathname === "/purchase/v1/purchase_order"
        && url.searchParams.get("orderId") === "all"
      ) {
        captured = response.json().then((body: unknown) => ({
          url: response.url(),
          headers: response.request().headers(),
          status: response.status(),
          body: objectValue(body) ?? {},
        }));
      }
    } catch {
      // Ignora URLs inválidas.
    }
  };
  page.on("response", capture);
  await page.goto("https://app.koper.com.br/compras/ordens_compra", {
    waitUntil: "domcontentloaded",
    timeout: 18_000,
  }).catch(() => undefined);
  for (let attempt = 0; attempt < 10 && !captured; attempt += 1) await page.waitForTimeout(750);
  page.off("response", capture);
  if (!captured) throw new Error("Koper purchase order transport was not captured");
  return await captured;
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
  capturedStatus: number | null;
  capturedQuery: Record<string, string>;
  declaredTotal: number;
  collectedFirstPage: number;
  entryUnmatchedSampleMatchesFirstPage: string[];
  statusCountsFirstPage: Record<string, number>;
  samples: OrderSummary[];
  detailChecks: Array<{ orderId: string; status: number; returnedOrderId: string | null; products: number | null }>;
  blockedWrites: number;
  message: string | null;
}> {
  return withBrowserless(async ({ page }) => {
    const empty = (message: string | null, authenticated: boolean, flowSelected: boolean, blockedWrites: number) => ({
      ok: true as const,
      authenticated,
      flowSelected,
      capturedStatus: null,
      capturedQuery: {},
      declaredTotal: 0,
      collectedFirstPage: 0,
      entryUnmatchedSampleMatchesFirstPage: [],
      statusCountsFirstPage: {},
      samples: [],
      detailChecks: [],
      blockedWrites,
      message,
    });

    const login = await performKoperLogin(page);
    if (!login.authenticated) return empty(login.message, false, false, 0);

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
    if (!flowSelected) return empty("KOPER_FLOW_COMPANY_NOT_SELECTED", true, false, blockedWrites);

    const transport = await captureTransport(page);
    const safeQueryKeys = new Set(["orderId", "open", "limit", "offset", "page", "orderFlag", "orderby", "typeDate"]);
    const capturedUrl = new URL(transport.url);
    const capturedQuery = Object.fromEntries(
      [...capturedUrl.searchParams.entries()].filter(([key]) => safeQueryKeys.has(key)),
    );
    const rawOrders = Array.isArray(transport.body.orders) ? transport.body.orders : [];
    const summaries = rawOrders.flatMap((value) => {
      const parsed = orderSummary(value);
      return parsed ? [parsed] : [];
    });
    const firstPageIds = new Set(summaries.map((item) => item.orderId));
    const entryUnmatchedSampleMatchesFirstPage = ENTRY_UNMATCHED_SAMPLE.filter((id) => firstPageIds.has(id));
    const statusCountsFirstPage: Record<string, number> = {};
    for (const item of summaries) {
      const status = item.status ?? "(missing)";
      statusCountsFirstPage[status] = (statusCountsFirstPage[status] ?? 0) + 1;
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
      capturedStatus: transport.status,
      capturedQuery,
      declaredTotal: numeric(transport.body.ordersAmount) ?? 0,
      collectedFirstPage: summaries.length,
      entryUnmatchedSampleMatchesFirstPage,
      statusCountsFirstPage,
      samples: summaries.slice(0, 15),
      detailChecks,
      blockedWrites,
      message: null,
    };
  }, { sessionTimeoutMs: 58_000 });
}
