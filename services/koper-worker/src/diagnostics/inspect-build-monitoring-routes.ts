import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type Rec = Record<string, unknown>;
type Probe = {
  inputId: string;
  status: number;
  arrayLength: number | null;
  fieldPaths: string[];
  technical: Record<string, string | number | boolean | null>;
  errorMessage: string | null;
};

function rec(value: unknown): Rec | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Rec : null;
}

function paths(value: unknown, prefix = "", out: string[] = [], depth = 0): string[] {
  if (depth > 6 || out.length >= 500) return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 8); i += 1) paths(value[i], `${prefix}[${i}]`, out, depth + 1);
    return out;
  }
  const row = rec(value);
  if (!row) return out;
  for (const [key, child] of Object.entries(row)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!out.includes(path)) out.push(path);
    if (typeof child === "object" && child !== null) paths(child, path, out, depth + 1);
  }
  return out;
}

function technical(value: unknown, prefix = "", out: Record<string, string | number | boolean | null> = {}, depth = 0): Record<string, string | number | boolean | null> {
  if (depth > 7 || Object.keys(out).length >= 500) return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 12); i += 1) technical(value[i], `${prefix}[${i}]`, out, depth + 1);
    return out;
  }
  const row = rec(value);
  if (!row) return out;
  for (const [key, child] of Object.entries(row)) {
    const lower = key.toLowerCase();
    const path = prefix ? `${prefix}.${key}` : key;
    if (child === null || typeof child === "number" || typeof child === "boolean" || typeof child === "string") {
      if (/id$|service|monitor|monit|input|planning|budget|item|stage|reference|amount|quantity|type|status/.test(lower)
        && !/name|description|user|customer|address|email|phone|document|token|cookie/.test(lower)) {
        out[path] = typeof child === "string" ? child.slice(0, 120) : child;
      }
    } else technical(child, path, out, depth + 1);
  }
  return out;
}

const inputIds = ["2185", "5629", "5630", "5634", "2081", "496"];

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
    const capture = (request: { method(): string; url(): string; headers(): Record<string, string> }) => {
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

    const probes: Probe[] = [];
    for (const inputId of inputIds) {
      const query = new URLSearchParams({
        services: "yes",
        inputId,
        buildMonitoringId: "67",
        page: "stockRequest",
      });
      const response = await page.request.get(
        `https://api.koper.com.br/engineering/v1/monitoring_input?${query.toString()}`,
        { headers: requestHeaders, timeout: 8_000 },
      ).catch(() => null);
      if (!response) {
        probes.push({ inputId, status: 0, arrayLength: null, fieldPaths: [], technical: {}, errorMessage: null });
        continue;
      }
      const body: unknown = await response.json().catch(() => null);
      const object = rec(body);
      probes.push({
        inputId,
        status: response.status(),
        arrayLength: Array.isArray(body) ? body.length : null,
        fieldPaths: body === null ? [] : paths(body),
        technical: body === null ? {} : technical(body),
        errorMessage: object && typeof object.message === "string" ? object.message.slice(0, 250) : null,
      });
    }

    return { ok: true, authenticated: true, flowSelected: true, probes, blockedWrites, message: null };
  }, { sessionTimeoutMs: 60_000 });
}
