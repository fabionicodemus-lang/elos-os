import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const object = (value: unknown): Json | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : null;

function shape(value: unknown): Json {
  if (Array.isArray(value)) return { type: "array", length: value.length, firstKeys: Object.keys(object(value[0]) ?? {}).sort() };
  const row = object(value);
  return row ? { type: "object", keys: Object.keys(row).sort(), arrays: Object.fromEntries(Object.entries(row).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length])) } : { type: typeof value };
}

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
    const pending: Promise<void>[] = [];
    const onResponse = (response: Response): void => {
      try {
        const url = new URL(response.url());
        if (response.request().method() !== "GET" || url.hostname !== "api.koper.com.br") return;
        const task = (async () => {
          const contentType = response.headers()["content-type"] ?? "";
          const body = contentType.includes("json") ? await response.json().catch(() => null) : null;
          calls.push({
            path: url.pathname,
            status: response.status(),
            queryKeys: [...url.searchParams.keys()].filter((key) => !/token|auth/i.test(key)).sort(),
            query: Object.fromEntries([...url.searchParams.entries()].filter(([key]) => !/token|auth|cb/i.test(key))),
            response: shape(body),
          });
        })();
        pending.push(task);
      } catch {}
    };

    page.on("response", onResponse);
    await page.goto("https://app.koper.com.br/suprimentos/entradas/view/180", { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    await page.waitForTimeout(8_000);
    page.off("response", onResponse);
    await Promise.allSettled(pending);

    const unique = [...new Map(calls.map((call) => [`${call.path}?${JSON.stringify(call.query)}`, call])).values()];
    return { ok: true, readOnly: true, flowSelected: true, blockedWrites, finalUrl: page.url(), calls: unique };
  }, { sessionTimeoutMs: 42_000 });
  console.log("KOPER_ENTRY_180_NETWORK_RESULT", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_ENTRY_180_NETWORK_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1000) : "unknown" }));
}

await import("./index.js");
