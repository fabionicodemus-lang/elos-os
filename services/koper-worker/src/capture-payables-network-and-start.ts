import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;

const object = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : null;

function summarize(value: unknown): Json {
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      firstKeys: Object.keys(object(value[0]) ?? {}).sort(),
    };
  }
  const row = object(value);
  if (!row) return { type: typeof value };
  return {
    type: "object",
    keys: Object.keys(row).sort(),
    arrays: Object.fromEntries(
      Object.entries(row)
        .filter(([, child]) => Array.isArray(child))
        .map(([key, child]) => [key, {
          length: (child as unknown[]).length,
          firstKeys: Object.keys(object((child as unknown[])[0]) ?? {}).sort(),
        }]),
    ),
  };
}

function relevantScalars(value: unknown, prefix = "", depth = 0): Array<{ path: string; value: string | number | boolean | null }> {
  if (depth > 5) return [];
  if (Array.isArray(value)) {
    return value.slice(0, 4).flatMap((item, index) => relevantScalars(item, `${prefix}[${index}]`, depth + 1));
  }
  const row = object(value);
  if (!row) return [];
  const result: Array<{ path: string; value: string | number | boolean | null }> = [];
  for (const [key, child] of Object.entries(row)) {
    if (/token|cookie|authorization|password|email|phone|documentNumber|cpf|cnpj/i.test(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (child === null || typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
      if (/(id|code|number|status|origin|source|type|kind|amount|value|total|date|due|paid|payment|bill|title|invoice|note|order|request|contract|measurement|service|work|allocation|chart|account|cost)/i.test(key)) {
        result.push({ path, value: child as string | number | boolean | null });
      }
    } else if (child && (Array.isArray(child) || object(child))) {
      result.push(...relevantScalars(child, path, depth + 1));
    }
  }
  return result;
}

async function navigationCandidates(page: import("playwright-core").Page): Promise<Array<{ text: string; href: string | null; tag: string; visible: boolean }>> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("a,button,[role='button'],[role='link']"));
    return nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
      const rawHref = node instanceof HTMLAnchorElement ? node.href : node.getAttribute("href");
      const href = rawHref ? String(rawHref).split("#")[0] : null;
      return {
        text: text.slice(0, 240),
        href: href ?? null,
        tag: node.tagName.toLowerCase(),
        visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
      };
    }).filter((entry) => /finance|pagar|pagamento/i.test(entry.text) || /finance|pagar|pay|bill/i.test(entry.href ?? ""));
  });
}

async function openPayables(page: import("playwright-core").Page): Promise<{ opened: boolean; route: string | null; candidates: Awaited<ReturnType<typeof navigationCandidates>> }> {
  const knownRoute = "https://app.koper.com.br/financeiro/contas_pagar";
  const response = await page.goto(knownRoute, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => null);
  await page.waitForTimeout(7_000);
  const finalUrl = page.url();
  const opened = Boolean(response) && /financeiro\/contas_pagar/i.test(finalUrl);
  if (opened) {
    return { opened: true, route: finalUrl, candidates: await navigationCandidates(page) };
  }

  let candidates = await navigationCandidates(page);
  const exact = candidates.find((entry) => /contas?\s+a\s+pagar/i.test(entry.text) && entry.href);
  if (exact?.href) {
    await page.goto(exact.href, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(5_000);
    return { opened: true, route: page.url(), candidates };
  }

  const finance = page.getByText(/financeiro/i).filter({ visible: true }).first();
  if (await finance.count().catch(() => 0)) {
    await finance.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);
    candidates = await navigationCandidates(page);
    const afterFinance = candidates.find((entry) => /contas?\s+a\s+pagar/i.test(entry.text) && entry.href);
    if (afterFinance?.href) {
      await page.goto(afterFinance.href, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(5_000);
      return { opened: true, route: page.url(), candidates };
    }
  }

  return { opened: false, route: null, candidates };
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
            query: Object.fromEntries([...url.searchParams.entries()].filter(([key]) => !/token|auth|cb/i.test(key))),
            response: summarize(body),
            relevantScalars: relevantScalars(body).slice(0, 220),
          });
        })();
        pending.push(task);
      } catch {}
    };

    page.on("response", onResponse);
    const navigation = await openPayables(page);
    await page.waitForTimeout(4_000);
    page.off("response", onResponse);
    await Promise.allSettled(pending);

    const unique = [...new Map(calls.map((call) => [`${call.path}?${JSON.stringify(call.query)}`, call])).values()];
    return {
      ok: true,
      readOnly: true,
      flowSelected: true,
      blockedWrites,
      navigation,
      finalUrl: page.url(),
      bodyPreview: (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 2_500),
      calls: unique,
    };
  }, { sessionTimeoutMs: 55_000 });

  console.log("KOPER_PAYABLE_NETWORK_RESULT", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_PAYABLE_NETWORK_FAILED", JSON.stringify({
    message: error instanceof Error ? error.message.slice(0, 1_000) : "unknown",
  }));
}

await import("./index.js");
