import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Row = Record<string, unknown>;
type Payload = { itemsAmount?: number; measurements?: Row[] };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isMeasurementList(response: Response): boolean {
  try {
    const req = response.request();
    const url = new URL(response.url());
    return req.method() === "GET" &&
      url.hostname === "api.koper.com.br" &&
      url.pathname === "/engineering/v1/build_measurement" &&
      url.searchParams.get("open") === "no";
  } catch {
    return false;
  }
}

try {
  console.log("KOPER_MEASUREMENTS_EXPORT_START");
  const result = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ok: false, message: login.message };

    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (isKoper && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !isAllowedFlowSwitch(url, request.method(), request.postData())) {
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {}
      await route.continue();
    });

    if (!await selectFlow(page)) return { ok: false, message: "KOPER_FLOW_COMPANY_NOT_SELECTED", blockedWrites };

    const seedPromise = page.waitForResponse(isMeasurementList, { timeout: 25_000 }).catch(() => null);
    await page.goto("https://app.koper.com.br/engenharia/medicoes/finalizadas", { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
    await sleep(3_000);
    const seed = await seedPromise;
    if (!seed) return { ok: false, message: "MEASUREMENT_SEED_NOT_FOUND", blockedWrites };

    const seedRequest = seed.request();
    const seedHeaders = seedRequest.headers();
    const headers: Record<string, string> = {};
    for (const key of ["accept", "origin", "referer", "x-accesstoken", "x-koper"]) {
      if (seedHeaders[key]) headers[key] = seedHeaders[key];
    }

    const base = new URL(seed.url());
    base.searchParams.delete("accessToken");
    base.searchParams.delete("cb");
    base.searchParams.delete("appVersion");
    base.searchParams.delete("visited-page");
    base.searchParams.set("open", "no");
    base.searchParams.set("orderby", "measurementDate");
    base.searchParams.set("orderFlag", "asc");

    const batchSize = 100;
    const all: Row[] = [];
    let expectedTotal: number | null = null;

    for (let offset = 0; ; offset += batchSize) {
      const url = new URL(base);
      url.searchParams.set("limit", String(batchSize));
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("cb", String(Date.now()));
      const response = await page.request.get(url.toString(), { headers, timeout: 20_000 });
      if (!response.ok()) throw new Error(`MEASUREMENT_LIST_HTTP_${response.status()}`);
      const body = await response.json() as Payload;
      const rows = Array.isArray(body.measurements) ? body.measurements : [];
      if (expectedTotal === null && Number.isFinite(Number(body.itemsAmount))) expectedTotal = Number(body.itemsAmount);
      all.push(...rows);
      console.log("KOPER_MEASUREMENTS_PAGE", JSON.stringify({ offset, returned: rows.length, itemsAmount: body.itemsAmount ?? null }));
      if (rows.length < batchSize) break;
      if (expectedTotal !== null && all.length >= expectedTotal) break;
      if (offset > 10000) throw new Error("MEASUREMENT_PAGINATION_GUARD");
    }

    const byId = new Map<string, Row>();
    for (const row of all) {
      const id = String(row.measurementId ?? "");
      if (id) byId.set(id, row);
    }
    const rows = Array.from(byId.values()).sort((a, b) => String(a.measurementDate ?? "").localeCompare(String(b.measurementDate ?? "")));
    const byYear: Record<string, number> = {};
    for (const row of rows) {
      const date = String(row.measurementDate ?? "");
      const year = date.match(/(20\d{2})/)?.[1] ?? "unknown";
      byYear[year] = (byYear[year] ?? 0) + 1;
    }

    return { ok: true, readOnly: true, blockedWrites, expectedTotal, fetched: all.length, unique: rows.length, byYear, rows };
  }, { sessionTimeoutMs: 90_000 });

  const rows = Array.isArray((result as any).rows) ? (result as any).rows as Row[] : [];
  const meta = { ...(result as any), rows: undefined };
  console.log("KOPER_MEASUREMENTS_META", JSON.stringify(meta));
  for (let i = 0; i < rows.length; i += 50) {
    console.log("KOPER_MEASUREMENTS_CHUNK", JSON.stringify({ index: i / 50, rows: rows.slice(i, i + 50) }));
  }
  console.log("KOPER_MEASUREMENTS_EXPORT_COMPLETE", JSON.stringify({ ok: (result as any).ok ?? false, unique: rows.length }));
} catch (error: unknown) {
  console.error("KOPER_MEASUREMENTS_EXPORT_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000) }));
}

await import("./index.js");
