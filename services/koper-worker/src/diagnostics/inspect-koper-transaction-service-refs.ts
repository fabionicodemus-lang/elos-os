import { requestSupabase } from "../elos/supabase.js";

const COMPANY_ID = process.env.BOSSA_COMPANY_ID!;
const PROJECT_ID = "ffe8b7ec-1f01-4f6c-8a03-2bd6d3ae94fc";

async function safeQuery(table: string, serviceId: string) {
  try {
    const q = new URLSearchParams({ select: "*", service_id: `eq.${serviceId}`, limit: "10" });
    const rows = await requestSupabase<Record<string, unknown>[]>(table, { query: q });
    return { count: rows.length, sample: rows.slice(0, 3) };
  } catch (error) {
    return { error: String(error).slice(0, 500) };
  }
}

async function main() {
  const serviceQ = new URLSearchParams({
    select: "id,code,description",
    company_id: `eq.${COMPANY_ID}`,
    code: "eq.KOPER-S336",
    limit: "1",
  });
  const service = (await requestSupabase<{id:string;code:string;description:string}[]>("engineering_services", { query: serviceQ }))[0];
  if (!service) throw new Error("KOPER-S336 not found");

  const tables = [
    "procurement_purchase_order_items",
    "procurement_purchase_orders",
    "execution_material_request_items",
    "execution_material_requests",
    "execution_contract_measurement_items",
    "execution_contract_measurements",
    "execution_service_contract_items",
    "execution_service_contracts",
    "payable_cost_allocations",
    "engineering_budget_items",
  ];

  const results: Record<string, unknown> = {};
  for (const table of tables) results[table] = await safeQuery(table, service.id);

  console.log("KOPER_TRANSACTION_SERVICE_REF_SCAN", JSON.stringify({ companyId: COMPANY_ID, projectId: PROJECT_ID, service, results }));
}

main().catch((error) => {
  console.error("KOPER_TRANSACTION_SERVICE_REF_SCAN_ERROR", error);
  process.exitCode = 1;
});
