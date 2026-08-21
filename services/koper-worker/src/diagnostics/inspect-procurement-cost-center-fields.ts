import { requestSupabase } from "../elos/supabase.js";

async function sample(table: string) {
  try {
    const q = new URLSearchParams({ select: "*", limit: "200" });
    const rows = await requestSupabase<Record<string, unknown>[]>(table, { query: q });
    const needles = ["KOPER-S336", "ce9c19e7-58bf-4e5f-9efc-27a9459ebc0a", "Pisos em Porcelanato", "Pisos Porcelanato"];
    const hits = rows.filter((row) => {
      const text = JSON.stringify(row).toLowerCase();
      return needles.some((n) => text.includes(n.toLowerCase()));
    });
    return {
      countFetched: rows.length,
      keys: rows[0] ? Object.keys(rows[0]) : [],
      sample: rows.slice(0, 3),
      hits: hits.slice(0, 20),
    };
  } catch (error) {
    return { error: String(error).slice(0, 800) };
  }
}

async function main() {
  const tables = [
    "procurement_purchase_order_items",
    "procurement_purchase_orders",
    "execution_material_request_items",
    "execution_material_requests",
    "execution_contract_measurement_items",
    "execution_contract_measurements",
    "execution_service_contract_items",
    "execution_service_contracts",
  ];
  const results: Record<string, unknown> = {};
  for (const table of tables) results[table] = await sample(table);
  console.log("PROCUREMENT_COST_CENTER_FIELD_SCAN", JSON.stringify(results));
}

main().catch((error) => {
  console.error("PROCUREMENT_COST_CENTER_FIELD_SCAN_ERROR", error);
  process.exitCode = 1;
});
