import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  console.log("KOPER_MEASUREMENT_YEAR_FILTER_START");
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
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {}
      await route.continue();
    });

    if (!await selectFlow(page)) return { ok: false, message: "FLOW_NOT_SELECTED", blockedWrites };

    const calls: string[] = [];
    page.on("response", (response: Response) => {
      try {
        const req = response.request();
        const u = new URL(response.url());
        if (req.method() === "GET" && u.hostname === "api.koper.com.br" && u.pathname === "/engineering/v1/build_measurement") {
          u.searchParams.delete("accessToken");
          u.searchParams.delete("cb");
          calls.push(`${u.pathname}?${u.searchParams.toString()}`);
        }
      } catch {}
    });

    await page.goto("https://app.koper.com.br/engenharia/medicoes/finalizadas", { waitUntil: "domcontentloaded", timeout: 20_000 });
    await sleep(4_000);

    const controls = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>("select,input,button,[role='button'],a"));
      return nodes.map((el, index) => {
        const r = el.getBoundingClientRect();
        const text = (el.innerText || (el as HTMLInputElement).value || "").replace(/\s+/g, " ").trim();
        const options = el instanceof HTMLSelectElement ? Array.from(el.options).map(o => ({ text: o.text, value: o.value, selected: o.selected })) : undefined;
        return {
          index,
          tag: el.tagName.toLowerCase(),
          text: text.slice(0, 120),
          name: el.getAttribute("name"),
          id: el.id || null,
          className: String(el.className || "").slice(0, 200),
          ariaLabel: el.getAttribute("aria-label"),
          title: el.getAttribute("title"),
          x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height),
          visible: r.width > 0 && r.height > 0,
          options,
        };
      }).filter(x => x.visible && x.y < 350);
    });

    console.log("KOPER_MEASUREMENT_YEAR_CONTROLS", JSON.stringify(controls));

    // Try changing only the date-period select if one has year-like options.
    const selects = page.locator("select");
    const selectCount = await selects.count();
    const actions: Array<Record<string, unknown>> = [];
    for (let i = 0; i < selectCount; i++) {
      const sel = selects.nth(i);
      const opts = await sel.locator("option").allTextContents().catch(() => []);
      if (!opts.some(t => /2024|2025|2026/.test(t))) continue;
      const values = await sel.locator("option").evaluateAll((els) => els.map((e) => ({ text: (e.textContent || "").trim(), value: (e as HTMLOptionElement).value })));
      const target = values.find(v => /2024/.test(v.text));
      if (!target) continue;
      const before = calls.length;
      await sel.selectOption(target.value).catch(() => undefined);
      await sleep(4_000);
      actions.push({ selectIndex: i, target, newCalls: calls.slice(before) });
    }

    return { ok: true, readOnly: true, blockedWrites, currentUrl: page.url(), calls, actions };
  }, { sessionTimeoutMs: 90_000 });
  console.log("KOPER_MEASUREMENT_YEAR_FILTER_RESULT", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_MEASUREMENT_YEAR_FILTER_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000) }));
}

await import("./index.js");
