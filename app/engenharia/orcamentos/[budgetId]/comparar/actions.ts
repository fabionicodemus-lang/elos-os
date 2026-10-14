"use server";

import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

export async function cloneBudgetRevision(formData: FormData) {
  const budgetId = String(formData.get("budget_id") ?? "").trim();
  const version = String(formData.get("version") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  if (!budgetId || !version) redirect(`/engenharia/orcamentos/${budgetId || ""}/comparar?error=${encodeURIComponent("Informe a nova revisão.")}`);

  const { supabase, companyId } = await requireCompanyPermission("budgets.manage");
  const { data, error } = await supabase.rpc("clone_engineering_budget_revision", {
    p_company_id: companyId,
    p_budget_id: budgetId,
    p_new_version: version,
    p_new_name: name || null,
  });
  if (error || !data) {
    redirect(`/engenharia/orcamentos/${budgetId}/comparar?error=${encodeURIComponent(error?.message ?? "Não foi possível criar a revisão.")}`);
  }
  redirect(`/engenharia/orcamentos/${data}?success=${encodeURIComponent("Nova revisão criada a partir do snapshot aprovado.")}`);
}