"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/execucao/qualidade";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function checked(formData: FormData, key: string) { return ["1", "true", "on", "yes"].includes(text(formData, key).toLowerCase()); }
function numberValue(formData: FormData, key: string, fallback = 0) { const value = Number(text(formData, key)); return Number.isFinite(value) ? value : fallback; }
function jsonArray(formData: FormData, key: string) { try { const value = JSON.parse(text(formData, key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function safeName(name: string) {
  const extension = name.includes(".") ? `.${name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  const stem = name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "evidencia";
  return `${stem}${extension}`;
}
function url(message: string, type: "success" | "error", options: { tab?: string; inspection?: string; nc?: string } = {}) {
  const params = new URLSearchParams({ [type]: message });
  if (options.tab) params.set("tab", options.tab);
  if (options.inspection) params.set("inspection", options.inspection);
  if (options.nc) params.set("nc", options.nc);
  return `${PATH}?${params.toString()}`;
}

async function uploadFiles(formData: FormData, prefix: string, parent: {
  inspectionId?: string | null; itemId?: string | null; ncId?: string | null; reinspectionId?: string | null; type: string;
}) {
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("execution.quality.fill");
  if (!projectId) throw new Error("Selecione uma obra.");
  const values = formData.getAll(prefix);
  for (const value of values) {
    if (!(value instanceof File) || value.size <= 0) continue;
    if (value.size > 15 * 1024 * 1024) throw new Error(`${value.name} excede 15 MB.`);
    if (!value.type.startsWith("image/") && value.type !== "application/pdf") throw new Error(`${value.name} não é uma imagem ou PDF válido.`);
    const path = `${companyId}/${projectId}/${parent.inspectionId ?? "sem-vistoria"}/${crypto.randomUUID()}-${safeName(value.name)}`;
    const upload = await supabase.storage.from("quality-evidence").upload(path, new Uint8Array(await value.arrayBuffer()), { contentType: value.type, upsert: false });
    if (upload.error) throw new Error(upload.error.message);
    const insert = await supabase.from("quality_attachments").insert({
      company_id: companyId, project_id: projectId,
      inspection_id: parent.inspectionId ?? null,
      inspection_item_id: parent.itemId ?? null,
      nonconformity_id: parent.ncId ?? null,
      reinspection_id: parent.reinspectionId ?? null,
      storage_path: path, file_name: value.name, mime_type: value.type, file_size: value.size,
      caption: optional(formData, `${prefix}_caption`), attachment_type: parent.type, uploaded_by: userId,
    });
    if (insert.error) { await supabase.storage.from("quality-evidence").remove([path]); throw new Error(insert.error.message); }
  }
}

export async function syncQualityInspections() {
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.quality.fill");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const { data, error } = await supabase.rpc("sync_quality_inspections", { p_company_id: companyId, p_project_id: projectId });
  if (error) redirect(url(error.message, "error"));
  revalidatePath(PATH);
  redirect(url(`${Number(data ?? 0)} nova(s) vistoria(s) criada(s) a partir do cronograma.`, "success"));
}

export async function createManualInspection(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.quality.fill");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const { data, error } = await supabase.rpc("create_manual_quality_inspection", {
    p_company_id: companyId, p_project_id: projectId,
    p_template_id: text(formData, "template_id"),
    p_schedule_activity_id: optional(formData, "schedule_activity_id"),
    p_location_id: optional(formData, "location_id"),
    p_stage_name: text(formData, "stage_name"),
    p_supplier_id: optional(formData, "supplier_id"),
    p_executor_team: optional(formData, "executor_team"),
    p_due_date: text(formData, "due_date"),
    p_tower: optional(formData, "tower"), p_unit_name: optional(formData, "unit_name"), p_environment_name: optional(formData, "environment_name"),
  });
  if (error || !data) redirect(url(error?.message ?? "Não foi possível criar a vistoria.", "error"));
  revalidatePath(PATH);
  redirect(url("Vistoria criada e atribuída ao engenheiro responsável.", "success", { inspection: String(data) }));
}

export async function saveInspection(formData: FormData) {
  const inspectionId = text(formData, "inspection_id");
  const answers = jsonArray(formData, "answers_json");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.quality.fill");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("save_quality_inspection", {
    p_company_id: companyId, p_project_id: projectId, p_inspection_id: inspectionId,
    p_supplier_id: optional(formData, "supplier_id"), p_executor_team: optional(formData, "executor_team"),
    p_general_notes: optional(formData, "general_notes"), p_executor_confirmed: checked(formData, "executor_confirmed"), p_answers: answers,
  });
  if (error) redirect(url(error.message, "error", { inspection: inspectionId }));
  try {
    for (const answer of answers as { item_id?: string }[]) {
      if (!answer.item_id) continue;
      await uploadFiles(formData, `photo_${answer.item_id}`, { inspectionId, itemId: answer.item_id, type: "evidence" });
    }
    await supabase.rpc("refresh_quality_inspection", { p_inspection_id: inspectionId });
  } catch (uploadError) {
    redirect(url(uploadError instanceof Error ? uploadError.message : "Falha ao enviar evidências.", "error", { inspection: inspectionId }));
  }
  revalidatePath(PATH);
  redirect(url("Progresso da vistoria salvo.", "success", { inspection: inspectionId }));
}

export async function completeInspection(formData: FormData) {
  const inspectionId = text(formData, "inspection_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.quality.complete");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const { data, error } = await supabase.rpc("complete_quality_inspection", { p_company_id: companyId, p_project_id: projectId, p_inspection_id: inspectionId });
  if (error) redirect(url(error.message, "error", { inspection: inspectionId }));
  revalidatePath(PATH);
  redirect(url(`Vistoria concluída: ${String(data).replaceAll("_", " ")}.`, "success", { inspection: inspectionId }));
}

export async function cancelInspection(formData: FormData) {
  const inspectionId = text(formData, "inspection_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.quality.cancel");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("cancel_quality_inspection", { p_company_id: companyId, p_project_id: projectId, p_inspection_id: inspectionId, p_reason: text(formData, "reason") });
  if (error) redirect(url(error.message, "error", { inspection: inspectionId }));
  revalidatePath(PATH);
  redirect(url("Vistoria cancelada com histórico.", "success", { tab: "all" }));
}

export async function exceptionRelease(formData: FormData) {
  const inspectionId = text(formData, "inspection_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.quality.exception");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("exception_release_quality_inspection", { p_company_id: companyId, p_project_id: projectId, p_inspection_id: inspectionId, p_reason: text(formData, "reason") });
  if (error) redirect(url(error.message, "error", { inspection: inspectionId }));
  revalidatePath(PATH);
  redirect(url("Serviço liberado por exceção, com justificativa auditada.", "success", { inspection: inspectionId }));
}

export async function reportCorrection(formData: FormData) {
  const ncId = text(formData, "nonconformity_id");
  const inspectionId = text(formData, "inspection_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.quality.nonconformity");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("report_quality_correction", {
    p_company_id: companyId, p_project_id: projectId, p_nonconformity_id: ncId,
    p_probable_cause: optional(formData, "probable_cause"), p_corrective_action: text(formData, "corrective_action"),
    p_correction_report: text(formData, "correction_report"), p_estimated_cost: numberValue(formData, "estimated_rework_cost"),
  });
  if (error) redirect(url(error.message, "error", { nc: ncId }));
  try { await uploadFiles(formData, "correction_files", { inspectionId, ncId, type: "correction" }); }
  catch (uploadError) { redirect(url(uploadError instanceof Error ? uploadError.message : "Falha ao anexar correção.", "error", { nc: ncId })); }
  revalidatePath(PATH);
  redirect(url("Correção informada. Não conformidade aguardando reinspeção.", "success", { tab: "nc", nc: ncId }));
}

export async function reinspectNonconformity(formData: FormData) {
  const ncId = text(formData, "nonconformity_id");
  const inspectionId = text(formData, "inspection_id");
  const approved = text(formData, "result") === "approved";
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.quality.reinspect");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const { data, error } = await supabase.rpc("reinspect_quality_nonconformity", { p_company_id: companyId, p_project_id: projectId, p_nonconformity_id: ncId, p_approved: approved, p_notes: text(formData, "notes") });
  if (error) redirect(url(error.message, "error", { nc: ncId }));
  revalidatePath(PATH);
  redirect(url(`Reinspeção registrada: ${String(data).replaceAll("_", " ")}.`, "success", { tab: "nc", nc: ncId }));
}

export async function saveQualitySettings(formData: FormData) {
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("execution.quality.settings");
  if (!projectId) redirect(url("Selecione uma obra.", "error", { tab: "settings" }));
  const payload = {
    company_id: companyId, project_id: projectId,
    responsible_engineer_user_id: optional(formData, "responsible_engineer_user_id"),
    first_inspection_weight: numberValue(formData, "first_inspection_weight", 85),
    on_time_correction_weight: numberValue(formData, "on_time_correction_weight", 10),
    non_recurrence_weight: numberValue(formData, "non_recurrence_weight", 5),
    critical_due_hours: numberValue(formData, "critical_due_hours", 24), serious_due_days: numberValue(formData, "serious_due_days", 3), light_due_days: numberValue(formData, "light_due_days", 7),
    auto_sync: checked(formData, "auto_sync"), updated_by: userId,
  };
  if (Math.abs(payload.first_inspection_weight + payload.on_time_correction_weight + payload.non_recurrence_weight - 100) > 0.01) redirect(url("Os pesos da nota do serviço precisam somar 100%.", "error", { tab: "settings" }));
  const { error } = await supabase.from("quality_settings").upsert(payload, { onConflict: "project_id" });
  if (error) redirect(url(error.message, "error", { tab: "settings" }));
  revalidatePath(PATH);
  redirect(url("Configurações da Qualidade salvas.", "success", { tab: "settings" }));
}

export async function saveChecklistTemplate(formData: FormData) {
  const criteria = jsonArray(formData, "criteria_json");
  const { supabase, companyId } = await requireCompanyPermission("execution.quality.templates");
  const { data, error } = await supabase.rpc("save_quality_template", {
    p_company_id: companyId, p_template_id: optional(formData, "template_id"), p_service_id: optional(formData, "service_id"),
    p_code: text(formData, "code"), p_name: text(formData, "name"), p_description: optional(formData, "description"),
    p_criticality: text(formData, "criticality") || "medium", p_service_weight: numberValue(formData, "service_weight", 1),
    p_inspection_unit: text(formData, "inspection_unit") || "local", p_periodicity: text(formData, "periodicity") || "per_activity",
    p_sampling_rule: optional(formData, "sampling_rule"), p_evidence_rule: optional(formData, "evidence_rule"),
    p_has_blocking_gate: checked(formData, "has_blocking_gate"), p_change_notes: optional(formData, "change_notes"), p_criteria: criteria,
  });
  if (error || !data) redirect(url(error?.message ?? "Não foi possível publicar o modelo.", "error", { tab: "templates" }));
  revalidatePath(PATH);
  redirect(url("Nova versão do checklist publicada e preservada.", "success", { tab: "templates" }));
}

export async function saveInspectionRule(formData: FormData) {
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("execution.quality.templates");
  if (!projectId) redirect(url("Selecione uma obra.", "error", { tab: "templates" }));
  const ruleId = optional(formData, "rule_id");
  const payload = {
    company_id: companyId, project_id: projectId, template_id: text(formData, "template_id"), service_id: text(formData, "service_id"),
    event_type: text(formData, "event_type") || "scheduled_start", stage_name: text(formData, "stage_name"),
    due_offset_days: numberValue(formData, "due_offset_days"), location_scope: text(formData, "location_scope") || "activity_location",
    only_first_location: checked(formData, "only_first_location"), active: checked(formData, "active"), updated_by: userId,
  };
  const query = ruleId ? supabase.from("quality_inspection_rules").update(payload).eq("id", ruleId).eq("company_id", companyId) : supabase.from("quality_inspection_rules").insert({ ...payload, created_by: userId });
  const { error } = await query;
  if (error) redirect(url(error.message, "error", { tab: "templates" }));
  revalidatePath(PATH);
  redirect(url("Regra automática salva.", "success", { tab: "templates" }));
}
