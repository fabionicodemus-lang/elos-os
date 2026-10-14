"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/engenharia/produtividade";

function numberValue(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim().replace(/\./g, "").replace(",", ".");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function saveServiceProductivity(formData: FormData) {
  const serviceId = String(formData.get("service_id") ?? "").trim();
  const productivity = numberValue(formData.get("productivity"));
  const teamCount = numberValue(formData.get("team_count"));
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const { supabase, companyId } = await requireCompanyPermission("services.manage");
  if (!serviceId) redirect(`${PATH}?error=${encodeURIComponent("Serviço não informado.")}`);
  const { error } = await supabase.from("engineering_services").update({
    default_productivity_per_team_day: productivity,
    default_team_count: teamCount,
    productivity_notes: notes,
    updated_at: new Date().toISOString(),
  }).eq("id", serviceId).eq("company_id", companyId);
  if (error) redirect(`${PATH}?error=${encodeURIComponent(error.message)}`);
  revalidatePath(PATH);
  redirect(`${PATH}?success=${encodeURIComponent("Produtividade padrão atualizada.")}`);
}

export async function applyProductivityToBaseline(formData: FormData) {
  const baselineId = String(formData.get("baseline_id") ?? "").trim();
  const { supabase, companyId, projectId } = await requireCompanyPermission("schedule.manage");
  if (!projectId || !baselineId) redirect(`${PATH}?error=${encodeURIComponent("Selecione uma obra e uma linha de base.")}`);
  const { data, error } = await supabase.rpc("apply_service_productivity_to_baseline", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_baseline_id: baselineId,
  });
  if (error) redirect(`${PATH}?baseline=${baselineId}&error=${encodeURIComponent(error.message)}`);
  revalidatePath(PATH);
  redirect(`${PATH}?baseline=${baselineId}&success=${encodeURIComponent(`${Number(data ?? 0)} atividade(s) recalculada(s) com os padrões de produtividade.`)}`);
}