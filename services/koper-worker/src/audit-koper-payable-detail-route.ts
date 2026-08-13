import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Json : null;
const text = (v: unknown): string | null => v === null || v === undefined ? null : String(v).trim() || null;

try {
  const result = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ok: false, message: login.message };

    let blockedWrites = 0;
    const observed: Array<{ method: string; status: number; url: string }> = [];

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

    page.on("response", (response: Response) => {
      try {
        const u = new URL(response.url());
        if (u.hostname === "api.koper.com.br" && u.pathname.startsWith("/financial/")) {
          observed.push({ method: response.request().method(), status: response.status(), url: `${u.origin}${u.pathname}${u.search}` });
        }
      } catch {}
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
    const body = obj(await seed.json().catch(() => null));
    const bills = body && Array.isArray(body.bills) ? body.bills.map(obj).filter((v): v is Json => Boolean(v)) : [];
    const target = bills.find((row) => text(row.originName)) ?? bills[0] ?? null;
    if (!target) return { ok: false, message: "NO_BILL_ROW", blockedWrites };

    const originName = text(target.originName);
    const billId = text(target.billId);
    const billToPayId = text(target.billToPayId);
    observed.length = 0;

    let clicked = false;
    if (originName) {
      const locator = page.getByText(originName, { exact: false }).first();
      if (await locator.count()) {
        clicked = await locator.click({ timeout: 5_000 }).then(() => true).catch(() => false);
      }
    }
    if (!clicked && billId) {
      const locator = page.getByText(billId, { exact: true }).first();
      if (await locator.count()) clicked = await locator.click({ timeout: 5_000 }).then(() => true).catch(() => false);
    }

    await page.waitForTimeout(2_500);

    const unique = new Map<string, { method: string; status: number; url: string }>();
    for (const item of observed) unique.set(`${item.method}:${item.url}`, item);
    return {
      ok: true,
      readOnly: true,
      blockedWrites,
      target: { billId, billToPayId, originName },
      clicked,
      pageUrl: page.url(),
      financialRequests: [...unique.values()].slice(0, 80),
    };
  }, { sessionTimeoutMs: 45_000 });

  console.log("KOPER_PAYABLE_DETAIL_ROUTE_AUDIT", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_PAYABLE_DETAIL_ROUTE_AUDIT_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1000) : "unknown" }));
}
