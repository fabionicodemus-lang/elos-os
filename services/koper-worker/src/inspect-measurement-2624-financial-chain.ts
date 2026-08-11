import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Json : null;

function safe(value: unknown, prefix = "", depth = 0): Array<{ path: string; value: unknown }> {
  if (depth > 9) return [];
  if (Array.isArray(value)) return value.slice(0, 50).flatMap((x, i) => safe(x, `${prefix}[${i}]`, depth + 1));
  const row = obj(value); if (!row) return [];
  const out: Array<{ path: string; value: unknown }> = [];
  for (const [k, v] of Object.entries(row)) {
    if (/email|phone|address|cpf|cnpj|document|file|token|cookie|password|supplierName|supplier_name|user_name|comments?/i.test(k)) continue;
    const p = prefix ? `${prefix}.${k}` : k;
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      if (/id|code|cost|center|build|monitor|stock|order|request|contract|measurement|service|receipt|invoice|bill|chart|account|origin|type|apportion|allocation|purchase|entry|input|stage|item|amount|value|status|discount|interest|retention|tax|release|quantity|price|percent|date/i.test(k)) out.push({ path: p, value: v });
    } else if (v && (Array.isArray(v) || obj(v))) out.push(...safe(v, p, depth + 1));
  }
  return out;
}

async function pause(ms: number) { await new Promise(resolve => setTimeout(resolve, ms)); }

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

    const seedPromise = page.waitForResponse((response: Response) => {
      try {
        const url = new URL(response.url());
        return response.request().method() === "GET" && url.hostname === "api.koper.com.br" && url.pathname === "/financial/v1/bills_to_pay";
      } catch { return false; }
    }, { timeout: 20_000 }).catch(() => null);
    await page.goto("https://app.koper.com.br/financeiro/contas_pagar", { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    const seed = await seedPromise;
    if (!seed) return { ok: false, message: "SEED_NOT_FOUND", blockedWrites };

    const sourceHeaders = seed.request().headers();
    const headers: Record<string, string> = {};
    for (const key of ["accept", "origin", "referer", "x-accesstoken", "x-koper"]) if (sourceHeaders[key]) headers[key] = sourceHeaders[key]!;

    const calls: Array<Record<string, unknown>> = [];
    for (const billId of ["15955", "15961", "15962"]) {
      const url = new URL("https://api.koper.com.br/financial/v1/bills_to_pay");
      url.searchParams.set("billId", billId);
      const response = await page.request.get(url.toString(), { headers, timeout: 8_000 }).catch(() => null);
      const body = response ? await response.json().catch(() => null) : null;
      const row = obj(body);
      calls.push({
        kind: "bill",
        id: billId,
        status: response?.status() ?? 0,
        keys: Object.keys(row ?? {}).sort(),
        direct: row ? Object.fromEntries(Object.entries(row).filter(([key]) => /bill|origin|receipt|invoice|service|order|contract|measurement|release|tax|discount|interest|value|amount|father|join|allocation|cost|center|date|paid/i.test(key))) : null,
        evidence: safe(body).slice(0, 1000),
      });
      await pause(500);
    }

    const receiptUrl = new URL("https://api.koper.com.br/financial/v1/receipt");
    receiptUrl.searchParams.set("receiptId", "122");
    receiptUrl.searchParams.set("cb", String(Date.now()));
    const receiptResponse = await page.request.get(receiptUrl.toString(), { headers, timeout: 8_000 }).catch(() => null);
    const receiptBody = receiptResponse ? await receiptResponse.json().catch(() => null) : null;
    const receiptRow = obj(receiptBody);
    calls.push({
      kind: "receipt",
      id: "122",
      status: receiptResponse?.status() ?? 0,
      keys: Object.keys(receiptRow ?? {}).sort(),
      direct: receiptRow ? Object.fromEntries(Object.entries(receiptRow).filter(([key]) => /receipt|service|order|contract|measurement|build|monitor|purchase|bill|invoice|release|tax|discount|retention|value|amount|cost|center|date/i.test(key))) : null,
      evidence: safe(receiptBody).slice(0, 1400),
    });

    return { ok: true, readOnly: true, blockedWrites, calls };
  }, { sessionTimeoutMs: 58_000 });

  console.log("KOPER_MEASUREMENT_2624_FINANCIAL_CHAIN", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_MEASUREMENT_2624_FINANCIAL_CHAIN_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1000) : "unknown" }));
}
await import("./index.js");
