"use server";

import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

export async function cloneBudgetRevision(formData: FormData) {
  const budgetId = String(formData.get("budget_id") ?? "").trim();
  const version = String(formData.get("version") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  if (!budgetId || !version) redirect(`/engenharia/orcamentos/${budgetId || ""}/comparar?error=${encodeURIComponent("Informe a nova revisão.")}`);

  const { supabase, companyId } = await requireCompanyPermission("budgets.manage");
  const sourceResult = await supabase.from("engineering_budgets")
    .select("adjustment_enabled, correction_index_id, correction_base_month, correction_base_value")
    .eq("id", budgetId).eq("company_id", companyId).maybeSingle();
  if (sourceResult.error) {
    redirect(`/engenharia/orcamentos/${budgetId}/comparar?error=${encodeURIComponent(sourceResult.error.message)}`);
  }

  const { data, error } = await supabase.rpc("clone_engineering_budget_revision", {
    p_company_id: companyId,
    p_budget_id: budgetId,
    p_new_version: version,
    p_new_name: name || null,
  });
  if (error || !data) {
    redirect(`/engenharia/orcamentos/${budgetId}/comparar?error=${encodeURIComponent(error?.message ?? "Não foi possível criar a revisão.")}`);
  }

  if (sourceResult.data?.adjustment_enabled) {
    const { error: adjustmentError } = await supabase.from("engineering_budgets").update({
      adjustment_enabled: true,
      correction_index_id: sourceResult.data.correction_index_id,
      correction_base_month: sourceResult.data.correction_base_month,
      correction_base_value: sourceResult.data.correction_base_value,
      updated_at: new Date().toISOString(),
    }).eq("id", data).eq("company_id", companyId);
    if (adjustmentError) {
      redirect(`/engenharia/orcamentos/${data}?error=${encodeURIComponent(`A revisão foi criada, mas não foi possível herdar o reajuste: ${adjustmentError.message}`)}`);
    }
  }

  redirect(`/engenharia/orcamentos/${data}?success=${encodeURIComponent("Nova revisão criada a partir do snapshot aprovado, preservando a política de reajuste.")}`);
}