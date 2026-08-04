import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const object = (value: unknown): Json | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : null;

function scalarIds(value: unknown, prefix = "", depth = 0): Array<{ path: string; value: string }> {
  if (depth > 4) return [];
  if (Array.isArray(value)) return value.slice(0, 30).flatMap((item, i) => scalarIds(item, `${prefix}[${i}]`, depth + 1));
  const row = object(value);
  if (!row) return [];
  const result: Array<{ path: string; value: string }> = [];
  for (const [key, child] of Object.entries(row)) {
    if (/token|cookie|authorization|password/i.test(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string" || typeof child === "number") {
      const text = String(child).trim();
      if (text && /id|number|seq|code|order|receipt|product|movement|request|amount|quantity|invoice|note/i.test(key)) result.push({ path, value: text });
    } else if (child && (Array.isArray(child) || object(child))) result.push(...scalarIds(child, path, depth + 1));
  }
  return result;
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
        pending.push((async () => {
          const contentType = response.headers()["content-type"] ?? "";
          const body = contentType.includes("json") ? await response.json().catch(() => null) : null;
          const row = object(body);
          calls.push({
            path: url.pathname,
            status: response.status(),
            query: Object.fromEntries([...url.searchParams.entries()].filter(([key]) => !/token|auth|cb/i.test(key))),
            keys: row ? Object.keys(row).sort() : [],
            arrays: row ? Object.fromEntries(Object.entries(row).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, { length: (v as unknown[]).length, firstKeys: Object.keys(object((v as unknown[])[0]) ?? {}).sort() }])) : {},
            scalarIds: scalarIds(body).slice(0, 180),
          });
        })());
      } catch {}
    };
    page.on("response", onResponse);
    await page.goto("https://app.koper.com.br/financeiro/notas_manuais/view/458", { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    await page.waitForTimeout(7_000);
    page.off("response", onResponse);
    await Promise.allSettled(pending);
    const unique = [...new Map(calls.map((call) => [`${call.path}?${JSON.stringify(call.query)}`, call])).values()];
    return { ok: true, readOnly: true, flowSelected: true, blockedWrites, finalUrl: page.url(), calls: unique };
  }, { sessionTimeoutMs: 43_000 });
  console.log("KOPER_MANUAL_NOTE_458_NETWORK_RESULT", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_MANUAL_NOTE_458_NETWORK_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1000) : "unknown" }));
}

await import("./index.js");
