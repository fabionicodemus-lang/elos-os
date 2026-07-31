import type { Page, Response } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { collectFieldPaths } from "./discover-stock-route.js";

type CompanyApiRead = {
  method: string;
  status: number;
  endpoint: string;
  dataKeys: string[];
  fieldPaths: string[];
};

export type KoperCompaniesDiagnostic = {
  ok: true;
  authenticated: boolean;
  activeCompanyLabel: string | null;
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

    if (login.authenticated) {
      await page.waitForTimeout(3_000);
      activeCompanyLabel = await readActiveCompanyLabel(page).catch(() => null);
    }

    await Promise.allSettled(pendingResponses);
    page.off("response", onResponse);

    return {
      ok: true,
      authenticated: login.authenticated,
      activeCompanyLabel,
      companyReads,
      message: login.authenticated ? null : login.message,
      checkedAt: new Date().toISOString(),
    };
  });
}
