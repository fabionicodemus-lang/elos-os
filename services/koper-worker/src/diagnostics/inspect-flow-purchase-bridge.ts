import type { Response } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { collectFieldPaths } from "./discover-stock-route.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type UnknownRecord = Record<string, unknown>;

type PurchaseShape = {
  purchaseId: string;
  status: number;
  endpoint: string;
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

function arrayShapes(value: unknown, prefix = "", depth = 0): PurchaseShape["arrays"] {
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
  if (/name|description|comment|address|email|phone|document|cnpj|cpf|token|cookie|file|url/.test(normalized)) {
    return false;
  }
  return /(^id$|id$|date$|at$|status|state|type|amount|value|price|total|quantity|number|sequence|order|flag|paid|open|closed|cancel|invoice|receipt|request|budget|purchase|stock|movement|entry)/.test(normalized);
}

function collectTechnicalScalars(
  value: unknown,
  prefix = "",
  output: Record<string, string | number | boolean | null> = {},
  depth = 0,
): Record<string, string | number | boolean | null> {
  if (depth > 6 || Object.keys(output).length >= 300) return output;
  if (Array.isArray(value)) {
    const first = value[0];
    if (first !== undefined) collectTechnicalScalars(first, `${prefix}[0]`, output, depth + 1);
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

async function purchaseShape(response: {
  url(): string;
  status(): number;
  json(): Promise<unknown>;
}, purchaseId: string): Promise<PurchaseShape> {
  const url = new URL(response.url());
  if (response.status() < 200 || response.status() >= 300) {
    return {
      purchaseId,
      status: response.status(),
      endpoint: url.pathname,
      topLevelKeys: [],
      fieldPaths: [],
      arrays: [],
      technicalScalars: {},
    };
  }
  const body: unknown = await response.json();
  const object = objectValue(body);
  return {
    purchaseId,
    status: response.status(),
    endpoint: url.pathname,
    topLevelKeys: object ? Object.keys(object).slice(0, 150) : [],
    fieldPaths: collectFieldPaths(body).slice(0, 1_000),
    arrays: arrayShapes(body),
    technicalScalars: collectTechnicalScalars(body),
  };
}

const PURCHASE_IDS = ["13667", "4097", "9607", "398", "169"];
const DETAIL_PATH = "/supply/v2/purchases/details/";

export async function inspectFlowPurchaseBridge(): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  visitedUrl: string | null;
  capturedEndpoint: boolean;
  purchases: PurchaseShape[];
  blockedWrites: number;
  message: string | null;
}> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) {
      return {
        ok: true,
        authenticated: false,
        flowSelected: false,
        visitedUrl: null,
        capturedEndpoint: false,
        purchases: [],
        blockedWrites: 0,
        message: login.message,
      };
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
      return {
        ok: true,
        authenticated: true,
        flowSelected: false,
        visitedUrl: null,
        capturedEndpoint: false,
        purchases: [],
        blockedWrites,
        message: "KOPER_FLOW_COMPANY_NOT_SELECTED",
      };
    }

    let detailHeaders: Record<string, string> | null = null;
    const captured: PurchaseShape[] = [];
    const pending: Promise<void>[] = [];
    const onResponse = (response: Response): void => {
      try {
        const url = new URL(response.url());
        if (
          response.request().method() !== "GET"
          || !url.pathname.startsWith(DETAIL_PATH)
        ) return;
        detailHeaders ??= response.request().headers();
        const purchaseId = url.pathname.slice(DETAIL_PATH.length).split("/")[0] || "unknown";
        pending.push(
          purchaseShape(response, purchaseId)
            .then((shape) => { captured.push(shape); })
            .catch(() => undefined),
        );
      } catch {
        // Ignora URLs inválidas.
      }
    };
    page.on("response", onResponse);

    await page.goto("https://web.koper.com.br/suprimentos/compras/13667", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    }).catch(() => undefined);
    await page.waitForTimeout(5_000);
    const visitedUrl = page.url();
    await Promise.allSettled(pending);

    if (detailHeaders) {
      const capturedIds = new Set(captured.map((item) => item.purchaseId));
      for (const purchaseId of PURCHASE_IDS) {
        if (capturedIds.has(purchaseId)) continue;
        const response = await page.request.get(
          `https://api.koper.com.br${DETAIL_PATH}${purchaseId}`,
          { headers: detailHeaders, timeout: 12_000 },
        );
        captured.push(await purchaseShape(response, purchaseId));
      }
    }

    page.off("response", onResponse);
    captured.sort((a, b) => PURCHASE_IDS.indexOf(a.purchaseId) - PURCHASE_IDS.indexOf(b.purchaseId));

    return {
      ok: true,
      authenticated: true,
      flowSelected: true,
      visitedUrl,
      capturedEndpoint: Boolean(detailHeaders),
      purchases: captured,
      blockedWrites,
      message: detailHeaders ? null : "KOPER_PURCHASE_DETAIL_HEADERS_NOT_CAPTURED",
    };
  }, { sessionTimeoutMs: 58_000 });
}
