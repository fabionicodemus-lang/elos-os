import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : null;
const ids = ["16081", "16083", "16088", "16089", "16090"];

function relevant(value: unknown, prefix = "", depth = 0): Array<{ path: string; value: unknown }> {
  if (depth > 7) return [];
  if (Array.isArray(value)) return value.slice(0, 20).flatMap((item, index) => relevant(item, `${prefix}[${index}]`, depth + 1));
  const row = obj(value); if (!row) return [];
  const out: Array<{ path: string; value: unknown }> = [];
  for (const [key, child] of Object.entries(row)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child === null || typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
      if (/date|time|created|updated|issue|due|payment|origin|receipt|invoice|service|order|request|contract|measure|monitor|release|cost|center|bill|id$/i.test(key)) out.push({ path, value: child });
    } else if (child && (Array.isArray(child) || obj(child))) out.push(...relevant(child, path, depth + 1));
  }
  return out;
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
          blockedWrites += 1; await route.abort("blockedbyclient"); return;
        }
      } catch {}
      await route.continue();
    });
    if (!await selectFlow(page)) return { ok: false, message: "FLOW_NOT_SELECTED", blockedWrites };

    const seedPromise = page.waitForResponse((response: Response) => {
      try { const u = new URL(response.url()); return response.request().method() === "GET" && u.hostname === "api.koper.com.br" && u.pathname === "/financial/v1/bills_to_pay"; }
      catch { return false; }
    }, { timeout: 20_000 }).catch(() => null);
    await page.goto("https://app.koper.com.br/financeiro/contas_pagar", { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    const seed = await seedPromise;
    if (!seed) return { ok: false, message: "SEED_NOT_FOUND", blockedWrites };
    const sourceHeaders = seed.request().headers();
    const headers: Record<string, string> = {};
    for (const key of ["accept", "origin", "referer", "x-accesstoken", "x-koper"]) if (sourceHeaders[key]) headers[key] = sourceHeaders[key]!;

    const details = [];
    for (const billId of ids) {
      const url = new URL("https://api.koper.com.br/financial/v1/bills_to_pay");
      url.searchParams.set("billId", billId);
      const response = await page.request.get(url.toString(), { headers, timeout: 8_000 });
      const body = await response.json().catch(() => null);
      const row = obj(body);
      details.push({
        billId,
        status: response.status(),
        topLevelKeys: Object.keys(row ?? {}).sort(),
        direct: row ? Object.fromEntries(Object.entries(row).filter(([key]) => /date|time|created|updated|issue|due|payment|origin|receipt|invoice|service|order|contract|measure|release|cost|center|bill/i.test(key))) : null,
        evidence: relevant(body).slice(0, 400),
      });
    }
    return { ok: true, readOnly: true, blockedWrites, details };
  }, { sessionTimeoutMs: 58_000 });
  console.log("KOPER_PAYABLE_SNAPSHOT_DELTA_DETAILS", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_PAYABLE_SNAPSHOT_DELTA_DETAILS_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1000) : "unknown" }));
}
await import("./index.js");
