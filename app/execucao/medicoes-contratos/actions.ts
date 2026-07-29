"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/execucao/medicoes-contratos";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function parseNumber(formData: FormData, key: string, fallback = 0) {
  const raw = text(formData, key).replace(/\s/g, "");
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : fallback;
}
function jsonArray(formData: FormData, key: string) { try { const value = JSON.parse(text(formData, key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function safeName(name: string) {
  const extension = name.includes(".") ? `.${name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  const stem = name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "documento";
  return `${stem}${extension}`;
}
function resultUrl(message: string, type: "success" | "error", measurement?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (measurement) params.set("measurement", measurement);
  return `${PATH}?${params.toString()}`;
}

export async function saveContractMeasurement(formData: FormData) {
  const measurementId = optional(formData, "measurement_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.measurements.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra antes de criar a medição.", "error"));
  const { data, error } = await supabase.rpc("save_execution_contract_measurement", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_measurement_id: measurementId,
    p_contract_id: optional(formData, "contract_id"),
    p_period_start: optional(formData, "period_start"),
    p_period_end: optional(formData, "period_end"),
    p_tax_withholding: parseNumber(formData, "tax_withholding_amount"),
    p_advance_deduction: parseNumber(formData, "advance_deduction_amount"),
    p_other_discount: parseNumber(formData, "other_discount_amount"),
    p_notes: optional(formData, "notes"),
    p_contractor_notes: optional(formData, "contractor_notes"),
    p_items: jsonArray(formData, "items_json"),
  });
  if (error || !data) redirect(resultUrl(error?.message ?? "Não foi possível salvar a medição.", "error", measurementId ?? undefined));
  revalidatePath(PATH);
  revalidatePath("/execucao/contratos-servicos");
  redirect(resultUrl(measurementId ? "Medição atualizada." : "Medição criada em elaboração.", "success", String(data)));
}

export async function submitContractMeasurement(formData: FormData) {
  const measurementId = text(formData, "measurement_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.measurements.submit");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("submit_execution_contract_measurement", { p_company_id: companyId, p_project_id: projectId, p_measurement_id: measurementId });
  if (error) redirect(resultUrl(error.message, "error", measurementId));
  revalidatePath(PATH);
  redirect(resultUrl("Medição enviada para aprovação técnica.", "success", measurementId));
}

export async function approveContractMeasurement(formData: FormData) {
  const measurementId = text(formData, "measurement_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.measurements.approve");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("approve_execution_contract_measurement", {
    p_company_id: companyId, p_project_id: projectId, p_measurement_id: measurementId, p_notes: optional(formData, "approval_notes"),
  });
  if (error) redirect(resultUrl(error.message, "error", measurementId));
  revalidatePath(PATH);
  revalidatePath("/execucao/contratos-servicos");
  redirect(resultUrl("Medição aprovada e acumulados do contrato atualizados.", "success", measurementId));
}

export async function rejectContractMeasurement(formData: FormData) {
  const measurementId = text(formData, "measurement_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.measurements.approve");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("reject_execution_contract_measurement", {
    p_company_id: companyId, p_project_id: projectId, p_measurement_id: measurementId, p_reason: text(formData, "reason"),
  });
  if (error) redirect(resultUrl(error.message, "error", measurementId));
  revalidatePath(PATH);
  redirect(resultUrl("Medição devolvida para correção.", "success", measurementId));
}

export async function cancelContractMeasurement(formData: FormData) {
  const measurementId = text(formData, "measurement_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.measurements.cancel");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("cancel_execution_contract_measurement", {
    p_company_id: companyId, p_project_id: projectId, p_measurement_id: measurementId, p_reason: text(formData, "reason"),
  });
  if (error) redirect(resultUrl(error.message, "error", measurementId));
  revalidatePath(PATH);
  redirect(resultUrl("Medição cancelada com justificativa.", "success", measurementId));
}

export async function sendContractMeasurementToFinance(formData: FormData) {
  const measurementId = text(formData, "measurement_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.measurements.finance");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("send_execution_contract_measurement_to_finance", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_measurement_id: measurementId,
    p_invoice_number: text(formData, "invoice_number"),
    p_invoice_date: optional(formData, "invoice_date"),
    p_invoice_gross_amount: parseNumber(formData, "invoice_gross_amount"),
    p_due_date: optional(formData, "due_date"),
    p_payment_method: optional(formData, "payment_method"),
    p_notes: optional(formData, "finance_notes"),
  });
  if (error) redirect(resultUrl(error.message, "error", measurementId));
  revalidatePath(PATH);
  revalidatePath("/execucao/contratos-servicos");
  revalidatePath("/financeiro/contas-a-pagar");
  redirect(resultUrl("Nota vinculada e conta a pagar gerada pelo valor líquido da medição.", "success", measurementId));
}

export async function uploadContractMeasurementDocuments(formData: FormData) {
  const measurementId = text(formData, "measurement_id");
  const documentType = text(formData, "document_type") || "evidence";
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("execution.measurements.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  let uploaded = 0;
  for (const value of formData.getAll("documents")) {
    if (!(value instanceof File) || value.size <= 0) continue;
    if (value.size > 25 * 1024 * 1024) redirect(resultUrl(`${value.name} excede 25 MB.`, "error", measurementId));
    const allowed = value.type === "application/pdf" || value.type.startsWith("image/") || value.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (!allowed) redirect(resultUrl(`${value.name} não possui formato aceito.`, "error", measurementId));
    const path = `${companyId}/${projectId}/${measurementId}/${crypto.randomUUID()}-${safeName(value.name)}`;
    const upload = await supabase.storage.from("contract-measurement-documents").upload(path, new Uint8Array(await value.arrayBuffer()), { contentType: value.type, upsert: false });
    if (upload.error) redirect(resultUrl(upload.error.message, "error", measurementId));
    const insert = await supabase.from("execution_contract_measurement_documents").insert({
      company_id: companyId, project_id: projectId, measurement_id: measurementId, document_type: documentType,
      storage_path: path, file_name: value.name, mime_type: value.type, file_size: value.size,
      caption: optional(formData, "caption"), uploaded_by: userId,
    });
    if (insert.error) {
      await supabase.storage.from("contract-measurement-documents").remove([path]);
      redirect(resultUrl(insert.error.message, "error", measurementId));
    }
    uploaded += 1;
  }
  revalidatePath(PATH);
  redirect(resultUrl(`${uploaded} documento(s) anexado(s).`, "success", measurementId));
}

export async function removeContractMeasurementDocument(formData: FormData) {
  const measurementId = text(formData, "measurement_id");
  const documentId = text(formData, "document_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.measurements.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { data: document } = await supabase.from("execution_contract_measurement_documents").select("storage_path,execution_contract_measurements!inner(status)")
    .eq("id", documentId).eq("company_id", companyId).eq("project_id", projectId).eq("measurement_id", measurementId).maybeSingle();
  const measurement = document?.execution_contract_measurements as unknown as { status?: string } | null;
  if (!document || !["draft", "rejected"].includes(measurement?.status ?? "")) redirect(resultUrl("Documentos só podem ser removidos antes da aprovação.", "error", measurementId));
  const deletion = await supabase.from("execution_contract_measurement_documents").delete().eq("id", documentId);
  if (deletion.error) redirect(resultUrl(deletion.error.message, "error", measurementId));
  await supabase.storage.from("contract-measurement-documents").remove([document.storage_path]);
  revalidatePath(PATH);
  redirect(resultUrl("Documento removido.", "success", measurementId));
}
