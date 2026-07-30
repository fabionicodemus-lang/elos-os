import type { Locator, Page, Response } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";

type AncestorInfo = {
  depth: number;
  tag: string;
  id: string | null;
  role: string | null;
  className: string;
  cursor: string;
  visible: boolean;
  href: string | null;
  routeAttribute: string | null;
  routeValue: string | null;
  ariaLabel: string | null;
  testId: string | null;
};

type TextOccurrence = {
  index: number;
  visible: boolean;
  tag: string;
  className: string;
  ancestors: AncestorInfo[];
};

type GraphQlOperation = {
  operationName: string | null;
  variableKeys: string[];
  status: number;
};

export type StockRouteDiagnostic = {
  ok: true;
  authenticated: boolean;
  strategy: string | null;
  menuOpened: boolean;
  routeCandidate: string | null;
  finalUrl: string;
  title: string;
  occurrencesBefore: TextOccurrence[];
  occurrencesAfterMenu: TextOccurrence[];
  headings: string[];
  tableHeaders: string[];
  bodyTextPreview: string;
  graphql: GraphQlOperation[];
  message: string | null;
  checkedAt: string;
};

const stockTextPattern = /solicita(?:ç|c)(?:ões|oes) de estoque/i;

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

async function collectOccurrences(page: Page): Promise<TextOccurrence[]> {
  const locator = page.getByText(stockTextPattern, { exact: true });
  const count = Math.min(await locator.count(), 40);
  const occurrences: TextOccurrence[] = [];

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);

    const occurrence = await item
      .evaluate((element, occurrenceIndex) => {
        const ancestors: AncestorInfo[] = [];
        let current: HTMLElement | null = element as HTMLElement;

        for (let depth = 0; current && depth < 12; depth += 1) {
          const style = window.getComputedStyle(current);
          const rect = current.getBoundingClientRect();
          const visible =
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden";
          const routeAttributes = [
            "href",
            "data-href",
            "data-to",
            "to",
            "routerlink",
            "data-path",
          ];
          let routeAttribute: string | null = null;
          let routeValue: string | null = null;

          for (const attribute of routeAttributes) {
            const value = current.getAttribute(attribute);

            if (value) {
              routeAttribute = attribute;
              routeValue = value;
              break;
            }
          }

          ancestors.push({
            depth,
            tag: current.tagName.toLowerCase(),
            id: current.id || null,
            role: current.getAttribute("role"),
            className: String(current.className ?? "").slice(0, 500),
            cursor: style.cursor,
            visible,
            href:
              current instanceof HTMLAnchorElement && current.href
                ? current.href
                : null,
            routeAttribute,
            routeValue,
            ariaLabel: current.getAttribute("aria-label"),
            testId: current.getAttribute("data-testid"),
          });

          current = current.parentElement;
        }

        const style = window.getComputedStyle(element as HTMLElement);
        const rect = (element as HTMLElement).getBoundingClientRect();

        return {
          index: occurrenceIndex,
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden",
          tag: (element as HTMLElement).tagName.toLowerCase(),
          className: String((element as HTMLElement).className ?? "").slice(0, 500),
          ancestors,
        };
      }, index)
      .catch(() => null);

    if (occurrence) {
      occurrences.push(occurrence);
    }
  }

  return occurrences;
}

function findRouteCandidate(occurrences: TextOccurrence[]): string | null {
  for (const occurrence of occurrences) {
    for (const ancestor of occurrence.ancestors) {
      const candidate = ancestor.href ?? ancestor.routeValue;

      if (
        candidate &&
        candidate !== "#" &&
        !candidate.toLowerCase().startsWith("javascript:")
      ) {
        return candidate;
      }
    }
  }

  return null;
}

async function clickVisibleStockOccurrence(page: Page): Promise<boolean> {
  const locator = page.getByText(stockTextPattern, { exact: true });
  const count = Math.min(await locator.count(), 40);

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);

    if (!(await item.isVisible().catch(() => false))) {
      continue;
    }

    await item.scrollIntoViewIfNeeded().catch(() => undefined);
    await item.evaluate((element) => {
      let current: HTMLElement | null = element as HTMLElement;

      for (let depth = 0; current && depth < 12; depth += 1) {
        const style = window.getComputedStyle(current);
        const tag = current.tagName.toLowerCase();
        const clickable =
          tag === "a" ||
          tag === "button" ||
          current.getAttribute("role") === "button" ||
          current.hasAttribute("onclick") ||
          current.hasAttribute("tabindex") ||
          style.cursor === "pointer";

        if (clickable) {
          current.click();
          return;
        }

        current = current.parentElement;
      }

      (element as HTMLElement).click();
    });

    return true;
  }

  return false;
}

async function openLikelyMenu(page: Page): Promise<boolean> {
  const buttons = page.locator("button, [role='button']");
  const count = Math.min(await buttons.count(), 100);
  let best: { locator: Locator; score: number } | null = null;

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);

    if (!(await button.isVisible().catch(() => false))) {
      continue;
    }

    const metadata = await button
      .evaluate((element) => {
        const node = element as HTMLElement;
        const rect = node.getBoundingClientRect();
        return {
          text: (node.innerText || "").trim(),
          aria: node.getAttribute("aria-label") || "",
          title: node.getAttribute("title") || "",
          testId: node.getAttribute("data-testid") || "",
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          hasSvg: Boolean(node.querySelector("svg")),
        };
      })
      .catch(() => null);

    if (!metadata) {
      continue;
    }

    const combined = `${metadata.text} ${metadata.aria} ${metadata.title} ${metadata.testId}`;
    let score = 0;

    if (/menu|navega|sidebar|drawer/i.test(combined)) score += 10;
    if (metadata.hasSvg) score += 2;
    if (!metadata.text) score += 2;
    if (metadata.x < 160 && metadata.y < 180) score += 4;
    if (metadata.width <= 100 && metadata.height <= 100) score += 1;

    if (!best || score > best.score) {
      best = { locator: button, score };
    }
  }

  if (!best || best.score < 5) {
    return false;
  }

  await best.locator.click({ force: true });
  await page.waitForTimeout(1_500);
  return true;
}

function parseGraphQlOperation(response: Response): GraphQlOperation[] {
  const request = response.request();
  const postData = request.postData();

  if (!postData) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(postData);
    const payloads = Array.isArray(parsed) ? parsed : [parsed];

    return payloads
      .filter((payload): payload is Record<string, unknown> =>
        Boolean(payload && typeof payload === "object"),
      )
      .map((payload) => ({
        operationName:
          typeof payload.operationName === "string" ? payload.operationName : null,
        variableKeys:
          payload.variables &&
          typeof payload.variables === "object" &&
          !Array.isArray(payload.variables)
            ? Object.keys(payload.variables).slice(0, 50)
            : [],
        status: response.status(),
      }));
  } catch {
    return [];
  }
}

export async function discoverStockRoute(): Promise<StockRouteDiagnostic> {
  return withBrowserless(async ({ page }) => {
    const graphql: GraphQlOperation[] = [];
    const login = await performKoperLogin(page);

    if (!login.authenticated) {
      return {
        ok: true,
        authenticated: false,
        strategy: null,
        menuOpened: false,
        routeCandidate: null,
        finalUrl: login.finalUrl,
        title: login.title,
        occurrencesBefore: [],
        occurrencesAfterMenu: [],
        headings: [],
        tableHeaders: [],
        bodyTextPreview: login.message ?? "",
        graphql: [],
        message: login.message,
        checkedAt: new Date().toISOString(),
      };
    }

    const onResponse = (response: Response): void => {
      try {
        if (new URL(response.url()).hostname !== "graphql.koper.com.br") {
          return;
        }
      } catch {
        return;
      }

      graphql.push(...parseGraphQlOperation(response));
    };

    page.on("response", onResponse);

    let strategy: string | null = null;
    let menuOpened = false;
    let routeCandidate: string | null = null;
    let message: string | null = null;
    let occurrencesBefore: TextOccurrence[] = [];
    let occurrencesAfterMenu: TextOccurrence[] = [];

    try {
      await page.waitForTimeout(2_500);
      occurrencesBefore = await collectOccurrences(page);
      routeCandidate = findRouteCandidate(occurrencesBefore);

      if (routeCandidate) {
        const target = new URL(routeCandidate, page.url()).toString();
        await page.goto(target, { waitUntil: "domcontentloaded" });
        strategy = "direct-route-from-hidden-or-visible-menu";
      } else {
        menuOpened = await openLikelyMenu(page);
        occurrencesAfterMenu = await collectOccurrences(page);
        routeCandidate = findRouteCandidate(occurrencesAfterMenu);

        if (routeCandidate) {
          const target = new URL(routeCandidate, page.url()).toString();
          await page.goto(target, { waitUntil: "domcontentloaded" });
          strategy = "open-menu-and-navigate-route";
        } else if (await clickVisibleStockOccurrence(page)) {
          strategy = menuOpened
            ? "open-menu-and-click-visible-item"
            : "click-visible-item";
        } else {
          message = "KOPER_STOCK_REQUEST_ROUTE_NOT_DISCOVERED";
        }
      }

      await page.waitForTimeout(5_000);
    } catch (error) {
      message =
        error instanceof Error
          ? error.message
          : "Falha desconhecida ao descobrir a rota de solicitações.";
    } finally {
      page.off("response", onResponse);
    }

    const bodyTextPreview = normalizeText(
      await page.locator("body").innerText().catch(() => ""),
    ).slice(0, 8_000);

    return {
      ok: true,
      authenticated: true,
      strategy,
      menuOpened,
      routeCandidate,
      finalUrl: page.url(),
      title: await page.title().catch(() => ""),
      occurrencesBefore,
      occurrencesAfterMenu,
      headings: await collectTexts(page, "h1, h2, h3, [role='heading']", 80),
      tableHeaders: await collectTexts(
        page,
        "table thead th, [role='columnheader']",
        80,
      ),
      bodyTextPreview,
      graphql: graphql.slice(0, 120),
      message,
      checkedAt: new Date().toISOString(),
    };
  });
}
