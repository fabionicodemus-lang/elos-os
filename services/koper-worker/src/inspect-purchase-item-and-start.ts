import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Row = { koper_id: string; koper_parent_id: string | null; payload: unknown };

const rows = await requestSupabase<Row[]>("koper_staging_records", {
  query: new URLSearchParams({
    select: "koper_id,koper_parent_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: "eq.purchase_order_item",
    koper_id: "eq.2781",
    limit: "5",
  }),
});

const row = rows[0];
const payload = typeof row?.payload === "object" && row.payload !== null && !Array.isArray(row.payload)
  ? row.payload as Record<string, unknown>
  : {};

console.log("KOPER_PURCHASE_ITEM_INSPECT_RESULT", JSON.stringify({
  count: rows.length,
  koperId: row?.koper_id ?? null,
  parentId: row?.koper_parent_id ?? null,
  amount: payload.amount ?? null,
  amountReceived: payload.amountReceived ?? null,
  prodCanceled: payload.prodCanceled ?? null,
  status: payload.status ?? null,
  productId: payload.productId ?? null,
  mainProductId: payload.mainProductId ?? null,
  productName: payload.productName ?? payload.productFullName ?? null,
  finalPrice: payload.finalPrice ?? null,
  price: payload.price ?? null,
  requests: Array.isArray(payload.requests) ? payload.requests.length : null,
}));

await import("./index.js");
