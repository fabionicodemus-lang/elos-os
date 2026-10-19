import { fetchAllRows } from "@/lib/supabase-pagination";
import { buildDevelopmentCostSummary, type DevelopmentCostSummary } from "./summary.mjs";

type SupabaseClientLike = Awaited<ReturnType<(typeof import("@/lib/workspace"))["requireCompanyPermission"]>>["supabase"];

type Center = { id: string; code: string; description: string; development_cost_category: string };
type Budget = { service_id: string; budget_amount: number; source: string | null };
type Allocation = { payable_id: string; service_id: string | null; allocation_amount: number };
type Payable = { id: string; status: string; amount: number; paid_amount: number | null };

export type DevelopmentCostContext = DevelopmentCostSummary & { errors: string[] };

/** Orçado × apropriado dos centros de custo de incorporação da obra. */
export async function loadDevelopmentCosts({
  supabase,
  companyId,
  projectId,
}: {
  supabase: SupabaseClientLike;
  companyId: string;
  projectId: string;
}): Promise<DevelopmentCostContext> {
  const centersResult = await supabase
    .from("engineering_services")
    .select("id, code, description, development_cost_category")
    .eq("company_id", companyId)
    .not("development_cost_category", "is", null)
    .order("code");
  const centers = (centersResult.data ?? []) as Center[];
  if (!centers.length) {
    return { ...buildDevelopmentCostSummary(), errors: centersResult.error?.message ? [centersResult.error.message] : [] };
  }
  const centerIds = centers.map((center) => center.id);

  const [budgetsResult, allocationsResult] = await Promise.all([
    supabase
      .from("development_cost_budgets")
      .select("service_id, budget_amount, source")
      .eq("company_id", companyId)
      .eq("project_id", projectId),
    fetchAllRows<Allocation>(async (from, to) => {
      const { data, error } = await supabase
        .from("payable_cost_allocations")
        .select("payable_id, service_id, allocation_amount")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .in("service_id", centerIds)
        .order("id")
        .range(from, to);
      return { data: (data ?? []) as Allocation[], error };
    }),
  ]);

  const payableIds = [...new Set(allocationsResult.data.map((allocation) => allocation.payable_id))];
  const payables: Payable[] = [];
  const errors = [centersResult.error?.message, budgetsResult.error?.message, allocationsResult.error?.message];
  // Lotes pequenos para não estourar o tamanho da URL do filtro "in".
  for (let index = 0; index < payableIds.length; index += 150) {
    const { data, error } = await supabase
      .from("payables")
      .select("id, status, amount, paid_amount")
      .eq("company_id", companyId)
      .in("id", payableIds.slice(index, index + 150));
    if (error?.message) errors.push(error.message);
    payables.push(...((data ?? []) as Payable[]));
  }

  return {
    ...buildDevelopmentCostSummary({
      centers,
      budgets: (budgetsResult.data ?? []) as Budget[],
      allocations: allocationsResult.data,
      payables,
    }),
    errors: errors.filter(Boolean) as string[],
  };
}
