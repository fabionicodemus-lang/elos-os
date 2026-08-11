import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { collectFieldPaths } from "./discover-stock-route.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type Probe = {
  endpoint: string;
  params: Record<string, string>;
  status: number;
  dataKeys: string[];
  fieldPaths: string[];
  technicalScalars: Record<string, string | number | boolean | null>;
};

type UnknownRecord = Record<string, unknown>;

function objectValue(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function safeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (/name|description|comment|address|email|phone|document|cnpj|cpf|token|cookie|file|url|supplier|user/.test(normalized)) return false;
  return /(^id$|id$|status|state|type|amount|quantity|date|at$|budget|monitor|monit|input|service|stage|cost|center|order|entry|planning|reference|value)/.test(normalized);
}

function technicalScalars(
  value: unknown,
  prefix = "",
  output: Record<string, string | number | boolean | null> = {},
  depth = 0,
): Record<string, string | number | boolean | null> {
  if (depth > 6 || Object.keys(output).length >= 250) return output;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 3); i += 1) {
      technicalScalars(value[i], `${prefix}[${i}]`, output, depth + 1);
    }
    return output;
  }
  const object = objectValue(value);
  if (!object) return output;
  for (const [key, item] of Object.entries(object)) {
    if (Object.keys(output).length >= 250) break;
    const path = prefix ? `${prefix}.${key}` : key;
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      if (safeKey(key)) output[path] = item;
    } else {
      technicalScalars(item, path, output, depth + 1);
    }
  }
  return output;
}

const candidates: Array<{ path: string; params: Record<string, string> }> = [
  { path: "/engineering/v1/item_monitoring_input", params: { itemMonitInputId: "449" } },
  { path: "/engineering/v1/item_monitoring_input", params: { itemMonitoringInputId: "449" } },
  { path: "/engineering/v1/item_monitoring_input", params: { buildMonitoringId: "67" } },
  { path: "/engineering/v1/monitoring_input", params: { itemMonitInputId: "449" } },
  { path: "/engineering/v1/monitoring_input", params: { monitInputPchId: "101" } },
  { path: "/engineering/v1/input_monitoring", params: { itemMonitInputId: "449" } },
  { path: "/engineering/v1/monitoring_input_pch", params: { monitInputPchId: "101" } },
  { path: "/engineering/v1/item_monitoring_pch", params: { monitInputPchId: "101" } },
  { path: "/engineering/v1/item_monitoring", params: { itemMonitoringId: "449" } },
  { path: "/engineering/v1/item_monitoring", params: { buildMonitoringId: "67", limitY: "500", offsetY: "0", financialSchedule: "yes", scale: "month", positionDate: "2026-08-11", limitX: "1", offsetX: "0" } },
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
    if (!login.authenticated) {
      return { ok: true, authenticated: false, flowSelected: false, probes: [], blockedWrites: 0, message: login.message };
    }

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
      } catch {
        // Ignora URL inválida.
      }
      await route.continue();
    });

    const flowSelected = await selectFlow(page);
    if (!flowSelected) {
      return { ok: true, authenticated: true, flowSelected: false, probes: [], blockedWrites, message: "KOPER_FLOW_COMPANY_NOT_SELECTED" };
    }

    let headers: Record<string, string> | null = null;
    const capture = (request: { method(): string; url(): string; headers(): Record<string, string> }): void => {
      try {
        const url = new URL(request.url());
        if (request.method() === "GET" && url.hostname === "api.koper.com.br" && url.pathname === "/engineering/v1/item_monitoring" && headers === null) headers = request.headers();
      } catch {
        // Ignora URL inválida.
      }
    };
    page.on("request", capture);
    await page.goto("https://app.koper.com.br/engenharia/acompanhamento_obra/view/67/cronograma_financeiro", {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    }).catch(() => undefined);
    for (let attempt = 0; attempt < 10 && !headers; attempt += 1) await page.waitForTimeout(750);
    page.off("request", capture);
    if (!headers) throw new Error("Koper item_monitoring headers were not captured");

    const probes: Probe[] = [];
    for (const candidate of candidates) {
      const query = new URLSearchParams(candidate.params);
      const response = await page.request.get(`https://api.koper.com.br${candidate.path}?${query.toString()}`, {
        headers,
        timeout: 8_000,
      }).catch(() => null);
      if (!response) {
        probes.push({ endpoint: candidate.path, params: candidate.params, status: 0, dataKeys: [], fieldPaths: [], technicalScalars: {} });
        continue;
      }
      const body: unknown = await response.json().catch(() => null);
      const object = objectValue(body);
      probes.push({
        endpoint: candidate.path,
        params: candidate.params,
        status: response.status(),
        dataKeys: object ? Object.keys(object).slice(0, 100) : [],
        fieldPaths: body === null ? [] : collectFieldPaths(body).slice(0, 700),
        technicalScalars: body === null ? {} : technicalScalars(body),
      });
    }

    return { ok: true, authenticated: true, flowSelected: true, probes, blockedWrites, message: null };
  }, { sessionTimeoutMs: 60_000 });
}
