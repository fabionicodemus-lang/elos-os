import type { Page } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { collectFieldPaths } from "./discover-stock-route.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type ResponseShape = {
  endpoint: string;
  status: number;
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

async function captureApiHeaders(page: Page): Promise<Record<string, string>> {
  let headers: Record<string, string> | null = null;
  const capture = (request: { method(): string; url(): string; headers(): Record<string, string> }): void => {
    try {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.hostname === "api.koper.com.br" && headers === null) {
        headers = request.headers();
      }
    } catch {
      // Ignora URLs inválidas.
    }
  };
  page.on("request", capture);
  await page.goto("https://app.koper.com.br/suprimentos/solicitacoes/", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  for (let attempt = 0; attempt < 12 && !headers; attempt += 1) await page.waitForTimeout(1_000);
  page.off("request", capture);
  if (!headers) throw new Error("Koper API headers were not captured");
  return headers;
}

async function readShape(
  page: Page,
  headers: Record<string, string>,
  path: string,
  query: URLSearchParams,
): Promise<ResponseShape> {
  const accessToken = headers["x-accesstoken"] ?? headers["x-access-token"];
  if (!accessToken) throw new Error("Koper access token header was not captured");
  query.set("accessToken", accessToken);
  query.set("cb", String(Date.now()));
  const response = await page.request.get(`https://api.koper.com.br${path}?${query.toString()}`, {
    headers,
    timeout: 30_000,
  });
  const body: unknown = response.ok() ? await response.json() : null;
  const object = objectValue(body);
  return {
    endpoint: path,
    status: response.status(),
    topLevelKeys: object ? Object.keys(object).slice(0, 100) : [],
    fieldPaths: collectFieldPaths(body).slice(0, 500),
    arrays: arrayShapes(body),
  };
}

export async function inspectFlowPurchaseOrders(): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
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
      reads: [],
      blockedWrites,
      message: "KOPER_FLOW_COMPANY_NOT_SELECTED",
    };
    const headers = await captureApiHeaders(page);
    const listQuery = (open: "yes" | "no") => new URLSearchParams({
      limit: "100",
      offset: "0",
      open,
      orderFlag: "desc",
      orderby: "orderDate",
      typeDate: "orderDate",
    });
    const reads = await Promise.all([
      readShape(page, headers, "/purchase/v1/purchase_order", listQuery("yes")),
      readShape(page, headers, "/purchase/v1/purchase_order", listQuery("no")),
      readShape(page, headers, "/purchase/v1/purchase_order", new URLSearchParams({ orderId: "10455" })),
      readShape(page, headers, "/purchase/v1/purchase", new URLSearchParams({
        limit: "100",
        offset: "0",
        orderFlag: "desc",
        orderby: "purchaseDate",
      })),
    ]);
    return { ok: true, authenticated: true, flowSelected: true, reads, blockedWrites, message: null };
  }, { sessionTimeoutMs: 60_000 });
}
