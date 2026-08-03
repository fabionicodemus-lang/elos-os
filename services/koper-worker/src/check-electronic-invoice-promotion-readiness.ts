import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type Stage = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Order = { id: string; source_id: string | null; supplier_id: string; project_id: string; order_number: string };
type OrderItem = { id: string; order_id: string; input_id: string; source_id: string | null };
type Receipt = { id: string; order_id: string; receipt_number: string; notes: string | null };
type ReceiptItem = { id: string; receipt_id: string; order_item_id: string; input_id: string };
type Input = { id: string; source_id: string | null };

const object = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};

const identifier = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result || null;
};

const numeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const arrayObjects = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : [];

const idsFrom = (value: unknown, key: string): string[] => [...new Set(arrayObjects(value).flatMap((item) => {
  const found = identifier(item[key]);
  return found ? [found] : [];
}))];

async function readAll<T>(table: string, query: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(table, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
    });
    rows.push(...page);
    if (page.length < 1_000) return rows;
  }
}

function markerEntryId(notes: string | null): string | null {
  return notes?.match(/Koper stockMovementId=(\d+)/i)?.[1] ?? null;
}

function baseSourceId(sourceId: string | null): string | null {
  return identifier(sourceId)?.split(":")[0] ?? null;
}

function sourceProductIds(payload: Json): string[] {
  return [...new Set([
    identifier(payload.inputId),
    identifier(payload.productId),
    identifier(payload.mainProductId),
    identifier(payload.genericProdSeq),
  ].filter((value): value is string => Boolean(value)))];
}

function invoiceAccessKey(payload: Json): string | null {
  const directKeys = [
    "accessKey", "invoiceAccessKey", "nfeAccessKey", "nfeKey", "keyNfe", "keyNFe", "chNFe", "invoiceKey",
  ];
  for (const key of directKeys) {
    const value = identifier(payload[key]);
    if (value) return value.replace(/\D/g, "") || value;
  }
  const reference = arrayObjects(payload.references).find((item) => /access|chave|nfe/i.test(Object.keys(item).join(" ")));
  if (reference) {
    for (const value of Object.values(reference)) {
      const candidate = identifier(value);
      if (candidate && candidate.replace(/\D/g, "").length >= 30) return candidate.replace(/\D/g, "");
    }
  }
  return null;
}

function invoiceNumber(payload: Json): string | null {
  for (const key of ["invoiceNumber", "number", "nfeNumber", "documentNumber", "nfNumber"]) {
    const value = identifier(payload[key]);
    if (value) return value;
  }
  return null;
}

function invoiceTotal(payload: Json): number | null {
  const total = object(payload.total);
  for (const value of [payload.invoiceTotal, payload.totalValue, payload.value, total.invoiceTotal, total.totalValue, total.value, total.total]) {
    const parsed = numeric(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

await import("./index.js");

try {
  const [invoices, invoiceProducts, stockItems, orders, orderItems, receipts, receiptItems, inputs, existingInvoices] = await Promise.all([
    readAll<Stage>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper", entity: "eq.xml_invoice", sync_state: "eq.present", order: "koper_id.asc",
    }),
    readAll<Stage>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper", entity: "eq.xml_invoice_product", sync_state: "eq.present", order: "koper_parent_id.asc,koper_id.asc",
    }),
    readAll<Stage>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper", entity: "eq.stock_entry_item", sync_state: "eq.present", order: "koper_parent_id.asc,koper_id.asc",
    }),
    readAll<Order>("procurement_purchase_orders", {
      select: "id,source_id,supplier_id,project_id,order_number", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper", order: "source_id.asc",
    }),
    readAll<OrderItem>("procurement_purchase_order_items", {
      select: "id,order_id,input_id,source_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper", order: "order_id.asc,id.asc",
    }),
    readAll<Receipt>("procurement_material_receipts", {
      select: "id,order_id,receipt_number,notes", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      order: "id.asc",
    }),
    readAll<ReceiptItem>("procurement_material_receipt_items", {
      select: "id,receipt_id,order_item_id,input_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      order: "receipt_id.asc,id.asc",
    }),
    readAll<Input>("engineering_inputs", {
      select: "id,source_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper", order: "source_id.asc",
    }),
    readAll<{ id: string; access_key: string; registry_number: string }>("finance_electronic_invoices", {
      select: "id,access_key,registry_number", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc",
    }),
  ]);

  const invoiceById = new Map(invoices.map((row) => [row.koper_id, row]));
  const productsByInvoice = new Map<string, Stage[]>();
  for (const product of invoiceProducts) {
    if (product.koper_parent_id) productsByInvoice.set(product.koper_parent_id, [...(productsByInvoice.get(product.koper_parent_id) ?? []), product]);
  }
  const entryIdsByInvoice = new Map<string, Set<string>>();
  for (const item of stockItems) {
    if (!item.koper_parent_id) continue;
    const payload = object(item.payload);
    const invoiceIds = idsFrom(payload.invoices, "invoiceId").length
      ? idsFrom(payload.invoices, "invoiceId")
      : Array.isArray(payload.invoiceIds) ? payload.invoiceIds.flatMap((value) => identifier(value) ? [identifier(value)!] : []) : [];
    for (const invoiceId of invoiceIds) {
      const set = entryIdsByInvoice.get(invoiceId) ?? new Set<string>();
      set.add(item.koper_parent_id);
      entryIdsByInvoice.set(invoiceId, set);
    }
  }

  const orderBySource = new Map(orders.flatMap((row) => row.source_id ? [[row.source_id, row] as const] : []));
  const orderItemsByOrder = new Map<string, OrderItem[]>();
  for (const row of orderItems) orderItemsByOrder.set(row.order_id, [...(orderItemsByOrder.get(row.order_id) ?? []), row]);
  const inputBySource = new Map(inputs.flatMap((row) => row.source_id ? [[row.source_id, row] as const] : []));
  const receiptsByEntry = new Map<string, Receipt[]>();
  for (const receipt of receipts) {
    const entryId = markerEntryId(receipt.notes);
    if (entryId) receiptsByEntry.set(entryId, [...(receiptsByEntry.get(entryId) ?? []), receipt]);
  }
  const receiptItemsByReceipt = new Map<string, ReceiptItem[]>();
  for (const row of receiptItems) receiptItemsByReceipt.set(row.receipt_id, [...(receiptItemsByReceipt.get(row.receipt_id) ?? []), row]);

  const sampleInvoice = object(invoices[0]?.payload);
  const sampleProduct = object(invoiceProducts[0]?.payload);
  console.log("KOPER_ELECTRONIC_INVOICE_PAYLOAD_SHAPE", JSON.stringify({
    invoiceKeys: Object.keys(sampleInvoice).sort(),
    purchaseOrderKeys: Object.keys(arrayObjects(sampleInvoice.purchaseOrders)[0] ?? {}).sort(),
    referenceKeys: Object.keys(arrayObjects(sampleInvoice.references)[0] ?? {}).sort(),
    billKeys: Object.keys(object(sampleInvoice.bill)).sort(),
    totalKeys: Object.keys(object(sampleInvoice.total)).sort(),
    productKeys: Object.keys(sampleProduct).sort(),
  }));

  let safeInvoices = 0;
  let safeItems = 0;
  let missingOrder = 0;
  let multipleOrders = 0;
  let missingReceipt = 0;
  let multipleReceipts = 0;
  let missingAccessKey = 0;
  let missingNumber = 0;
  let missingTotal = 0;
  let missingProducts = 0;
  let unmappedProduct = 0;
  let ambiguousProduct = 0;
  const examples: Array<{ invoiceId: string; reason: string }> = [];

  for (const invoice of invoices) {
    const payload = object(invoice.payload);
    const sourceOrderIds = idsFrom(payload.purchaseOrders, "purchaseOrderId");
    const nativeOrders = sourceOrderIds.flatMap((sourceId) => {
      const order = orderBySource.get(sourceId);
      return order ? [order] : [];
    });
    let reason: string | null = null;
    if (nativeOrders.length === 0) { missingOrder += 1; reason = "missing_order"; }
    else if (nativeOrders.length !== 1) { multipleOrders += 1; reason = "multiple_orders"; }

    const entryIds = [...(entryIdsByInvoice.get(invoice.koper_id) ?? new Set<string>())];
    const candidateReceipts = nativeOrders.length === 1
      ? entryIds.flatMap((entryId) => (receiptsByEntry.get(entryId) ?? []).filter((receipt) => receipt.order_id === nativeOrders[0]!.id))
      : [];
    const uniqueReceipts = [...new Map(candidateReceipts.map((row) => [row.id, row])).values()];
    if (!reason && uniqueReceipts.length === 0) { missingReceipt += 1; reason = "missing_receipt"; }
    else if (!reason && uniqueReceipts.length !== 1) { multipleReceipts += 1; reason = "multiple_receipts"; }

    if (!invoiceAccessKey(payload)) { missingAccessKey += 1; if (!reason) reason = "missing_access_key"; }
    if (!invoiceNumber(payload)) { missingNumber += 1; if (!reason) reason = "missing_number"; }
    if (invoiceTotal(payload) === null) { missingTotal += 1; if (!reason) reason = "missing_total"; }

    const products = productsByInvoice.get(invoice.koper_id) ?? [];
    if (products.length === 0) { missingProducts += 1; if (!reason) reason = "missing_products"; }

    let mapped = 0;
    if (nativeOrders.length === 1 && uniqueReceipts.length === 1) {
      const candidateOrderItems = orderItemsByOrder.get(nativeOrders[0]!.id) ?? [];
      const candidateReceiptItems = receiptItemsByReceipt.get(uniqueReceipts[0]!.id) ?? [];
      for (const product of products) {
        const productPayload = object(product.payload);
        const nativeInputIds = new Set(sourceProductIds(productPayload).flatMap((sourceId) => {
          const input = inputBySource.get(sourceId);
          return input ? [input.id] : [];
        }));
        const sourceItemId = identifier(productPayload.orderProductId) ?? identifier(productPayload.purchaseOrderItemId);
        const candidates = candidateOrderItems.filter((item) => {
          if (sourceItemId && baseSourceId(item.source_id) === sourceItemId) return true;
          return nativeInputIds.has(item.input_id);
        });
        const grouped = new Map<string, OrderItem[]>();
        for (const candidate of candidates) {
          const base = baseSourceId(candidate.source_id) ?? candidate.id;
          grouped.set(base, [...(grouped.get(base) ?? []), candidate]);
        }
        if (grouped.size === 0) { unmappedProduct += 1; continue; }
        if (grouped.size > 1) { ambiguousProduct += 1; continue; }
        const group = [...grouped.values()][0]!;
        const orderItemIds = new Set(group.map((item) => item.id));
        const matchingReceiptItems = candidateReceiptItems.filter((item) => orderItemIds.has(item.order_item_id));
        if (matchingReceiptItems.length !== 1) {
          if (matchingReceiptItems.length === 0) unmappedProduct += 1;
          else ambiguousProduct += 1;
          continue;
        }
        mapped += 1;
      }
    }
    if (!reason && mapped !== products.length) reason = "unmapped_items";

    if (!reason) {
      safeInvoices += 1;
      safeItems += mapped;
    } else if (examples.length < 30) examples.push({ invoiceId: invoice.koper_id, reason });
  }

  console.log("KOPER_ELECTRONIC_INVOICE_READINESS", JSON.stringify({
    ok: true,
    source: {
      invoices: invoices.length,
      products: invoiceProducts.length,
      stockEntryItems: stockItems.length,
      nativeOrders: orders.length,
      nativeOrderItems: orderItems.length,
      nativeReceipts: receipts.length,
      nativeReceiptItems: receiptItems.length,
      existingNativeInvoices: existingInvoices.length,
    },
    resolution: {
      safeInvoices,
      safeItems,
      missingOrder,
      multipleOrders,
      missingReceipt,
      multipleReceipts,
      missingAccessKey,
      missingNumber,
      missingTotal,
      missingProducts,
      unmappedProduct,
      ambiguousProduct,
    },
    examples,
  }));
} catch (error: unknown) {
  console.error("KOPER_ELECTRONIC_INVOICE_READINESS_FAILED", {
    message: error instanceof Error ? error.message.slice(0, 1_200) : "unknown",
  });
}
