"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const BASE = "/comercial/incorporacao/resultado";

function back(message: string, type: "error" | "success" = "success"): never {
  redirect(`${BASE}?${new URLSearchParams({ [type]: message }).toString()}#centros-incorporacao`);
}

function money(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!raw) return Number.NaN;
  // Formato brasileiro: ponto é milhar e vírgula é decimal ("32.000" = trinta e dois mil).
  const parsed = Number(raw.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Cria os centros de incorporação (se faltarem) e grava o orçado a partir do estudo de viabilidade aprovado. */
export async function applyFeasibilityDevelopmentBudget() {
  const { supabase, projectId } = await requireCompanyPermission("commercial.incorporation.manage");
  if (!projectId) back("Selecione um empreendimento.", "error");
  const { error } = await supabase.rpc("apply_feasibility_development_budget", { p_project_id: projectId });
  if (error) back(error.message, "error");
  revalidatePath(BASE);
  back("Centros de incorporação atualizados com o orçado do estudo de viabilidade. Valores ajustados à mão foram mantidos.");
}

/** Ajusta à mão o orçado de um centro de incorporação. O valor passa a não ser sobrescrito pelo estudo. */
export async function updateDevelopmentBudget(formData: FormData) {
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("commercial.incorporation.manage");
  if (!projectId) back("Selecione um empreendimento.", "error");
  const serviceId = String(formData.get("service_id") ?? "");
  const amount = money(formData.get("budget_amount"));
  if (!serviceId) back("Centro de custo não informado.", "error");
  if (!Number.isFinite(amount) || amount < 0) back("Informe um orçado válido (zero ou maior).", "error");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const { data: center } = await supabase
    .from("engineering_services")
    .select("id, code")
    .eq("company_id", companyId)
    .eq("id", serviceId)
    .not("development_cost_category", "is", null)
    .maybeSingle();
  if (!center) back("Centro de incorporação não encontrado.", "error");

  const { error } = await supabase
    .from("development_cost_budgets")
    .upsert({
      company_id: companyId,
      project_id: projectId,
      service_id: serviceId,
      budget_amount: Math.round(amount * 100) / 100,
      source: "manual",
      notes,
      created_by: userId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "project_id,service_id" });
  if (error) back(error.message, "error");
  revalidatePath(BASE);
  back(`Orçado de ${center!.code} atualizado.`);
}
