import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type StageRow = {
  koper_id: string;
  koper_parent_id: string | null;
  payload: unknown;
};
type OrderRow = {
  id: string;
  source_id: string | null;
  order_number: string;
};
type OrderItemRow = {
  id: string;
  order_id: string;
  input_id: string;
  source_id: string | null;
  received_quantity: number;
  accepted_quantity: number;
};
type InputRow = {
  id: string;
  source_id: string | null;
};
type ReceiptRow = {
  id: string;
  order_id: string;
  notes: string | null;
};

type ResolvedItem = {
  entryId: string;
  entryItemId: string;
  sourceGroupKey: string;
  quantity: number;
  invoiceIds: string[];
};

type EntryClassification = {
  entryId: string;
  reason: string;
  itemCount: number;
  invoiceIds: string[];
  blockingInvoiceIds: string[];
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
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};

const identifierArray = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.flatMap((item) => {
      const id = identifier(item);
      return id ? [id] : [];
    }))]
  : [];

function invoiceIdsFromPayload(payload: Json): string[] {
  const direct = identifierArray(payload.invoiceIds);
  const nested = Array.isArray(payload.invoices)
    ? payload.invoices.flatMap((value) => {
        const id = identifier(object(value).invoiceId);
        return id ? [id] : [];
      })
    : [];
  return [...new Set([...direct, ...nested])];
}

function purchaseOrderIdsFromInvoice(payload: Json): string[] {
  if (!Array.isArray(payload.purchaseOrders)) return [];
  return [...new Set(payload.purchaseOrders.flatMap((value) => {
    const id = identifier(object(value).purchaseOrderId);
    return id ? [id] : [];
  }))];
}

function sourceProductIds(payload: Json): string[] {
  return [...new Set([
    identifier(payload.mainProductId),
    identifier(payload.productId),
    identifier(payload.inputId),
    identifier(payload.genericProdSeq),
  ].filter((value): value is string => Boolean(value)))];
}

function baseSourceId(value: string | null): string | null {
  return identifier(value)?.split(":")[0] ?? null;
}

function dateOnly(value: unknown): string | null {
  const raw = identifier(value);
  if (!raw) return null;
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

function markerEntryId(notes: string | null): string | null {
  return notes?.match(/Koper stockMovementId=(\d+)/i)?.[1] ?? null;
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(0.000001, Math.abs(right) * 0.000001);
}

async function readAll<T>(resource: string, query: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(resource, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
      timeoutMs: 30_000,
    });
    rows.push(...page);
    console.log("KOPER_UNPROMOTED_STOCK_ENTRY_PROGRESS", JSON.stringify({
      stage: resource,
      offset,
      pageRows: page.length,
      totalRows: rows.length,
    }));
    if (page.length < 1_000) return rows;
  }
}

async function load<T>(
  label: string,
  resource: string,
  query: Record<string, string>,
): Promise<T[]> {
  const startedAt = Date.now();
  console.log("KOPER_UNPROMOTED_STOCK_ENTRY_TABLE_START", JSON.stringify({ label }));
  const rows = await readAll<T>(resource, query);
  console.log("KOPER_UNPROMOTED_STOCK_ENTRY_TABLE_DONE", JSON.stringify({
    label,
    rows: rows.length,
    elapsedMs: Date.now() - startedAt,
  }));
  return rows;
}

const reasonPriority = [
  "no_items",
  "missing_order",
  "missing_input",
  "missing_order_item",
  "ambiguous_source_item",
  "allocation_split",
  "invalid_quantity",
  "invalid_date",
  "quantity_reconciliation_mismatch",
] as const;

try {
  console.log("KOPER_UNPROMOTED_STOCK_ENTRY_DIAGNOSTIC_START", JSON.stringify({
    companyId: env.BOSSA_COMPANY_ID,
    readOnly: true,
  }));

  const entries = await load<StageRow>("stock_entries", "koper_staging_records", {
    select: "koper_id,koper_parent_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: "eq.stock_entry",
    sync_state: "eq.present",
    order: "koper_id.asc",
  });
  const entryItems = await load<StageRow>("stock_entry_items", "koper_staging_records", {
    select: "koper_id,koper_parent_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: "eq.stock_entry_item",
    sync_state: "eq.present",
    order: "koper_parent_id.asc,koper_id.asc",
  });
  const invoices = await load<StageRow>("xml_invoices", "koper_staging_records", {
    select: "koper_id,koper_parent_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: "eq.xml_invoice",
    sync_state: "eq.present",
    order: "koper_id.asc",
  });
  const orders = await load<OrderRow>("purchase_orders", "procurement_purchase_orders", {
    select: "id,source_id,order_number",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source_system: "eq.koper",
    order: "source_id.asc",
  });
  const orderItems = await load<OrderItemRow>("purchase_order_items", "procurement_purchase_order_items", {
    select: "id,order_id,input_id,source_id,received_quantity,accepted_quantity",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source_system: "eq.koper",
    order: "order_id.asc,id.asc",
  });
  const inputs = await load<InputRow>("engineering_inputs", "engineering_inputs", {
    select: "id,source_id",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source_system: "eq.koper",
    order: "source_id.asc",
  });
  const receipts = await load<ReceiptRow>("material_receipts", "procurement_material_receipts", {
    select: "id,order_id,notes",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    order: "id.asc",
  });

  const programmedEntries = entries.filter(
    (row) => identifier(object(row.payload).originType) === "0",
  );
  const programmedEntryIds = new Set(programmedEntries.map((row) => row.koper_id));
  const entryById = new Map(programmedEntries.map((row) => [row.koper_id, row]));
  const itemsByEntry = new Map<string, StageRow[]>();
  let orphanProgrammedItems = 0;
  for (const item of entryItems) {
    const entryId = item.koper_parent_id;
    if (!entryId || !programmedEntryIds.has(entryId)) {
      if (entryId && !entries.some((entry) => entry.koper_id === entryId)) orphanProgrammedItems += 1;
      continue;
    }
    itemsByEntry.set(entryId, [...(itemsByEntry.get(entryId) ?? []), item]);
  }

  const orderBySource = new Map(
    orders.flatMap((row) => row.source_id ? [[row.source_id, row] as const] : []),
  );
  const orderItemsByOrder = new Map<string, OrderItemRow[]>();
  for (const row of orderItems) {
    orderItemsByOrder.set(row.order_id, [...(orderItemsByOrder.get(row.order_id) ?? []), row]);
  }
  const inputBySource = new Map(
    inputs.flatMap((row) => row.source_id ? [[row.source_id, row] as const] : []),
  );
  const promotedEntryIds = new Set(
    receipts.flatMap((row) => {
      const entryId = markerEntryId(row.notes);
      return entryId ? [entryId] : [];
    }),
  );
  const receiptsByEntry = new Map<string, ReceiptRow[]>();
  for (const receipt of receipts) {
    const entryId = markerEntryId(receipt.notes);
    if (!entryId) continue;
    receiptsByEntry.set(entryId, [...(receiptsByEntry.get(entryId) ?? []), receipt]);
  }

  const itemReasonsByEntry = new Map<string, Set<string>>();
  const resolvedItems: ResolvedItem[] = [];

  for (const entry of programmedEntries) {
    const items = itemsByEntry.get(entry.koper_id) ?? [];
    const reasons = new Set<string>();
    const entryPayload = object(entry.payload);
    const receiptDate = dateOnly(entryPayload.movementDate) ?? dateOnly(entryPayload.entryDate);

    if (items.length === 0) reasons.add("no_items");

    for (const source of items) {
      const payload = object(source.payload);
      const candidateOrders = [...new Map(
        identifierArray(payload.candidatePurchaseOrderIds).flatMap((sourceId) => {
          const order = orderBySource.get(sourceId);
          return order ? [[order.id, order] as const] : [];
        }),
      ).values()];
      if (candidateOrders.length === 0) {
        reasons.add("missing_order");
        continue;
      }

      const inputIds = new Set(sourceProductIds(payload).flatMap((sourceId) => {
        const input = inputBySource.get(sourceId);
        return input ? [input.id] : [];
      }));
      if (inputIds.size === 0) {
        reasons.add("missing_input");
        continue;
      }

      const groups = new Map<string, OrderItemRow[]>();
      for (const order of candidateOrders) {
        for (const orderItem of orderItemsByOrder.get(order.id) ?? []) {
          if (!inputIds.has(orderItem.input_id)) continue;
          const sourcePurchaseItemId = baseSourceId(orderItem.source_id);
          if (!sourcePurchaseItemId) continue;
          const key = `${order.id}:${sourcePurchaseItemId}`;
          groups.set(key, [...(groups.get(key) ?? []), orderItem]);
        }
      }
      if (groups.size === 0) {
        reasons.add("missing_order_item");
        continue;
      }
      if (groups.size > 1) {
        reasons.add("ambiguous_source_item");
        continue;
      }

      const [sourceGroupKey, groupRows] = [...groups.entries()][0]!;
      if (groupRows.length !== 1) {
        reasons.add("allocation_split");
        continue;
      }

      const quantity = numeric(payload.productAmount) ?? 0;
      if (quantity <= 0) {
        reasons.add("invalid_quantity");
        continue;
      }
      if (!receiptDate) {
        reasons.add("invalid_date");
        continue;
      }

      resolvedItems.push({
        entryId: entry.koper_id,
        entryItemId: source.koper_id,
        sourceGroupKey,
        quantity,
        invoiceIds: invoiceIdsFromPayload(payload),
      });
    }

    itemReasonsByEntry.set(entry.koper_id, reasons);
  }

  const sourceQuantityByGroup = new Map<string, number>();
  for (const item of resolvedItems) {
    sourceQuantityByGroup.set(
      item.sourceGroupKey,
      (sourceQuantityByGroup.get(item.sourceGroupKey) ?? 0) + item.quantity,
    );
  }
  const nativeAcceptedByGroup = new Map<string, number>();
  const nativeReceivedByGroup = new Map<string, number>();
  for (const item of orderItems) {
    const sourcePurchaseItemId = baseSourceId(item.source_id);
    if (!sourcePurchaseItemId) continue;
    const key = `${item.order_id}:${sourcePurchaseItemId}`;
    nativeAcceptedByGroup.set(
      key,
      (nativeAcceptedByGroup.get(key) ?? 0) + Number(item.accepted_quantity ?? 0),
    );
    nativeReceivedByGroup.set(
      key,
      (nativeReceivedByGroup.get(key) ?? 0) + Number(item.received_quantity ?? 0),
    );
  }
  const exactGroups = new Set([...sourceQuantityByGroup.entries()].flatMap(([key, quantity]) =>
    approximatelyEqual(quantity, nativeAcceptedByGroup.get(key) ?? 0)
      && approximatelyEqual(quantity, nativeReceivedByGroup.get(key) ?? 0)
      ? [key]
      : [],
  ));

  const resolvedByEntry = new Map<string, ResolvedItem[]>();
  for (const item of resolvedItems) {
    resolvedByEntry.set(item.entryId, [...(resolvedByEntry.get(item.entryId) ?? []), item]);
  }

  const entryIdsByInvoice = new Map<string, Set<string>>();
  for (const entry of programmedEntries) {
    const entryInvoiceIds = new Set([
      ...invoiceIdsFromPayload(object(entry.payload)),
      ...(itemsByEntry.get(entry.koper_id) ?? []).flatMap((item) =>
        invoiceIdsFromPayload(object(item.payload))),
    ]);
    for (const invoiceId of entryInvoiceIds) {
      const entryIds = entryIdsByInvoice.get(invoiceId) ?? new Set<string>();
      entryIds.add(entry.koper_id);
      entryIdsByInvoice.set(invoiceId, entryIds);
    }
  }

  const missingReceiptInvoiceIds = new Set<string>();
  for (const invoice of invoices) {
    const sourceOrderIds = purchaseOrderIdsFromInvoice(object(invoice.payload));
    const nativeOrders = [...new Map(sourceOrderIds.flatMap((sourceId) => {
      const order = orderBySource.get(sourceId);
      return order ? [[order.id, order] as const] : [];
    })).values()];
    if (nativeOrders.length !== 1) continue;
    const entryIds = [...(entryIdsByInvoice.get(invoice.koper_id) ?? new Set<string>())];
    const matchingReceipts = entryIds.flatMap((entryId) =>
      (receiptsByEntry.get(entryId) ?? []).filter(
        (receipt) => receipt.order_id === nativeOrders[0]!.id,
      ));
    if (matchingReceipts.length === 0) missingReceiptInvoiceIds.add(invoice.koper_id);
  }

  const classifications: EntryClassification[] = [];
  for (const entry of programmedEntries) {
    const items = itemsByEntry.get(entry.koper_id) ?? [];
    const resolved = resolvedByEntry.get(entry.koper_id) ?? [];
    const reasons = itemReasonsByEntry.get(entry.koper_id) ?? new Set<string>();
    let reason: string;

    if (promotedEntryIds.has(entry.koper_id)) {
      reason = "already_promoted";
    } else {
      const primary = reasonPriority.find((candidate) => reasons.has(candidate));
      if (primary) {
        reason = primary;
      } else if (resolved.length !== items.length) {
        reason = "unclassified_item_mismatch";
      } else if (resolved.some((item) => !exactGroups.has(item.sourceGroupKey))) {
        reason = "quantity_reconciliation_mismatch";
      } else {
        reason = "safe_unpromoted";
      }
    }

    const invoiceIds = [...new Set([
      ...invoiceIdsFromPayload(object(entryById.get(entry.koper_id)?.payload)),
      ...items.flatMap((item) => invoiceIdsFromPayload(object(item.payload))),
    ])];
    const blockingInvoiceIds = invoiceIds.filter((invoiceId) =>
      missingReceiptInvoiceIds.has(invoiceId));

    classifications.push({
      entryId: entry.koper_id,
      reason,
      itemCount: items.length,
      invoiceIds,
      blockingInvoiceIds,
    });
  }

  const countsByReason: Record<string, number> = {};
  for (const row of classifications) {
    countsByReason[row.reason] = (countsByReason[row.reason] ?? 0) + 1;
  }
  const pending = classifications.filter((row) => row.reason !== "already_promoted");
  const blockingEntries = pending.filter((row) => row.blockingInvoiceIds.length > 0);
  const safeUnpromoted = classifications.filter((row) => row.reason === "safe_unpromoted");
  const safeBlocking = safeUnpromoted.filter((row) => row.blockingInvoiceIds.length > 0);
  const impactedInvoices = new Set(blockingEntries.flatMap((row) => row.blockingInvoiceIds));
  const safelyRecoverableInvoices = new Set(safeBlocking.flatMap((row) => row.blockingInvoiceIds));

  const examplesByReason: Record<string, Array<{
    entryId: string;
    itemCount: number;
    invoiceIds: string[];
    blockingInvoiceIds: string[];
  }>> = {};
  for (const row of classifications) {
    const examples = examplesByReason[row.reason] ?? [];
    if (examples.length < 10) {
      examples.push({
        entryId: row.entryId,
        itemCount: row.itemCount,
        invoiceIds: row.invoiceIds,
        blockingInvoiceIds: row.blockingInvoiceIds,
      });
    }
    examplesByReason[row.reason] = examples;
  }

  const safePilotCandidates = [...safeUnpromoted]
    .sort((left, right) =>
      Number(right.blockingInvoiceIds.length > 0) - Number(left.blockingInvoiceIds.length > 0)
        || left.itemCount - right.itemCount
        || Number(left.entryId) - Number(right.entryId))
    .slice(0, 25)
    .map((row) => ({
      entryId: row.entryId,
      itemCount: row.itemCount,
      invoiceIds: row.invoiceIds,
      blockingInvoiceIds: row.blockingInvoiceIds,
    }));

  console.log("KOPER_UNPROMOTED_STOCK_ENTRY_DIAGNOSTIC", JSON.stringify({
    ok: true,
    readOnly: true,
    source: {
      stockEntries: entries.length,
      programmedEntries: programmedEntries.length,
      stockEntryItems: entryItems.length,
      invoices: invoices.length,
      purchaseOrders: orders.length,
      purchaseOrderItems: orderItems.length,
      inputs: inputs.length,
      nativeReceipts: receipts.length,
      orphanProgrammedItems,
    },
    classification: {
      totalProgrammedEntries: classifications.length,
      promotedEntries: countsByReason.already_promoted ?? 0,
      pendingEntries: pending.length,
      safeUnpromotedEntries: safeUnpromoted.length,
      blockedEntries: pending.length - safeUnpromoted.length,
      countsByReason,
      resolvedItems: resolvedItems.length,
      exactSourceGroups: exactGroups.size,
    },
    invoiceImpact: {
      currentlyMissingReceiptInvoices: missingReceiptInvoiceIds.size,
      pendingEntriesLinkedToMissingReceiptInvoices: blockingEntries.length,
      distinctMissingReceiptInvoicesImpacted: impactedInvoices.size,
      safeEntriesLinkedToMissingReceiptInvoices: safeBlocking.length,
      safelyRecoverableMissingReceiptInvoices: safelyRecoverableInvoices.size,
    },
    safePilotCandidates,
    examplesByReason,
  }));
} catch (error: unknown) {
  console.error("KOPER_UNPROMOTED_STOCK_ENTRY_DIAGNOSTIC_FAILED", JSON.stringify({
    ok: false,
    message: error instanceof Error ? error.message.slice(0, 1_500) : String(error),
  }));
  process.exitCode = 1;
}
