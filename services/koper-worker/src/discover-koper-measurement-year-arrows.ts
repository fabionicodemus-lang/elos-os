import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  console.log("KOPER_MEASUREMENT_YEAR_ARROWS_START");
  const result = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ok: false, message: login.message };
    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const req = route.request();
      try {
        const u = new URL(req.url());
        const isKoper = u.hostname === "koper.com.br" || u.hostname.endsWith(".koper.com.br");
        if (isKoper && !["GET", "HEAD", "OPTIONS"].includes(req.method()) && !isAllowedFlowSwitch(u, req.method(), req.postData())) {
          blockedWrites++;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {}
      await route.continue();
    });
    if (!await selectFlow(page)) return { ok: false, message: "FLOW_NOT_SELECTED", blockedWrites };

    const calls: Array<Record<string, unknown>> = [];
    page.on("response", async (resp) => {
      try {
        const req = resp.request();
        const u = new URL(resp.url());
        if (req.method() !== "GET" || u.hostname !== "api.koper.com.br" || u.pathname !== "/engineering/v1/build_measurement") return;
        u.searchParams.delete("accessToken"); u.searchParams.delete("cb"); u.searchParams.delete("appVersion"); u.searchParams.delete("visited-page");
        const body = await resp.json().catch(() => null) as any;
        calls.push({ url: `${u.pathname}?${u.searchParams.toString()}`, itemsAmount: body?.itemsAmount ?? null, returned: Array.isArray(body?.measurements) ? body.measurements.length : null, firstDate: body?.measurements?.[0]?.measurementDate ?? null, lastDate: body?.measurements?.at?.(-1)?.measurementDate ?? null });
      } catch {}
    });

    await page.goto("https://app.koper.com.br/engenharia/medicoes/finalizadas", { waitUntil: "domcontentloaded", timeout: 20_000 });
    await sleep(4_000);
    const arrowButtons = page.locator("button.input-default");
    const count = await arrowButtons.count();
    const steps: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 3; i++) {
      if (count < 2) break;
      const before = calls.length;
      await arrowButtons.nth(0).click({ timeout: 5_000 }).catch(() => undefined);
      await sleep(3_000);
      const periodText = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll<HTMLElement>("body *"));
        const candidates = els.filter(el => {
          const r = el.getBoundingClientRect();
          const t = (el.innerText || "").replace(/\s+/g," ").trim();
          return r.width > 0 && r.height > 0 && r.x >= 480 && r.x <= 680 && r.y >= 135 && r.y <= 185 && t.length > 0 && t.length < 80;
        });
        return candidates.map(el => ({ tag: el.tagName.toLowerCase(), text: (el.innerText || "").replace(/\s+/g," ").trim(), className: String(el.className || "").slice(0,120) })).slice(0,20);
      });
      steps.push({ step: i + 1, periodText, newCalls: calls.slice(before) });
    }
    return { ok: true, readOnly: true, blockedWrites, calls, steps };
  }, { sessionTimeoutMs: 90_000 });
  console.log("KOPER_MEASUREMENT_YEAR_ARROWS_RESULT", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_MEASUREMENT_YEAR_ARROWS_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0,1000) : String(error).slice(0,1000) }));
}
await import("./index.js");
