"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const BASE = "/comercial/incorporacao/viabilidade";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function numberValue(formData: FormData, key: string) {
  const raw = text(formData, key).replace(/\s/g, "");
  if (!raw) return Number.NaN;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  return Number(normalized);
}

function monthValue(formData: FormData, key: string) {
  const raw = text(formData, key);
  return /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : null;
}

function detail(studyId: string) {
  return `${BASE}/${studyId}`;
}

function go(studyId: string, message: string, type: "success" | "error" = "success"): never {
  redirect(`${detail(studyId)}?${new URLSearchParams({ [type]: message }).toString()}`);
}

export async function updateFeasibilityCubBaseline(formData: FormData) {
  const studyId = text(formData, "study_id");
  const vgvIndexName = text(formData, "vgv_cub_index_name");
  const vgvReferenceMonth = monthValue(formData, "vgv_cub_reference_month");
  const vgvBaseValue = numberValue(formData, "vgv_cub_base_value");
  const costIndexName = text(formData, "cost_cub_index_name");
  const costReferenceMonth = monthValue(formData, "cost_cub_reference_month");
  const costBaseValue = numberValue(formData, "cost_cub_base_value");

  if (!studyId) redirect(`${BASE}?error=Estudo%20inv%C3%A1lido.`);
  if (
    !vgvIndexName || !vgvReferenceMonth || !Number.isFinite(vgvBaseValue) || vgvBaseValue <= 0 ||
    !costIndexName || !costReferenceMonth || !Number.isFinite(costBaseValue) || costBaseValue <= 0
  ) {
    go(studyId, "Informe índice, mês-base e valor do CUB tanto para o VGV quanto para os custos.", "error");
  }

  const { supabase, companyId } = await requireCompanyPermission("commercial.incorporation.manage");
  const { data: study } = await supabase
    .from("commercial_feasibility_studies")
    .select("id,status")
    .eq("id", studyId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!study) go(studyId, "Estudo não localizado.", "error");
  if (study.status !== "draft") go(studyId, "O CUB-base faz parte do baseline aprovado e não pode ser alterado depois da conversão.", "error");

  const { error } = await supabase
    .from("commercial_feasibility_studies")
    .update({
      vgv_cub_index_name: vgvIndexName,
      vgv_cub_reference_month: vgvReferenceMonth,
      vgv_cub_base_value: vgvBaseValue,
      cost_cub_index_name: costIndexName,
      cost_cub_reference_month: costReferenceMonth,
      cost_cub_base_value: costBaseValue,
      updated_at: new Date().toISOString(),
    })
    .eq("id", studyId)
    .eq("company_id", companyId)
    .eq("status", "draft");

  if (error) go(studyId, error.message, "error");

  revalidatePath(detail(studyId));
  revalidatePath(BASE);
  go(studyId, "Referências CUB do VGV e dos custos salvas no baseline.");
}
