import type { Page, Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
type Transport = { url: string; headers: Record<string, string> };

type Probe = {
  label: string;
  pathname: string;
  params: Record<string, string>;
};

const probes: Probe[] = [
  { label: "stock_receipt_458", pathname: "/stock/v1/receipt", params: { receiptId: "458" } },
  { label: "stock_receipt_1329", pathname: "/stock/v1/receipt", params: { receiptId: "1329" } },
  { label: "stock_receipt_number_2905", pathname: "/stock/v1/receipt", params: { receiptNumber: "2905" } },
  { label: "stock_product_receipt_458", pathname: "/stock/v1/product_receipt", params: { receiptId: "458" } },
  { label: "stock_product_receipt_1329", pathname: "/stock/v1/product_receipt", params: { receiptId: "1329" } },
  { label: "stock_receipt_product_458", pathname: "/stock/v1/receipt_product", params: { receiptId: "458" } },
  { label: "stock_receipt_entry_458", pathname: "/stock/v1/receipt_entry", params: { receiptId: "458" } },
  { label: "stock_product_entry_receipt_458", pathname: "/stock/v1/product_entry_receipt", params: { receiptId: "458" } },
  { label: "purchase_receipt_458", pathname: "/purchase/v1/receipt", params: { receiptId: "458" } },
  { label: "purchase_product_receipt_458", pathname: "/purchase/v1/product_receipt", params: { receiptId: "458" } },
  { label: "stock_entry_180_receipt", pathname: "/stock/v1/entry_receipt", params: { entryId: "180" } },
];

const object = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Json
    : null;

const identifier = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
};

function allowedHeaders(headers: Record<string, string>): Record<string, string> {
  const allowed = new Set([
    "accept", "accept-language", "cache-control", "cookie", "origin", "referer",
    "user-agent", "x-accesstoken", "x-koper",
  ]);
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => allowed.has(key.toLowerCase())),
  );
}

async function captureStockTransport(page: Page): Promise<Transport> {
  let captured: Transport | null = null;
  const listener = (response: Response): void => {
    try {
      const url = new URL(response.url());
      if (
        !captured
        && response.request().method() === "GET"
        && url.hostname === "api.koper.com.br"
        && url.pathname.startsWith("/stock/v1/")
      ) {
        captured = {
          url: response.url(),
          headers: allowedHeaders(response.request().headers()),
        };
      }
    } catch {
      // Ignore malformed URLs.
    }
  };

  page.on("response", listener);
  await page.goto("https://app.koper.com.br/suprimentos/entradas/", {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  }).catch(() => undefined);
  for (let attempt = 0; attempt < 12 && !captured; attempt += 1) {
    await page.waitForTimeout(500);
  }
  page.off("response", listener);
  const result = captured as Transport | null;
  if (!result) throw new Error("KOPER_STOCK_TRANSPORT_NOT_CAPTURED");
  return result;
}

function probeUrl(template: string, probe: Probe): string {
  const url = new URL(template);
  url.pathname = probe.pathname;
  const accessToken = url.searchParams.get("accessToken");
  url.search = "";
  if (accessToken) url.searchParams.set("accessToken", accessToken);
  url.searchParams.set("cb", String(Date.now()));
  for (const [key, value] of Object.entries(probe.params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function scalarIds(value: unknown, prefix = "", depth = 0): Array<{ path: string; value: string }> {
  if (depth > 4) return [];
  if (Array.isArray(value)) {
    return value.slice(0, 30).flatMap((item, index) =>
      scalarIds(item, `${prefix}[${index}]`, depth + 1));
  }
  const row = object(value);
  if (!row) return [];
  const result: Array<{ path: string; value: string }> = [];
  for (const [key, child] of Object.entries(row)) {
    if (/token|cookie|authorization|password/i.test(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string" || typeof child === "number") {
      const scalar = identifier(child);
      if (scalar && /id|number|seq|code|order|receipt|product|movement|request|amount|quantity/i.test(key)) {
        result.push({ path, value: scalar });
      }
    } else if (child && (Array.isArray(child) || object(child))) {
      result.push(...scalarIds(child, path, depth + 1));
    }
  }
  return result;
}

function responseShape(body: unknown): Json {
  if (Array.isArray(body)) {
    const first = body[0];
    return {
      type: "array",
      length: body.length,
      firstKeys: Object.keys(object(first) ?? {}).sort(),
      scalarIds: scalarIds(first).slice(0, 100),
    };
  }
  const row = object(body);
  if (row) {
    return {
      type: "object",
      keys: Object.keys(row).sort(),
      scalarIds: scalarIds(row).slice(0, 150),
      arrayFields: Object.fromEntries(
        Object.entries(row)
          .filter(([, value]) => Array.isArray(value))
          .map(([key, value]) => [key, {
            length: (value as unknown[]).length,
            firstKeys: Object.keys(object((value as unknown[])[0]) ?? {}).sort(),
          }]),
      ),
    };
  }
  return { type: typeof body };
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
        // Ignore malformed URLs.
      }
      await route.continue();
    });

    const flowSelected = await selectFlow(page);
    if (!flowSelected) {
      return { ok: false, message: "KOPER_FLOW_COMPANY_NOT_SELECTED", blockedWrites };
    }
    const transport = await captureStockTransport(page);
    const results: Json[] = [];

    for (const probe of probes) {
      try {
        const response = await page.request.get(probeUrl(transport.url, probe), {
          headers: transport.headers,
          timeout: 8_000,
        });
        const contentType = response.headers()["content-type"] ?? "";
        const body = contentType.includes("json")
          ? await response.json().catch(() => null)
          : null;
        results.push({
          label: probe.label,
          pathname: probe.pathname,
          params: probe.params,
          status: response.status(),
          contentType,
          shape: responseShape(body),
        });
      } catch (error: unknown) {
        results.push({
          label: probe.label,
          pathname: probe.pathname,
          params: probe.params,
          error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
        });
      }
    }

    return {
      ok: true,
      readOnly: true,
      flowSelected: true,
      blockedWrites,
      probes: results,
    };
  }, { sessionTimeoutMs: 58_000 });

  console.log("KOPER_RECEIPT_ENDPOINT_PROBE_RESULT", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_RECEIPT_ENDPOINT_PROBE_FAILED", JSON.stringify({
    message: error instanceof Error ? error.message.slice(0, 1_500) : "unknown",
  }));
}

await import("./index.js");
