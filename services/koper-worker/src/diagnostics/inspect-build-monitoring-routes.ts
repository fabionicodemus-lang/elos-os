import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { collectFieldPaths } from "./discover-stock-route.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type UnknownRecord = Record<string, unknown>;
type Probe = { params: Record<string, string>; status: number; dataKeys: string[]; fieldPaths: string[]; technical: Record<string, string | number | boolean | null>; errorMessage: string | null };

function obj(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : null;
}

function safeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/[\w.+-]+@[\w.-]+/g, "[REDACTED]").replace(/token[^\s,;]*/gi, "token[REDACTED]").slice(0, 300);
}

function collectTechnical(value: unknown, prefix = "", out: Record<string, string | number | boolean | null> = {}, depth = 0): Record<string, string | number | boolean | null> {
  if (depth > 6 || Object.keys(out).length >= 400) return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 5); i += 1) collectTechnical(value[i], `${prefix}[${i}]`, out, depth + 1);
    return out;
  }
  const record = obj(value);
  if (!record) return out;
  for (const [key, item] of Object.entries(record)) {
    const lower = key.toLowerCase();
    const path = prefix ? `${prefix}.${key}` : key;
    if (item === null || typeof item === "number" || typeof item === "boolean" || typeof item === "string") {
      if (!/name|description|comment|address|email|phone|document|cnpj|cpf|token|cookie|file|url|supplier|user/.test(lower) && /id$|status|type|amount|quantity|budget|monitor|monit|input|service|stage|cost|center|planning|reference|value/.test(lower)) out[path] = item;
    } else collectTechnical(item, path, out, depth + 1);
  }
  return out;
}

const probes: Record<string, string>[] = [
  { itemMonitoringId: "134" },
  { buildMonitoringId: "67", itemMonitoringId: "134" },
  { buildMonitoringId: "67", limit: "500", offset: "0", orderby: "id" },
  { buildMonitoringId: "67", limit: "500", offset: "0", orderby: "itemMonitoringId" },
  { buildMonitoringId: "67", limit: "500", offset: "0", orderby: "inputId" },
  { buildMonitoringId: "67", limit: "500", offset: "0", orderby: "itemMonitInputId" },
  { buildMonitoringId: "67", limit: "500", offset: "0", orderby: "monitInputPchId" },
  { buildMonitoringId: "67", limit: "500", offset: "0", orderby: "createdAt" },
  { buildMonitoringId: "67", limit: "500", offset: "0", orderby: "id", order: "asc" },
];

export async function inspectBuildMonitoringRoutes(): Promise<{ ok: true; authenticated: boolean; flowSelected: boolean; probes: Probe[]; blockedWrites: number; message: string | null }> {
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

    const results: Probe[] = [];
    for (const params of probes) {
      const response = await page.request.get(`https://api.koper.com.br/engineering/v1/monitoring_input?${new URLSearchParams(params).toString()}`, { headers, timeout: 8_000 }).catch(() => null);
      if (!response) {
        results.push({ params, status: 0, dataKeys: [], fieldPaths: [], technical: {}, errorMessage: null });
        continue;
      }
      const body: unknown = await response.json().catch(() => null);
      const record = obj(body);
      results.push({
        params,
        status: response.status(),
        dataKeys: record ? Object.keys(record).slice(0, 100) : [],
        fieldPaths: body === null ? [] : collectFieldPaths(body).slice(0, 800),
        technical: body === null ? {} : collectTechnical(body),
        errorMessage: record ? safeText(record.message) : null,
      });
    }
    return { ok: true, authenticated: true, flowSelected: true, probes: results, blockedWrites, message: null };
  }, { sessionTimeoutMs: 60_000 });
}
