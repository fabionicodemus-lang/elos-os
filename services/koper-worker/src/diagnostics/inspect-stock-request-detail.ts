import type { Response } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import {
  clickVisibleStockOccurrence,
  collectFieldPaths,
  openLikelyMenu,
} from "./discover-stock-route.js";

type DetailApiRead = {
  method: string;
  status: number;
  endpoint: string;
  queryParams: Record<string, string>;
  dataKeys: string[];
  fieldPaths: string[];
};

export type StockRequestDetailDiagnostic = {
  ok: true;
  authenticated: boolean;
  listReached: boolean;
  rowClicked: boolean;
  clickedRowText: string | null;
  finalUrl: string;
  title: string;
  detailReads: DetailApiRead[];
  message: string | null;
  checkedAt: string;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const requestNumberPattern = /^#\d+/;

export async function inspectStockRequestDetail(): Promise<StockRequestDetailDiagnostic> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);

    if (!login.authenticated) {
      return {
        ok: true,
        authenticated: false,
        listReached: false,
        rowClicked: false,
        clickedRowText: null,
        finalUrl: login.finalUrl,
        title: login.title,
        detailReads: [],
        message: login.message,
        checkedAt: new Date().toISOString(),
      };
    }

    await page.waitForTimeout(2_500);
    await openLikelyMenu(page);
    const listReached = await clickVisibleStockOccurrence(page);
    await page.waitForTimeout(3_000);

    const detailReads: DetailApiRead[] = [];
    const pendingResponses: Promise<void>[] = [];

    const onResponse = (response: Response): void => {
      try {
        const parsedUrl = new URL(response.url());

        if (
          response.request().method() === "GET" &&
          parsedUrl.hostname === "api.koper.com.br" &&
          parsedUrl.pathname.startsWith("/stock/v1/request") &&
          parsedUrl.pathname !== "/stock/v1/request"
        ) {
          const task = response
            .json()
            .then((body: unknown) => {
              const queryParams = Object.fromEntries(
                [...parsedUrl.searchParams.entries()].map(([key, value]) => [
                  key,
                  /accessToken|cb/i.test(key) ? "[REDACTED]" : value,
                ]),
              );
              const object =
                typeof body === "object" && body !== null
                  ? (body as Record<string, unknown>)
                  : null;

              detailReads.push({
                method: "GET",
                status: response.status(),
                endpoint: parsedUrl.origin + parsedUrl.pathname,
                queryParams,
                dataKeys: object ? Object.keys(object).slice(0, 50) : [],
                fieldPaths: collectFieldPaths(body).slice(0, 300),
              });
            })
            .catch(() => undefined);

          pendingResponses.push(task);
        }
      } catch {
        // Ignora respostas fora da API de estoque.
      }
    };

    page.on("response", onResponse);

    let rowClicked = false;
    let clickedRowText: string | null = null;
    let message: string | null = null;

    try {
      const tableRow = page.locator("table tbody tr").first();
      const hasTableRow = await tableRow.isVisible().catch(() => false);
      const rowLocator = hasTableRow
        ? tableRow
        : page.getByText(requestNumberPattern).first();
      const hasRow =
        hasTableRow || (await rowLocator.isVisible().catch(() => false));

      if (hasRow) {
        clickedRowText = normalizeText(await rowLocator.innerText().catch(() => ""));
        await rowLocator.scrollIntoViewIfNeeded().catch(() => undefined);
        await rowLocator.click({ force: true }).catch(() => undefined);
        rowClicked = true;
        await page.waitForTimeout(4_000);
      } else {
        message = "KOPER_STOCK_REQUEST_ROW_NOT_FOUND";
      }
    } finally {
      await Promise.allSettled(pendingResponses);
      page.off("response", onResponse);
    }

    return {
      ok: true,
      authenticated: true,
      listReached,
      rowClicked,
      clickedRowText,
      finalUrl: page.url(),
      title: await page.title().catch(() => ""),
      detailReads,
      message,
      checkedAt: new Date().toISOString(),
    };
  });
}
