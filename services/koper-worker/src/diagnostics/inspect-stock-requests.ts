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
    const locator = candidate.first();

    if (
      (await locator.count()) > 0 &&
      (await locator.isVisible().catch(() => false))
    ) {
      return locator;
    }
  }

  return null;
}

async function clickStockRequests(page: Page): Promise<string> {
  const textPattern = /solicita(?:ç|c)(?:ões|oes) de estoque/i;
  const textLocator = page.getByText(textPattern, { exact: true }).first();

  await textLocator.waitFor({ state: "visible", timeout: 15_000 });
  await textLocator.scrollIntoViewIfNeeded();

  const clickable = await firstVisible([
    page.getByRole("button", { name: textPattern }),
    page.getByRole("link", { name: textPattern }),
    textLocator.locator(
      "xpath=ancestor-or-self::*[self::button or self::a or @role='button' or @tabindex][1]",
    ),
  ]);

  if (clickable) {
    await clickable.click();
    return "clickable-ancestor";
  }

  // Em dashboards React, o texto pode estar dentro de um card cujo clique é
  // tratado por um ancestral sem semântica de botão. O evento ainda propaga.
  await textLocator.click();
  return "text-bubble";
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
