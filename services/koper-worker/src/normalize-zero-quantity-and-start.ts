import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { hashKoperPayload, normalizeKoperPayload } from "./koper/payload-hash.js";

type Row = { id: string; koper_id: string; payload: unknown };

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

if (process.env.KOPER_NORMALIZE_ZERO_QUANTITY_ITEMS_ENABLED !== "true") {
  throw new Error("Koper zero quantity normalization is not explicitly enabled");
}

const rows: Row[] = [];
for (let offset = 0; ; offset += 1_000) {
  const page = await requestSupabase<Row[]>("koper_staging_records", {
    query: new URLSearchParams({
      select: "id,koper_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.purchase_order_item",
      sync_state: "eq.present",
      order: "koper_id.asc",
      limit: "1000",
      offset: String(offset),
    }),
  });
  rows.push(...page);
  if (page.length < 1_000) break;
}

const normalizedIds: string[] = [];
for (const row of rows) {
  const payload = objectValue(row.payload);
  const amount = numeric(payload.amount);
  if (amount !== null && amount > 0) continue;

  const normalizedPayload = normalizeKoperPayload({
    ...payload,
    historicalOriginalAmount: payload.amount ?? null,
    historicalOriginalPrice: payload.price ?? null,
    historicalOriginalFinalPrice: payload.finalPrice ?? null,
    historicalZeroQuantityNormalized: true,
    amount: 1,
    amountReceived: 0,
    price: 0,
    finalPrice: 0,
  }) as Record<string, unknown>;

  const patched = await requestSupabase<Array<{ id: string }>>("koper_staging_records", {
    method: "PATCH",
    body: {
      payload: normalizedPayload,
      payload_hash: hashKoperPayload(normalizedPayload),
      processing_status: "pending",
      processing_error: null,
      updated_at: new Date().toISOString(),
    },
    prefer: "return=representation",
    query: new URLSearchParams({ id: `eq.${row.id}`, select: "id" }),
  });
  if (patched.length !== 1) throw new Error(`Could not normalize Koper purchase item ${row.koper_id}`);
  normalizedIds.push(row.koper_id);
}

console.log("KOPER_ZERO_QUANTITY_NORMALIZATION_RESULT", JSON.stringify({
  ok: true,
  sourceItems: rows.length,
  normalizedIds,
  normalizedCount: normalizedIds.length,
}));

await import("./index.js");
