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
  if (depth > 5) return [];
  if (Array.isArray(value)) {
    const first = objectValue(value[0]);
    return [{
      path: prefix || "(root)",
      length: value.length,
      firstItemKeys: first ? Object.keys(first).slice(0, 120) : [],
    }];
  }
  const object = objectValue(value);
  if (!object) return [];
  return Object.entries(object).flatMap(([key, item]) =>
    arrayShapes(item, prefix ? `${prefix}.${key}` : key, depth + 1)
  );
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
    "entryId",
    "pending",
    "limit",
    "offset",
    "orderFlag",
    "orderby",
    "originType",
    "placeEntryId",
  ]);
  return {
    endpoint: url.pathname,
    status: response.status(),
    queryParams: Object.fromEntries(
      [...url.searchParams.entries()].filter(([key]) => allowedQueryKeys.has(key)),
    ),
    topLevelKeys: object ? Object.keys(object).slice(0, 120) : [],
    fieldPaths: collectFieldPaths(body).slice(0, 800),
    arrays: arrayShapes(body),
  };
}

const TARGET_PATHS = new Set([
  "/stock/v1/entry",
  "/stock/v1/pending_entry",
  "/stock/v1/product_entry",
  "/stock/v1/temp_entry",
  "/stock/v1/sector",
  "/stock/v1/stock_place",
]);

export async function inspectFlowStockEntries(): Promise<{
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
    if (!login.authenticated) {
      return {
        ok: true,
        authenticated: false,
        flowSelected: false,
        visitedUrls: [],
        reads: [],
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
        visitedUrls: [],
        reads: [],
        blockedWrites,
        message: "KOPER_FLOW_COMPANY_NOT_SELECTED",
      };
    }

    const reads: ResponseShape[] = [];
    const pendingReads: Promise<void>[] = [];
    let stockHeaders: Record<string, string> | null = null;

    const onResponse = (response: Response): void => {
      try {
        const url = new URL(response.url());
        if (
          response.request().method() !== "GET"
          || url.hostname !== "api.koper.com.br"
          || !TARGET_PATHS.has(url.pathname)
        ) return;

        stockHeaders ??= response.request().headers();
        pendingReads.push(
          responseShape(response)
            .then((shape) => { reads.push(shape); })
            .catch(() => undefined),
        );
      } catch {
        // Ignora URLs inválidas.
      }
    };
    page.on("response", onResponse);

    const visitedUrls: string[] = [];
    for (const url of [
      "https://app.koper.com.br/suprimentos/entradas/",
      "https://app.koper.com.br/suprimentos/entradas/view/13373",
      "https://app.koper.com.br/suprimentos/entradas/view/13374",
    ]) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 18_000 }).catch(() => undefined);
      await page.waitForTimeout(2_500);
      visitedUrls.push(page.url());
    }

    await Promise.allSettled(pendingReads);

    if (stockHeaders) {
      const directReads = [
        "https://api.koper.com.br/stock/v1/entry?limit=25&offset=0&orderFlag=desc&orderby=movementDate",
        "https://api.koper.com.br/stock/v1/pending_entry?limit=25&offset=0&orderFlag=asc&orderby=pendingEntryId&originType=all&placeEntryId=all",
        "https://api.koper.com.br/stock/v1/product_entry?entryId=13373&pending=false",
        "https://api.koper.com.br/stock/v1/product_entry?entryId=13374&pending=false",
      ];
      for (const url of directReads) {
        const response = await page.request.get(url, { headers: stockHeaders, timeout: 15_000 });
        reads.push(await responseShape(response));
      }
    }

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
  }, { sessionTimeoutMs: 58_000 });
}
