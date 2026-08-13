import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Json : null;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 8).map((v) => sanitize(v, depth + 1));
  const row = obj(value);
  if (!row) return value;
  const out: Json = {};
  for (const [key, val] of Object.entries(row)) {
    if (/password|token|secret|authorization/i.test(key)) continue;
    if (/supplier|provider|person|company|project|build|construction|cost|center|chart|account|origin|document|invoice|receipt|tax|bill|recType|payment|apportion|installment|description|name|id/i.test(key)) {
      out[key] = sanitize(val, depth + 1);
    }
  }
  return out;
}

try {
  const result = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ok: false, message: login.message };
    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const req = route.request();
      try {
        const url = new URL(req.url());
        const koper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (koper && !["GET", "HEAD", "OPTIONS"].includes(req.method()) && !isAllowedFlowSwitch(url, req.method(), req.postData())) {
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {}
      await route.continue();
    });
    if (!await selectFlow(page)) return { ok: false, message: "FLOW_NOT_SELECTED", blockedWrites };

    const listPromise = page.waitForResponse((response: Response) => {
      try { const u = new URL(response.url()); return response.request().method() === "GET" && u.hostname === "api.koper.com.br" && u.pathname === "/financial/v1/bills_to_pay" && !u.searchParams.has("billId"); } catch { return false; }
    }, { timeout: 20_000 }).catch(() => null);
    await page.goto("https://app.koper.com.br/financeiro/contas_pagar", { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    const seed = await listPromise;
    if (!seed) return { ok: false, message: "LIST_SEED_NOT_FOUND", blockedWrites };

    const seedHeaders = seed.request().headers();
    const headers: Record<string, string> = {};
    for (const key of ["accept", "origin", "referer", "x-accesstoken", "x-koper"]) if (seedHeaders[key]) headers[key] = seedHeaders[key];

    const listBody = obj(await seed.json().catch(() => null));
    const listRows = listBody && Array.isArray(listBody.bills) ? listBody.bills.map(obj).filter((v): v is Json => Boolean(v)) : [];
    const target = listRows.find((row) => row.billId) ?? null;
    if (!target) return { ok: false, message: "NO_TARGET", blockedWrites };
    const billId = String(target.billId);

    const detailUrl = new URL("https://api.koper.com.br/financial/v1/bills_to_pay");
    detailUrl.searchParams.set("billId", billId);
    detailUrl.searchParams.set("cb", String(Date.now()));
    const detailResponse = await page.request.get(detailUrl.toString(), { headers, timeout: 8_000 });
    if (!detailResponse.ok()) return { ok: false, message: "DETAIL_FAILED", status: detailResponse.status(), billId, blockedWrites };
    const raw = await detailResponse.json().catch(() => null);
    const detail = obj(raw);
    if (!detail) return { ok: false, message: "DETAIL_INVALID", billId, blockedWrites };

    return {
      ok: true,
      readOnly: true,
      blockedWrites,
      billId,
      topLevelKeys: Object.keys(detail).sort(),
      detail: sanitize(detail),
    };
  }, { sessionTimeoutMs: 45_000 });
  console.log("KOPER_PAYABLE_DETAIL_FIELDS_AUDIT", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_PAYABLE_DETAIL_FIELDS_AUDIT_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1000) : "unknown" }));
}
