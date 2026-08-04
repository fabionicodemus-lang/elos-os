import type { Page, Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
type Transport = { url: string; headers: Record<string, string> };

const probes = [
  { label: "stock_receipt", pathname: "/stock/v1/receipt", params: { receiptId: "458" } },
  { label: "stock_product_receipt", pathname: "/stock/v1/product_receipt", params: { receiptId: "458" } },
  { label: "stock_receipt_product", pathname: "/stock/v1/receipt_product", params: { receiptId: "458" } },
  { label: "purchase_receipt", pathname: "/purchase/v1/receipt", params: { receiptId: "458" } },
] as const;

const object = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : null;

function allowedHeaders(headers: Record<string, string>): Record<string, string> {
  const allowed = new Set(["accept", "accept-language", "cache-control", "cookie", "origin", "referer", "user-agent", "x-accesstoken", "x-koper"]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => allowed.has(key.toLowerCase())));
}

async function captureStockTransport(page: Page): Promise<Transport> {
  let transport: Transport | null = null;
  const listener = (response: Response): void => {
    try {
      const url = new URL(response.url());
      if (!transport && response.request().method() === "GET" && url.hostname === "api.koper.com.br" && url.pathname.startsWith("/stock/v1/")) {
        transport = { url: response.url(), headers: allowedHeaders(response.request().headers()) };
      }
    } catch { /* ignore */ }
  };
  page.on("response", listener);
  await page.goto("https://app.koper.com.br/suprimentos/entradas/", { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
  for (let attempt = 0; attempt < 12 && !transport; attempt += 1) await page.waitForTimeout(400);
  page.off("response", listener);
  if (!transport) throw new Error("KOPER_STOCK_TRANSPORT_NOT_CAPTURED");
  return transport;
}

function probeUrl(template: string, pathname: string, params: Record<string, string>): string {
  const source = new URL(template);
  const url = new URL(pathname, source.origin);
  const accessToken = source.searchParams.get("accessToken");
  if (accessToken) url.searchParams.set("accessToken", accessToken);
  url.searchParams.set("cb", String(Date.now()));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function shape(body: unknown): Json {
  if (Array.isArray(body)) return { type: "array", length: body.length, firstKeys: Object.keys(object(body[0]) ?? {}).sort() };
  const row = object(body);
  if (!row) return { type: body === null ? "null" : typeof body };
  return {
    type: "object",
    keys: Object.keys(row).sort(),
    arrays: Object.fromEntries(Object.entries(row).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, { length: (value as unknown[]).length, firstKeys: Object.keys(object((value as unknown[])[0]) ?? {}).sort() }])),
  };
}

try {
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
      } catch { /* ignore */ }
      await route.continue();
    });
    if (!await selectFlow(page)) return { ok: false, message: "KOPER_FLOW_COMPANY_NOT_SELECTED", blockedWrites };
    const transport = await captureStockTransport(page);
    const results: Json[] = [];
    for (const probe of probes) {
      try {
        const response = await page.request.get(probeUrl(transport.url, probe.pathname, probe.params), { headers: transport.headers, timeout: 3_000 });
        const contentType = response.headers()["content-type"] ?? "";
        const body = contentType.includes("json") ? await response.json().catch(() => null) : null;
        results.push({ label: probe.label, pathname: probe.pathname, status: response.status(), contentType, shape: shape(body) });
      } catch (error: unknown) {
        results.push({ label: probe.label, pathname: probe.pathname, error: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
      }
    }
    return { ok: true, readOnly: true, blockedWrites, probes: results };
  }, { sessionTimeoutMs: 58_000 });
  console.log("KOPER_RECEIPT_FAST_PROBE_RESULT", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_RECEIPT_FAST_PROBE_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 500) : "unknown" }));
}
await import("./index.js");
