import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Row = { koper_id: string; koper_parent_id: string | null; payload: unknown };

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

const rows: Row[] = [];
for (let offset = 0; ; offset += 1_000) {
  const page = await requestSupabase<Row[]>("koper_staging_records", {
    query: new URLSearchParams({
      select: "koper_id,koper_parent_id,payload",
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

const invalid = rows.flatMap((row) => {
  const payload = objectValue(row.payload);
  const amount = numeric(payload.amount);
  if (amount !== null && amount > 0) return [];
  return [{
    koperId: row.koper_id,
    parentId: row.koper_parent_id,
    amount: payload.amount ?? null,
    amountReceived: payload.amountReceived ?? null,
    prodCanceled: payload.prodCanceled ?? null,
    productId: payload.productId ?? null,
    mainProductId: payload.mainProductId ?? null,
    productName: payload.productName ?? payload.productFullName ?? null,
    finalPrice: payload.finalPrice ?? null,
    price: payload.price ?? null,
    requests: Array.isArray(payload.requests) ? payload.requests.length : null,
  }];
});

console.log("KOPER_ZERO_QUANTITY_ITEMS_RESULT", JSON.stringify({
  sourceItems: rows.length,
  invalidCount: invalid.length,
  invalid: invalid.slice(0, 100),
}));

await import("./index.js");
