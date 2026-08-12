import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Row = { id: string; requested_quantity: number; notes: string | null };

async function main(): Promise<void> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await requestSupabase<Row[]>("execution_material_request_items", {
      query: new URLSearchParams({
        select: "id,requested_quantity,notes",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        notes: "like.Koper productRequestIds=*",
        limit: "1000",
        offset: String(offset),
      }),
      timeoutMs: 30000,
    });
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const parsed = rows.map((row) => {
    const raw = row.notes?.match(/Koper productRequestIds=([^·]+)/)?.[1] ?? "";
    const ids = raw.split(",").map((value) => value.trim()).filter(Boolean);
    return { ...row, ids };
  });
  const multi = parsed.filter((row) => row.ids.length > 1);
  console.log("KOPER_STOCK_REQUEST_AGGREGATION_AUDIT", JSON.stringify({
    rows: rows.length,
    multiProductRequestRows: multi.length,
    maxProductRequestIdsPerRow: Math.max(0, ...parsed.map((row) => row.ids.length)),
    samples: multi.slice(0, 20).map((row) => ({ id: row.id, requestedQuantity: row.requested_quantity, productRequestIds: row.ids })),
  }));
}

void main().catch((error) => {
  console.error("KOPER_STOCK_REQUEST_AGGREGATION_AUDIT_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
