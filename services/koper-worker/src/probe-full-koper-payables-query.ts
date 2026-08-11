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
      try { const u = new URL(response.url()); return response.request().method() === "GET" && u.hostname === "api.koper.com.br" && u.pathname === "/financial/v1/bills_to_pay"; } catch { return false; }
    }, { timeout: 20_000 }).catch(() => null);
    await page.goto("https://app.koper.com.br/financeiro/contas_pagar", { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    const seed = await seedPromise;
    if (!seed) return { ok: false, message: "SEED_NOT_FOUND", blockedWrites };

    const base = new URL(seed.url());
    const variants = [
      { name: "har_exact_25_blank", limit: 25, dates: "blank" },
      { name: "25_omitted_dates", limit: 25, dates: "omit" },
      { name: "50_blank", limit: 50, dates: "blank" },
      { name: "100_blank", limit: 100, dates: "blank" },
      { name: "200_blank", limit: 200, dates: "blank" },
    ] as const;
    const probes: Json[] = [];
    for (const variant of variants) {
      const u = new URL(base);
      u.searchParams.set("allBills", "yes");
      u.searchParams.set("limit", String(variant.limit));
      u.searchParams.set("offset", "0");
      u.searchParams.set("orderFlag", "asc");
      u.searchParams.set("orderby", "dueDate");
      u.searchParams.set("typeDate", "dueDate");
      if (variant.dates === "blank") { u.searchParams.set("initialDate", ""); u.searchParams.set("finalDate", ""); }
      else { u.searchParams.delete("initialDate"); u.searchParams.delete("finalDate"); }
      const response = await page.request.get(u.toString(), { timeout: 8_000 });
      const body = obj(await response.json().catch(() => null));
      probes.push({
        name: variant.name,
        status: response.status(),
        ok: response.ok(),
        billsAmount: body?.billsAmount ?? null,
        totalBills: body?.totalBills ?? null,
        returned: Array.isArray(body?.bills) ? body.bills.length : null,
        keys: body ? Object.keys(body).sort() : [],
      });
    }
    return { ok: true, readOnly: true, blockedWrites, probes };
  }, { sessionTimeoutMs: 58_000 });
  console.log("KOPER_PAYABLE_QUERY_PROBE", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_PAYABLE_QUERY_PROBE_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1000) : "unknown" }));
}
await import("./index.js");
