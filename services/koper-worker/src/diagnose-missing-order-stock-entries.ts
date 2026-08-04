import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type StageRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type OrderRow = { id: string; source_id: string | null; order_number: string };
type ReceiptRow = { id: string; order_id: string; notes: string | null };

type Evidence = {
  entryId: string;
  entryType: string | null;
  originId: string | null;
  invoiceIds: string[];
  itemCandidateOrderIds: string[];
  entryOrderIds: string[];
  invoiceOrderIds: string[];
  referencedOrderIds: string[];
  nativeOrderIds: string[];
  nativeOrderNumbers: string[];
  blockingInvoiceIds: string[];
  itemCount: number;
  receiptCount: number | null;
  packingListId: string | null;
  classification: string;
};

const object = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Json
    : {};

const identifier = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const numeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const identifiers = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.flatMap((item) => {
      const id = identifier(item);
      return id ? [id] : [];
    }))]
  : [];

function invoiceIds(payload: Json): string[] {
  const nested = Array.isArray(payload.invoices)
    ? payload.invoices.flatMap((value) => {
        const id = identifier(object(value).invoiceId);
        return id ? [id] : [];
      })
    : [];
  return [...new Set([...identifiers(payload.invoiceIds), ...nested])];
}

function orderIdsFromInvoice(payload: Json): string[] {
  if (!Array.isArray(payload.purchaseOrders)) return [];
  return [...new Set(payload.purchaseOrders.flatMap((value) => {
    const id = identifier(object(value).purchaseOrderId);
    return id ? [id] : [];
  }))];
}

function orderIdsFromEntry(payload: Json): string[] {
  const direct = identifiers(payload.purchaseOrderIds);
  const nested = Array.isArray(payload.purchaseOrders)
    ? payload.purchaseOrders.flatMap((value) => {
        const row = object(value);
        const id = identifier(row.purchaseOrderId) ?? identifier(row.id);
        return id ? [id] : [];
      })
    : [];
  return [...new Set([...direct, ...nested])];
}

function markerEntryId(notes: string | null): string | null {
  return notes?.match(/Koper stockMovementId=(\d+)/i)?.[1] ?? null;
}

async function readAll<T>(resource: string, query: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(resource, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
      timeoutMs: 30_000,
    });
    rows.push(...page);
    console.log("KOPER_MISSING_ORDER_PROGRESS", JSON.stringify({ resource, offset, pageRows: page.length, totalRows: rows.length }));
    if (page.length < 1_000) return rows;
  }
}

function classify(params: {
  nativeOrderIds: string[];
  referencedOrderIds: string[];
  invoiceIds: string[];
  entryType: string | null;
  packingListId: string | null;
  receiptCount: number | null;
}): string {
  if (params.nativeOrderIds.length === 1) return "recoverable_single_order";
  if (params.nativeOrderIds.length > 1) return "recoverable_multiple_orders";
  if (params.referencedOrderIds.length > 0) return "referenced_orders_not_imported";

  const description = `${params.entryType ?? ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/transfer|movimentacao entre|remanej/.test(description)) return "explicit_transfer";
  if (/ajuste|inventar|manual|avulsa|saldo inicial|acerto/.test(description)) return "explicit_manual_adjustment";
  if (/devolu/.test(description)) return "explicit_return";
  if (params.packingListId) return "packing_list_without_order";
  if (params.invoiceIds.length > 0) return "invoice_without_order_reference";
  if ((params.receiptCount ?? 0) > 0) return "technical_receipt_without_order_reference";
  return "no_order_reference";
}

function summarize(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

try {
  console.log("KOPER_MISSING_ORDER_DIAGNOSTIC_START", JSON.stringify({ readOnly: true, companyId: env.BOSSA_COMPANY_ID }));

  const entries = await readAll<StageRow>("koper_staging_records", {
    select: "koper_id,koper_parent_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: "eq.stock_entry",
    sync_state: "eq.present",
    order: "koper_id.asc",
  });
  const items = await readAll<StageRow>("koper_staging_records", {
    select: "koper_id,koper_parent_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: "eq.stock_entry_item",
    sync_state: "eq.present",
    order: "koper_parent_id.asc,koper_id.asc",
  });
  const invoices = await readAll<StageRow>("koper_staging_records", {
    select: "koper_id,koper_parent_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: "eq.xml_invoice",
    sync_state: "eq.present",
    order: "koper_id.asc",
  });
  const orders = await readAll<OrderRow>("procurement_purchase_orders", {
    select: "id,source_id,order_number",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source_system: "eq.koper",
    order: "source_id.asc",
  });
  const receipts = await readAll<ReceiptRow>("procurement_material_receipts", {
    select: "id,order_id,notes",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    order: "id.asc",
  });

  const programmedEntries = entries.filter((row) => identifier(object(row.payload).originType) === "0");
  const programmedIds = new Set(programmedEntries.map((row) => row.koper_id));
  const itemsByEntry = new Map<string, StageRow[]>();
  for (const item of items) {
    if (!item.koper_parent_id || !programmedIds.has(item.koper_parent_id)) continue;
    itemsByEntry.set(item.koper_parent_id, [...(itemsByEntry.get(item.koper_parent_id) ?? []), item]);
  }

  const invoiceById = new Map(invoices.map((row) => [row.koper_id, row]));
  const orderBySource = new Map(orders.flatMap((row) => row.source_id ? [[row.source_id, row] as const] : []));
  const receiptsByEntry = new Map<string, ReceiptRow[]>();
  for (const receipt of receipts) {
    const entryId = markerEntryId(receipt.notes);
    if (!entryId) continue;
    receiptsByEntry.set(entryId, [...(receiptsByEntry.get(entryId) ?? []), receipt]);
  }

  const entryIdsByInvoice = new Map<string, Set<string>>();
  for (const entry of programmedEntries) {
    const linkedInvoices = new Set([
      ...invoiceIds(object(entry.payload)),
      ...(itemsByEntry.get(entry.koper_id) ?? []).flatMap((item) => invoiceIds(object(item.payload))),
    ]);
    for (const invoiceId of linkedInvoices) {
      const set = entryIdsByInvoice.get(invoiceId) ?? new Set<string>();
      set.add(entry.koper_id);
      entryIdsByInvoice.set(invoiceId, set);
    }
  }

  const missingReceiptInvoiceIds = new Set<string>();
  for (const invoice of invoices) {
    const sourceOrderIds = orderIdsFromInvoice(object(invoice.payload));
    const nativeOrders = sourceOrderIds.flatMap((sourceId) => {
      const order = orderBySource.get(sourceId);
      return order ? [order] : [];
    });
    const uniqueNativeOrders = [...new Map(nativeOrders.map((row) => [row.id, row])).values()];
    if (uniqueNativeOrders.length !== 1) continue;
    const entryIds = [...(entryIdsByInvoice.get(invoice.koper_id) ?? new Set<string>())];
    const matches = entryIds.flatMap((entryId) => (receiptsByEntry.get(entryId) ?? []).filter((receipt) => receipt.order_id === uniqueNativeOrders[0]!.id));
    if (matches.length === 0) missingReceiptInvoiceIds.add(invoice.koper_id);
  }

  const evidence: Evidence[] = [];
  for (const entry of programmedEntries) {
    const entryPayload = object(entry.payload);
    const entryItems = itemsByEntry.get(entry.koper_id) ?? [];
    const itemCandidateOrderIds = [...new Set(entryItems.flatMap((item) => identifiers(object(item.payload).candidatePurchaseOrderIds)))];
    const hasNativeItemCandidate = itemCandidateOrderIds.some((sourceId) => orderBySource.has(sourceId));
    if (hasNativeItemCandidate) continue;

    const linkedInvoiceIds = [...new Set([
      ...invoiceIds(entryPayload),
      ...entryItems.flatMap((item) => invoiceIds(object(item.payload))),
    ])];
    const entryOrderIds = orderIdsFromEntry(entryPayload);
    const invoiceOrderIds = [...new Set(linkedInvoiceIds.flatMap((invoiceId) => {
      const invoice = invoiceById.get(invoiceId);
      return invoice ? orderIdsFromInvoice(object(invoice.payload)) : [];
    }))];
    const originId = identifier(entryPayload.originId);
    const referencedOrderIds = [...new Set([
      ...itemCandidateOrderIds,
      ...entryOrderIds,
      ...invoiceOrderIds,
      ...(originId ? [originId] : []),
    ])];
    const nativeOrders = referencedOrderIds.flatMap((sourceId) => {
      const order = orderBySource.get(sourceId);
      return order ? [order] : [];
    });
    const uniqueNativeOrders = [...new Map(nativeOrders.map((row) => [row.id, row])).values()];
    const blockingInvoiceIds = linkedInvoiceIds.filter((invoiceId) => missingReceiptInvoiceIds.has(invoiceId));
    const entryType = identifier(entryPayload.entryType);
    const packingListId = identifier(entryPayload.packingListId);
    const receiptCount = numeric(entryPayload.receiptCount);
    const classification = classify({
      nativeOrderIds: uniqueNativeOrders.map((row) => row.id),
      referencedOrderIds,
      invoiceIds: linkedInvoiceIds,
      entryType,
      packingListId,
      receiptCount,
    });

    evidence.push({
      entryId: entry.koper_id,
      entryType,
      originId,
      invoiceIds: linkedInvoiceIds,
      itemCandidateOrderIds,
      entryOrderIds,
      invoiceOrderIds,
      referencedOrderIds,
      nativeOrderIds: uniqueNativeOrders.map((row) => row.source_id).filter((value): value is string => Boolean(value)),
      nativeOrderNumbers: uniqueNativeOrders.map((row) => row.order_number),
      blockingInvoiceIds,
      itemCount: entryItems.length,
      receiptCount,
      packingListId,
      classification,
    });
  }

  const byClassification = new Map<string, Evidence[]>();
  for (const row of evidence) byClassification.set(row.classification, [...(byClassification.get(row.classification) ?? []), row]);
  const examples = Object.fromEntries([...byClassification.entries()].map(([key, rows]) => [key, rows.slice(0, 15)]));
  const recoverable = evidence.filter((row) => row.classification === "recoverable_single_order");

  console.log("KOPER_MISSING_ORDER_DIAGNOSTIC", JSON.stringify({
    ok: true,
    readOnly: true,
    source: {
      programmedEntries: programmedEntries.length,
      stockEntryItems: items.length,
      invoices: invoices.length,
      nativeOrders: orders.length,
      nativeReceipts: receipts.length,
    },
    result: {
      missingOrderEntries: evidence.length,
      countsByClassification: summarize(evidence.map((row) => row.classification)),
      entryTypes: summarize(evidence.map((row) => row.entryType ?? "<null>")),
      entriesWithInvoices: evidence.filter((row) => row.invoiceIds.length > 0).length,
      entriesWithoutInvoices: evidence.filter((row) => row.invoiceIds.length === 0).length,
      entriesWithOriginId: evidence.filter((row) => Boolean(row.originId)).length,
      originIdMatchingNativeOrder: evidence.filter((row) => row.originId && orderBySource.has(row.originId)).length,
      recoverableSingleOrder: recoverable.length,
      recoverableSingleOrderBlockingInvoices: new Set(recoverable.flatMap((row) => row.blockingInvoiceIds)).size,
      linkedBlockingInvoices: new Set(evidence.flatMap((row) => row.blockingInvoiceIds)).size,
    },
    recoverableCandidates: recoverable.slice(0, 40),
    examples,
  }));
} catch (error: unknown) {
  console.error("KOPER_MISSING_ORDER_DIAGNOSTIC_FAILED", JSON.stringify({
    message: error instanceof Error ? error.message.slice(0, 1_200) : "unknown",
  }));
  process.exitCode = 1;
}
