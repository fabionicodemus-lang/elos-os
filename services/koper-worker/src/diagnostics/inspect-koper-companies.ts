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
  await page.waitForTimeout(1_500);

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
