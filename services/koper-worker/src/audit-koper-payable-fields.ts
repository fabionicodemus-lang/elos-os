import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Json : null;

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

    const seedPromise = page.waitForResponse((response: Response) => {
      try {
        const u = new URL(response.url());
        return response.request().method() === "GET" && u.hostname === "api.koper.com.br" && u.pathname === "/financial/v1/bills_to_pay";
      } catch { return false; }
    }, { timeout: 20_000 }).catch(() => null);

    await page.goto("https://app.koper.com.br/financeiro/contas_pagar", { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    const seed = await seedPromise;
    if (!seed) return { ok: false, message: "PAYABLE_SEED_NOT_FOUND", blockedWrites };

    const seedHeaders = seed.request().headers();
    const headers: Record<string, string> = {};
    for (const key of ["accept", "origin", "referer", "x-accesstoken", "x-koper"]) if (seedHeaders[key]) headers[key] = seedHeaders[key];

    const url = new URL(seed.url());
    url.searchParams.set("allBills", "yes");
    url.searchParams.set("initialDate", "");
    url.searchParams.set("finalDate", "");
    url.searchParams.set("limit", "5");
    url.searchParams.set("offset", "0");
    url.searchParams.set("orderby", "dueDate");
    url.searchParams.set("orderFlag", "desc");
    url.searchParams.set("typeDate", "dueDate");
    url.searchParams.set("cb", String(Date.now()));

    const response = await page.request.get(url.toString(), { headers, timeout: 8_000 });
    if (!response.ok()) return { ok: false, message: "PAGE_FAILED", status: response.status(), blockedWrites };
    const body = obj(await response.json().catch(() => null));
    if (!body) return { ok: false, message: "INVALID_BODY", blockedWrites };
    const bills = Array.isArray(body.bills) ? body.bills.map(obj).filter((v): v is Json => Boolean(v)) : [];
    const keys = [...new Set(bills.flatMap((row) => Object.keys(row)))].sort();
    const candidate = /supplier|provider|person|client|name|company|project|build|construction|cost|center|account|origin|document|invoice|receipt|tax|bill|recType|payment/i;
    const samples = bills.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => candidate.test(key))));

    return { ok: true, readOnly: true, blockedWrites, keys, samples };
  }, { sessionTimeoutMs: 45_000 });

  console.log("KOPER_PAYABLE_FIELD_AUDIT", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_PAYABLE_FIELD_AUDIT_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1000) : "unknown" }));
}
