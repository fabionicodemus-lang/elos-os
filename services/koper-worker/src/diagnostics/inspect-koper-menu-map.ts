import type { Page } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";

type InteractiveEntry = {
  index: number;
  visible: boolean;
  tag: string;
  text: string;
  ariaLabel: string | null;
  title: string | null;
  testId: string | null;
  role: string | null;
  href: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  cursor: string;
  region: string | null;
  parentTag: string | null;
  parentText: string;
};

type RegionEntry = {
  index: number;
  tag: string;
  id: string | null;
  role: string | null;
  ariaLabel: string | null;
  className: string;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
};

export type KoperMenuMapDiagnostic = {
  ok: true;
  authenticated: boolean;
  finalUrl: string;
  title: string;
  viewport: { width: number; height: number };
  interactive: InteractiveEntry[];
  leftRail: InteractiveEntry[];
  regions: RegionEntry[];
  bodyTextPreview: string;
  message: string | null;
  checkedAt: string;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function collectInteractive(page: Page): Promise<InteractiveEntry[]> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const sanitize = (rawHref: string | null): string | null => {
      if (!rawHref) return null;

      try {
        const parsed = new URL(rawHref, window.location.href);
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString();
      } catch {
        return rawHref.slice(0, 500);
      }
    };

    const selector = [
      "button",
      "a",
      "[role='button']",
      "[role='link']",
      "[aria-label]",
      "[data-testid]",
      "input[type='button']",
      "input[type='submit']",
    ].join(",");

    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const entries: InteractiveEntry[] = [];
    const seen = new Set<HTMLElement>();

    for (const node of nodes) {
      if (seen.has(node)) continue;
      seen.add(node);

      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || "1") > 0;
      const text = normalize(node.innerText || node.getAttribute("value") || "");
      const ariaLabel = node.getAttribute("aria-label");
      const title = node.getAttribute("title");
      const testId = node.getAttribute("data-testid");
      const role = node.getAttribute("role");
      const href = node instanceof HTMLAnchorElement ? sanitize(node.href) : sanitize(node.getAttribute("href"));
      const regionNode = node.closest("nav, aside, header, main, [role='navigation'], [role='menu']");
      const parent = node.parentElement;
      const hasUsefulMetadata = Boolean(text || ariaLabel || title || testId || href);
      const isNearEdge = rect.x < 280 || rect.y < 180;

      if (!visible && !hasUsefulMetadata) continue;
      if (!isNearEdge && !hasUsefulMetadata) continue;

      entries.push({
        index: entries.length,
        visible,
        tag: node.tagName.toLowerCase(),
        text: text.slice(0, 240),
        ariaLabel,
        title,
        testId,
        role,
        href,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        cursor: style.cursor,
        region: regionNode ? regionNode.tagName.toLowerCase() : null,
        parentTag: parent ? parent.tagName.toLowerCase() : null,
        parentText: normalize(parent?.innerText || "").slice(0, 240),
      });

      if (entries.length >= 220) break;
    }

    return entries;
  });
}

async function collectRegions(page: Page): Promise<RegionEntry[]> {
  return page.evaluate(() => {
    const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
    const selector = [
      "nav",
      "aside",
      "header",
      "[role='navigation']",
      "[role='menu']",
      "[aria-label*='menu' i]",
      "[aria-label*='navega' i]",
      "[data-testid*='menu' i]",
      "[data-testid*='sidebar' i]",
      "[data-testid*='drawer' i]",
    ].join(",");
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const regions: RegionEntry[] = [];
    const seen = new Set<HTMLElement>();

    for (const node of nodes) {
      if (seen.has(node)) continue;
      seen.add(node);

      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";

      regions.push({
        index: regions.length,
        tag: node.tagName.toLowerCase(),
        id: node.id || null,
        role: node.getAttribute("role"),
        ariaLabel: node.getAttribute("aria-label"),
        className: String(node.className || "").slice(0, 500),
        visible,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        text: normalize(node.innerText || "").slice(0, 1_500),
      });

      if (regions.length >= 80) break;
    }

    return regions;
  });
}

export async function inspectKoperMenuMap(): Promise<KoperMenuMapDiagnostic> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);

    if (!login.authenticated) {
      return {
        ok: true,
        authenticated: false,
        finalUrl: login.finalUrl,
        title: login.title,
        viewport: page.viewportSize() ?? { width: 0, height: 0 },
        interactive: [],
        leftRail: [],
        regions: [],
        bodyTextPreview: login.message ?? "",
        message: login.message,
        checkedAt: new Date().toISOString(),
      };
    }

    await page.waitForTimeout(3_000);

    const interactive = await collectInteractive(page);
    const leftRail = interactive.filter(
      (entry) =>
        entry.visible &&
        entry.x < 320 &&
        entry.y < 1_200 &&
        (entry.width > 0 || entry.height > 0),
    );
    const regions = await collectRegions(page);
    const bodyTextPreview = normalizeText(
      await page.locator("body").innerText().catch(() => ""),
    ).slice(0, 5_000);

    return {
      ok: true,
      authenticated: true,
      finalUrl: page.url(),
      title: await page.title().catch(() => ""),
      viewport: page.viewportSize() ?? { width: 0, height: 0 },
      interactive,
      leftRail,
      regions,
      bodyTextPreview,
      message: null,
      checkedAt: new Date().toISOString(),
    };
  });
}
