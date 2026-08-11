import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { collectFieldPaths } from "./discover-stock-route.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type UnknownRecord = Record<string, unknown>;

type HistoryProbe = {
  productRequestId: string;
  history: string;
  status: number;
  topLevelKeys: string[];
  fieldPaths: string[];
  arrays: Array<{ path: string; length: number; firstItemKeys: string[] }>;
  technicalScalars: Record<string, string | number | boolean | null>;
};

function objectValue(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function arrayShapes(value: unknown, prefix = "", depth = 0): HistoryProbe["arrays"] {
  if (depth > 5) return [];
  if (Array.isArray(value)) {
    const first = objectValue(value[0]);
    const current = [{
      path: prefix || "(root)",
      length: value.length,
      firstItemKeys: first ? Object.keys(first).slice(0, 100) : [],
    }];
    if (!first) return current;
    return current.concat(
      Object.entries(first).flatMap(([key, item]) =>
        arrayShapes(item, prefix ? `${prefix}[0].${key}` : `[0].${key}`, depth + 1)
      ),
    );
  }
  const object = objectValue(value);
  if (!object) return [];
  return Object.entries(object).flatMap(([key, item]) =>
    arrayShapes(item, prefix ? `${prefix}.${key}` : key, depth + 1)
  );
}

function isSafeTechnicalKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (/name|description|comment|address|email|phone|document|cnpj|cpf|token|cookie|file|url|supplier|user/.test(normalized)) {
    return false;
  }
  return /(^id$|id$|status|state|type|amount|quantity|date|at$|request|budget|purchase|monitor|monit|input|service|stage|cost|center|order|entry|history|approved|open|closed|cancel)/.test(normalized);
}

function collectTechnicalScalars(
  value: unknown,
  prefix = "",
  output: Record<string, string | number | boolean | null> = {},
  depth = 0,
): Record<string, string | number | boolean | null> {
  if (depth > 6 || Object.keys(output).length >= 300) return output;
  if (Array.isArray(value)) {
    if (value[0] !== undefined) collectTechnicalScalars(value[0], `${prefix}[0]`, output, depth + 1);
    return output;
  }
  const object = objectValue(value);
  if (!object) return output;
  for (const [key, item] of Object.entries(object)) {
    if (Object.keys(output).length >= 300) break;
    const path = prefix ? `${prefix}.${key}` : key;
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      if (isSafeTechnicalKey(key)) output[path] = item;
      continue;
    }
    collectTechnicalScalars(item, path, output, depth + 1);
  }
  return output;
}

const SAMPLE_PRODUCT_REQUEST_IDS = ["266", "357", "10251"];
const HISTORY_VALUES = ["yes", "true", "1"];

export async function inspectStockRequestHistoryBridge(): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  probes: HistoryProbe[];
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
        if (
          isKoper
          && !["GET", "HEAD", "OPTIONS"].includes(request.method())
          && !isAllowedFlowSwitch(url, request.method(), request.postData())
        ) {
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {
        // Ignora URLs inválidas.
      }
      await route.continue();
    });

    const flowSelected = await selectFlow(page);
    if (!flowSelected) {
      return { ok: true, authenticated: true, flowSelected: false, probes: [], blockedWrites, message: "KOPER_FLOW_COMPANY_NOT_SELECTED" };
    }

    let headers: Record<string, string> | null = null;
    const captureHeaders = (request: { method(): string; url(): string; headers(): Record<string, string> }): void => {
      try {
        const url = new URL(request.url());
        if (
          request.method() === "GET"
          && url.hostname === "api.koper.com.br"
          && url.pathname === "/stock/v1/request"
          && headers === null
        ) headers = request.headers();
      } catch {
        // Ignora URLs inválidas.
      }
    };
    page.on("request", captureHeaders);
    await page.goto("https://app.koper.com.br/suprimentos/solicitacoes/", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    }).catch(() => undefined);
    for (let attempt = 0; attempt < 8 && !headers; attempt += 1) await page.waitForTimeout(750);
    page.off("request", captureHeaders);
    if (!headers) throw new Error("Koper stock request headers were not captured");

    const probes: HistoryProbe[] = [];
    for (const productRequestId of SAMPLE_PRODUCT_REQUEST_IDS) {
      for (const history of HISTORY_VALUES) {
        const query = new URLSearchParams({ productRequestId, history });
        const response = await page.request.get(
          `https://api.koper.com.br/stock/v1/product_request?${query.toString()}`,
          { headers, timeout: 10_000 },
        );
        let body: unknown = null;
        if (response.ok()) body = await response.json().catch(() => null);
        probes.push({
          productRequestId,
          history,
          status: response.status(),
          topLevelKeys: objectValue(body) ? Object.keys(objectValue(body)!).slice(0, 120) : [],
          fieldPaths: body === null ? [] : collectFieldPaths(body).slice(0, 800),
          arrays: body === null ? [] : arrayShapes(body),
          technicalScalars: body === null ? {} : collectTechnicalScalars(body),
        });
      }
    }

    return {
      ok: true,
      authenticated: true,
      flowSelected: true,
      probes,
      blockedWrites,
      message: null,
    };
  }, { sessionTimeoutMs: 60_000 });
}
