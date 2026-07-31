import type { Page, Response } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { collectFieldPaths } from "./discover-stock-route.js";

type CompanyOption = {
  text: string;
  tag: string;
  role: string | null;
  testId: string | null;
  href: string | null;
};

type CompanySummary = {
  enterpriseId: string | number | null;
  branchId: string | number | null;
  enterpriseName: string | null;
  fantasyName: string | null;
  stockPlaceName: string | null;
};

type CompanyApiRead = {
  method: string;
  status: number;
  endpoint: string;
  dataKeys: string[];
  fieldPaths: string[];
  companies: CompanySummary[];
};

export type KoperCompaniesDiagnostic = {
  ok: true;
  authenticated: boolean;
  activeCompanyLabel: string | null;
  companyOptions: CompanyOption[];
  companyReads: CompanyApiRead[];
  message: string | null;
  checkedAt: string;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const companyEndpointPaths = new Set([
  "/administrative/v1/enterprise",
  "/administrative/v1/multi_company",
]);

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value.slice(0, 200) : null;
}

function idValue(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function collectCompanies(body: unknown): CompanySummary[] {
  const items = Array.isArray(body) ? body : [body];

  return items
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
      enterpriseId: idValue(item.enterpriseId),
      branchId: idValue(item.branchId),
      enterpriseName: stringValue(item.enterpriseName),
      fantasyName: stringValue(item.fantasyName),
      stockPlaceName: stringValue(item.stockPlaceName),
    }));
}

async function readActiveCompanyLabel(page: Page): Promise<string | null> {
  const candidates = page.locator("button, [role='button'], [class*='company' i], [class*='enterprise' i]");
  const count = Math.min(await candidates.count(), 150);
  let best: { text: string; score: number } | null = null;

  for (let index = 0; index < count; index += 1) {
    const element = candidates.nth(index);

    if (!(await element.isVisible().catch(() => false))) {
      continue;
    }

    const metadata = await element
      .evaluate((node) => {
        const rect = (node as HTMLElement).getBoundingClientRect();
        return {
          text: ((node as HTMLElement).innerText || "").trim(),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          viewportWidth: window.innerWidth,
        };
      })
      .catch(() => null);

    if (!metadata || !metadata.text || metadata.text.length > 80) {
      continue;
    }

    let score = 0;

    if (metadata.y < 180) score += 5;
    if (metadata.x > metadata.viewportWidth * 0.6) score += 5;
    if (/empreend|bossa|flow|alma|ltda|s\.?a\.?/i.test(metadata.text)) score += 3;

    if (score > 0 && (!best || score > best.score)) {
      best = { text: normalizeText(metadata.text), score };
    }
  }

  return best && best.score >= 8 ? best.text : null;
}

async function openCompanySelectorAndCollectOptions(
  page: Page,
  activeCompanyLabel: string,
): Promise<CompanyOption[]> {
  const label = page.getByText(activeCompanyLabel, { exact: true }).last();
  const control = label.locator(
    "xpath=ancestor-or-self::*[self::button or self::a or @role='button'][1]",
  );

  if (!(await control.isVisible().catch(() => false))) {
    return [];
  }

  await control.click();
  await page.waitForTimeout(1_000);

  const changeCompany = page
    .getByText(/^Acessar outra empresa$/i, { exact: true })
    .last();

  if (await changeCompany.isVisible().catch(() => false)) {
    await changeCompany.click();
    await page.waitForTimeout(1_000);
  }

  return page
    .locator("body *")
    .evaluateAll((elements) => {
      const seen = new Set<string>();

      return elements.flatMap((element) => {
        const node = element as HTMLElement;
        const text = (node.innerText || "").replace(/\s+/g, " ").trim();
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden";

        if (
          !visible ||
          !/bossa|flow|alma/i.test(text) ||
          text.length > 100 ||
          seen.has(text)
        ) {
          return [];
        }

        seen.add(text);
        return [{
          text,
          tag: node.tagName.toLowerCase(),
          role: node.getAttribute("role"),
          testId: node.getAttribute("data-testid"),
          href: node instanceof HTMLAnchorElement ? node.getAttribute("href") : null,
        }];
      });
    });
}

export async function inspectKoperCompanies(): Promise<KoperCompaniesDiagnostic> {
  return withBrowserless(async ({ page }) => {
    const companyReads: CompanyApiRead[] = [];
    const pendingResponses: Promise<void>[] = [];

    const onResponse = (response: Response): void => {
      try {
        const parsedUrl = new URL(response.url());

        if (
          response.request().method() === "GET" &&
          parsedUrl.hostname === "api.koper.com.br" &&
          companyEndpointPaths.has(parsedUrl.pathname)
        ) {
          const task = response
            .json()
            .then((body: unknown) => {
              const object =
                typeof body === "object" && body !== null
                  ? (body as Record<string, unknown>)
                  : null;

              companyReads.push({
                method: "GET",
                status: response.status(),
                endpoint: parsedUrl.origin + parsedUrl.pathname,
                dataKeys: object ? Object.keys(object).slice(0, 50) : [],
                fieldPaths: collectFieldPaths(body).slice(0, 200),
                companies: collectCompanies(body),
              });
            })
            .catch(() => undefined);

          pendingResponses.push(task);
        }
      } catch {
        // Ignora respostas fora das APIs administrativas de empresa.
      }
    };

    page.on("response", onResponse);

    const login = await performKoperLogin(page);
    let activeCompanyLabel: string | null = null;
    let companyOptions: CompanyOption[] = [];

    if (login.authenticated) {
      await page.waitForTimeout(3_000);
      activeCompanyLabel = await readActiveCompanyLabel(page).catch(() => null);

      if (activeCompanyLabel) {
        companyOptions = await openCompanySelectorAndCollectOptions(
          page,
          activeCompanyLabel,
        ).catch(() => []);
      }
    }

    await Promise.allSettled(pendingResponses);
    page.off("response", onResponse);

    return {
      ok: true,
      authenticated: login.authenticated,
      activeCompanyLabel,
      companyOptions,
      companyReads,
      message: login.authenticated ? null : login.message,
      checkedAt: new Date().toISOString(),
    };
  });
}


type NetworkSummary = {
  method: string;
  resourceType: string;
  endpoint: string;
  queryKeys: string[];
};

type StockRequestSample = {
  requestId: string | number | null;
  requestAuxId: string | number | null;
  stockPlaceId: string | number | null;
  stockPlaceName: string | null;
  productAmount: number | null;
  requestDate: string | null;
  deadline: string | null;
  status: string | null;
  isUrgent: boolean | null;
  isDraft: boolean | null;
};

type StockRequestRead = NetworkSummary & {
  listMode: "active" | "finalized";
  statusCode: number;
  queryParams: Record<string, string>;
  itemsAmount: number | null;
  returnedRecords: number;
  requests: StockRequestSample[];
};

type SwitchAttemptShape = {
  queryValueKind: "uuid" | "flag" | "other" | "missing";
  bodyKind: "json" | "form" | "text" | "empty";
  bodyKeys: string[];
  matchesFlowEnterpriseId: boolean;
  matchesFlowBranchId: boolean;
};

export type KoperFlowContextDiagnostic = {
  ok: true;
  authenticated: boolean;
  activeCompanyBefore: string | null;
  activeCompanyAfter: string | null;
  flowCardFound: boolean;
  flowSelected: boolean;
  stockListReached: boolean;
  finalizedControlFound: boolean;
  finalizedClicked: boolean;
  stockRequestReads: StockRequestRead[];
  finalUrl: string;
  network: NetworkSummary[];
  blockedWrites: NetworkSummary[];
  switchAttempts: SwitchAttemptShape[];
  storageKeysBefore: { local: string[]; session: string[] };
  storageKeysAfter: { local: string[]; session: string[] };
  message: string | null;
  checkedAt: string;
};

function sanitizeRequest(rawUrl: string, method: string, resourceType: string): NetworkSummary {
  const parsed = new URL(rawUrl);

  return {
    method,
    resourceType,
    endpoint: parsed.origin + parsed.pathname,
    queryKeys: [...new Set(parsed.searchParams.keys())].slice(0, 30),
  };
}

const flowEnterpriseId = "6d3b4724-5880-11ee-827d-1219c832db49";

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function collectSafeStockRequests(body: unknown): {
  itemsAmount: number | null;
  returnedRecords: number;
  requests: StockRequestSample[];
} {
  const object =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : null;
  const requests = Array.isArray(object?.requests) ? object.requests : [];

  return {
    itemsAmount: safeNumber(object?.itemsAmount),
    returnedRecords: requests.length,
    requests: requests.slice(0, 25).flatMap((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return [];
      }

      const record = item as Record<string, unknown>;

      return [{
        requestId: idValue(record.requestId),
        requestAuxId: idValue(record.requestAuxId),
        stockPlaceId: idValue(record.stockPlaceId),
        stockPlaceName: stringValue(record.stockPlaceName),
        productAmount: safeNumber(record.productAmount),
        requestDate: stringValue(record.requestDate),
        deadline: stringValue(record.deadline),
        status: stringValue(record.status),
        isUrgent: safeBoolean(record.isUrgent),
        isDraft: safeBoolean(record.isDraft),
      }];
    }),
  };
}

function safeStockQueryParams(parsedUrl: URL): Record<string, string> {
  const allowed = [
    "group",
    "limit",
    "offset",
    "open",
    "orderFlag",
    "orderby",
    "typeDate",
  ];

  return Object.fromEntries(
    allowed.flatMap((key) => {
      const value = parsedUrl.searchParams.get(key);
      return value === null ? [] : [[key, value]];
    }),
  );
}

function isAllowedFlowSwitchBody(postData: string | null): boolean {
  if (!postData) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(postData);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return false;
    }

    const body = parsed as Record<string, unknown>;
    const allowedKeys = new Set([
      "accessToken",
      "toEnterpriseId",
      "changeCompany",
    ]);
    const keys = Object.keys(body);

    return (
      keys.length === 3 &&
      keys.every((key) => allowedKeys.has(key)) &&
      typeof body.accessToken === "string" &&
      body.accessToken.length > 0 &&
      body.toEnterpriseId === flowEnterpriseId &&
      Object.hasOwn(body, "changeCompany")
    );
  } catch {
    return false;
  }
}

function inspectSwitchAttempt(
  rawUrl: string,
  postData: string | null,
): SwitchAttemptShape {
  const queryValue = new URL(rawUrl).searchParams.get("changeCompany");
  let bodyKind: SwitchAttemptShape["bodyKind"] = postData ? "text" : "empty";
  let bodyKeys: string[] = [];

  if (postData) {
    try {
      const parsed: unknown = JSON.parse(postData);
      bodyKind = "json";
      bodyKeys =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? Object.keys(parsed).slice(0, 30)
          : [];
    } catch {
      const form = new URLSearchParams(postData);
      const keys = [...new Set(form.keys())];

      if (keys.length > 0 && keys.some((key) => postData.includes("="))) {
        bodyKind = "form";
        bodyKeys = keys.slice(0, 30);
      }
    }
  }

  return {
    queryValueKind:
      queryValue === null
        ? "missing"
        : /^[0-9a-f-]{36}$/i.test(queryValue)
          ? "uuid"
          : /^(true|false|0|1)$/i.test(queryValue)
            ? "flag"
            : "other",
    bodyKind,
    bodyKeys,
    matchesFlowEnterpriseId:
      Boolean(postData?.includes("6d3b4724-5880-11ee-827d-1219c832db49")),
    matchesFlowBranchId:
      Boolean(postData?.includes("1c527099-2e63-465f-b97a-772e36a93d8c")),
  };
}

async function readStorageKeys(
  page: Page,
): Promise<{ local: string[]; session: string[] }> {
  return page.evaluate(() => ({
    local: Object.keys(localStorage).sort(),
    session: Object.keys(sessionStorage).sort(),
  }));
}

export async function inspectKoperFlowContext(): Promise<KoperFlowContextDiagnostic> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    const emptyStorage = { local: [], session: [] };

    if (!login.authenticated) {
      return {
        ok: true,
        authenticated: false,
        activeCompanyBefore: null,
        activeCompanyAfter: null,
        flowCardFound: false,
        flowSelected: false,
        stockListReached: false,
        finalizedControlFound: false,
        finalizedClicked: false,
        stockRequestReads: [],
        finalUrl: login.finalUrl,
        network: [],
        blockedWrites: [],
        switchAttempts: [],
        storageKeysBefore: emptyStorage,
        storageKeysAfter: emptyStorage,
        message: login.message,
        checkedAt: new Date().toISOString(),
      };
    }

    await page.waitForTimeout(3_000);

    const activeCompanyBefore = await readActiveCompanyLabel(page).catch(() => null);
    const storageKeysBefore = await readStorageKeys(page).catch(() => emptyStorage);
    const network: NetworkSummary[] = [];
    const blockedWrites: NetworkSummary[] = [];
    const stockRequestReads: StockRequestRead[] = [];
    const switchAttempts: SwitchAttemptShape[] = [];
    const pendingStockResponses: Promise<void>[] = [];
    let stockListMode: "active" | "finalized" = "active";

    await page.route("**/*", async (route) => {
      const request = route.request();
      const method = request.method();

      try {
        const parsedUrl = new URL(request.url());
        const hostname = parsedUrl.hostname;
        const isKoper =
          hostname === "koper.com.br" || hostname.endsWith(".koper.com.br");
        const isSafeRead = ["GET", "HEAD", "OPTIONS"].includes(method);
        const isCompanySwitch =
          method === "POST" &&
          hostname === "api.koper.com.br" &&
          parsedUrl.pathname === "/login/change_company";

        if (isCompanySwitch) {
          switchAttempts.push(
            inspectSwitchAttempt(request.url(), request.postData()),
          );
        }

        const isAllowedFlowSwitch =
          isCompanySwitch && isAllowedFlowSwitchBody(request.postData());

        if (isKoper && !isSafeRead && !isAllowedFlowSwitch) {
          blockedWrites.push(
            sanitizeRequest(request.url(), method, request.resourceType()),
          );
          await route.abort("blockedbyclient");
          return;
        }
      } catch {
        // URLs inválidas seguem o fluxo normal do navegador.
      }

      await route.continue();
    });

    const onRequest = (request: { url(): string; method(): string; resourceType(): string }): void => {
      try {
        const hostname = new URL(request.url()).hostname;

        if (
          network.length < 150 &&
          (hostname === "koper.com.br" || hostname.endsWith(".koper.com.br"))
        ) {
          network.push(
            sanitizeRequest(request.url(), request.method(), request.resourceType()),
          );
        }
      } catch {
        // Ignora URLs que não possam ser sanitizadas.
      }
    };

    const onResponse = (response: Response): void => {
      try {
        const request = response.request();
        const parsedUrl = new URL(response.url());

        if (
          request.method() === "GET" &&
          parsedUrl.hostname === "api.koper.com.br" &&
          parsedUrl.pathname === "/stock/v1/request"
        ) {
          const listMode = stockListMode;
          const summary = sanitizeRequest(
            response.url(),
            request.method(),
            request.resourceType(),
          );
          const task = response
            .json()
            .then((body: unknown) => {
              const safeBody = collectSafeStockRequests(body);

              stockRequestReads.push({
                ...summary,
                listMode,
                statusCode: response.status(),
                queryParams: safeStockQueryParams(parsedUrl),
                ...safeBody,
              });
            })
            .catch(() => undefined);

          pendingStockResponses.push(task);
        }
      } catch {
        // Ignora respostas que não possam ser sanitizadas.
      }
    };

    page.on("request", onRequest);
    page.on("response", onResponse);

    if (activeCompanyBefore) {
      await openCompanySelectorAndCollectOptions(page, activeCompanyBefore);
    }

    const flowCard = page
      .locator('[data-testid="multiCompaniesModal"]')
      .filter({
        has: page.getByText(/^FLOW APTOS - BOSSA$/i, { exact: true }),
      })
      .first();
    const flowCardFound = await flowCard.isVisible().catch(() => false);
    let flowSelected = false;
    let activeCompanyAfter: string | null = null;
    let message: string | null = null;

    if (flowCardFound) {
      const action = flowCard
        .getByText(/^Acessar esta empresa$/i, { exact: true })
        .last();

      if (await action.isVisible().catch(() => false)) {
        await action.click();
        flowSelected = true;
        await Promise.race([
          page.waitForLoadState("domcontentloaded", { timeout: 15_000 }),
          page.waitForTimeout(15_000),
        ]).catch(() => undefined);

        for (let attempt = 0; attempt < 10; attempt += 1) {
          await page.waitForTimeout(2_000);
          activeCompanyAfter = await readActiveCompanyLabel(page).catch(
            () => null,
          );

          if (/flow/i.test(activeCompanyAfter ?? "")) {
            break;
          }
        }
      } else {
        message = "KOPER_FLOW_ACCESS_ACTION_NOT_FOUND";
      }
    } else {
      message = "KOPER_FLOW_COMPANY_CARD_NOT_FOUND";
    }

    let stockListReached = false;
    let finalizedControlFound = false;
    let finalizedClicked = false;

    if (/flow/i.test(activeCompanyAfter ?? "")) {
      const supplies = page.locator('[data-testid="button-Suprimentos"]').first();

      if (await supplies.isVisible().catch(() => false)) {
        await supplies.click({ force: true });
        await page.waitForTimeout(1_500);

        const requests = page.getByText(/^Solicitações$/i, { exact: true });
        const count = Math.min(await requests.count(), 30);

        for (let index = 0; index < count; index += 1) {
          const item = requests.nth(index);

          if (await item.isVisible().catch(() => false)) {
            await item.click();
            await page.waitForTimeout(8_000);
            break;
          }
        }
      }

      stockListReached =
        page.url().includes("/suprimentos/solicitacoes") ||
        stockRequestReads.length > 0;

      if (stockListReached) {
        const finalized = page
          .locator("button, a, [role='button'], input[type='button'], input[type='submit']")
          .filter({ hasText: /ver finalizadas/i })
          .last();
        const finalizedInput = page
          .locator("input")
          .filter({ has: page.locator("[value*='FINALIZADAS' i]") })
          .last();
        const control =
          await finalized.isVisible().catch(() => false)
            ? finalized
            : finalizedInput;

        finalizedControlFound = await control.isVisible().catch(() => false);

        if (finalizedControlFound) {
          stockListMode = "finalized";
          const finalizedResponse = page.waitForResponse(
            (response) => {
              try {
                const url = new URL(response.url());
                return (
                  response.request().method() === "GET" &&
                  url.hostname === "api.koper.com.br" &&
                  url.pathname === "/stock/v1/request"
                );
              } catch {
                return false;
              }
            },
            { timeout: 15_000 },
          );

          await control.click();
          finalizedClicked = true;
          await finalizedResponse.catch(() => undefined);
          await page.waitForTimeout(2_000);
        }
      }
    }

    await Promise.allSettled(pendingStockResponses);
    page.off("request", onRequest);
    page.off("response", onResponse);
    await page.unroute("**/*").catch(() => undefined);

    activeCompanyAfter ??= await readActiveCompanyLabel(page).catch(() => null);
    const storageKeysAfter = await readStorageKeys(page).catch(() => emptyStorage);

    return {
      ok: true,
      authenticated: true,
      activeCompanyBefore,
      activeCompanyAfter,
      flowCardFound,
      flowSelected,
      stockListReached,
      finalizedControlFound,
      finalizedClicked,
      stockRequestReads,
      finalUrl: page.url(),
      network,
      blockedWrites,
      switchAttempts,
      storageKeysBefore,
      storageKeysAfter,
      message,
      checkedAt: new Date().toISOString(),
    };
  });
}
