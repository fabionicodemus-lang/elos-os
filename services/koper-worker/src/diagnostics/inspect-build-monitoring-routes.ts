import type { Response } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { collectFieldPaths } from "./discover-stock-route.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type ReadShape = {
  endpoint: string;
  status: number;
  queryKeys: string[];
  queryParams: Record<string, string>;
  dataKeys: string[];
  fieldPaths: string[];
  arrays: Array<{ path: string; length: number; firstItemKeys: string[] }>;
  technicalScalars: Record<string, string | number | boolean | null>;
};

type UnknownRecord = Record<string, unknown>;

function objectValue(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function arrayShapes(value: unknown, prefix = "", depth = 0): ReadShape["arrays"] {
  if (depth > 5) return [];
  if (Array.isArray(value)) {
    const first = objectValue(value[0]);
    const current = [{
      path: prefix || "(root)",
      length: value.length,
      firstItemKeys: first ? Object.keys(first).slice(0, 120) : [],
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
  if (/name|description|comment|address|email|phone|document|cnpj|cpf|token|cookie|file|url|supplier|user/.test(normalized)) return false;
  return /(^id$|id$|status|state|type|amount|quantity|date|at$|budget|monitor|monit|input|service|stage|cost|center|order|entry|planning|reference|execut|percent|value)/.test(normalized);
}

function collectTechnicalScalars(
  value: unknown,
  prefix = "",
  output: Record<string, string | number | boolean | null> = {},
  depth = 0,
): Record<string, string | number | boolean | null> {
  if (depth > 6 || Object.keys(output).length >= 250) return output;
  if (Array.isArray(value)) {
    if (value[0] !== undefined) collectTechnicalScalars(value[0], `${prefix}[0]`, output, depth + 1);
    return output;
  }
  const object = objectValue(value);
  if (!object) return output;
  for (const [key, item] of Object.entries(object)) {
    if (Object.keys(output).length >= 250) break;
    const path = prefix ? `${prefix}.${key}` : key;
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      if (isSafeTechnicalKey(key)) output[path] = item;
    } else {
      collectTechnicalScalars(item, path, output, depth + 1);
    }
  }
  return output;
}

export async function inspectBuildMonitoringRoutes(): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  visitedUrl: string | null;
  reads: ReadShape[];
  blockedWrites: number;
  message: string | null;
}> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) {
      return { ok: true, authenticated: false, flowSelected: false, visitedUrl: null, reads: [], blockedWrites: 0, message: login.message };
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
        // Ignora URLs inválidas.
      }
      await route.continue();
    });

    const flowSelected = await selectFlow(page);
    if (!flowSelected) {
      return { ok: true, authenticated: true, flowSelected: false, visitedUrl: null, reads: [], blockedWrites, message: "KOPER_FLOW_COMPANY_NOT_SELECTED" };
    }

    const reads = new Map<string, ReadShape>();
    const pending: Promise<void>[] = [];
    const onResponse = (response: Response): void => {
      try {
        const request = response.request();
        const url = new URL(response.url());
        if (request.method() !== "GET" || url.hostname !== "api.koper.com.br") return;
        if (!/(engineering|monitor|planning|construction|build)/i.test(url.pathname + url.search)) return;

        const queryKeys = [...new Set(url.searchParams.keys())].sort().slice(0, 30);
        const key = `${url.pathname}|${response.status()}|${queryKeys.join(",")}`;
        if (reads.has(key)) return;
        const task = response.json().then((body: unknown) => {
          const object = objectValue(body);
          reads.set(key, {
            endpoint: url.origin + url.pathname,
            status: response.status(),
            queryKeys,
            queryParams: Object.fromEntries([...url.searchParams.entries()].filter(([k]) => !/token|access|cb/i.test(k)).slice(0, 30)),
            dataKeys: object ? Object.keys(object).slice(0, 100) : [],
            fieldPaths: collectFieldPaths(body).slice(0, 700),
            arrays: arrayShapes(body).slice(0, 100),
            technicalScalars: collectTechnicalScalars(body),
          });
        }).catch(() => {
          reads.set(key, {
            endpoint: url.origin + url.pathname,
            status: response.status(),
            queryKeys,
            queryParams: Object.fromEntries([...url.searchParams.entries()].filter(([k]) => !/token|access|cb/i.test(k)).slice(0, 30)),
            dataKeys: [], fieldPaths: [], arrays: [], technicalScalars: {},
          });
        });
        pending.push(task);
      } catch {
        // Ignora respostas não sanitizáveis.
      }
    };
    page.on("response", onResponse);

    await page.goto("https://app.koper.com.br/engenharia/acompanhamento_obra/view/67/cronograma_financeiro", {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    }).catch(() => undefined);
    await page.waitForTimeout(10_000);
    const visitedUrl = page.url();
    await Promise.allSettled(pending);
    page.off("response", onResponse);

    return {
      ok: true,
      authenticated: true,
      flowSelected: true,
      visitedUrl,
      reads: [...reads.values()],
      blockedWrites,
      message: reads.size > 0 ? null : "KOPER_BUILD_MONITORING_READS_NOT_CAPTURED",
    };
  }, { sessionTimeoutMs: 60_000 });
}
