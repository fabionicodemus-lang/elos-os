import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type UnknownRecord = Record<string, unknown>;
type InvoiceTransport = { url: string; headers: Record<string, string> };

const SAMPLES = [
  {
    invoiceId: "610c1040-85f1-11f1-b4a9-86c46e718d59",
    stockMovementId: "13374",
    expectedInputIds: ["15308", "15309", "15310", "15311"],
  },
  {
    invoiceId: "d4360ae6-85f9-11f1-9cb1-86c46e718d59",
    stockMovementId: "13373",
    expectedInputIds: ["15307"],
  },
  {
    invoiceId: "2394da78-85fe-11f1-a500-86c46e718d59",
    stockMovementId: "13372",
    expectedInputIds: ["15305", "15306"],
  },
];

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

function isSafeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (/name|description|comment|address|email|phone|cnpj|cpf|tax|token|cookie|file|url|key|access/.test(normalized)) {
    return false;
  }
  return /(^id$|id$|date$|at$|status|situation|type|draft|amount|value|price|total|quantity|number|sequence|order|invoice|receipt|request|budget|purchase|stock|movement|input|duplicate|due|paid)/.test(normalized);
}

function technicalObject(value: unknown, depth = 0): unknown {
  if (depth > 4) return null;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => technicalObject(item, depth + 1));
  const object = objectValue(value);
  if (!object) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    return null;
  }
  return Object.fromEntries(
    Object.entries(object).flatMap(([key, item]) => {
      if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
        return isSafeKey(key) ? [[key, item]] : [];
      }
      const nested = technicalObject(item, depth + 1);
      if (Array.isArray(nested) && nested.length > 0) return [[key, nested]];
      if (objectValue(nested) && Object.keys(nested as UnknownRecord).length > 0) return [[key, nested]];
      return [];
    }),
  );
}

function invoiceUrl(template: string, invoiceId: string): string {
  const url = new URL(template);
  url.searchParams.set("invoiceId", invoiceId);
  url.searchParams.set("cb", String(Date.now()));
  return url.toString();
}

const result = await withBrowserless(async ({ page }) => {
  const login = await performKoperLogin(page);
  if (!login.authenticated) return { ok: false, message: login.message };

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
  if (!flowSelected) return { ok: false, message: "KOPER_FLOW_COMPANY_NOT_SELECTED", blockedWrites };

  let transport: InvoiceTransport | null = null;
  const capture = (response: Response): void => {
    try {
      const url = new URL(response.url());
      if (
        !transport
        && response.request().method() === "GET"
        && url.hostname === "api.koper.com.br"
        && url.pathname === "/financial/v1/xml_invoice"
      ) transport = { url: response.url(), headers: response.request().headers() };
    } catch {
      // Ignora URLs inválidas.
    }
  };
  page.on("response", capture);
  await page.goto(`https://app.koper.com.br/financeiro/notas_fiscais/view/${SAMPLES[0].invoiceId}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  }).catch(() => undefined);
  for (let attempt = 0; attempt < 12 && !transport; attempt += 1) await page.waitForTimeout(750);
  page.off("response", capture);
  const capturedTransport = transport as InvoiceTransport | null;
  if (!capturedTransport) return { ok: false, message: "KOPER_XML_INVOICE_TRANSPORT_NOT_CAPTURED", blockedWrites };

  const invoices = [] as unknown[];
  for (const sample of SAMPLES) {
    const response = await page.request.get(invoiceUrl(capturedTransport.url, sample.invoiceId), {
      headers: capturedTransport.headers,
      timeout: 12_000,
    });
    if (!response.ok()) {
      invoices.push({ invoiceId: sample.invoiceId, stockMovementId: sample.stockMovementId, status: response.status() });
      continue;
    }
    const payload = objectValue(await response.json()) ?? {};
    const products = Array.isArray(payload.products) ? payload.products : [];
    const inputIds = products
      .map((item) => identifier(objectValue(item)?.inputId))
      .filter((item): item is string => Boolean(item));
    const inputIdSet = new Set(inputIds);
    invoices.push({
      invoiceId: identifier(payload.invoiceId) ?? sample.invoiceId,
      stockMovementId: sample.stockMovementId,
      status: response.status(),
      invoiceType: identifier(payload.invoiceType),
      situation: identifier(payload.situation),
      isDraft: typeof payload.isDraft === "boolean" ? payload.isDraft : null,
      emitDate: identifier(payload.emitDate),
      exitDate: identifier(payload.exitDate),
      buildMonitoringId: identifier(payload.buildMonitoringId),
      costCenterId: identifier(payload.costCenterId),
      stockPlaceId: identifier(payload.stockPlaceId),
      chartAccountId: identifier(payload.chartAccountId),
      itemChartAccountId: identifier(payload.itemChartAccountId),
      deliverySupplierId: identifier(payload.deliverySupplierId),
      purchaseOrdersCount: Array.isArray(payload.purchaseOrders) ? payload.purchaseOrders.length : null,
      purchaseOrders: technicalObject(payload.purchaseOrders),
      referencesCount: Array.isArray(payload.references) ? payload.references.length : null,
      references: technicalObject(payload.references),
      bill: technicalObject(payload.bill),
      total: technicalObject(payload.total),
      productsCount: products.length,
      products: technicalObject(products),
      inputIds,
      expectedInputIds: sample.expectedInputIds,
      matchedExpectedInputIds: sample.expectedInputIds.filter((id) => inputIdSet.has(id)),
      missingExpectedInputIds: sample.expectedInputIds.filter((id) => !inputIdSet.has(id)),
      invoiceProductTotal: products.reduce((sum, item) => {
        const product = objectValue(item);
        return sum + (numeric(product?.totalValue) ?? numeric(product?.productTotalValue) ?? 0);
      }, 0),
    });
  }

  return { ok: true, flowSelected: true, invoices, blockedWrites };
}, { sessionTimeoutMs: 58_000 });

console.log("KOPER_ENTRY_INVOICE_LINKS_RESULT", JSON.stringify(result));
await import("./index.js");
