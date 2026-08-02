import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type UnknownRecord = Record<string, unknown>;
type StockTransport = { headers: Record<string, string> };

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

function originCategory(value: unknown): string {
  if (typeof value !== "string") return "missing";
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized.includes("pedido") || normalized.includes("ordem")) return "purchase_order_like";
  if (normalized.includes("nota") || normalized.includes("fiscal")) return "invoice_like";
  if (normalized.includes("recibo")) return "receipt_like";
  if (normalized.includes("transfer")) return "transfer_like";
  if (normalized.includes("devol")) return "return_like";
  if (normalized.includes("estoque")) return "stock_like";
  if (normalized.includes("entrada")) return "entry_like";
  return "other";
}

function invoiceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const id = identifier(objectValue(item)?.invoiceId);
    return id ? [id] : [];
  });
}

function sanitizeReceipts(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => {
      const receipt = objectValue(item);
      if (!receipt) return typeof item;
      return {
        receiptId: identifier(receipt.receiptId),
        receiptNumber: identifier(receipt.receiptNumber),
        receiptAmount: numeric(receipt.receiptAmount) ?? numeric(receipt.amount),
      };
    });
  }
  return numeric(value) ?? identifier(value) ?? (value === null ? null : typeof value);
}

const SAMPLE_ENTRIES = [
  { stockMovementId: "13374", originId: "4097", originType: "0", expected: "known_purchase_order" },
  { stockMovementId: "13373", originId: "9607", originType: "0", expected: "unknown_origin" },
  { stockMovementId: "13372", originId: "398", originType: "0", expected: "unknown_origin" },
  { stockMovementId: "34", originId: "169", originType: "1", expected: "type_one_origin" },
];

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

  let transport: StockTransport | null = null;
  const capture = (response: Response): void => {
    try {
      const url = new URL(response.url());
      if (
        !transport
        && response.request().method() === "GET"
        && url.hostname === "api.koper.com.br"
        && url.pathname.startsWith("/stock/v1/")
      ) transport = { headers: response.request().headers() };
    } catch {
      // Ignora URLs inválidas.
    }
  };
  page.on("response", capture);
  await page.goto("https://app.koper.com.br/suprimentos/entradas/", {
    waitUntil: "domcontentloaded",
    timeout: 18_000,
  }).catch(() => undefined);
  for (let attempt = 0; attempt < 10 && !transport; attempt += 1) await page.waitForTimeout(750);
  page.off("response", capture);
  const capturedTransport = transport as StockTransport | null;
  if (!capturedTransport) return { ok: false, message: "KOPER_STOCK_TRANSPORT_NOT_CAPTURED", blockedWrites };

  const entries = [] as unknown[];
  for (const sample of SAMPLE_ENTRIES) {
    const response = await page.request.get(
      `https://api.koper.com.br/stock/v1/product_entry?entryId=${sample.stockMovementId}&pending=false`,
      { headers: capturedTransport.headers, timeout: 12_000 },
    );
    if (!response.ok()) {
      entries.push({ ...sample, status: response.status() });
      continue;
    }
    const payload = objectValue(await response.json()) ?? {};
    const products = Array.isArray(payload.products) ? payload.products : [];
    entries.push({
      ...sample,
      status: response.status(),
      entryType: identifier(payload.entryType),
      packingListId: identifier(payload.packingListId),
      placeEntryId: identifier(payload.placeEntryId),
      movementDate: identifier(payload.movementDate),
      originCategory: originCategory(payload.originName),
      originNameLength: typeof payload.originName === "string" ? payload.originName.length : null,
      totalProductValue: numeric(payload.totalProductValue),
      averageProductValue: numeric(payload.averageProductValue),
      itemsAmount: numeric(payload.itemsAmount),
      filesCount: Array.isArray(payload.files) ? payload.files.length : null,
      products: products.slice(0, 20).map((item) => {
        const product = objectValue(item) ?? {};
        return {
          productId: identifier(product.productId),
          mainProductId: identifier(product.mainProductId),
          genericProdSeq: identifier(product.genericProdSeq),
          productMovementId: identifier(product.productMovementId),
          stockMovementId: identifier(product.stockMovementId),
          productAmount: numeric(product.productAmount),
          unitMeasureId: identifier(product.unitMeasureId),
          productValue: numeric(product.productValue),
          averageProductValue: numeric(product.averageProductValue),
          totalProductValue: numeric(product.totalProductValue),
          receipts: sanitizeReceipts(product.receipts),
          invoiceIds: invoiceIds(product.invoices),
          invoicesCount: Array.isArray(product.invoices) ? product.invoices.length : numeric(product.invoices),
        };
      }),
    });
  }

  return { ok: true, flowSelected: true, entries, blockedWrites };
}, { sessionTimeoutMs: 58_000 });

console.log("KOPER_STOCK_ENTRY_SEMANTICS_RESULT", JSON.stringify(result));
await import("./index.js");
