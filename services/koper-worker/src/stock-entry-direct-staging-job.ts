import type { Page, Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { env } from "./config/env.js";
import { saveKoperStagingBatch } from "./elos/koper-staging-repository.js";
import { requestSupabase } from "./elos/supabase.js";
import { createKoperStagingRecord } from "./sync/staging-record.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type UnknownRecord = Record<string, unknown>;
type SessionTransport = {
  accessToken: string;
  headers: Record<string, string>;
};

type EntryHeader = {
  stockMovementId: string;
  originId: string | null;
  originType: string | null;
  entryDate: string | null;
  entryType: string | null;
  itemsAmount: number | null;
  invoiceIds: string[];
  receiptCount: number;
};

type EntryItem = {
  stockMovementId: string;
  productMovementId: string;
  productId: string | null;
  mainProductId: string | null;
  genericProdSeq: string | null;
  productAmount: number | null;
  unitMeasureId: string | null;
  productValue: number | null;
  averageProductValue: number | null;
  totalProductValue: number | null;
  invoiceIds: string[];
  receipts: unknown[];
};

type InvoiceProduct = {
  invoiceId: string;
  inputId: string | null;
  numberItem: string | null;
  productId: string | null;
  mainProductId: string | null;
  amount: number | null;
  unitValue: number | null;
  totalValue: number | null;
  inputUnit: string | null;
  invoiceCfop: string | null;
};

type FetchResult = {
  status: number;
  body: UnknownRecord | null;
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

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integerEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function stringIds(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const id = identifier(objectValue(item)?.[key]);
    return id ? [id] : [];
  });
}

function technicalReceipts(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((item) => {
    const receipt = objectValue(item) ?? {};
    return {
      receiptId: identifier(receipt.receiptId),
      receiptNumber: identifier(receipt.receiptNumber),
      receiptAmount: numeric(receipt.receiptAmount) ?? numeric(receipt.amount),
    };
  });
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function allowedHeaders(headers: Record<string, string>): Record<string, string> {
  const allow = new Set([
    "accept",
    "accept-language",
    "cache-control",
    "cookie",
    "origin",
    "referer",
    "user-agent",
    "x-accesstoken",
    "x-koper",
  ]);
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => allow.has(key.toLowerCase())),
  );
}

async function captureSession(page: Page): Promise<SessionTransport> {
  let transport: SessionTransport | null = null;
  const capture = (response: Response): void => {
    try {
      const url = new URL(response.url());
      if (
        !transport
        && response.request().method() === "GET"
        && url.hostname === "api.koper.com.br"
        && url.pathname.startsWith("/stock/v1/")
      ) {
        const accessToken = url.searchParams.get("accessToken")
          ?? response.request().headers()["x-accesstoken"]
          ?? null;
        if (accessToken) {
          transport = {
            accessToken,
            headers: allowedHeaders(response.request().headers()),
          };
        }
      }
    } catch {
      // Ignore malformed URLs.
    }
  };
  page.on("response", capture);
  await page.goto("https://app.koper.com.br/suprimentos/entradas/", {
    waitUntil: "domcontentloaded",
    timeout: 18_000,
  }).catch(() => undefined);
  for (let attempt = 0; attempt < 12 && !transport; attempt += 1) await page.waitForTimeout(500);
  page.off("response", capture);
  const captured = transport as SessionTransport | null;
  if (!captured) throw new Error("KOPER_STOCK_SESSION_NOT_CAPTURED");
  return captured;
}

function apiUrl(pathname: string, accessToken: string, params: Record<string, string>): string {
  const url = new URL(pathname, "https://api.koper.com.br");
  url.searchParams.set("accessToken", accessToken);
  url.searchParams.set("cb", String(Date.now()));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function fetchKoper(
  session: SessionTransport,
  pathname: string,
  params: Record<string, string>,
): Promise<FetchResult> {
  const response = await fetch(apiUrl(pathname, session.accessToken, params), {
    method: "GET",
    headers: session.headers,
    signal: AbortSignal.timeout(20_000),
  });
  const body = objectValue(await response.json().catch(() => null));
  return { status: response.status, body };
}

function parseEntryHeader(value: unknown): EntryHeader | null {
  const entry = objectValue(value);
  const stockMovementId = identifier(entry?.stockMovementId);
  if (!entry || !stockMovementId) return null;
  return {
    stockMovementId,
    originId: identifier(entry.originId),
    originType: identifier(entry.originType),
    entryDate: text(entry.entryDate),
    entryType: text(entry.entryType),
    itemsAmount: numeric(entry.itemsAmount),
    invoiceIds: stringIds(entry.invoices, "invoiceId"),
    receiptCount: Array.isArray(entry.receipts) ? entry.receipts.length : numeric(entry.receipts) ?? 0,
  };
}

function parseEntryItems(stockMovementId: string, payload: UnknownRecord): EntryItem[] {
  const products = Array.isArray(payload.products) ? payload.products : [];
  return products.flatMap((value) => {
    const item = objectValue(value);
    const productMovementId = identifier(item?.productMovementId);
    if (!item || !productMovementId) return [];
    return [{
      stockMovementId,
      productMovementId,
      productId: identifier(item.productId),
      mainProductId: identifier(item.mainProductId),
      genericProdSeq: identifier(item.genericProdSeq),
      productAmount: numeric(item.productAmount),
      unitMeasureId: identifier(item.unitMeasureId),
      productValue: numeric(item.productValue),
      averageProductValue: numeric(item.averageProductValue),
      totalProductValue: numeric(item.totalProductValue),
      invoiceIds: stringIds(item.invoices, "invoiceId"),
      receipts: technicalReceipts(item.receipts),
    }];
  });
}

function parseInvoiceProducts(invoiceId: string, payload: UnknownRecord): InvoiceProduct[] {
  const products = Array.isArray(payload.products) ? payload.products : [];
  return products.flatMap((value) => {
    const product = objectValue(value);
    if (!product) return [];
    return [{
      invoiceId,
      inputId: identifier(product.inputId),
      numberItem: identifier(product.numberItem),
      productId: identifier(product.productId),
      mainProductId: identifier(product.mainProductId),
      amount: numeric(product.amount),
      unitValue: numeric(product.unitValue),
      totalValue: numeric(product.totalValue),
      inputUnit: text(product.inputUnit),
      invoiceCfop: identifier(product.invoiceCfop),
    }];
  });
}

function invoiceOrderIds(payload: UnknownRecord | undefined): string[] {
  return payload && Array.isArray(payload.purchaseOrders)
    ? payload.purchaseOrders.flatMap((value) => {
        const id = identifier(objectValue(value)?.purchaseOrderId);
        return id ? [id] : [];
      })
    : [];
}

function sanitizeInvoice(invoiceId: string, payload: UnknownRecord, products: InvoiceProduct[]): UnknownRecord {
  const purchaseOrders = Array.isArray(payload.purchaseOrders) ? payload.purchaseOrders : [];
  const bill = objectValue(payload.bill) ?? {};
  const duplicates = Array.isArray(bill.duplicates) ? bill.duplicates : [];
  return {
    invoiceId,
    invoiceNumber: identifier(payload.invoiceNumber),
    invoiceType: identifier(payload.invoiceType),
    situation: identifier(payload.situation),
    isDraft: typeof payload.isDraft === "boolean" ? payload.isDraft : null,
    emitDate: text(payload.emitDate),
    exitDate: text(payload.exitDate),
    buildMonitoringId: identifier(payload.buildMonitoringId),
    costCenterId: identifier(payload.costCenterId),
    stockPlaceId: identifier(payload.stockPlaceId),
    chartAccountId: identifier(payload.chartAccountId),
    itemChartAccountId: identifier(payload.itemChartAccountId),
    deliverySupplierId: identifier(payload.deliverySupplierId),
    purchaseOrders: purchaseOrders.map((value) => {
      const order = objectValue(value) ?? {};
      return {
        purchaseOrderId: identifier(order.purchaseOrderId),
        status: identifier(order.status),
        purchaseOrderDate: text(order.purchaseOrderDate),
      };
    }),
    bill: {
      billToPayId: identifier(bill.billToPayId),
      duplicates: duplicates.map((value) => {
        const duplicate = objectValue(value) ?? {};
        return {
          billId: identifier(duplicate.billId),
          duplicateNumber: identifier(duplicate.duplicateNumber),
          billValue: numeric(duplicate.billValue),
          dueDate: text(duplicate.dueDate),
          isPaid: typeof duplicate.isPaid === "boolean" ? duplicate.isPaid : null,
          paymentId: identifier(duplicate.paymentId),
          paymentDate: text(duplicate.paymentDate),
          paymentValue: numeric(duplicate.paymentValue),
        };
      }),
    },
    total: objectValue(payload.total),
    productCount: products.length,
  };
}

function quotedIn(ids: string[]): string {
  return `in.(${ids.map((id) => `\"${id.replaceAll("\"", "\\\"")}\"`).join(",")})`;
}

async function verifyIds(entity: string, ids: string[]): Promise<number> {
  let found = 0;
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    if (chunk.length === 0) continue;
    const rows = await requestSupabase<Array<{ koper_id: string }>>("koper_staging_records", {
      query: new URLSearchParams({
        select: "koper_id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: `eq.${entity}`,
        koper_id: quotedIn(chunk),
        sync_state: "eq.present",
        limit: "1000",
      }),
    });
    found += rows.length;
  }
  return found;
}

function safeFailureReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Unknown error";
  if (/429 Too Many Requests/i.test(raw)) return "BROWSERLESS_RATE_LIMIT";
  if (/timeout|Request context disposed/i.test(raw)) return "REQUEST_TIMEOUT";
  return raw
    .split("\n")[0]
    ?.replace(/[a-z]+:\/\/\S+/gi, "[URL_REDACTED]")
    .replace(/(?:accessToken|x-accesstoken|authorization|cookie)[^\s,;]*/gi, "[CREDENTIAL_REDACTED]")
    .slice(0, 300)
    ?? "UNKNOWN_FAILURE";
}

await import("./index.js");

try {
  if (process.env.KOPER_STOCK_ENTRY_DIRECT_STAGING_WRITE_ENABLED !== "true") {
    console.log("KOPER_STOCK_ENTRY_DIRECT_STAGING_SKIPPED", JSON.stringify({ reason: "WRITE_DISABLED" }));
  } else {
    const batchOffset = integerEnv("KOPER_STOCK_ENTRY_BATCH_OFFSET", 0, 0, 100_000);
    const batchSize = integerEnv("KOPER_STOCK_ENTRY_BATCH_SIZE", 300, 1, 500);
    const targetOriginType = process.env.KOPER_STOCK_ENTRY_ORIGIN_TYPE ?? "0";
    const concurrency = integerEnv("KOPER_STOCK_ENTRY_HTTP_CONCURRENCY", 20, 1, 40);

    const session = await withBrowserless(async ({ page }) => {
      const login = await performKoperLogin(page);
      if (!login.authenticated) throw new Error(login.message ?? "Koper authentication failed");

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
          // Ignore malformed URLs.
        }
        await route.continue();
      });

      const flowSelected = await selectFlow(page);
      if (!flowSelected) throw new Error("KOPER_FLOW_COMPANY_NOT_SELECTED");
      const transport = await captureSession(page);
      return { ...transport, blockedWrites };
    }, { sessionTimeoutMs: 58_000 });

    const allHeaders: EntryHeader[] = [];
    let declaredTotal: number | null = null;
    for (let offset = 0; offset < 50_000; offset += 1_000) {
      const response = await fetchKoper(session, "/stock/v1/entry", {
        limit: "1000",
        offset: String(offset),
        orderFlag: "asc",
        orderby: "stockMovementId",
      });
      if (response.status < 200 || response.status >= 300 || !response.body) {
        throw new Error(`Koper stock entry list failed (HTTP ${response.status})`);
      }
      declaredTotal ??= numeric(response.body.amountEntry);
      const entries = Array.isArray(response.body.entries) ? response.body.entries : [];
      for (const value of entries) {
        const parsed = parseEntryHeader(value);
        if (parsed) allHeaders.push(parsed);
      }
      if (entries.length < 1_000 || (declaredTotal !== null && allHeaders.length >= declaredTotal)) break;
    }

    const targetHeaders = allHeaders
      .filter((header) => header.originType === targetOriginType)
      .sort((left, right) => Number(left.stockMovementId) - Number(right.stockMovementId));
    const selectedHeaders = targetHeaders.slice(batchOffset, batchOffset + batchSize);

    if (selectedHeaders.length === 0) {
      console.log("KOPER_STOCK_ENTRY_DIRECT_STAGING_RESULT", JSON.stringify({
        ok: true,
        targetOriginType,
        totalTargetEntries: targetHeaders.length,
        batchOffset,
        selectedEntries: 0,
        nextOffset: batchOffset,
        complete: true,
      }));
    } else {
      const detailResults = await mapConcurrent(selectedHeaders, concurrency, async (header) => {
        const response = await fetchKoper(session, "/stock/v1/product_entry", {
          entryId: header.stockMovementId,
          pending: "false",
        });
        return { header, response };
      });

      const detailsById = new Map<string, UnknownRecord>();
      const detailErrors: Array<{ entryId: string; status: number }> = [];
      for (const { header, response } of detailResults) {
        if (response.status >= 200 && response.status < 300 && response.body) {
          detailsById.set(header.stockMovementId, response.body);
        } else {
          detailErrors.push({ entryId: header.stockMovementId, status: response.status });
        }
      }

      const entryItems = selectedHeaders.flatMap((header) =>
        parseEntryItems(header.stockMovementId, detailsById.get(header.stockMovementId) ?? {})
      );
      const invoiceIds = [...new Set(entryItems.flatMap((item) => item.invoiceIds))];
      const invoiceResults = await mapConcurrent(invoiceIds, concurrency, async (invoiceId) => ({
        invoiceId,
        response: await fetchKoper(session, "/financial/v1/xml_invoice", { invoiceId }),
      }));

      const invoicesById = new Map<string, UnknownRecord>();
      const invoiceProductsById = new Map<string, InvoiceProduct[]>();
      const invoiceErrors: Array<{ invoiceId: string; status: number }> = [];
      for (const { invoiceId, response } of invoiceResults) {
        if (response.status >= 200 && response.status < 300 && response.body) {
          invoicesById.set(invoiceId, response.body);
          invoiceProductsById.set(invoiceId, parseInvoiceProducts(invoiceId, response.body));
        } else {
          invoiceErrors.push({ invoiceId, status: response.status });
        }
      }

      const seenAt = new Date();
      const entryRecords = selectedHeaders.map((header) => {
        const detail = detailsById.get(header.stockMovementId) ?? {};
        const relatedItems = entryItems.filter((item) => item.stockMovementId === header.stockMovementId);
        const relatedInvoiceIds = [...new Set(relatedItems.flatMap((item) => item.invoiceIds))];
        const purchaseOrderIds = [...new Set(relatedInvoiceIds.flatMap((invoiceId) =>
          invoiceOrderIds(invoicesById.get(invoiceId))
        ))];
        return createKoperStagingRecord({
          companyId: env.BOSSA_COMPANY_ID,
          entity: "stock_entry",
          koperId: header.stockMovementId,
          sanitizedPayload: {
            stockMovementId: header.stockMovementId,
            originId: header.originId,
            originType: header.originType,
            entryType: text(detail.entryType) ?? header.entryType,
            placeEntryId: identifier(detail.placeEntryId),
            movementDate: text(detail.movementDate) ?? header.entryDate,
            itemsAmount: numeric(detail.itemsAmount) ?? header.itemsAmount,
            totalProductValue: numeric(detail.totalProductValue),
            averageProductValue: numeric(detail.averageProductValue),
            packingListId: identifier(detail.packingListId),
            invoiceIds: relatedInvoiceIds,
            purchaseOrderIds,
            productMovementIds: relatedItems.map((item) => item.productMovementId),
            receiptCount: header.receiptCount,
            detailStatus: detailsById.has(header.stockMovementId) ? "available" : "unavailable",
          },
          koperCreatedAt: text(detail.movementDate) ?? header.entryDate,
          koperUpdatedAt: text(detail.movementDate) ?? header.entryDate,
          mappingVersion: 3,
          seenAt,
        });
      });

      const entryItemRecords = entryItems.map((item) => {
        const candidatePurchaseOrderIds = [...new Set(item.invoiceIds.flatMap((invoiceId) =>
          invoiceOrderIds(invoicesById.get(invoiceId))
        ))];
        return createKoperStagingRecord({
          companyId: env.BOSSA_COMPANY_ID,
          entity: "stock_entry_item",
          koperId: item.productMovementId,
          koperParentId: item.stockMovementId,
          sanitizedPayload: {
            ...item,
            candidatePurchaseOrderIds,
            matchStatus: "pending_resolution",
          },
          mappingVersion: 3,
          seenAt,
        });
      });

      const invoiceRecords = [...invoicesById.entries()].map(([invoiceId, payload]) =>
        createKoperStagingRecord({
          companyId: env.BOSSA_COMPANY_ID,
          entity: "xml_invoice",
          koperId: invoiceId,
          sanitizedPayload: sanitizeInvoice(invoiceId, payload, invoiceProductsById.get(invoiceId) ?? []),
          koperCreatedAt: text(payload.emitDate),
          koperUpdatedAt: text(payload.exitDate) ?? text(payload.emitDate),
          mappingVersion: 3,
          seenAt,
        })
      );

      const invoiceProductRecords = [...invoiceProductsById.entries()].flatMap(([invoiceId, products]) =>
        products.map((product, index) =>
          createKoperStagingRecord({
            companyId: env.BOSSA_COMPANY_ID,
            entity: "xml_invoice_product",
            koperId: `${invoiceId}:${product.numberItem ?? product.inputId ?? index + 1}`,
            koperParentId: invoiceId,
            sanitizedPayload: product,
            mappingVersion: 3,
            seenAt,
          })
        )
      );

      const [entriesSaved, entryItemsSaved, invoicesSaved, invoiceProductsSaved] = await Promise.all([
        saveKoperStagingBatch(entryRecords),
        saveKoperStagingBatch(entryItemRecords),
        saveKoperStagingBatch(invoiceRecords),
        saveKoperStagingBatch(invoiceProductRecords),
      ]);

      const verification = {
        stockEntries: await verifyIds("stock_entry", entryRecords.map((record) => record.koper_id)),
        stockEntryItems: await verifyIds("stock_entry_item", entryItemRecords.map((record) => record.koper_id)),
        xmlInvoices: await verifyIds("xml_invoice", invoiceRecords.map((record) => record.koper_id)),
        xmlInvoiceProducts: await verifyIds("xml_invoice_product", invoiceProductRecords.map((record) => record.koper_id)),
      };
      if (
        verification.stockEntries !== entryRecords.length
        || verification.stockEntryItems !== entryItemRecords.length
        || verification.xmlInvoices !== invoiceRecords.length
        || verification.xmlInvoiceProducts !== invoiceProductRecords.length
      ) throw new Error(`Stock entry direct staging verification failed: ${JSON.stringify(verification)}`);

      const nextOffset = batchOffset + selectedHeaders.length;
      console.log("KOPER_STOCK_ENTRY_DIRECT_STAGING_RESULT", JSON.stringify({
        ok: true,
        blockedWrites: session.blockedWrites,
        targetOriginType,
        declaredAllEntries: declaredTotal,
        totalTargetEntries: targetHeaders.length,
        batchOffset,
        batchSize,
        selectedEntries: selectedHeaders.length,
        firstEntryId: selectedHeaders[0]?.stockMovementId ?? null,
        lastEntryId: selectedHeaders.at(-1)?.stockMovementId ?? null,
        entryDetailsFetched: detailsById.size,
        detailErrors,
        entryItems: entryItems.length,
        invoiceIdsDiscovered: invoiceIds.length,
        invoicesFetched: invoicesById.size,
        invoiceErrors,
        invoiceProducts: invoiceProductRecords.length,
        entriesWithPurchaseOrderCandidates: entryRecords.filter((record) => {
          const payload = objectValue(record.payload);
          return Array.isArray(payload?.purchaseOrderIds) && payload.purchaseOrderIds.length > 0;
        }).length,
        saved: {
          stockEntries: entriesSaved,
          stockEntryItems: entryItemsSaved,
          xmlInvoices: invoicesSaved,
          xmlInvoiceProducts: invoiceProductsSaved,
        },
        verification,
        nextOffset,
        complete: nextOffset >= targetHeaders.length,
      }));
    }
  }
} catch (error: unknown) {
  console.error("KOPER_STOCK_ENTRY_DIRECT_STAGING_FAILED", { reason: safeFailureReason(error) });
}
