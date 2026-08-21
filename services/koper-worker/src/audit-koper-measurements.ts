import type { Page, Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import {
  openCompanySelector,
  readActiveCompanyLabel,
} from "./diagnostics/inspect-koper-engineering.js";

const FLOW_LABEL = "Flow Aptos - Bossa";

type ApiRead = {
  endpoint: string;
  status: number;
  query: Record<string, string>;
  dataKeys: string[];
  itemCount: number | null;
  total: number | null;
  sample: unknown;
};

function safePreview(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[MAX_DEPTH]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 250);
  if (Array.isArray(value)) return value.slice(0, 2).map((item) => safePreview(item, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, 100);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/password|senha|token|secret|authorization|cookie/i.test(key))
      .slice(0, 60)
      .map(([key, item]) => [key, safePreview(item, depth + 1)]),
  );
}

function extractArray(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (typeof body !== "object" || body === null) return null;
  const object = body as Record<string, unknown>;
  for (const key of ["items", "records", "data", "measurements", "measurementsList", "list"]) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  return null;
}

function extractTotal(body: unknown): number | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const object = body as Record<string, unknown>;
  for (const key of ["total", "itemsAmount", "count", "totalItems", "recordsTotal"]) {
    if (typeof object[key] === "number") return object[key] as number;
  }
  return null;
}

async function ensureFlowSelected(page: Page): Promise<void> {
  const active = await readActiveCompanyLabel(page);
  if (active && /Flow Aptos - Bossa/i.test(active)) return;
  if (!active) return;

  await openCompanySelector(page, active);
  const flow = page.getByText(/^Flow Aptos - Bossa$/i, { exact: true }).last();
  if (await flow.isVisible().catch(() => false)) {
    await flow.click();
    await page.waitForTimeout(2_000);
  }
}

async function clickMeasurements(page: Page): Promise<void> {
  const contracts = page.getByText(/Contratos e medições/i, { exact: true }).last();
  if (await contracts.isVisible().catch(() => false)) {
    await contracts.click();
    await page.waitForTimeout(500);
  }

  const measurements = page.getByText(/^Medições$/i, { exact: true }).last();
  await measurements.waitFor({ state: "visible", timeout: 15_000 });
  await measurements.click();
  await page.waitForTimeout(1_500);

  const finalized = page.getByText(/VER FINALIZADAS/i, { exact: true }).last();
  if (await finalized.isVisible().catch(() => false)) {
    await finalized.click();
    await page.waitForTimeout(2_000);
  }
}

async function nativeDateSelect(page: Page) {
  const label = page.getByText(/DATA DA MEDIÇÃO/i).first();
  if (!(await label.isVisible().catch(() => false))) return null;
  const select = label.locator("xpath=following::select[1]");
  if ((await select.count()) === 0) return null;
  return select.first();
}

async function tryYear(page: Page, year: number): Promise<boolean> {
  const select = await nativeDateSelect(page);
  if (select) {
    const options = await select.locator("option").allTextContents();
    const option = options.find((text) => text.trim() === String(year));
    if (option) {
      await select.selectOption({ label: option });
      await page.waitForTimeout(1_500);
      return true;
    }
  }

  const allTexts = page.getByText(/^Todos$/i, { exact: true });
  const count = await allTexts.count();
  if (count >= 2) {
    const dateControl = allTexts.nth(1);
    if (await dateControl.isVisible().catch(() => false)) {
      await dateControl.click();
      await page.waitForTimeout(300);
      const yearOption = page.getByText(new RegExp(`^${year}$`), { exact: true }).last();
      if (await yearOption.isVisible().catch(() => false)) {
        await yearOption.click();
        await page.waitForTimeout(1_500);
        return true;
      }
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  }

  return false;
}

async function snapshotUi(page: Page) {
  const selects = page.locator("select");
  const selectCount = await selects.count();
  const selectInfo = [] as Array<{ index: number; value: string; options: string[] }>;
  for (let i = 0; i < Math.min(selectCount, 10); i += 1) {
    const select = selects.nth(i);
    selectInfo.push({
      index: i,
      value: await select.inputValue().catch(() => ""),
      options: (await select.locator("option").allTextContents()).map((v) => v.trim()).filter(Boolean).slice(0, 30),
    });
  }

  const rows = page.locator("table tbody tr");
  const rowCount = await rows.count();
  const rowTexts: string[] = [];
  for (let i = 0; i < Math.min(rowCount, 10); i += 1) {
    rowTexts.push((await rows.nth(i).innerText().catch(() => "")).replace(/\s+/g, " ").trim());
  }

  return {
    url: page.url(),
    selectInfo,
    rowCount,
    rowTexts,
    bodyText: (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 2500),
  };
}

async function main(): Promise<void> {
  const result = await withBrowserless(async ({ page }) => {
    const reads: ApiRead[] = [];
    const pending: Promise<void>[] = [];

    const login = await performKoperLogin(page);
    if (!login.authenticated) throw new Error(login.message ?? "KOPER_LOGIN_FAILED");

    await ensureFlowSelected(page);

    const onResponse = (response: Response) => {
      const task = (async () => {
        const request = response.request();
        if (request.method() !== "GET") return;
        const url = new URL(response.url());
        if (url.hostname !== "api.koper.com.br") return;
        if (!/measure|medi|contract|engineering/i.test(url.pathname + url.search)) return;

        let body: unknown = null;
        try { body = await response.json(); } catch { return; }
        const array = extractArray(body);
        reads.push({
          endpoint: url.origin + url.pathname,
          status: response.status(),
          query: Object.fromEntries(url.searchParams.entries()),
          dataKeys: typeof body === "object" && body !== null && !Array.isArray(body) ? Object.keys(body as Record<string, unknown>).slice(0, 50) : [],
          itemCount: array?.length ?? null,
          total: extractTotal(body),
          sample: safePreview(array ? array.slice(0, 2) : body),
        });
      })().catch(() => undefined);
      pending.push(task);
    };

    page.on("response", onResponse);
    await clickMeasurements(page);
    const initial = await snapshotUi(page);

    const yearly: Record<string, { applied: boolean; ui: Awaited<ReturnType<typeof snapshotUi>> }> = {};
    for (const year of [2022, 2023, 2024, 2025, 2026]) {
      const applied = await tryYear(page, year);
      yearly[String(year)] = { applied, ui: await snapshotUi(page) };
    }

    await Promise.allSettled(pending);
    page.off("response", onResponse);

    return {
      authenticated: true,
      activeCompany: await readActiveCompanyLabel(page),
      initial,
      yearly,
      reads,
      checkedAt: new Date().toISOString(),
    };
  }, { sessionTimeoutMs: 240_000 });

  console.log("KOPER_MEASUREMENTS_AUDIT", JSON.stringify(result));
}

main().catch((error: unknown) => {
  console.error("KOPER_MEASUREMENTS_AUDIT_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
