import type { Response } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type StagingIdRow = { koper_id: string };
type UnknownRecord = Record<string, unknown>;

type EntryHeader = {
  stockMovementId: string | null;
  originId: string | null;
  originType: string | null;
  itemsAmount: number | null;
  entryDate: string | null;
  invoiceIds: string[];
  invoiceCount: number;
  receiptCount: number;
  productCount: number;
};

function objectValue(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function identifier(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function arrayLength(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return numericValue(value) ?? 0;
}

function invoiceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => identifier(objectValue(item)?.invoiceId))
    .filter((item): item is string => Boolean(item));
}

function entryHeader(value: unknown): EntryHeader | null {
  const entry = objectValue(value);
  if (!entry) return null;
  return {
    stockMovementId: identifier(entry.stockMovementId),
    originId: identifier(entry.originId),
    originType: identifier(entry.originType),
    itemsAmount: numericValue(entry.itemsAmount),
    entryDate: typeof entry.entryDate === "string" ? entry.entryDate : null,
    invoiceIds: invoiceIds(entry.invoices),
    invoiceCount: arrayLength(entry.invoices),
    receiptCount: arrayLength(entry.receipts),
    productCount: arrayLength(entry.products),
  };
}

function increment(counter: Record<string, number>, key: string | null): void {
  const normalized = key ?? "(missing)";
  counter[normalized] = (counter[normalized] ?? 0) + 1;
}

async function readPurchaseOrderIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<StagingIdRow[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "koper_id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: "eq.purchase_order",
        sync_state: "eq.present",
        order: "koper_id.asc",
        limit: "1000",
        offset: String(offset),
      }),
    });
    for (const row of page) ids.add(row.koper_id);
    if (page.length < 1_000) break;
  }
  return ids;
}

async function responseJson(response: {
  status(): number;
  json(): Promise<unknown>;
}, label: string): Promise<UnknownRecord> {
  if (response.status() < 200 || response.status() >= 300) {
    throw new Error(`${label} failed with HTTP ${response.status()}`);
  }
  const body = objectValue(await response.json());
  if (!body) throw new Error(`${label} returned an invalid body`);
  return body;
}

export async function inventoryFlowStockEntries(): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  consolidated: UnknownRecord | null;
  pending: UnknownRecord | null;
  linkage: UnknownRecord | null;
  blockedWrites: number;
  message: string | null;
}> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) {
      return {
        ok: true,
        authenticated: false,
        flowSelected: false,
        consolidated: null,
        pending: null,
        linkage: null,
        blockedWrites: 0,
        message: login.message,
      };
    }

    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (
          isKoper
          && !["GET", "HEAD", "OPTIONS"].includes(request.method())
          && !isAllowedFlowSwitch(url, request.method(), request.postData())
        ) {
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {
        // Ignora URLs inválidas.
      }
      await route.continue();
    });

    const flowSelected = await selectFlow(page);
    if (!flowSelected) {
      return {
        ok: true,
        authenticated: true,
        flowSelected: false,
        consolidated: null,
        pending: null,
        linkage: null,
        blockedWrites,
        message: "KOPER_FLOW_COMPANY_NOT_SELECTED",
      };
    }

    let stockHeaders: Record<string, string> | null = null;
    const onResponse = (response: Response): void => {
      try {
        const url = new URL(response.url());
        if (
          response.request().method() === "GET"
          && url.hostname === "api.koper.com.br"
          && url.pathname.startsWith("/stock/v1/")
        ) stockHeaders ??= response.request().headers();
      } catch {
        // Ignora URLs inválidas.
      }
    };
    page.on("response", onResponse);
    await page.goto("https://app.koper.com.br/suprimentos/entradas/", {
      waitUntil: "domcontentloaded",
      timeout: 18_000,
    }).catch(() => undefined);
    await page.waitForTimeout(3_500);
    page.off("response", onResponse);

    if (!stockHeaders) {
      return {
        ok: true,
        authenticated: true,
        flowSelected: true,
        consolidated: null,
        pending: null,
        linkage: null,
        blockedWrites,
        message: "KOPER_STOCK_ENTRY_HEADERS_NOT_CAPTURED",
      };
    }

    const headers: EntryHeader[] = [];
    let declaredTotal: number | null = null;
    for (let offset = 0; offset < 50_000; offset += 1_000) {
      const response = await page.request.get(
        `https://api.koper.com.br/stock/v1/entry?limit=1000&offset=${offset}&orderFlag=desc&orderby=movementDate`,
        { headers: stockHeaders, timeout: 15_000 },
      );
      const body = await responseJson(response, "stock entry list");
      declaredTotal ??= numericValue(body.amountEntry);
      const pageEntries = Array.isArray(body.entries) ? body.entries : [];
      for (const item of pageEntries) {
        const parsed = entryHeader(item);
        if (parsed) headers.push(parsed);
      }
      if (pageEntries.length < 1_000 || (declaredTotal !== null && headers.length >= declaredTotal)) break;
    }

    const pendingResponse = await page.request.get(
      "https://api.koper.com.br/stock/v1/pending_entry?limit=1000&offset=0&orderFlag=asc&orderby=pendingEntryId&originType=all&placeEntryId=all",
      { headers: stockHeaders, timeout: 15_000 },
    );
    const pendingBody = await responseJson(pendingResponse, "pending stock entry list");
    const pendingEntries = Array.isArray(pendingBody.entries) ? pendingBody.entries : [];
    const pendingIds = pendingEntries
      .map((item) => identifier(objectValue(item)?.pendingEntryId))
      .filter((item): item is string => Boolean(item));

    const purchaseOrderIds = await readPurchaseOrderIds();
    const originTypeCounts: Record<string, number> = {};
    const matchedOriginTypeCounts: Record<string, number> = {};
    const entriesPerOrigin = new Map<string, number>();
    let matchedEntries = 0;
    let missingOriginId = 0;
    let entriesWithInvoices = 0;
    let entriesWithReceipts = 0;
    let listedProductReferences = 0;
    const unmatchedOriginIds = new Set<string>();
    const matchedPurchaseOrderIds = new Set<string>();

    for (const entry of headers) {
      increment(originTypeCounts, entry.originType);
      if (!entry.originId) {
        missingOriginId += 1;
      } else {
        entriesPerOrigin.set(entry.originId, (entriesPerOrigin.get(entry.originId) ?? 0) + 1);
        if (purchaseOrderIds.has(entry.originId)) {
          matchedEntries += 1;
          matchedPurchaseOrderIds.add(entry.originId);
          increment(matchedOriginTypeCounts, entry.originType);
        } else {
          unmatchedOriginIds.add(entry.originId);
        }
      }
      if (entry.invoiceCount > 0) entriesWithInvoices += 1;
      if (entry.receiptCount > 0) entriesWithReceipts += 1;
      listedProductReferences += entry.productCount;
    }

    const dates = headers
      .map((entry) => entry.entryDate)
      .filter((item): item is string => Boolean(item))
      .sort();
    const duplicateOriginIds = [...entriesPerOrigin.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1]);

    const sample = (entry: EntryHeader): UnknownRecord => ({
      stockMovementId: entry.stockMovementId,
      originId: entry.originId,
      originType: entry.originType,
      itemsAmount: entry.itemsAmount,
      entryDate: entry.entryDate,
      invoiceIds: entry.invoiceIds,
      invoiceCount: entry.invoiceCount,
      receiptCount: entry.receiptCount,
      productCount: entry.productCount,
    });

    return {
      ok: true,
      authenticated: true,
      flowSelected: true,
      consolidated: {
        declaredTotal,
        collected: headers.length,
        uniqueStockMovements: new Set(headers.map((entry) => entry.stockMovementId).filter(Boolean)).size,
        firstEntryDate: dates[0] ?? null,
        lastEntryDate: dates.at(-1) ?? null,
        originTypeCounts,
        entriesWithInvoices,
        entriesWithReceipts,
        listedProductReferences,
        firstSamples: headers.slice(0, 8).map(sample),
        lastSamples: headers.slice(-8).map(sample),
      },
      pending: {
        declaredTotal: numericValue(pendingBody.entriesAmount),
        collected: pendingEntries.length,
        pendingIds: pendingIds.slice(0, 30),
      },
      linkage: {
        purchaseOrdersInStaging: purchaseOrderIds.size,
        matchedEntries,
        matchedPurchaseOrders: matchedPurchaseOrderIds.size,
        matchedOriginTypeCounts,
        missingOriginId,
        unmatchedUniqueOriginIds: unmatchedOriginIds.size,
        unmatchedOriginIdSample: [...unmatchedOriginIds].slice(0, 30),
        originsWithMultipleEntries: duplicateOriginIds.length,
        multipleEntryOriginSample: duplicateOriginIds.slice(0, 20),
      },
      blockedWrites,
      message: null,
    };
  }, { sessionTimeoutMs: 58_000 });
}
