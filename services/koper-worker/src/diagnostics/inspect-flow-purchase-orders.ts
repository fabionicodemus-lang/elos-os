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

type CostCenterRead = {
  endpoint: string;
  status: number;
  fieldPaths: string[];
  arrays: Array<{ path: string; length: number; firstItemKeys: string[] }>;
  technicalSamples: Array<Record<string, unknown>>;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayShapes(value: unknown, prefix = "", depth = 0): ResponseShape["arrays"] {
  if (depth > 6) return [];
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

function technicalObject(value: unknown): Record<string, unknown> | null {
  const object = objectValue(value);
  if (!object) return null;
  const allowed = /(^id$|id$|code|name|description|cost|center|monitor|service|budget|building|enterprise|parent)/i;
  const filtered = Object.fromEntries(
    Object.entries(object)
      .filter(([key, item]) => allowed.test(key) && (item === null || ["string", "number", "boolean"].includes(typeof item)))
      .slice(0, 60),
  );
  return Object.keys(filtered).length ? filtered : null;
}

function collectCostCenterSamples(value: unknown, path = "", depth = 0): Array<Record<string, unknown>> {
  if (depth > 7) return [];
  if (Array.isArray(value)) {
    if (/cost.*center|center.*cost/i.test(path)) {
      return value.flatMap((item) => {
        const sample = technicalObject(item);
        return sample ? [sample] : [];
      }).slice(0, 50);
    }
    return value.flatMap((item, index) => collectCostCenterSamples(item, `${path}[${index}]`, depth + 1)).slice(0, 50);
  }
  const object = objectValue(value);
  if (!object) return [];
  return Object.entries(object).flatMap(([key, item]) =>
    collectCostCenterSamples(item, path ? `${path}.${key}` : key, depth + 1)
  ).slice(0, 50);
}

async function responseShape(response: {
  url(): string;
  status(): number;
  json(): Promise<unknown>;
}): Promise<ResponseShape> {
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

async function costCenterResponse(response: Response): Promise<CostCenterRead> {
  const body: unknown = await response.json();
  return {
    endpoint: new URL(response.url()).pathname,
    status: response.status(),
    fieldPaths: collectFieldPaths(body).slice(0, 1000),
    arrays: arrayShapes(body),
    technicalSamples: collectCostCenterSamples(body),
  };
}

function isCostCentersQuery(method: string, postData: string | null): boolean {
  return method === "POST" && Boolean(postData?.includes("CostCentersQuery"));
}

export async function inspectFlowPurchaseOrders(): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  visitedUrls: string[];
  reads: ResponseShape[];
  costCenterReads: CostCenterRead[];
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
      costCenterReads: [],
      blockedWrites: 0,
      message: login.message,
    };

    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        const costCentersRead = isCostCentersQuery(request.method(), request.postData());
        if (isKoper && !["GET", "HEAD", "OPTIONS"].includes(request.method())
          && !costCentersRead
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

    const costCenterReads: CostCenterRead[] = [];
    const costCenterPending: Promise<void>[] = [];
    const onCostCenterResponse = (response: Response): void => {
      const request = response.request();
      if (!isCostCentersQuery(request.method(), request.postData())) return;
      costCenterPending.push(costCenterResponse(response).then((read) => {
        costCenterReads.push(read);
      }).catch(() => undefined));
    };
    page.on("response", onCostCenterResponse);

    const flowSelected = await selectFlow(page);
    if (!flowSelected) {
      page.off("response", onCostCenterResponse);
      return {
        ok: true,
        authenticated: true,
        flowSelected: false,
        visitedUrls: [],
        reads: [],
        costCenterReads,
        blockedWrites,
        message: "KOPER_FLOW_COMPANY_NOT_SELECTED",
      };
    }

    const reads: ResponseShape[] = [];
    const pending: Promise<void>[] = [];
    let orderListUrl: string | null = null;
    let orderListHeaders: Record<string, string> | null = null;
    const onResponse = (response: Response): void => {
      try {
        const url = new URL(response.url());
        if (response.request().method() !== "GET" || url.hostname !== "api.koper.com.br") return;
        if (url.pathname !== "/purchase/v1/purchase_order" && url.pathname !== "/purchase/v1/purchase") return;
        if (url.pathname === "/purchase/v1/purchase_order" && url.searchParams.get("orderId") === "all") {
          orderListUrl = response.url();
          orderListHeaders = response.request().headers();
        }
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
      "https://app.koper.com.br/",
      "https://app.koper.com.br/dashboard",
      "https://app.koper.com.br/compras/ordens_compra",
      "https://app.koper.com.br/compras/ordens_compra/finalizados",
      "https://app.koper.com.br/compras/ordens_compra/view/10455",
    ]) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(5_000);
      visitedUrls.push(page.url());
    }
    await Promise.allSettled([...pending, ...costCenterPending]);
    if (orderListUrl && orderListHeaders) {
      const finalizedUrl = new URL(orderListUrl);
      finalizedUrl.searchParams.set("open", "no");
      finalizedUrl.searchParams.set("cb", String(Date.now()));
      const response = await page.request.get(finalizedUrl.toString(), {
        headers: orderListHeaders,
        timeout: 30_000,
      });
      reads.push(await responseShape(response));
    }
    page.off("response", onResponse);
    page.off("response", onCostCenterResponse);

    return {
      ok: true,
      authenticated: true,
      flowSelected: true,
      visitedUrls,
      reads,
      costCenterReads,
      blockedWrites,
      message: null,
    };
  }, { sessionTimeoutMs: 60_000 });
}
