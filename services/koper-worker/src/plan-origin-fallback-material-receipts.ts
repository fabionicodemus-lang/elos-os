import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type StageRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Order = { id: string; source_id: string | null; order_number: string };
type OrderItem = {
  id: string;
  order_id: string;
  input_id: string;
  source_id: string | null;
  received_quantity: number;
  accepted_quantity: number;
};
type Input = { id: string; source_id: string | null };
type Receipt = { id: string; notes: string | null };
type Resolved = { entryId: string; itemId: string; groupKey: string; quantity: number; usedOriginFallback: boolean };

type EntryResult = {
  entryId: string;
  originId: string | null;
  orderNumber: string | null;
  itemCount: number;
  resolvedCount: number;
  reasons: string[];
  usesOriginFallback: boolean;
  safe: boolean;
};

const object = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};

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
    console.log("KOPER_ORIGIN_FALLBACK_PROGRESS", JSON.stringify({ resource, offset, pageRows: page.length, totalRows: rows.length }));
    if (page.length < 1_000) return rows;
  }
}

function summarize(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

try {
  console.log("KOPER_ORIGIN_FALLBACK_PLAN_START", JSON.stringify({ readOnly: true, companyId: env.BOSSA_COMPANY_ID }));

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
  const orders = await readAll<Order>("procurement_purchase_orders", {
    select: "id,source_id,order_number",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source_system: "eq.koper",
    order: "source_id.asc",
  });
  const orderItems = await readAll<OrderItem>("procurement_purchase_order_items", {
    select: "id,order_id,input_id,source_id,received_quantity,accepted_quantity",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source_system: "eq.koper",
    order: "order_id.asc,id.asc",
  });
  const inputs = await readAll<Input>("engineering_inputs", {
    select: "id,source_id",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source_system: "eq.koper",
    order: "source_id.asc",
  });
  const receipts = await readAll<Receipt>("procurement_material_receipts", {
    select: "id,notes",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    order: "id.asc",
  });

  const programmedEntries = entries.filter((row) => identifier(object(row.payload).originType) === "0");
  const entryById = new Map(programmedEntries.map((row) => [row.koper_id, row]));
  const programmedIds = new Set(entryById.keys());
  const itemsByEntry = new Map<string, StageRow[]>();
  for (const item of items) {
    if (!item.koper_parent_id || !programmedIds.has(item.koper_parent_id)) continue;
    itemsByEntry.set(item.koper_parent_id, [...(itemsByEntry.get(item.koper_parent_id) ?? []), item]);
  }

  const orderBySource = new Map(orders.flatMap((row) => row.source_id ? [[row.source_id, row] as const] : []));
  const inputBySource = new Map(inputs.flatMap((row) => row.source_id ? [[row.source_id, row] as const] : []));
  const orderItemsByOrder = new Map<string, OrderItem[]>();
  for (const item of orderItems) orderItemsByOrder.set(item.order_id, [...(orderItemsByOrder.get(item.order_id) ?? []), item]);
  const promotedIds = new Set(receipts.flatMap((row) => {
    const id = markerEntryId(row.notes);
    return id ? [id] : [];
  }));

  const reasonsByEntry = new Map<string, Set<string>>();
  const resolved: Resolved[] = [];
  const originFallbackEntryIds = new Set<string>();

  for (const entry of programmedEntries) {
    const entryPayload = object(entry.payload);
    const originId = identifier(entryPayload.originId);
    const originOrder = originId ? orderBySource.get(originId) : undefined;
    const entryItems = itemsByEntry.get(entry.koper_id) ?? [];
    const reasons = new Set<string>();
    if (entryItems.length === 0) reasons.add("no_items");
    const receiptDate = dateOnly(entryPayload.movementDate) ?? dateOnly(entryPayload.entryDate);

    for (const source of entryItems) {
      const payload = object(source.payload);
      const directOrderIds = identifiers(payload.candidatePurchaseOrderIds);
      const directOrders = directOrderIds.flatMap((sourceId) => {
        const order = orderBySource.get(sourceId);
        return order ? [order] : [];
      });
      const uniqueDirectOrders = [...new Map(directOrders.map((row) => [row.id, row])).values()];
      const candidateOrders = uniqueDirectOrders.length > 0
        ? uniqueDirectOrders
        : originOrder ? [originOrder] : [];
      const usedOriginFallback = uniqueDirectOrders.length === 0 && Boolean(originOrder);
      if (usedOriginFallback) originFallbackEntryIds.add(entry.koper_id);
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

      const groups = new Map<string, OrderItem[]>();
      for (const order of candidateOrders) {
        for (const orderItem of orderItemsByOrder.get(order.id) ?? []) {
          if (!inputIds.has(orderItem.input_id)) continue;
          const sourceItemId = baseSourceId(orderItem.source_id);
          if (!sourceItemId) continue;
          const key = `${order.id}:${sourceItemId}`;
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
      const [groupKey, rows] = [...groups.entries()][0]!;
      if (rows.length !== 1) {
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
      resolved.push({ entryId: entry.koper_id, itemId: source.koper_id, groupKey, quantity, usedOriginFallback });
    }
    reasonsByEntry.set(entry.koper_id, reasons);
  }

  const sourceQuantityByGroup = new Map<string, number>();
  for (const item of resolved) sourceQuantityByGroup.set(item.groupKey, (sourceQuantityByGroup.get(item.groupKey) ?? 0) + item.quantity);
  const nativeReceivedByGroup = new Map<string, number>();
  const nativeAcceptedByGroup = new Map<string, number>();
  for (const item of orderItems) {
    const sourceItemId = baseSourceId(item.source_id);
    if (!sourceItemId) continue;
    const key = `${item.order_id}:${sourceItemId}`;
    nativeReceivedByGroup.set(key, (nativeReceivedByGroup.get(key) ?? 0) + Number(item.received_quantity ?? 0));
    nativeAcceptedByGroup.set(key, (nativeAcceptedByGroup.get(key) ?? 0) + Number(item.accepted_quantity ?? 0));
  }
  const exactGroups = new Set([...sourceQuantityByGroup.entries()].flatMap(([key, quantity]) =>
    approximatelyEqual(quantity, nativeReceivedByGroup.get(key) ?? 0)
      && approximatelyEqual(quantity, nativeAcceptedByGroup.get(key) ?? 0)
      ? [key]
      : [],
  ));

  const resolvedByEntry = new Map<string, Resolved[]>();
  for (const item of resolved) resolvedByEntry.set(item.entryId, [...(resolvedByEntry.get(item.entryId) ?? []), item]);

  const results: EntryResult[] = [];
  for (const entryId of originFallbackEntryIds) {
    if (promotedIds.has(entryId)) continue;
    const entry = entryById.get(entryId)!;
    const entryPayload = object(entry.payload);
    const originId = identifier(entryPayload.originId);
    const order = originId ? orderBySource.get(originId) : undefined;
    const sourceItems = itemsByEntry.get(entryId) ?? [];
    const entryResolved = resolvedByEntry.get(entryId) ?? [];
    const reasons = new Set(reasonsByEntry.get(entryId) ?? []);
    if (sourceItems.length > 0 && entryResolved.length === sourceItems.length) {
      if (!entryResolved.every((row) => exactGroups.has(row.groupKey))) reasons.add("quantity_reconciliation_mismatch");
    }
    const safe = sourceItems.length > 0
      && entryResolved.length === sourceItems.length
      && reasons.size === 0
      && entryResolved.every((row) => exactGroups.has(row.groupKey));
    results.push({
      entryId,
      originId,
      orderNumber: order?.order_number ?? null,
      itemCount: sourceItems.length,
      resolvedCount: entryResolved.length,
      reasons: [...reasons].sort(),
      usesOriginFallback: true,
      safe,
    });
  }
  results.sort((a, b) => Number(a.entryId) - Number(b.entryId));

  console.log("KOPER_ORIGIN_FALLBACK_PLAN", JSON.stringify({
    ok: true,
    readOnly: true,
    source: {
      programmedEntries: programmedEntries.length,
      nativeOrders: orders.length,
      nativeOrderItems: orderItems.length,
      nativeInputs: inputs.length,
      existingReceipts: receipts.length,
    },
    result: {
      originFallbackEntries: results.length,
      safeEntries: results.filter((row) => row.safe).length,
      blockedEntries: results.filter((row) => !row.safe).length,
      countsByReason: summarize(results.flatMap((row) => row.reasons.length > 0 ? row.reasons : ["safe"])),
    },
    safeCandidates: results.filter((row) => row.safe).slice(0, 50),
    blockedExamples: results.filter((row) => !row.safe).slice(0, 50),
  }));
} catch (error: unknown) {
  console.error("KOPER_ORIGIN_FALLBACK_PLAN_FAILED", JSON.stringify({
    message: error instanceof Error ? error.message.slice(0, 1_200) : "unknown",
  }));
  process.exitCode = 1;
}
