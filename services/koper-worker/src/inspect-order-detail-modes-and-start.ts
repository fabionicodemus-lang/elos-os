import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type UnknownRecord = Record<string, unknown>;
type Transport = { url: string; headers: Record<string, string>; status: number };

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

const result = await withBrowserless(async ({ page }) => {
  const login = await performKoperLogin(page);
  if (!login.authenticated) return { ok: false, message: login.message };

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
  if (!flowSelected) return { ok: false, message: "KOPER_FLOW_COMPANY_NOT_SELECTED", blockedWrites };

  let transport: Transport | null = null;
  const capture = (response: Response): void => {
    try {
      const url = new URL(response.url());
      if (
        !transport
        && response.request().method() === "GET"
        && url.hostname === "api.koper.com.br"
        && url.pathname === "/purchase/v1/purchase_order"
      ) transport = { url: response.url(), headers: response.request().headers(), status: response.status() };
    } catch {
      // Ignora URLs inválidas.
    }
  };
  page.on("response", capture);
  await page.goto("https://app.koper.com.br/compras/ordens_compra", {
    waitUntil: "domcontentloaded",
    timeout: 18_000,
  }).catch(() => undefined);
  for (let attempt = 0; attempt < 10 && !transport; attempt += 1) await page.waitForTimeout(750);
  page.off("response", capture);

  const capturedTransport = transport as Transport | null;
  if (!capturedTransport) {
    return { ok: false, message: "KOPER_PURCHASE_ORDER_TRANSPORT_NOT_CAPTURED", blockedWrites };
  }

  const baseUrl = new URL(capturedTransport.url);
  const checks = [] as Array<{
    orderId: string;
    mode: "yes" | "no" | "absent";
    status: number;
    returnedOrderId: string | null;
    orderStatus: string | null;
    products: number | null;
  }>;

  for (const orderId of ["9607", "398", "5678", "4097"]) {
    for (const mode of ["yes", "no", "absent"] as const) {
      const url = new URL(baseUrl);
      for (const key of ["limit", "offset", "orderFlag", "orderby", "typeDate", "page"]) {
        url.searchParams.delete(key);
      }
      url.searchParams.set("orderId", orderId);
      if (mode === "absent") url.searchParams.delete("open");
      else url.searchParams.set("open", mode);
      url.searchParams.set("cb", String(Date.now()));
      const response = await page.request.get(url.toString(), {
        headers: capturedTransport.headers,
        timeout: 10_000,
      });
      let returnedOrderId: string | null = null;
      let orderStatus: string | null = null;
      let products: number | null = null;
      if (response.ok()) {
        const payload = objectValue(await response.json());
        returnedOrderId = identifier(payload?.orderId);
        orderStatus = identifier(payload?.status) ?? identifier(payload?.orderStatus);
        products = Array.isArray(payload?.products) ? payload.products.length : null;
      }
      checks.push({ orderId, mode, status: response.status(), returnedOrderId, orderStatus, products });
    }
  }

  return {
    ok: true,
    flowSelected: true,
    capturedStatus: capturedTransport.status,
    capturedOpen: baseUrl.searchParams.get("open"),
    checks,
    blockedWrites,
  };
}, { sessionTimeoutMs: 58_000 });

console.log("KOPER_ORDER_DETAIL_MODES_RESULT", JSON.stringify(result));
await import("./index.js");
