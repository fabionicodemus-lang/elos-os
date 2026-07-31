import type { Locator, Page, Response } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";

type GraphQlOperation = {
  operationName: string | null;
  variableKeys: string[];
  status: number;
  dataKeys: string[];
  errorCount: number;
};

export type StockRequestsDiagnostic = {
  ok: true;
  authenticated: boolean;
  clicked: boolean;
  clickMethod: string | null;
  finalUrl: string;
  title: string;
  headings: string[];
  buttons: string[];
  tableHeaders: string[];
  visibleRowCount: number;
  bodyTextPreview: string;
  graphql: GraphQlOperation[];
  message: string | null;
  checkedAt: string;
};

type GraphQlPayload = {
  operationName?: unknown;
  variables?: unknown;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function collectTexts(
  page: Page,
  selector: string,
  limit: number,
): Promise<string[]> {
  const locator = page.locator(selector);
  const count = Math.min(await locator.count(), limit);
  const values: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);

    if (!(await item.isVisible().catch(() => false))) {
      continue;
    }

    const text = normalizeText(await item.innerText().catch(() => ""));

    if (text && !values.includes(text)) {
      values.push(text.slice(0, 300));
    }
  }

  return values;
}

function payloadsFromPostData(postData: string | null): GraphQlPayload[] {
  if (!postData) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(postData);

    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is GraphQlPayload =>
          typeof item === "object" && item !== null,
      );
    }

    if (typeof parsed === "object" && parsed !== null) {
      return [parsed as GraphQlPayload];
    }
  } catch {
    // O diagnóstico não precisa armazenar corpos que não sejam JSON válido.
  }

  return [];
}

function variableKeys(variables: unknown): string[] {
  if (typeof variables !== "object" || variables === null || Array.isArray(variables)) {
    return [];
  }

  return Object.keys(variables).slice(0, 50);
}

async function inspectGraphQlResponse(
  response: Response,
): Promise<GraphQlOperation[]> {
  const request = response.request();
  const payloads = payloadsFromPostData(request.postData());
  let responseBody: unknown = null;

  try {
    responseBody = await response.json();
  } catch {
    // Algumas respostas podem não ser JSON ou podem ter o corpo indisponível.
  }

  const responseItems = Array.isArray(responseBody) ? responseBody : [responseBody];

  return payloads.map((payload, index) => {
    const item = responseItems[index];
    const itemObject =
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>)
        : null;
    const data = itemObject?.data;
    const errors = itemObject?.errors;

    return {
      operationName:
        typeof payload.operationName === "string" ? payload.operationName : null,
      variableKeys: variableKeys(payload.variables),
      status: response.status(),
      dataKeys:
        typeof data === "object" && data !== null && !Array.isArray(data)
          ? Object.keys(data).slice(0, 50)
          : [],
      errorCount: Array.isArray(errors) ? errors.length : 0,
    };
  });
}

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    const count = Math.min(await candidate.count(), 80);

    for (let index = 0; index < count; index += 1) {
      const locator = candidate.nth(index);

      if (await locator.isVisible().catch(() => false)) {
        return locator;
      }
    }
  }

  return null;
}

async function clickStockRequests(page: Page): Promise<string> {
  const textPattern = /solicita(?:ç|c)(?:ões|oes) de estoque/i;
  const textLocator = await firstVisible([
    page.getByText(textPattern, { exact: true }),
    page
      .locator(
        "h1, h2, h3, h4, h5, h6, [role='heading'], button, a, [role='button'], p, span, div",
      )
      .filter({ hasText: textPattern }),
  ]);

  if (!textLocator) {
    throw new Error("KOPER_STOCK_REQUESTS_VISIBLE_TEXT_NOT_FOUND");
  }

  await textLocator.scrollIntoViewIfNeeded();

  const clickable = await firstVisible([
    page.getByRole("button", { name: textPattern }),
    page.getByRole("link", { name: textPattern }),
    textLocator.locator(
      "xpath=ancestor-or-self::*[self::button or self::a or @role='button' or @onclick or @tabindex][1]",
    ),
  ]);

  if (clickable) {
    await clickable.click();
    return "visible-clickable-ancestor";
  }

  const domClickMethod = await textLocator.evaluate((element) => {
    let current: HTMLElement | null = element as HTMLElement;

    for (let depth = 0; current && depth < 10; depth += 1) {
      const tag = current.tagName.toLowerCase();
      const role = current.getAttribute("role");
      const style = window.getComputedStyle(current);
      const looksClickable =
        tag === "button" ||
        tag === "a" ||
        role === "button" ||
        current.hasAttribute("tabindex") ||
        current.hasAttribute("onclick") ||
        style.cursor === "pointer";

      if (looksClickable) {
        current.click();
        return `ancestor-${tag}`;
      }

      current = current.parentElement;
    }

    (element as HTMLElement).click();
    return "text-element-bubble";
  });

  return domClickMethod;
}

export async function inspectStockRequests(): Promise<StockRequestsDiagnostic> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);

    if (!login.authenticated) {
      return {
        ok: true,
        authenticated: false,
        clicked: false,
        clickMethod: null,
        finalUrl: login.finalUrl,
        title: login.title,
        headings: [],
        buttons: [],
        tableHeaders: [],
        visibleRowCount: 0,
        bodyTextPreview: login.message ?? "",
        graphql: [],
        message: login.message,
        checkedAt: new Date().toISOString(),
      };
    }

    await page.waitForTimeout(3_000);

    const graphql: GraphQlOperation[] = [];
    const pending: Promise<void>[] = [];

    const onResponse = (response: Response): void => {
      try {
        const hostname = new URL(response.url()).hostname;

        if (hostname !== "graphql.koper.com.br") {
          return;
        }
      } catch {
        return;
      }

      const task = inspectGraphQlResponse(response)
        .then((operations) => {
          graphql.push(...operations);
        })
        .catch(() => undefined);

      pending.push(task);
    };

    page.on("response", onResponse);

    let clicked = false;
    let clickMethod: string | null = null;
    let message: string | null = null;

    try {
      clickMethod = await clickStockRequests(page);
      clicked = true;

      await Promise.race([
        page.waitForLoadState("domcontentloaded", { timeout: 15_000 }),
        page.waitForTimeout(15_000),
      ]).catch(() => undefined);
      await page.waitForTimeout(4_000);
      await Promise.allSettled(pending);
    } catch (error) {
      message = error instanceof Error ? error.message : "Falha desconhecida ao abrir solicitações de estoque.";
    } finally {
      page.off("response", onResponse);
    }

    const bodyTextPreview = normalizeText(
      await page.locator("body").innerText().catch(() => ""),
    ).slice(0, 8_000);

    const tableHeaders = await collectTexts(
      page,
      "table thead th, [role='columnheader']",
      80,
    );
    const visibleRowCount = await page
      .locator("table tbody tr, [role='row']")
      .evaluateAll((rows) =>
        rows.filter((row) => {
          const element = row as HTMLElement;
          const style = window.getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden";
        }).length,
      )
      .catch(() => 0);

    return {
      ok: true,
      authenticated: true,
      clicked,
      clickMethod,
      finalUrl: page.url(),
      title: await page.title().catch(() => ""),
      headings: await collectTexts(page, "h1, h2, h3, [role='heading']", 80),
      buttons: await collectTexts(
        page,
        "button, [role='button'], input[type='button'], input[type='submit']",
        120,
      ),
      tableHeaders,
      visibleRowCount,
      bodyTextPreview,
      graphql: graphql.slice(0, 120),
      message,
      checkedAt: new Date().toISOString(),
    };
  });
}
