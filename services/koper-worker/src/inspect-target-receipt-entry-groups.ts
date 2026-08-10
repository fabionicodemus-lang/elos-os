import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type StageRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type ReceiptRow = { id: string; notes: string | null };

const TARGET_RECEIPTS = new Set(["10304", "11343", "463", "5851", "6518"]);

const objectValue = (value: unknown): Json =>
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

function receiptIds(payload: Json): string[] {
  const receipts = Array.isArray(payload.receipts) ? payload.receipts : [];
  return [...new Set(receipts.flatMap((raw) => {
    const id = identifier(objectValue(raw).receiptId);
    return id ? [id] : [];
  }))];
}

function markerEntryId(notes: string | null): string | null {
  return notes?.match(/Koper stockMovementId=(\d+)/i)?.[1] ?? null;
}

async function readAll<T>(resource: string, query: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await requestSupabase<T[]>(resource, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
      timeoutMs: 30000,
    });
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

try {
  const [entries, items, receipts] = await Promise.all([
    readAll<StageRow>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.stock_entry",
      sync_state: "eq.present",
      order: "koper_id.asc",
    }),
    readAll<StageRow>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.stock_entry_item",
      sync_state: "eq.present",
      order: "koper_parent_id.asc,koper_id.asc",
    }),
    readAll<ReceiptRow>("procurement_material_receipts", {
      select: "id,notes",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      order: "id.asc",
    }),
  ]);

  const programmed = new Set(entries.filter((row) => identifier(objectValue(row.payload).originType) === "0").map((row) => row.koper_id));
  const promoted = new Set(receipts.flatMap((row) => {
    const id = markerEntryId(row.notes);
    return id ? [id] : [];
  }));

  const groups = new Map<string, Array<{ entryId: string; itemId: string; quantity: number | null; promoted: boolean; productId: string | null; mainProductId: string | null; genericProdSeq: string | null; inputId: string | null }>>();

  for (const item of items) {
    const entryId = item.koper_parent_id;
    if (!entryId || !programmed.has(entryId)) continue;
    const payload = objectValue(item.payload);
    for (const receiptId of receiptIds(payload)) {
      if (!TARGET_RECEIPTS.has(receiptId)) continue;
      const list = groups.get(receiptId) ?? [];
      list.push({
        entryId,
        itemId: item.koper_id,
        quantity: numeric(payload.productAmount),
        promoted: promoted.has(entryId),
        productId: identifier(payload.productId),
        mainProductId: identifier(payload.mainProductId),
        genericProdSeq: identifier(payload.genericProdSeq),
        inputId: identifier(payload.inputId),
      });
      groups.set(receiptId, list);
    }
  }

  const result = [...groups.entries()].map(([receiptId, rows]) => ({
    receiptId,
    rows,
    totalQuantity: rows.reduce((sum, row) => sum + (row.quantity ?? 0), 0),
    promotedQuantity: rows.filter((row) => row.promoted).reduce((sum, row) => sum + (row.quantity ?? 0), 0),
    pendingQuantity: rows.filter((row) => !row.promoted).reduce((sum, row) => sum + (row.quantity ?? 0), 0),
  }));

  console.log("KOPER_TARGET_RECEIPT_ENTRY_GROUPS", JSON.stringify({ ok: true, readOnly: true, result }));
} catch (error: unknown) {
  console.error("KOPER_TARGET_RECEIPT_ENTRY_GROUPS_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1200) : "unknown" }));
  process.exitCode = 1;
}
