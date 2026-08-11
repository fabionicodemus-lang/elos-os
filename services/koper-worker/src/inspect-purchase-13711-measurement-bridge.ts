import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Json : null;

function evidence(value: unknown, prefix = "", depth = 0): Array<{ path: string; value: unknown }> {
  if (depth > 10) return [];
  if (Array.isArray(value)) return value.slice(0, 100).flatMap((x, i) => evidence(x, `${prefix}[${i}]`, depth + 1));
  const row = obj(value); if (!row) return [];
  const out: Array<{ path: string; value: unknown }> = [];
  for (const [key, child] of Object.entries(row)) {
    if (/name|description|comment|address|email|phone|document|cnpj|cpf|token|cookie|file|url|user/i.test(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (child === null || typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
      if (/id|status|state|type|date|amount|value|price|total|quantity|number|sequence|order|request|budget|purchase|stock|movement|entry|invoice|receipt|contract|measurement|monitor|service|stage|release|cost|center|allocation|apportion|discount|deduction|retention|tax|withheld|percent|reference|paid|open|closed|cancel/i.test(key)) out.push({ path, value: child });
    } else if (child && (Array.isArray(child) || obj(child))) out.push(...evidence(child, path, depth + 1));
  }
  return out;
}

function arrays(value: unknown, prefix = "", depth = 0): Array<{ path: string; length: number; firstKeys: string[] }> {
  if (depth > 7) return [];
  if (Array.isArray(value)) {
    const first = obj(value[0]);
    const current = [{ path: prefix || "(root)", length: value.length, firstKeys: Object.keys(first ?? {}).sort() }];
    return first ? current.concat(Object.entries(first).flatMap(([key, child]) => arrays(child, `${prefix}[0].${key}`, depth + 1))) : current;
  }
  const row = obj(value); if (!row) return [];
  return Object.entries(row).flatMap(([key, child]) => arrays(child, prefix ? `${prefix}.${key}` : key, depth + 1));
}

try {
  const result = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ok: false, message: login.message };
    let blockedWrites = 0;
    await page.route("**/*", async route => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const koper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (koper && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !isAllowedFlowSwitch(url, request.method(), request.postData())) {
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {}
      await route.continue();
    });
    if (!await selectFlow(page)) return { ok: false, message: "FLOW_NOT_SELECTED", blockedWrites };

    let headers: Record<string, string> | null = null;
    const seedPromise = page.waitForResponse((response: Response) => {
      try {
        const url = new URL(response.url());
        return response.request().method() === "GET" && url.hostname === "api.koper.com.br" && url.pathname.startsWith("/supply/v2/purchases/details/");
      } catch { return false; }
    }, { timeout: 20_000 }).catch(() => null);
    await page.goto("https://web.koper.com.br/suprimentos/compras/13711", { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
    const seed = await seedPromise;
    if (seed) headers = seed.request().headers();
    if (!headers) return { ok: false, message: "PURCHASE_HEADERS_NOT_CAPTURED", blockedWrites, finalUrl: page.url() };

    const response = await page.request.get("https://api.koper.com.br/supply/v2/purchases/details/13711", { headers, timeout: 12_000 });
    const body = await response.json().catch(() => null);
    const row = obj(body);

    return {
      ok: true,
      readOnly: true,
      blockedWrites,
      status: response.status(),
      purchaseId: 13711,
      topLevelKeys: Object.keys(row ?? {}).sort(),
      arrayShapes: arrays(body),
      evidence: evidence(body).slice(0, 2500),
    };
  }, { sessionTimeoutMs: 58_000 });
  console.log("KOPER_PURCHASE_13711_MEASUREMENT_BRIDGE", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_PURCHASE_13711_MEASUREMENT_BRIDGE_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1000) : "unknown" }));
}
await import("./index.js");
