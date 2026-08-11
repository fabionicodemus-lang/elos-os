import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Json : null;
function shape(v: unknown): Json {
  if (Array.isArray(v)) return { type: "array", length: v.length, firstKeys: Object.keys(obj(v[0]) ?? {}).sort() };
  const r = obj(v);
  return r ? { type: "object", keys: Object.keys(r).sort(), arrays: Object.fromEntries(Object.entries(r).filter(([, x]) => Array.isArray(x)).map(([k, x]) => [k, { length: (x as unknown[]).length, firstKeys: Object.keys(obj((x as unknown[])[0]) ?? {}).sort() }])) } : { type: typeof v };
}
function ev(v: unknown, prefix = "", depth = 0): Array<{ path: string; value: unknown }> {
  if (depth > 8) return [];
  if (Array.isArray(v)) return v.slice(0, 30).flatMap((x, i) => ev(x, `${prefix}[${i}]`, depth + 1));
  const r = obj(v); if (!r) return [];
  const out: Array<{ path: string; value: unknown }> = [];
  for (const [k, x] of Object.entries(r)) {
    if (/email|phone|address|cpf|cnpj|document|file|token|cookie|password|comment|text/i.test(k)) continue;
    const p = prefix ? `${prefix}.${k}` : k;
    if (x === null || typeof x === "string" || typeof x === "number" || typeof x === "boolean") {
      if (/id|code|status|value|amount|contract|measure|service|stage|cost|center|build|monitor|supplier|bill|pay|order|receipt|invoice|item|release|quantity|price|percent|total|reference/i.test(k)) out.push({ path: p, value: x });
    } else if (x && (Array.isArray(x) || obj(x))) out.push(...ev(x, p, depth + 1));
  }
  return out;
}

try {
  const result = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ok: false, message: login.message };
    let blockedWrites = 0;
    await page.route("**/*", async route => {
      const r = route.request();
      try {
        const u = new URL(r.url());
        const koper = u.hostname === "koper.com.br" || u.hostname.endsWith(".koper.com.br");
        if (koper && !["GET", "HEAD", "OPTIONS"].includes(r.method()) && !isAllowedFlowSwitch(u, r.method(), r.postData())) {
          blockedWrites += 1; await route.abort("blockedbyclient"); return;
        }
      } catch {}
      await route.continue();
    });
    if (!await selectFlow(page)) return { ok: false, message: "FLOW_NOT_SELECTED", blockedWrites };
    await page.goto("https://app.koper.com.br/engenharia/medicoes", { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(5_000);

    const row = page.locator("tr").filter({ hasText: /(^|\s)238(\s|$)/ }).first();
    const rowCount = await row.count().catch(() => 0);
    const rowInfo = rowCount ? await row.evaluate((el) => ({
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 1500),
      html: el.outerHTML.slice(0, 5000),
      clickables: Array.from(el.querySelectorAll<HTMLElement>("a,button,[role='button'],[role='link'],[tabindex]")).map((n) => ({
        tag: n.tagName.toLowerCase(),
        text: (n.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
        href: n instanceof HTMLAnchorElement ? n.href : n.getAttribute("href"),
        role: n.getAttribute("role"),
        aria: n.getAttribute("aria-label"),
        title: n.getAttribute("title"),
      })),
    })).catch(() => null) : null;

    const calls: Json[] = []; const pending: Promise<void>[] = [];
    const onResponse = (response: Response) => {
      try {
        const u = new URL(response.url());
        if (response.request().method() !== "GET" || u.hostname !== "api.koper.com.br") return;
        const task = (async () => {
          const ct = response.headers()["content-type"] ?? "";
          const body = ct.includes("json") ? await response.json().catch(() => null) : null;
          calls.push({ path: u.pathname, status: response.status(), query: Object.fromEntries([...u.searchParams.entries()].filter(([k]) => !/token|auth|cb/i.test(k))), response: shape(body), evidence: ev(body).slice(0, 800) });
        })(); pending.push(task);
      } catch {}
    };
    page.on("response", onResponse);

    let clicked = false; let clickMethod = "none";
    if (rowCount) {
      const clickable = row.locator("a,button,[role='button'],[role='link']").first();
      if (await clickable.count().catch(() => 0)) {
        clicked = await clickable.click({ timeout: 5_000 }).then(() => true).catch(() => false);
        clickMethod = "row-clickable";
      }
      if (!clicked) {
        clicked = await row.click({ timeout: 5_000 }).then(() => true).catch(() => false);
        clickMethod = "row";
      }
    }
    if (!clicked) {
      const text238 = page.getByText(/^238$/).first();
      if (await text238.count().catch(() => 0)) {
        clicked = await text238.click({ timeout: 5_000 }).then(() => true).catch(() => false);
        clickMethod = "text-238";
      }
    }

    await page.waitForTimeout(8_000);
    page.off("response", onResponse); await Promise.allSettled(pending);
    return {
      ok: true, readOnly: true, blockedWrites, rowCount, rowInfo, clicked, clickMethod,
      finalUrl: page.url(),
      body: (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 5000),
      calls: [...new Map(calls.map(c => [`${c.path}|${JSON.stringify(c.query)}`, c])).values()],
    };
  }, { sessionTimeoutMs: 58_000 });
  console.log("KOPER_MEASUREMENT_238_CLICK_NETWORK", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_MEASUREMENT_238_CLICK_NETWORK_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1000) : "unknown" }));
}
await import("./index.js");
