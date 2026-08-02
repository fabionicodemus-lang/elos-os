import type { Page, Response } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { collectFieldPaths } from "./discover-stock-route.js";

type EngineeringRead = {
  endpoint: string;
  statusCode: number;
  queryParams: Record<string, string>;
  dataKeys: string[];
  fieldPaths: string[];
  returnedRecords: number;
  sample: unknown[];
};

type VisitedPage = {
  url: string;
  title: string;
  headings: string[];
};

export type KoperEngineeringDiagnostic = {
  ok: true;
  authenticated: boolean;
  activeCompanyBefore: string | null;
  activeCompanyAfter: string | null;
  flowSelected: boolean;
  visitedPages: VisitedPage[];
  reads: EngineeringRead[];
  blockedWrites: Array<{ method: string; endpoint: string }>;
  fullServiceRecords?: Array<Record<string, unknown>>;
  fullConstructionBudget?: Record<string, unknown>;
  fullBudgetItems?: Array<Record<string, unknown>>;
  message: string | null;
  checkedAt: string;
};

const flowEnterpriseId = "6d3b4724-5880-11ee-827d-1219c832db49";
const engineeringPaths = [
  /^\/supply\/v2\/services(?:\/[^/]+(?:\/version)?)?$/,
  /^\/engineering\/v1\/(?:construction_budget|item_budget|budget_composition|budget_input|composition|service|category|building|source_table)$/,
];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safePreview(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[MAX_DEPTH]";
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") return value.slice(0, 300);
  if (Array.isArray(value)) {
    return value.slice(0, 3).map((item) => safePreview(item, depth + 1));
  }
  if (typeof value !== "object") return String(value).slice(0, 100);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/password|senha|token|secret|authorization|cookie/i.test(key))
      .slice(0, 80)
      .map(([key, item]) => [key, safePreview(item, depth + 1)]),
  );
}

function extractItems(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (typeof body !== "object" || body === null) return [];

  const object = body as Record<string, unknown>;
  for (const key of ["items", "records", "data", "services", "compositions", "inputs"]) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }

  return [body];
}

async function readActiveCompanyLabel(page: Page): Promise<string | null> {
  const candidates = page.locator(
    "button, [role='button'], [class*='company' i], [class*='enterprise' i]",
  );
  const count = Math.min(await candidates.count(), 150);
  let best: { text: string; score: number } | null = null;

  for (let index = 0; index < count; index += 1) {
    const element = candidates.nth(index);
    if (!(await element.isVisible().catch(() => false))) continue;

    const metadata = await element
      .evaluate((node) => {
        const rect = (node as HTMLElement).getBoundingClientRect();
        return {
          text: ((node as HTMLElement).innerText || "").trim(),
          x: rect.x,
          y: rect.y,
          viewportWidth: window.innerWidth,
        };
      })
      .catch(() => null);

    if (!metadata?.text || metadata.text.length > 80) continue;

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

async function openCompanySelector(page: Page, activeCompanyLabel: string): Promise<void> {
  const label = page.getByText(activeCompanyLabel, { exact: true }).last();
  const control = label.locator(
    "xpath=ancestor-or-self::*[self::button or self::a or @role='button'][1]",
  );

  if (!(await control.isVisible().catch(() => false))) return;

  await control.click();
  await page.waitForTimeout(1_000);

  const changeCompany = page
    .getByText(/^Acessar outra empresa$/i, { exact: true })
    .last();

  if (await changeCompany.isVisible().catch(() => false)) {
    await changeCompany.click();
    await page.waitForTimeout(1_000);
  }
}

async function collectVisitedPage(page: Page): Promise<VisitedPage> {
  const headingLocator = page.locator("h1, h2, h3, [role='heading']");
  const count = Math.min(await headingLocator.count(), 30);
  const headings: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const heading = headingLocator.nth(index);
    if (!(await heading.isVisible().catch(() => false))) continue;
    const text = normalizeText(await heading.innerText().catch(() => ""));
    if (text && !headings.includes(text)) headings.push(text.slice(0, 200));
  }

  const parsed = new URL(page.url());
  return {
    url: parsed.origin + parsed.pathname,
    title: await page.title().catch(() => ""),
    headings,
  };
}

function isAllowedGraphQlRead(url: URL, method: string, postData: string | null): boolean {
  if (
    method !== "POST" ||
    url.hostname !== "graphql.koper.com.br" ||
    url.pathname !== "/" ||
    !postData
  ) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(postData);
    const operations = Array.isArray(parsed) ? parsed : [parsed];

    return (
      operations.length > 0 &&
      operations.every((operation) => {
        if (typeof operation !== "object" || operation === null) return false;
        const query = (operation as Record<string, unknown>).query;
        return (
          typeof query === "string" &&
          !/\bmutation\b/i.test(query) &&
          /\bquery\b/i.test(query)
        );
      })
    );
  } catch {
    return false;
  }
}

function isAllowedFlowSwitch(url: URL, method: string, postData: string | null): boolean {
  if (
    method !== "POST" ||
    url.hostname !== "api.koper.com.br" ||
    url.pathname !== "/login/change_company" ||
    !postData
  ) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(postData);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return false;
    }

    const body = parsed as Record<string, unknown>;
    const allowedKeys = new Set(["accessToken", "toEnterpriseId", "changeCompany"]);
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

async function fetchAllServiceRecords(
  page: Page,
  requestHeaders: Record<string, string>,
): Promise<Array<Record<string, unknown>>> {
  const records: Array<Record<string, unknown>> = [];
  const limit = 100;

  for (let offset = 0; ; offset += limit) {
    const query = new URLSearchParams({
      orderFlag: "desc",
      sort: "id",
      search: "",
      limit: String(limit),
      offset: String(offset),
    });
    const response = await page.request.get(
      `https://api.koper.com.br/supply/v2/services?${query.toString()}`,
      { headers: requestHeaders, timeout: 30_000 },
    );

    if (!response.ok()) {
      throw new Error(`Koper services request failed (HTTP ${response.status()})`);
    }

    const body: unknown = await response.json();
    const object =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : null;
    const items = Array.isArray(object?.items) ? object.items : [];
    const total = typeof object?.total === "number" ? object.total : null;

    records.push(
      ...items.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      ),
    );

    if (items.length < limit || (total !== null && records.length >= total)) break;
  }

  return records;
}

async function fetchConstructionBudget(
  page: Page,
  requestHeaders: Record<string, string>,
  engBudgetId: number,
): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ engBudgetId: String(engBudgetId) });
  const response = await page.request.get(
    `https://api.koper.com.br/engineering/v1/construction_budget?${query.toString()}`,
    { headers: requestHeaders, timeout: 30_000 },
  );

  if (!response.ok()) {
    throw new Error(`Koper budget request failed (HTTP ${response.status()})`);
  }

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Invalid Koper construction budget response");
  }

  return body as Record<string, unknown>;
}

async function fetchAllBudgetItems(
  page: Page,
  requestHeaders: Record<string, string>,
  engBudgetId: number,
): Promise<Array<Record<string, unknown>>> {
  const records: Array<Record<string, unknown>> = [];
  const limit = 40;

  for (let offset = 0; ; offset += limit) {
    const query = new URLSearchParams({
      engBudgetId: String(engBudgetId),
      limit: String(limit),
      offset: String(offset),
    });
    const response = await page.request.get(
      `https://api.koper.com.br/engineering/v1/item_budget?${query.toString()}`,
      { headers: requestHeaders, timeout: 30_000 },
    );

    if (!response.ok()) {
      throw new Error(`Koper budget items request failed (HTTP ${response.status()})`);
    }

    const body: unknown = await response.json();
    const object =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : null;
    const items = Array.isArray(object?.items) ? object.items : [];
    const total =
      typeof object?.itemsAmount === "number" ? object.itemsAmount : null;

    records.push(
      ...items.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      ),
    );

    if (items.length < limit || (total !== null && records.length >= total)) break;
  }

  return records;
}

export async function inspectKoperEngineering(
  options: { collectFullServices?: boolean; collectFullBudget?: boolean } = {},
): Promise<KoperEngineeringDiagnostic> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);

    if (!login.authenticated) {
      return {
        ok: true,
        authenticated: false,
        activeCompanyBefore: null,
        activeCompanyAfter: null,
        flowSelected: false,
        visitedPages: [],
        reads: [],
        blockedWrites: [],
        message: login.message,
        checkedAt: new Date().toISOString(),
      };
    }

    await page.waitForTimeout(3_000);

    const reads: EngineeringRead[] = [];
    const blockedWrites: Array<{ method: string; endpoint: string }> = [];
    const pendingResponses: Promise<void>[] = [];
    const visitedPages: VisitedPage[] = [];
    let serviceRequestHeaders: Record<string, string> | null = null;
    let budgetRequestHeaders: Record<string, string> | null = null;
    let fullServiceRecords: Array<Record<string, unknown>> | undefined;
    let fullConstructionBudget: Record<string, unknown> | undefined;
    let fullBudgetItems: Array<Record<string, unknown>> | undefined;
    const activeCompanyBefore = await readActiveCompanyLabel(page).catch(() => null);

    await page.route("**/*", async (route) => {
      const request = route.request();
      const method = request.method();

      try {
        const parsed = new URL(request.url());
        const isKoper =
          parsed.hostname === "koper.com.br" || parsed.hostname.endsWith(".koper.com.br");
        const safeRead = ["GET", "HEAD", "OPTIONS"].includes(method);

        const allowedReadPost = isAllowedGraphQlRead(
          parsed,
          method,
          request.postData(),
        );

        if (
          isKoper &&
          !safeRead &&
          !allowedReadPost &&
          !isAllowedFlowSwitch(parsed, method, request.postData())
        ) {
          blockedWrites.push({
            method,
            endpoint: parsed.origin + parsed.pathname,
          });
          await route.abort("blockedbyclient");
          return;
        }
      } catch {
        // URLs inválidas seguem o fluxo normal do navegador.
      }

      await route.continue();
    });

    const onResponse = (response: Response): void => {
      try {
        const request = response.request();
        const parsed = new URL(response.url());

        if (
          request.method() !== "GET" ||
          parsed.hostname !== "api.koper.com.br" ||
          !engineeringPaths.some((pattern) => pattern.test(parsed.pathname))
        ) {
          return;
        }

        if (
          parsed.pathname === "/supply/v2/services" &&
          serviceRequestHeaders === null
        ) {
          serviceRequestHeaders = request.headers();
        }
        if (
          parsed.pathname.startsWith("/engineering/v1/") &&
          budgetRequestHeaders === null
        ) {
          budgetRequestHeaders = request.headers();
        }

        const task = response
          .json()
          .then((body: unknown) => {
            const object =
              typeof body === "object" && body !== null && !Array.isArray(body)
                ? (body as Record<string, unknown>)
                : null;
            const items = extractItems(body);
            const queryParams = Object.fromEntries(
              [...parsed.searchParams.entries()]
                .filter(([key]) => !/accessToken|token|cb/i.test(key))
                .slice(0, 30),
            );

            reads.push({
              endpoint: parsed.origin + parsed.pathname,
              statusCode: response.status(),
              queryParams,
              dataKeys: object ? Object.keys(object).slice(0, 80) : [],
              fieldPaths: collectFieldPaths(body).slice(0, 400),
              returnedRecords: items.length,
              sample: items.slice(0, 3).map((item) => safePreview(item)),
            });
          })
          .catch(() => undefined);

        pendingResponses.push(task);
      } catch {
        // Ignora respostas fora das APIs de Engenharia.
      }
    };

    page.on("response", onResponse);

    let flowSelected = /flow/i.test(activeCompanyBefore ?? "");
    let activeCompanyAfter = activeCompanyBefore;
    let message: string | null = null;

    if (!flowSelected && activeCompanyBefore) {
      await openCompanySelector(page, activeCompanyBefore).catch(() => undefined);

      const flowCard = page
        .locator('[data-testid="multiCompaniesModal"]')
        .filter({
          has: page.getByText(/^FLOW APTOS - BOSSA$/i, { exact: true }),
        })
        .first();

      if (await flowCard.isVisible().catch(() => false)) {
        const action = flowCard
          .getByText(/^Acessar esta empresa$/i, { exact: true })
          .last();

        if (await action.isVisible().catch(() => false)) {
          await action.click();

          for (let attempt = 0; attempt < 10; attempt += 1) {
            await page.waitForTimeout(2_000);
            activeCompanyAfter = await readActiveCompanyLabel(page).catch(() => null);
            if (/flow/i.test(activeCompanyAfter ?? "")) break;
          }

          flowSelected = /flow/i.test(activeCompanyAfter ?? "");
        }
      }
    }

    if (!flowSelected) {
      message = "KOPER_FLOW_COMPANY_NOT_SELECTED";
    } else {
      try {
        await page.goto(
          "https://web.koper.com.br/engenharia/cadastros/fichas-de-servicos",
          { waitUntil: "domcontentloaded", timeout: 30_000 },
        );
        await page.waitForTimeout(8_000);
        visitedPages.push(await collectVisitedPage(page));

        if (options.collectFullServices) {
          if (!serviceRequestHeaders) {
            throw new Error("Koper service request headers were not captured");
          }
          fullServiceRecords = await fetchAllServiceRecords(
            page,
            serviceRequestHeaders,
          );
        }

        await page.goto(
          "https://app.koper.com.br/engenharia/orcamentos_obra",
          { waitUntil: "domcontentloaded", timeout: 30_000 },
        );
        await page.waitForTimeout(8_000);
        visitedPages.push(await collectVisitedPage(page));

        const budgetRow = page
          .locator("tr")
          .filter({ hasText: /Flow Aptos - OBRA/i })
          .first();
        const budgetName = page
          .getByText(/^Flow Aptos - OBRA$/i, { exact: true })
          .first();

        if (await budgetRow.isVisible().catch(() => false)) {
          const link = budgetRow.locator("a").first();
          if (await link.isVisible().catch(() => false)) {
            await link.click();
          } else {
            await budgetRow.click();
          }
          await page.waitForTimeout(8_000);
          visitedPages.push(await collectVisitedPage(page));
        } else if (await budgetName.isVisible().catch(() => false)) {
          await budgetName.click();
          await page.waitForTimeout(8_000);
          visitedPages.push(await collectVisitedPage(page));
        } else {
          message = "KOPER_CONSTRUCTION_BUDGET_100_ROW_NOT_FOUND";
        }

        if (options.collectFullBudget && !message) {
          if (!budgetRequestHeaders) {
            throw new Error("Koper budget request headers were not captured");
          }
          fullConstructionBudget = await fetchConstructionBudget(
            page,
            budgetRequestHeaders,
            100,
          );
          fullBudgetItems = await fetchAllBudgetItems(
            page,
            budgetRequestHeaders,
            100,
          );
        }
      } catch (error) {
        message =
          error instanceof Error
            ? error.message
            : "Falha desconhecida ao inspecionar Engenharia.";
      }
    }

    await Promise.allSettled(pendingResponses);
    page.off("response", onResponse);

    return {
      ok: true,
      authenticated: true,
      activeCompanyBefore,
      activeCompanyAfter,
      flowSelected,
      visitedPages,
      reads,
      blockedWrites,
      ...(fullServiceRecords ? { fullServiceRecords } : {}),
      ...(fullConstructionBudget ? { fullConstructionBudget } : {}),
      ...(fullBudgetItems ? { fullBudgetItems } : {}),
      message,
      checkedAt: new Date().toISOString(),
    };
  });
}
