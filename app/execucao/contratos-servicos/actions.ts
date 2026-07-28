"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/execucao/contratos-servicos";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function numberValue(formData: FormData, key: string, fallback = 0) { const value = Number(text(formData, key).replace(",", ".")); return Number.isFinite(value) ? value : fallback; }
function jsonArray(formData: FormData, key: string) { try { const value = JSON.parse(text(formData, key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function safeName(name: string) {
  const extension = name.includes(".") ? `.${name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  const stem = name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "documento";
  return `${stem}${extension}`;
}
function resultUrl(message: string, type: "success" | "error", options: { contract?: string; status?: string; q?: string } = {}) {
  const params = new URLSearchParams({ [type]: message });
  if (options.contract) params.set("contract", options.contract);
  if (options.status) params.set("status", options.status);
  if (options.q) params.set("q", options.q);
  return `${PATH}?${params.toString()}`;
}

export async function saveServiceContract(formData: FormData) {
  const contractId = optional(formData, "contract_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contracts.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra antes de criar o contrato.", "error"));

  const { data, error } = await supabase.rpc("save_execution_service_contract", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_contract_id: contractId,
    p_supplier_id: optional(formData, "supplier_id"),
    p_budget_id: optional(formData, "budget_id"),
    p_title: text(formData, "title"),
    p_scope_summary: text(formData, "scope_summary"),
    p_start_date: optional(formData, "start_date"),
    p_end_date: optional(formData, "end_date"),
    p_signed_date: optional(formData, "signed_date"),
    p_retention_percent: numberValue(formData, "retention_percent"),
    p_guarantee_percent: numberValue(formData, "guarantee_percent"),
    p_guarantee_months: numberValue(formData, "guarantee_months"),
    p_payment_days: numberValue(formData, "payment_days", 15),
    p_adjustment_index: optional(formData, "adjustment_index"),
    p_adjustment_base_date: optional(formData, "adjustment_base_date"),
    p_contact_name: optional(formData, "contact_name"),
    p_contact_phone: optional(formData, "contact_phone"),
    p_contact_email: optional(formData, "contact_email"),
    p_notes: optional(formData, "notes"),
    p_items: jsonArray(formData, "items_json"),
  });
  if (error || !data) redirect(resultUrl(error?.message ?? "Não foi possível salvar o contrato.", "error", { contract: contractId ?? undefined }));
  revalidatePath(PATH);
  redirect(resultUrl(contractId ? "Contrato atualizado." : "Contrato criado em elaboração.", "success", { contract: String(data) }));
}

export async function activateServiceContract(formData: FormData) {
  const contractId = text(formData, "contract_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contracts.approve");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("activate_execution_service_contract", { p_company_id: companyId, p_project_id: projectId, p_contract_id: contractId });
  if (error) redirect(resultUrl(error.message, "error", { contract: contractId }));
  revalidatePath(PATH);
  redirect(resultUrl("Contrato ativado e liberado para ordens de serviço e medições.", "success", { contract: contractId }));
}

async function changeStatus(formData: FormData, action: string, permission: string, success: string) {
  const contractId = text(formData, "contract_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission(permission);
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("change_execution_service_contract_status", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_contract_id: contractId,
    p_action: action,
    p_reason: optional(formData, "reason"),
  });
  if (error) redirect(resultUrl(error.message, "error", { contract: contractId }));
  revalidatePath(PATH);
  redirect(resultUrl(success, "success", { contract: contractId }));
}

export async function suspendServiceContract(formData: FormData) { return changeStatus(formData, "suspend", "execution.contracts.approve", "Contrato suspenso."); }
export async function resumeServiceContract(formData: FormData) { return changeStatus(formData, "resume", "execution.contracts.approve", "Contrato retomado."); }
export async function finishServiceContract(formData: FormData) { return changeStatus(formData, "finish", "execution.contracts.approve", "Contrato concluído."); }
export async function cancelServiceContract(formData: FormData) { return changeStatus(formData, "cancel", "execution.contracts.cancel", "Contrato cancelado com rastreabilidade."); }

export async function addServiceContractAmendment(formData: FormData) {
  const contractId = text(formData, "contract_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contracts.amend");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const type = text(formData, "amendment_type");
  let valueChange = numberValue(formData, "value_change");
  if (type === "suppression" && valueChange > 0) valueChange *= -1;
  const { error } = await supabase.rpc("add_execution_service_contract_amendment", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_contract_id: contractId,
    p_type: type,
    p_description: text(formData, "description"),
    p_value_change: valueChange,
    p_new_end_date: optional(formData, "new_end_date"),
    p_justification: text(formData, "justification"),
  });
  if (error) redirect(resultUrl(error.message, "error", { contract: contractId }));
  revalidatePath(PATH);
  redirect(resultUrl("Aditivo aprovado e incorporado ao valor/vigência atual do contrato.", "success", { contract: contractId }));
}

export async function uploadServiceContractDocuments(formData: FormData) {
  const contractId = text(formData, "contract_id");
  const documentType = text(formData, "document_type") || "other";
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("execution.contracts.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const files = formData.getAll("documents");
  let uploaded = 0;
  for (const value of files) {
    if (!(value instanceof File) || value.size <= 0) continue;
    if (value.size > 25 * 1024 * 1024) redirect(resultUrl(`${value.name} excede 25 MB.`, "error", { contract: contractId }));
    const allowed = value.type === "application/pdf" || value.type.startsWith("image/") || value.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (!allowed) redirect(resultUrl(`${value.name} não possui um formato aceito.`, "error", { contract: contractId }));
    const path = `${companyId}/${projectId}/${contractId}/${crypto.randomUUID()}-${safeName(value.name)}`;
    const upload = await supabase.storage.from("service-contract-documents").upload(path, new Uint8Array(await value.arrayBuffer()), { contentType: value.type, upsert: false });
    if (upload.error) redirect(resultUrl(upload.error.message, "error", { contract: contractId }));
    const insert = await supabase.from("execution_service_contract_documents").insert({
      company_id: companyId, project_id: projectId, contract_id: contractId, document_type: documentType,
      storage_path: path, file_name: value.name, mime_type: value.type, file_size: value.size,
      caption: optional(formData, "caption"), uploaded_by: userId,
    });
    if (insert.error) {
      await supabase.storage.from("service-contract-documents").remove([path]);
      redirect(resultUrl(insert.error.message, "error", { contract: contractId }));
    }
    uploaded += 1;
  }
  revalidatePath(PATH);
  redirect(resultUrl(`${uploaded} documento(s) anexado(s).`, "success", { contract: contractId }));
}

export async function removeServiceContractDocument(formData: FormData) {
  const contractId = text(formData, "contract_id");
  const documentId = text(formData, "document_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contracts.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { data: document } = await supabase.from("execution_service_contract_documents").select("storage_path, execution_service_contracts!inner(status)")
    .eq("id", documentId).eq("company_id", companyId).eq("project_id", projectId).eq("contract_id", contractId).maybeSingle();
  const contract = document?.execution_service_contracts as unknown as { status?: string } | null;
  if (!document || contract?.status !== "draft") redirect(resultUrl("Documentos somente podem ser removidos enquanto o contrato está em elaboração.", "error", { contract: contractId }));
  const deletion = await supabase.from("execution_service_contract_documents").delete().eq("id", documentId);
  if (deletion.error) redirect(resultUrl(deletion.error.message, "error", { contract: contractId }));
  await supabase.storage.from("service-contract-documents").remove([document.storage_path]);
  revalidatePath(PATH);
  redirect(resultUrl("Documento removido.", "success", { contract: contractId }));
}
