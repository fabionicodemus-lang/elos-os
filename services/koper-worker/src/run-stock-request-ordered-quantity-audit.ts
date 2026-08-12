import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Row = {
  id: string;
  requested_quantity: number;
  ordered_quantity: number;
  notes: string | null;
};

async function readAll(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await requestSupabase<Row[]>("execution_material_request_items", {
      query: new URLSearchParams({
        select: "id,requested_quantity,ordered_quantity,notes",
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
  return rows;
}

async function main(): Promise<void> {
  const rows = await readAll();
  const ordered = rows.filter((row) => row.ordered_quantity > 0);
  const invalid = rows.filter((row) => row.ordered_quantity > row.requested_quantity + 0.000001);
  console.log("KOPER_REQUEST_ORDERED_QUANTITY_AUDIT", JSON.stringify({
    rows: rows.length,
    rowsWithOrderedQuantity: ordered.length,
    totalRequested: rows.reduce((sum, row) => sum + row.requested_quantity, 0),
    totalOrdered: rows.reduce((sum, row) => sum + row.ordered_quantity, 0),
    invalidRows: invalid.length,
    samples: ordered.slice(0, 20).map((row) => ({ id: row.id, requested: row.requested_quantity, ordered: row.ordered_quantity })),
  }));
}

void main().catch((error) => {
  console.error("KOPER_REQUEST_ORDERED_QUANTITY_AUDIT_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
