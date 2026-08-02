import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

type AnalyticalBudgetSearchParams = {
  budget?: string;
  q?: string;
  group?: string;
  incomplete?: string;
  view?: string;
};

export default async function AnalyticalBudgetRedirectPage({
  searchParams,
}: {
  searchParams: Promise<AnalyticalBudgetSearchParams>;
}) {
  const params = await searchParams;
  const { supabase, companyId, projectId } = await requireCompanyPermission("budgets.view");

  if (!projectId) {
    redirect("/engenharia/orcamentos?error=Selecione%20uma%20obra%20para%20abrir%20o%20orçamento%20analítico.");
  }

  let budgetId: string | null = null;

  if (params.budget) {
    const { data: requestedBudget } = await supabase
      .from("engineering_budgets")
      .select("id")
      .eq("id", params.budget)
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .neq("status", "archived")
      .maybeSingle();

    budgetId = requestedBudget?.id ?? null;
  }

  if (!budgetId) {
    const { data: latestBudget } = await supabase
      .from("engineering_budgets")
      .select("id")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    budgetId = latestBudget?.id ?? null;
  }

  if (!budgetId) {
    redirect("/engenharia/orcamentos?error=A%20obra%20selecionada%20ainda%20não%20possui%20uma%20revisão%20de%20orçamento.");
  }

  const targetParams = new URLSearchParams();
  if (params.q) targetParams.set("q", params.q);
  if (params.group) targetParams.set("group", params.group);
  if (params.incomplete === "1") targetParams.set("incomplete", "1");
  if (params.view === "details") targetParams.set("view", "details");
  targetParams.set("origin", "analytical-menu");

  const query = targetParams.toString();
  redirect(`/engenharia/orcamentos/${budgetId}${query ? `?${query}` : ""}`);
}
