"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

export async function saveProjectAdjustments(formData: FormData) {
  const { supabase, companyId } = await requireCompanyPermission("projects.manage");
  const projectId = String(formData.get("project_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) redirect("/empreendimentos?error=Empreendimento%20inválido");
  const path = `/empreendimentos/${projectId}/reajustes`;
  const base = String(formData.get("budget_base_month") ?? "");
  const { data, error } = await supabase.rpc("save_project_adjustment", {
    p_company: companyId, p_project: projectId,
    p_budget: formData.get("budget_enabled") === "true",
    p_index: String(formData.get("budget_index_id") ?? "") || null,
    p_base: base ? `${base}-01` : null,
    p_installments: formData.get("installments_enabled") === "true",
    p_apply_budgets: formData.get("apply_budgets") === "true",
  });
  if (error) redirect(`${path}?error=${encodeURIComponent(error.message)}`);
  revalidatePath(path); revalidatePath("/engenharia/orcamentos", "layout");
  redirect(`${path}?success=${encodeURIComponent(`Padrões salvos. Contratos existentes preservados. ${Number(data ?? 0)} orçamento(s) atualizado(s).`)}`);
}
