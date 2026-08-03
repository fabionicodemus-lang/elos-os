import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type UnknownRecord = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type NativeOrder = { id: string; source_id: string | null; supplier_id: string; project_id: string; order_number: string; status: string };
type NativeOrderItem = {
  id: string; order_id: string; input_id: string; source_id: string | null;
  input_code: string; input_name: string; unit_snapshot: string;
  ordered_quantity: number; received_quantity: number; accepted_quantity: number;
  rejected_quantity: number; unit_price: number; cost_center_service_id: string | null;
  cost_center_code: string; cost_center_name: string;
};
type InputRow = { id: string; source_id: string | null };

function objectValue(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
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

function identifierArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    const id = identifier(item);
    return id ? [id] : [];
  }))];
}

async function readAll<T>(resource: string, query: Record<string, string>): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(resource, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
    });
    result.push(...page);
    if (page.length < 1_000) break;
  }
  return result;
}

function entryInputSourceIds(payload: UnknownRecord): string[] {
  return [...new Set([
    identifier(payload.mainProductId),
    identifier(payload.productId),
    identifier(payload.inputId),
    identifier(payload.genericProdSeq),
  ].filter((value): value is string => Boolean(value)))];
}

await import("./index.js");

try {
  const [entryRows, itemRows, orders, orderItems, inputs, existingReceipts] = await Promise.all([
    readAll<StagingRow>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.stock_entry",
      sync_state: "eq.present",
      order: "koper_id.asc",
    }),
    readAll<StagingRow>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.stock_entry_item",
      sync_state: "eq.present",
      order: "koper_id.asc",
    }),
    readAll<NativeOrder>("procurement_purchase_orders", {
      select: "id,source_id,supplier_id,project_id,order_number,status",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      order: "source_id.asc",
    }),
    readAll<NativeOrderItem>("procurement_purchase_order_items", {
      select: "id,order_id,input_id,source_id,input_code,input_name,unit_snapshot,ordered_quantity,received_quantity,accepted_quantity,rejected_quantity,unit_price,cost_center_service_id,cost_center_code,cost_center_name",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      order: "order_id.asc,sort_order.asc",
    }),
    readAll<InputRow>("engineering_inputs", {
      select: "id,source_id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      order: "source_id.asc",
    }),
    readAll<{ id: string; notes: string | null }>("procurement_material_receipts", {
      select: "id,notes",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      order: "created_at.asc",
    }),
  ]);

  const programmedEntries = entryRows.filter((row) => identifier(objectValue(row.payload).originType) === "0");
  const programmedEntryIds = new Set(programmedEntries.map((row) => row.koper_id));
  const programmedItems = itemRows.filter((row) => row.koper_parent_id && programmedEntryIds.has(row.koper_parent_id));

  const orderBySource = new Map(orders.flatMap((order) => order.source_id ? [[order.source_id, order] as const] : []));
  const itemsByOrder = new Map<string, NativeOrderItem[]>();
  for (const item of orderItems) itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), item]);
  const inputBySource = new Map(inputs.flatMap((input) => input.source_id ? [[input.source_id, input] as const] : []));

  let uniqueMapped = 0;
  let missingOrderCandidate = 0;
  let missingNativeOrder = 0;
  let missingInput = 0;
  let missingOrderItem = 0;
  let ambiguousOrderItem = 0;
  let zeroOrInvalidQuantity = 0;
  let overOrderQuantity = 0;
  const mappedGroups = new Set<string>();
  const fullyMappedEntryItems = new Map<string, number>();
  const totalEntryItems = new Map<string, number>();
  const orderIdsPerEntry = new Map<string, Set<string>>();
  const unresolvedExamples: Array<{ entryId: string; itemId: string; reason: string }> = [];

  for (const row of programmedItems) {
    const entryId = row.koper_parent_id!;
    totalEntryItems.set(entryId, (totalEntryItems.get(entryId) ?? 0) + 1);
    const payload = objectValue(row.payload);
    const candidateOrderSourceIds = identifierArray(payload.candidatePurchaseOrderIds);
    const sourceInputIds = entryInputSourceIds(payload);
    const mappedInputIds = new Set(sourceInputIds.flatMap((sourceId) => {
      const input = inputBySource.get(sourceId);
      return input ? [input.id] : [];
    }));
    const quantity = numeric(payload.productAmount) ?? 0;

    let reason: string | null = null;
    if (candidateOrderSourceIds.length === 0) {
      missingOrderCandidate += 1;
      reason = "missing_order_candidate";
    }

    const nativeOrders = candidateOrderSourceIds.flatMap((sourceId) => {
      const order = orderBySource.get(sourceId);
      return order ? [order] : [];
    });
    if (!reason && nativeOrders.length === 0) {
      missingNativeOrder += 1;
      reason = "missing_native_order";
    }
    if (!reason && mappedInputIds.size === 0) {
      missingInput += 1;
      reason = "missing_input";
    }

    const candidates = nativeOrders.flatMap((order) =>
      (itemsByOrder.get(order.id) ?? [])
        .filter((item) => mappedInputIds.has(item.input_id))
        .map((item) => ({ order, item })),
    );

    if (!reason && candidates.length === 0) {
      missingOrderItem += 1;
      reason = "missing_order_item";
    } else if (!reason && candidates.length > 1) {
      ambiguousOrderItem += 1;
      reason = "ambiguous_order_item";
    }
    if (!reason && quantity <= 0) {
      zeroOrInvalidQuantity += 1;
      reason = "invalid_quantity";
    }

    if (!reason) {
      const resolved = candidates[0]!;
      uniqueMapped += 1;
      fullyMappedEntryItems.set(entryId, (fullyMappedEntryItems.get(entryId) ?? 0) + 1);
      mappedGroups.add(`${entryId}:${resolved.order.id}`);
      const orderSet = orderIdsPerEntry.get(entryId) ?? new Set<string>();
      orderSet.add(resolved.order.id);
      orderIdsPerEntry.set(entryId, orderSet);
      const remaining = Number(resolved.item.ordered_quantity) - Number(resolved.item.accepted_quantity ?? 0);
      if (quantity > remaining + 0.000001) overOrderQuantity += 1;
    } else if (unresolvedExamples.length < 20) {
      unresolvedExamples.push({ entryId, itemId: row.koper_id, reason });
    }
  }

  let fullyMappedEntries = 0;
  let partiallyMappedEntries = 0;
  let unmappedEntries = 0;
  for (const entry of programmedEntries) {
    const total = totalEntryItems.get(entry.koper_id) ?? 0;
    const mapped = fullyMappedEntryItems.get(entry.koper_id) ?? 0;
    if (total > 0 && mapped === total) fullyMappedEntries += 1;
    else if (mapped > 0) partiallyMappedEntries += 1;
    else unmappedEntries += 1;
  }

  const multiOrderEntries = [...orderIdsPerEntry.values()].filter((ordersForEntry) => ordersForEntry.size > 1).length;
  const existingKoperReceipts = existingReceipts.filter((receipt) => /Koper stockMovementId=/i.test(receipt.notes ?? "")).length;

  console.log("KOPER_MATERIAL_RECEIPT_READINESS_RESULT", JSON.stringify({
    ok: true,
    source: {
      programmedEntries: programmedEntries.length,
      programmedItems: programmedItems.length,
      nativeOrders: orders.length,
      nativeOrderItems: orderItems.length,
      inputs: inputs.length,
    },
    resolution: {
      uniqueMapped,
      missingOrderCandidate,
      missingNativeOrder,
      missingInput,
      missingOrderItem,
      ambiguousOrderItem,
      zeroOrInvalidQuantity,
      overOrderQuantity,
      fullyMappedEntries,
      partiallyMappedEntries,
      unmappedEntries,
      receiptGroups: mappedGroups.size,
      multiOrderEntries,
    },
    idempotency: {
      existingNativeReceipts: existingReceipts.length,
      existingKoperReceipts,
    },
    unresolvedExamples,
  }));
} catch (error: unknown) {
  console.error("KOPER_MATERIAL_RECEIPT_READINESS_FAILED", {
    message: error instanceof Error ? error.message.slice(0, 800) : "unknown",
  });
}
