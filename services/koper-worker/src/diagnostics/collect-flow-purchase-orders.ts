import type { Page, Response } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

export type FlowPurchaseOrderDetail = { orderId: string; payload: Record<string, unknown> };

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function identifier(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

async function captureListTransport(page: Page): Promise<{ url: string; headers: Record<string, string> }> {
  let transport: { url: string; headers: Record<string, string> } | null = null;
  const capture = (response: Response): void => {
    try {
      const url = new URL(response.url());
      if (response.request().method() === "GET"
        && url.hostname === "api.koper.com.br"
        && url.pathname === "/purchase/v1/purchase_order"
        && url.searchParams.get("orderId") === "all") {
        transport = { url: response.url(), headers: response.request().headers() };
      }
    } catch {
      // Ignora URLs inválidas.
    }
  };
  page.on("response", capture);
  await page.goto("https://app.koper.com.br/compras/ordens_compra", {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  }).catch(() => undefined);
  for (let attempt = 0; attempt < 12 && !transport; attempt += 1) await page.waitForTimeout(1_000);
  page.off("response", capture);
  if (!transport) throw new Error("Koper purchase order list transport was not captured");
  return transport;
}

function listUrl(template: string, open: "yes" | "no", offset: number, limit: number): string {
  const url = new URL(template);
  url.searchParams.set("orderId", "all");
  url.searchParams.set("open", open);
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

async function fetchPurchaseOrderDetail(
  page: Page,
  url: string,
  headers: Record<string, string>,
  orderId: string,
): Promise<Record<string, unknown>> {
  let lastStatus: number | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await page.request.get(url, { headers, timeout: 30_000 });
      lastStatus = response.status();
      if (response.ok()) {
        const body: unknown = await response.json();
        const payload = objectValue(body);
        if (payload) return payload;
      }
    } catch {
      // A API do Koper encerra conexões esporadicamente; a repetição é idempotente.
    }
    if (attempt < 3) await page.waitForTimeout(attempt * 1_000);
  }
  throw new Error(`Koper purchase order ${orderId} failed${lastStatus === null ? "" : ` (HTTP ${lastStatus})`}`);
}

export async function collectFlowPurchaseOrderBatch(batchIndex: number, batchSize = 100): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  batchIndex: number;
  total: number;
  orders: Array<Record<string, unknown>>;
  details: FlowPurchaseOrderDetail[];
  blockedWrites: number;
  message: string | null;
}> {
  if (!Number.isInteger(batchIndex) || batchIndex < 0) throw new Error("Invalid purchase order batch index");
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return {
      ok: true, authenticated: false, flowSelected: false, batchIndex, total: 0,
      orders: [], details: [], blockedWrites: 0, message: login.message,
    };
    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (isKoper && !["GET", "HEAD", "OPTIONS"].includes(request.method())
          && !isAllowedFlowSwitch(url, request.method(), request.postData())) {
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
      ok: true, authenticated: true, flowSelected: false, batchIndex, total: 0,
      orders: [], details: [], blockedWrites, message: "KOPER_FLOW_COMPANY_NOT_SELECTED",
    };
    const transport = await captureListTransport(page);
    const offset = batchIndex * batchSize;
    const response = await page.request.get(listUrl(transport.url, "no", offset, batchSize), {
      headers: transport.headers,
      timeout: 30_000,
    });
    if (!response.ok()) throw new Error(`Koper finalized purchase order list failed (HTTP ${response.status()})`);
    const body: unknown = await response.json();
    const object = objectValue(body);
    const total = numeric(object?.ordersAmount) ?? 0;
    const orders = Array.isArray(object?.orders)
      ? object.orders.filter((value): value is Record<string, unknown> => objectValue(value) !== null)
      : [];
    const ids = orders.flatMap((order) => {
      const id = identifier(order.orderId);
      return id ? [id] : [];
    });
    const details: FlowPurchaseOrderDetail[] = [];
    const concurrency = 20;
    for (let index = 0; index < ids.length; index += concurrency) {
      const batch = ids.slice(index, index + concurrency);
      details.push(...await Promise.all(batch.map(async (orderId) => {
        const payload = await fetchPurchaseOrderDetail(
          page,
          detailUrl(transport.url, orderId),
          transport.headers,
          orderId,
        );
        return { orderId, payload };
      })));
    }
    if (details.length !== orders.length) throw new Error("Koper purchase order detail count mismatch");
    return {
      ok: true, authenticated: true, flowSelected: true, batchIndex, total,
      orders, details, blockedWrites, message: null,
    };
  }, { sessionTimeoutMs: 60_000 });
}
