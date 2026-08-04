import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;

const safeText = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, 180);

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
      } catch { /* ignore */ }
      await route.continue();
    });

    if (!await selectFlow(page)) return { ok: false, message: "KOPER_FLOW_COMPANY_NOT_SELECTED", blockedWrites };

    const reads: Json[] = [];
    const pending: Promise<void>[] = [];
    const listener = (response: Response): void => {
      try {
        const url = new URL(response.url());
        if (response.request().method() !== "GET" || url.hostname !== "api.koper.com.br") return;
        pending.push((async () => {
          const contentType = response.headers()["content-type"] ?? "";
          let keys: string[] = [];
          let arrayFields: string[] = [];
          if (contentType.includes("json")) {
            const body: unknown = await response.json().catch(() => null);
            if (body && typeof body === "object" && !Array.isArray(body)) {
              const row = body as Record<string, unknown>;
              keys = Object.keys(row).sort().slice(0, 100);
              arrayFields = Object.entries(row).filter(([, value]) => Array.isArray(value)).map(([key]) => key).sort();
            }
          }
          reads.push({ pathname: url.pathname, status: response.status(), queryKeys: [...url.searchParams.keys()].filter((key) => !/token/i.test(key)).sort(), keys, arrayFields });
        })().catch(() => undefined));
      } catch { /* ignore */ }
    };
    page.on("response", listener);

    await page.goto("https://app.koper.com.br/suprimentos/entradas/view/180", { waitUntil: "domcontentloaded", timeout: 18_000 }).catch(() => undefined);
    await page.waitForTimeout(4_000);

    const before = await page.evaluate(() => {
      const text = (element: Element): string => (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
      return {
        url: location.href,
        title: document.title,
        bodyText: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 4000),
        anchors: [...document.querySelectorAll("a")].map((element) => ({ text: text(element), href: (element as HTMLAnchorElement).href })).filter((row) => row.text || row.href).slice(0, 200),
        buttons: [...document.querySelectorAll("button,[role=button]")].map((element) => ({ text: text(element), aria: element.getAttribute("aria-label"), title: element.getAttribute("title") })).filter((row) => row.text || row.aria || row.title).slice(0, 200),
      };
    });

    const candidates = page.locator("a,button,[role=button]").filter({ hasText: /recibo|recebimento|receipt|458/i });
    const candidateCount = await candidates.count();
    const clicked: Json[] = [];
    for (let index = 0; index < Math.min(candidateCount, 5); index += 1) {
      const element = candidates.nth(index);
      const label = safeText(await element.innerText().catch(() => ""));
      const href = await element.getAttribute("href").catch(() => null);
      clicked.push({ index, label, href });
      await element.click({ timeout: 2_000 }).catch(() => undefined);
      await page.waitForTimeout(1_500);
    }

    await Promise.allSettled(pending);
    page.off("response", listener);

    const uniqueReads = [...new Map(reads.map((row) => [`${String(row.pathname)}:${JSON.stringify(row.queryKeys)}`, row])).values()];
    return {
      ok: true,
      readOnly: true,
      blockedWrites,
      before: { ...before, bodyText: safeText(before.bodyText) },
      candidateCount,
      clicked,
      finalUrl: page.url(),
      apiReads: uniqueReads,
    };
  }, { sessionTimeoutMs: 58_000 });
  console.log("KOPER_ENTRY_RECEIPT_UI_RESULT", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_ENTRY_RECEIPT_UI_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 600) : "unknown" }));
}
await import("./index.js");
