import type { Response } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { collectFieldPaths } from "./discover-stock-route.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type ResponseShape = {
  endpoint: string;
  status: number;
  queryParams: Record<string, string>;
  topLevelKeys: string[];
  fieldPaths: string[];
  arrays: Array<{ path: string; length: number; firstItemKeys: string[] }>;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayShapes(value: unknown, prefix = "", depth = 0): ResponseShape["arrays"] {
  if (depth > 4) return [];
  if (Array.isArray(value)) {
    const first = objectValue(value[0]);
    return [{
      path: prefix || "(root)",
      length: value.length,
      firstItemKeys: first ? Object.keys(first).slice(0, 100) : [],
    }];
  }
  const object = objectValue(value);
  if (!object) return [];
  return Object.entries(object).flatMap(([key, item]) =>
    arrayShapes(item, prefix ? `${prefix}.${key}` : key, depth + 1)
  );
}

async function responseShape(response: Response): Promise<ResponseShape> {
  const url = new URL(response.url());
  const body: unknown = await response.json();
  const object = objectValue(body);
  const allowedQueryKeys = new Set([
    "orderId", "invoiceId", "page", "open", "limit", "offset", "orderFlag", "orderby", "typeDate",
  ]);
  return {
    endpoint: url.pathname,
    status: response.status(),
    queryParams: Object.fromEntries([...url.searchParams.entries()].filter(([key]) => allowedQueryKeys.has(key))),
    topLevelKeys: object ? Object.keys(object).slice(0, 100) : [],
    fieldPaths: collectFieldPaths(body).slice(0, 500),
    arrays: arrayShapes(body),
  };
}

export async function inspectFlowPurchaseOrders(): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  visitedUrls: string[];
  reads: ResponseShape[];
  blockedWrites: number;
  message: string | null;
}> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return {
      ok: true,
      authenticated: false,
      flowSelected: false,
      visitedUrls: [],
      reads: [],
      blockedWrites: 0,
      message: login.message,
    };

    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (isKoper && !["GET", "HEAD", "OPTIONS"].includes(request.method())
          && !isAllowedFlowSwitch(url, request.method(), request.postData())) {
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
    if (!flowSelected) return {
      ok: true,
      authenticated: true,
      flowSelected: false,
      visitedUrls: [],
      reads: [],
      blockedWrites,
      message: "KOPER_FLOW_COMPANY_NOT_SELECTED",
    };

    const reads: ResponseShape[] = [];
    const pending: Promise<void>[] = [];
    const onResponse = (response: Response): void => {
      try {
        const url = new URL(response.url());
        if (response.request().method() !== "GET" || url.hostname !== "api.koper.com.br") return;
        if (url.pathname !== "/purchase/v1/purchase_order" && url.pathname !== "/purchase/v1/purchase") return;
        pending.push(responseShape(response).then((shape) => {
          reads.push(shape);
        }).catch(() => undefined));
      } catch {
        // Ignora URLs inválidas.
      }
    };
    page.on("response", onResponse);

    const visitedUrls: string[] = [];
    for (const url of [
      "https://app.koper.com.br/compras/ordens_compra",
      "https://app.koper.com.br/compras/ordens_compra/finalizados",
      "https://app.koper.com.br/compras/ordens_compra/view/10455",
    ]) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(5_000);
      visitedUrls.push(page.url());
    }
    await Promise.allSettled(pending);
    page.off("response", onResponse);

    return {
      ok: true,
      authenticated: true,
      flowSelected: true,
      visitedUrls,
      reads,
      blockedWrites,
      message: null,
    };
  }, { sessionTimeoutMs: 60_000 });
}
