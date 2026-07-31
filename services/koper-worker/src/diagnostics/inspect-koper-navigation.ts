import type { Page, Response } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";

type NetworkEntry = {
  method: string;
  status: number;
  resourceType: string;
  url: string;
  queryKeys: string[];
};

type LinkEntry = {
  text: string;
  href: string | null;
};

export type KoperNavigationDiagnostic = {
  ok: true;
  authenticated: boolean;
  finalUrl: string;
  title: string;
  headings: string[];
  buttons: string[];
  links: LinkEntry[];
  bodyTextPreview: string;
  network: NetworkEntry[];
  checkedAt: string;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeUrl(rawUrl: string): { url: string; queryKeys: string[] } {
  try {
    const parsed = new URL(rawUrl);
    const queryKeys = [...new Set(parsed.searchParams.keys())].slice(0, 20);
    parsed.search = "";
    parsed.hash = "";

    return {
      url: parsed.toString(),
      queryKeys,
    };
  } catch {
    return {
      url: rawUrl.slice(0, 500),
      queryKeys: [],
    };
  }
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
    const text = normalizeText(
      await locator.nth(index).innerText().catch(() => ""),
    );

    if (text && !values.includes(text)) {
      values.push(text.slice(0, 300));
    }
  }

  return values;
}

async function collectLinks(page: Page, limit: number): Promise<LinkEntry[]> {
  const locator = page.locator("a[href]");
  const count = Math.min(await locator.count(), limit);
  const values: LinkEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    const text = normalizeText(await item.innerText().catch(() => ""));
    const rawHref = await item.getAttribute("href");
    const href = rawHref ? sanitizeUrl(rawHref).url : null;

    if (!text && !href) {
      continue;
    }

    values.push({
      text: text.slice(0, 300),
      href,
    });
  }

  return values;
}

export async function inspectKoperNavigation(): Promise<KoperNavigationDiagnostic> {
  return withBrowserless(async ({ page }) => {
    const network: NetworkEntry[] = [];

    const onResponse = (response: Response): void => {
      const request = response.request();
      const resourceType = request.resourceType();

      if (
        network.length >= 120 ||
        (resourceType !== "xhr" && resourceType !== "fetch")
      ) {
        return;
      }

      const sanitized = sanitizeUrl(response.url());

      network.push({
        method: request.method(),
        status: response.status(),
        resourceType,
        url: sanitized.url,
        queryKeys: sanitized.queryKeys,
      });
    };

    page.on("response", onResponse);

    try {
      const login = await performKoperLogin(page);

      if (!login.authenticated) {
        return {
          ok: true,
          authenticated: false,
          finalUrl: login.finalUrl,
          title: login.title,
          headings: [],
          buttons: [],
          links: [],
          bodyTextPreview: login.message ?? "",
          network,
          checkedAt: new Date().toISOString(),
        };
      }

      await page.waitForTimeout(3_000);

      const bodyTextPreview = normalizeText(
        await page.locator("body").innerText().catch(() => ""),
      ).slice(0, 5_000);

      return {
        ok: true,
        authenticated: true,
        finalUrl: page.url(),
        title: await page.title().catch(() => ""),
        headings: await collectTexts(page, "h1, h2, h3, [role='heading']", 50),
        buttons: await collectTexts(
          page,
          "button, [role='button'], input[type='button'], input[type='submit']",
          80,
        ),
        links: await collectLinks(page, 120),
        bodyTextPreview,
        network,
        checkedAt: new Date().toISOString(),
      };
    } finally {
      page.off("response", onResponse);
    }
  });
}
