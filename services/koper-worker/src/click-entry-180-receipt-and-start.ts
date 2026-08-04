import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;

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
        if (isKoper && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !isAllowedFlowSwitch(url, request.method(), request.postData())) {
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {}
      await route.continue();
    });

    const flowSelected = await selectFlow(page);
    if (!flowSelected) return { ok: false, message: "KOPER_FLOW_COMPANY_NOT_SELECTED", blockedWrites };

    const calls: Json[] = [];
    const onResponse = (response: Response): void => {
      try {
        const url = new URL(response.url());
        if (response.request().method() !== "GET" || url.hostname !== "api.koper.com.br") return;
        calls.push({
          path: url.pathname,
          status: response.status(),
          query: Object.fromEntries([...url.searchParams.entries()].filter(([key]) => !/token|auth|cb/i.test(key))),
        });
      } catch {}
    };
    page.on("response", onResponse);

    await page.goto("https://app.koper.com.br/suprimentos/entradas/view/180", { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    await page.waitForTimeout(4_000);

    const candidates = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("a,button,[role='button'],td,span,div")];
      return nodes.flatMap((node, index) => {
        const element = node as HTMLElement;
        const text = (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ");
        const href = element instanceof HTMLAnchorElement ? element.href : null;
        if (!text || (!/458|2905|recibo|receb/i.test(text) && !/receipt|receb/i.test(href || ""))) return [];
        return [{ index, tag: element.tagName, text: text.slice(0, 180), href, role: element.getAttribute("role"), className: element.className?.toString().slice(0, 180) ?? "" }];
      }).slice(0, 80);
    });

    const preferred = page.locator("a,button,[role='button']").filter({ hasText: /458|2905|recibo|receb/i }).first();
    let clicked = false;
    let clickError: string | null = null;
    if (await preferred.count()) {
      try {
        await preferred.click({ timeout: 4_000 });
        clicked = true;
        await page.waitForTimeout(4_000);
      } catch (error: unknown) {
        clickError = error instanceof Error ? error.message.slice(0, 500) : "unknown";
      }
    }

    page.off("response", onResponse);
    return { ok: true, readOnly: true, flowSelected: true, blockedWrites, candidates, clicked, clickError, finalUrl: page.url(), calls };
  }, { sessionTimeoutMs: 44_000 });

  console.log("KOPER_ENTRY_180_RECEIPT_CLICK_RESULT", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_ENTRY_180_RECEIPT_CLICK_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1000) : "unknown" }));
}

await import("./index.js");
