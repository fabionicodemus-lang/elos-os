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
type ApiTransport = { url: string; headers: Record<string, string> };
type StagingItemRow = {
  koper_id: string;
  koper_parent_id: string | null;
  payload: unknown;
  elos_id: string | null;
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

type OrderItem = {
  sourceId: string;
  parentOrderId: string;
  elosId: string | null;
  productId: string | null;
  mainProductId: string | null;
  genericProdSeq: string | null;
  amount: number | null;
  unitPrice: number | null;
};

type ItemResolution = {
  purchaseOrderId: string | null;
  orderItem: OrderItem | null;
  invoiceId: string | null;
  invoiceProduct: InvoiceProduct | null;
  matchMethod: string;
  score: number;
  status: "resolved" | "unresolved";
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

async function captureTransport(page: Page, pathnamePrefix: string, navigationUrl: string): Promise<ApiTransport> {
  let transport: ApiTransport | null = null;
  const capture = (response: Response): void => {
    try {
      const url = new URL(response.url());
      if (
        !transport
        && response.request().method() === "GET"
        && url.hostname === "api.koper.com.br"
        && url.pathname.startsWith(pathnamePrefix)
      ) transport = { url: response.url(), headers: response.request().headers() };
    } catch {
      // Ignore malformed URLs.
    }
  };
  page.on("response", capture);
  await page.goto(navigationUrl, { waitUntil: "domcontentloaded", timeout: 18_000 }).catch(() => undefined);
  for (let attempt = 0; attempt < 10 && !transport; attempt += 1) await page.waitForTimeout(500);
  page.off("response", capture);
  const captured = transport as ApiTransport | null;
  if (!captured) throw new Error(`Koper transport not captured for ${pathnamePrefix}`);
  return captured;
}

async function readJson(
  response: { ok(): boolean; status(): number; json(): Promise<unknown> },
  label: string,
): Promise<UnknownRecord> {
  if (!response.ok()) throw new Error(`${label} failed (HTTP ${response.status()})`);
  const body = objectValue(await response.json());
  if (!body) throw new Error(`${label} returned an invalid body`);
  return body;
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

async function readOrderItems(orderIds: string[]): Promise<OrderItem[]> {
  if (orderIds.length === 0) return [];
  const rows: StagingItemRow[] = [];
  for (let index = 0; index < orderIds.length; index += 100) {
    const chunk = orderIds.slice(index, index + 100);
    const page = await requestSupabase<StagingItemRow[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "koper_id,koper_parent_id,payload,elos_id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: "eq.purchase_order_item",
        sync_state: "eq.present",
        koper_parent_id: `in.(${chunk.join(",")})`,
        order: "koper_id.asc",
        limit: "5000",
      }),
    });
    rows.push(...page);
  }
  return rows.flatMap((row) => {
    const payload = objectValue(row.payload);
    if (!payload || !row.koper_parent_id) return [];
    return [{
      sourceId: row.koper_id,
      parentOrderId: row.koper_parent_id,
      elosId: row.elos_id,
      productId: identifier(payload.productId),
      mainProductId: identifier(payload.mainProductId),
      genericProdSeq: identifier(payload.genericProdSeq),
      amount: numeric(payload.amount) ?? numeric(payload.productAmount),
      unitPrice: numeric(payload.finalPrice) ?? numeric(payload.price) ?? numeric(payload.productValue),
    }];
  });
}

function closeEnough(left: number | null, right: number | null, tolerance = 0.02): boolean {
  if (left === null || right === null) return false;
  return Math.abs(left - right) <= Math.max(tolerance, Math.abs(right) * 0.0005);
}

function scoreInvoiceProduct(entry: EntryItem, invoice: InvoiceProduct): number {
  let score = 0;
  if (entry.productId && invoice.productId === entry.productId) score += 100;
  else if (entry.mainProductId && invoice.mainProductId === entry.mainProductId) score += 70;
  if (closeEnough(entry.totalProductValue, invoice.totalValue, 0.05)) score += 35;
  if (closeEnough(entry.productAmount, invoice.amount, 0.0001)) score += 10;
  return score;
}

function scoreOrderItem(entry: EntryItem, candidate: OrderItem): number {
  let score = 0;
  if (entry.productId && candidate.productId === entry.productId) score += 120;
  else if (entry.mainProductId && candidate.mainProductId === entry.mainProductId) score += 80;
  else if (entry.genericProdSeq && candidate.genericProdSeq === entry.genericProdSeq) score += 70;
  if (closeEnough(entry.productAmount, candidate.amount, 0.0001)) score += 25;
  const candidateTotal = candidate.amount !== null && candidate.unitPrice !== null
    ? candidate.amount * candidate.unitPrice
    : null;
  if (closeEnough(entry.totalProductValue, candidateTotal, 0.10)) score += 20;
  return score;
}

function bestUnique<T>(values: T[], scorer: (value: T) => number, minimum: number): { value: T | null; score: number } {
  const scored = values
    .map((value) => ({ value, score: scorer(value) }))
    .sort((a, b) => b.score - a.score);
  const first = scored[0];
  if (!first || first.score < minimum) return { value: null, score: first?.score ?? 0 };
  const second = scored[1];
  if (second && second.score === first.score) return { value: null, score: first.score };
  return first;
}

function resolveItem(
  entry: EntryItem,
  invoicesById: Map<string, UnknownRecord>,
  invoiceProductsById: Map<string, InvoiceProduct[]>,
  orderItems: OrderItem[],
): ItemResolution {
  const candidateInvoiceIds = entry.invoiceIds.filter((invoiceId) => invoicesById.has(invoiceId));
  const invoiceProductCandidates = candidateInvoiceIds.flatMap(
    (invoiceId) => invoiceProductsById.get(invoiceId) ?? [],
  );
  const bestInvoice = bestUnique(invoiceProductCandidates, (candidate) => scoreInvoiceProduct(entry, candidate), 100);
  const invoiceId = bestInvoice.value?.invoiceId ?? (candidateInvoiceIds.length === 1 ? candidateInvoiceIds[0]! : null);
  const candidateOrderIds = [...new Set(candidateInvoiceIds.flatMap((candidateInvoiceId) => {
    const invoice = invoicesById.get(candidateInvoiceId);
    return invoice && Array.isArray(invoice.purchaseOrders)
      ? invoice.purchaseOrders.flatMap((value) => {
          const id = identifier(objectValue(value)?.purchaseOrderId);
          return id ? [id] : [];
        })
      : [];
  }))];
  const orderCandidates = orderItems.filter((item) => candidateOrderIds.includes(item.parentOrderId));
  const bestOrder = bestUnique(orderCandidates, (candidate) => scoreOrderItem(entry, candidate), 100);
  const purchaseOrderId = bestOrder.value?.parentOrderId ?? (candidateOrderIds.length === 1 ? candidateOrderIds[0]! : null);
  const methodParts = [] as string[];
  if (invoiceId) methodParts.push("invoice_id");
  if (purchaseOrderId) methodParts.push("invoice_purchase_order");
  if (bestOrder.value) {
    if (entry.productId && bestOrder.value.productId === entry.productId) methodParts.push("product_id");
    else if (entry.mainProductId && bestOrder.value.mainProductId === entry.mainProductId) methodParts.push("main_product_id");
    else methodParts.push("generic_product");
  }
  return {
    purchaseOrderId,
    orderItem: bestOrder.value,
    invoiceId,
    invoiceProduct: bestInvoice.value,
    matchMethod: methodParts.join("+") || "unresolved",
    score: bestOrder.score,
    status: bestOrder.value ? "resolved" : "unresolved",
  };
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

const result = await withBrowserless(async ({ page }) => {
  if (process.env.KOPER_STOCK_ENTRY_STAGING_WRITE_ENABLED !== "true") {
    throw new Error("Koper stock entry staging write is not explicitly enabled");
  }
  const batchOffset = integerEnv("KOPER_STOCK_ENTRY_BATCH_OFFSET", 0, 0, 100_000);
  const batchSize = integerEnv("KOPER_STOCK_ENTRY_BATCH_SIZE", 50, 1, 250);
  const targetOriginType = process.env.KOPER_STOCK_ENTRY_ORIGIN_TYPE ?? "0";

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

  const stockTransport = await captureTransport(
    page,
    "/stock/v1/",
    "https://app.koper.com.br/suprimentos/entradas/",
  );

  const allHeaders: EntryHeader[] = [];
  let declaredTotal: number | null = null;
  for (let offset = 0; offset < 50_000; offset += 1_000) {
    const response = await page.request.get(
      `https://api.koper.com.br/stock/v1/entry?limit=1000&offset=${offset}&orderFlag=asc&orderby=stockMovementId`,
      { headers: stockTransport.headers, timeout: 12_000 },
    );
    const body = await readJson(response, "Koper stock entry list");
    declaredTotal ??= numeric(body.amountEntry);
    const entries = Array.isArray(body.entries) ? body.entries : [];
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
    return {
      ok: true,
      flowSelected: true,
      blockedWrites,
      targetOriginType,
      totalTargetEntries: targetHeaders.length,
      batchOffset,
      batchSize,
      selectedEntries: 0,
      nextOffset: batchOffset,
      complete: true,
      message: "NO_ENTRIES_IN_BATCH",
    };
  }

  const detailPairs = await mapConcurrent(selectedHeaders, 10, async (header) => {
    const response = await page.request.get(
      `https://api.koper.com.br/stock/v1/product_entry?entryId=${header.stockMovementId}&pending=false`,
      { headers: stockTransport.headers, timeout: 12_000 },
    );
    return [header.stockMovementId, await readJson(response, `Koper stock entry ${header.stockMovementId}`)] as const;
  });
  const detailsById = new Map(detailPairs);
  const entryItems = selectedHeaders.flatMap((header) =>
    parseEntryItems(header.stockMovementId, detailsById.get(header.stockMovementId) ?? {})
  );
  const invoiceIds = [...new Set(entryItems.flatMap((item) => item.invoiceIds))];

  const invoicesById = new Map<string, UnknownRecord>();
  const invoiceProductsById = new Map<string, InvoiceProduct[]>();
  if (invoiceIds.length > 0) {
    const invoiceTransport = await captureTransport(
      page,
      "/financial/v1/xml_invoice",
      `https://app.koper.com.br/financeiro/notas_fiscais/view/${invoiceIds[0]}`,
    );
    const invoicePairs = await mapConcurrent(invoiceIds, 10, async (invoiceId) => {
      const url = new URL(invoiceTransport.url);
      url.searchParams.set("invoiceId", invoiceId);
      url.searchParams.set("cb", String(Date.now()));
      const response = await page.request.get(url.toString(), {
        headers: invoiceTransport.headers,
        timeout: 12_000,
      });
      if (!response.ok()) return [invoiceId, null] as const;
      return [invoiceId, await readJson(response, `Koper XML invoice ${invoiceId}`)] as const;
    });
    for (const [invoiceId, payload] of invoicePairs) {
      if (!payload) continue;
      invoicesById.set(invoiceId, payload);
      invoiceProductsById.set(invoiceId, parseInvoiceProducts(invoiceId, payload));
    }
  }

  const orderIds = [...new Set([...invoicesById.values()].flatMap((invoice) =>
    Array.isArray(invoice.purchaseOrders)
      ? invoice.purchaseOrders.flatMap((value) => {
          const id = identifier(objectValue(value)?.purchaseOrderId);
          return id ? [id] : [];
        })
      : []
  ))];
  const orderItems = await readOrderItems(orderIds);
  const resolutions = new Map<string, ItemResolution>();
  for (const item of entryItems) {
    resolutions.set(item.productMovementId, resolveItem(item, invoicesById, invoiceProductsById, orderItems));
  }

  const seenAt = new Date();
  const entryRecords = selectedHeaders.map((header) => {
    const detail = detailsById.get(header.stockMovementId) ?? {};
    const relatedItems = entryItems.filter((item) => item.stockMovementId === header.stockMovementId);
    const relatedResolutions = relatedItems.map((item) => resolutions.get(item.productMovementId)!);
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
        invoiceIds: [...new Set(relatedItems.flatMap((item) => item.invoiceIds))],
        purchaseOrderIds: [...new Set(relatedResolutions.flatMap((resolution) =>
          resolution.purchaseOrderId ? [resolution.purchaseOrderId] : []
        ))],
        productMovementIds: relatedItems.map((item) => item.productMovementId),
        receiptCount: header.receiptCount,
        resolvedItems: relatedResolutions.filter((resolution) => resolution.status === "resolved").length,
        unresolvedItems: relatedResolutions.filter((resolution) => resolution.status === "unresolved").length,
      },
      koperCreatedAt: text(detail.movementDate) ?? header.entryDate,
      koperUpdatedAt: text(detail.movementDate) ?? header.entryDate,
      mappingVersion: 2,
      seenAt,
    });
  });

  const entryItemRecords = entryItems.map((item) => {
    const resolution = resolutions.get(item.productMovementId)!;
    return createKoperStagingRecord({
      companyId: env.BOSSA_COMPANY_ID,
      entity: "stock_entry_item",
      koperId: item.productMovementId,
      koperParentId: item.stockMovementId,
      sanitizedPayload: {
        ...item,
        resolvedInvoiceId: resolution.invoiceId,
        resolvedInvoiceInputId: resolution.invoiceProduct?.inputId ?? null,
        resolvedInvoiceNumberItem: resolution.invoiceProduct?.numberItem ?? null,
        resolvedPurchaseOrderId: resolution.purchaseOrderId,
        resolvedOrderProductId: resolution.orderItem?.sourceId ?? null,
        resolvedElosOrderItemId: resolution.orderItem?.elosId ?? null,
        matchStatus: resolution.status,
        matchMethod: resolution.matchMethod,
        matchScore: resolution.score,
      },
      mappingVersion: 2,
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
      mappingVersion: 2,
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
        mappingVersion: 2,
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
  ) throw new Error(`Stock entry staging verification failed: ${JSON.stringify(verification)}`);

  const resolutionValues = [...resolutions.values()];
  const nextOffset = batchOffset + selectedHeaders.length;
  return {
    ok: true,
    flowSelected: true,
    blockedWrites,
    targetOriginType,
    declaredAllEntries: declaredTotal,
    totalTargetEntries: targetHeaders.length,
    batchOffset,
    batchSize,
    selectedEntries: selectedHeaders.length,
    firstEntryId: selectedHeaders[0]?.stockMovementId ?? null,
    lastEntryId: selectedHeaders.at(-1)?.stockMovementId ?? null,
    entryItems: entryItems.length,
    invoiceIdsDiscovered: invoiceIds.length,
    invoicesFetched: invoicesById.size,
    invoiceProducts: invoiceProductRecords.length,
    purchaseOrderIds: orderIds.length,
    resolvedItems: resolutionValues.filter((resolution) => resolution.status === "resolved").length,
    unresolvedItems: resolutionValues.filter((resolution) => resolution.status === "unresolved").length,
    matchMethods: Object.fromEntries(
      resolutionValues.reduce((map, resolution) => {
        map.set(resolution.matchMethod, (map.get(resolution.matchMethod) ?? 0) + 1);
        return map;
      }, new Map<string, number>()),
    ),
    saved: {
      stockEntries: entriesSaved,
      stockEntryItems: entryItemsSaved,
      xmlInvoices: invoicesSaved,
      xmlInvoiceProducts: invoiceProductsSaved,
    },
    verification,
    nextOffset,
    complete: nextOffset >= targetHeaders.length,
  };
}, { sessionTimeoutMs: 58_000 });

console.log("KOPER_STOCK_ENTRY_STAGING_BATCH_RESULT", JSON.stringify(result));
await import("./index.js");
