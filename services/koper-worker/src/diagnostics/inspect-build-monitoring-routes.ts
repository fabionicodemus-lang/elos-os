import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type UnknownRecord = Record<string, unknown>;
type Probe = {
  params: Record<string, string>;
  status: number;
  arrayLength: number | null;
  technical: Record<string, string | number | boolean | null>;
  errorMessage: string | null;
};

function obj(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : null;
}

function safeText(value: unknown): string | null {
  return typeof value === "string" ? value.replace(/[\w.+-]+@[\w.-]+/g, "[REDACTED]").slice(0, 240) : null;
}

function technical(value: unknown, prefix = "", out: Record<string, string | number | boolean | null> = {}, depth = 0): Record<string, string | number | boolean | null> {
  if (depth > 8 || Object.keys(out).length >= 500) return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 8); i += 1) technical(value[i], `${prefix}[${i}]`, out, depth + 1);
    return out;
  }
  const record = obj(value);
  if (!record) return out;
  for (const [key, child] of Object.entries(record)) {
    const lower = key.toLowerCase();
    const path = prefix ? `${prefix}.${key}` : key;
    if (child === null || typeof child === "number" || typeof child === "boolean" || typeof child === "string") {
      if (/id$|service|monitor|monit|input|budget|item|request|amount|quantity|cost|center|stage|reference|type|status/.test(lower)
        && !/name|description|comment|address|email|phone|document|cnpj|cpf|token|cookie|file|url|supplier|user/.test(lower)) {
        out[path] = typeof child === "string" ? child.slice(0, 120) : child;
      }
    } else technical(child, path, out, depth + 1);
  }
  return out;
}

const probes: Record<string, string>[] = [
  { itemMonitInputId: "465" },
  { itemMonitInputId: "465", limit: "20", offset: "0" },
  { itemMonitInputId: "465", limit: "20", offset: "0", orderby: "inputId" },
  { itemMonitInputId: "465", limit: "20", offset: "0", orderby: "inputId", orderFlag: "asc" },
  { monitInputPchId: "117" },
  { monitInputPchId: "117", limit: "20", offset: "0", orderby: "inputId", orderFlag: "asc" },
  { itemMonitInputId: "465", monitInputPchId: "117", limit: "20", offset: "0", orderby: "inputId", orderFlag: "asc" },
  { buildMonitoringId: "67", itemMonitInputId: "465", limit: "20", offset: "0", orderby: "inputId", orderFlag: "asc" },
  { buildMonitoringId: "67", monitInputPchId: "117", limit: "20", offset: "0", orderby: "inputId", orderFlag: "asc" },
  { inputId: "2185", limit: "20", offset: "0", orderby: "inputId", orderFlag: "asc" },
];

export async function inspectBuildMonitoringRoutes(): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  probes: Probe[];
  blockedWrites: number;
  message: string | null;
}> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ok: true, authenticated: false, flowSelected: false, probes: [], blockedWrites: 0, message: login.message };

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
    if (!flowSelected) return { ok: true, authenticated: true, flowSelected: false, probes: [], blockedWrites, message: "KOPER_FLOW_COMPANY_NOT_SELECTED" };

    let headers: Record<string, string> | null = null;
    const capture = (request: { method(): string; url(): string; headers(): Record<string, string> }): void => {
      try {
        const url = new URL(request.url());
        if (request.method() === "GET" && url.hostname === "api.koper.com.br" && url.pathname === "/engineering/v1/item_monitoring" && headers === null) headers = request.headers();
      } catch {}
    };
    page.on("request", capture);
    await page.goto("https://app.koper.com.br/engenharia/acompanhamento_obra/view/67/cronograma_financeiro", { waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => undefined);
    for (let i = 0; i < 10 && !headers; i += 1) await page.waitForTimeout(750);
    page.off("request", capture);
    if (!headers) throw new Error("Koper engineering headers not captured");
    const requestHeaders: Record<string, string> = headers;

    const results: Probe[] = [];
    for (const params of probes) {
      const response = await page.request.get(
        `https://api.koper.com.br/engineering/v1/monitoring_input?${new URLSearchParams(params).toString()}`,
        { headers: requestHeaders, timeout: 8_000 },
      ).catch(() => null);
      if (!response) {
        results.push({ params, status: 0, arrayLength: null, technical: {}, errorMessage: null });
        continue;
      }
      const body: unknown = await response.json().catch(() => null);
      const record = obj(body);
      results.push({
        params,
        status: response.status(),
        arrayLength: Array.isArray(body) ? body.length : null,
        technical: body === null ? {} : technical(body),
        errorMessage: record ? safeText(record.message) : null,
      });
    }

    return { ok: true, authenticated: true, flowSelected: true, probes: results, blockedWrites, message: null };
  }, { sessionTimeoutMs: 60_000 });
}
