"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/execucao/ordens-servico";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function jsonArray(formData: FormData, key: string) { try { const parsed = JSON.parse(text(formData, key) || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function resultUrl(message: string, type: "success" | "error", workOrder?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (workOrder) params.set("work_order", workOrder);
  return `${PATH}?${params.toString()}`;
}
function safeName(name: string) {
  const extension = name.includes(".") ? `.${name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  const stem = name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "documento";
  return `${stem}${extension}`;
}

export async function saveWorkOrder(formData: FormData) {
  const workOrderId = optional(formData, "work_order_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.work_orders.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra antes de criar a ordem de serviço.", "error"));
  const { data, error } = await supabase.rpc("save_execution_work_order", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_work_order_id: workOrderId,
    p_contract_id: optional(formData, "contract_id"),
    p_title: text(formData, "title"),
    p_scope_summary: text(formData, "scope_summary"),
    p_planned_start: optional(formData, "planned_start"),
    p_planned_finish: optional(formData, "planned_finish"),
    p_supplier_contact_name: optional(formData, "supplier_contact_name"),
    p_supplier_contact_phone: optional(formData, "supplier_contact_phone"),
    p_site_instructions: optional(formData, "site_instructions"),
    p_safety_instructions: optional(formData, "safety_instructions"),
    p_quality_requirements: optional(formData, "quality_requirements"),
    p_notes: optional(formData, "notes"),
    p_items: jsonArray(formData, "items_json"),
    p_prerequisites: jsonArray(formData, "prerequisites_json"),
  });
  if (error || !data) redirect(resultUrl(error?.message ?? "Não foi possível salvar a ordem de serviço.", "error", workOrderId ?? undefined));
  revalidatePath(PATH);
  redirect(resultUrl(workOrderId ? "Ordem de serviço atualizada." : "Ordem de serviço criada em elaboração.", "success", String(data)));
}

export async function releaseWorkOrder(formData: FormData) {
  const workOrderId = text(formData, "work_order_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.work_orders.release");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("release_execution_work_order", { p_company_id: companyId, p_project_id: projectId, p_work_order_id: workOrderId });
  if (error) redirect(resultUrl(error.message, "error", workOrderId));
  revalidatePath(PATH);
  redirect(resultUrl("Ordem de serviço liberada para o prestador.", "success", workOrderId));
}

async function changeStatus(formData: FormData, action: string, permission: string, success: string) {
  const workOrderId = text(formData, "work_order_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission(permission);
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("change_execution_work_order_status", {
    p_company_id: companyId, p_project_id: projectId, p_work_order_id: workOrderId,
    p_action: action, p_reason: optional(formData, "reason"),
  });
  if (error) redirect(resultUrl(error.message, "error", workOrderId));
  revalidatePath(PATH);
  redirect(resultUrl(success, "success", workOrderId));
}

export async function startWorkOrder(formData: FormData) { return changeStatus(formData, "start", "execution.work_orders.release", "Execução iniciada."); }
export async function pauseWorkOrder(formData: FormData) { return changeStatus(formData, "pause", "execution.work_orders.progress", "Ordem de serviço pausada."); }
export async function resumeWorkOrder(formData: FormData) { return changeStatus(formData, "resume", "execution.work_orders.progress", "Execução retomada."); }
export async function requestWorkOrderAcceptance(formData: FormData) { return changeStatus(formData, "request_acceptance", "execution.work_orders.progress", "Ordem enviada para aceite técnico."); }
export async function cancelWorkOrder(formData: FormData) { return changeStatus(formData, "cancel", "execution.work_orders.cancel", "Ordem de serviço cancelada com rastreabilidade."); }

export async function updateWorkOrderProgress(formData: FormData) {
  const workOrderId = text(formData, "work_order_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.work_orders.progress");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("update_execution_work_order_progress", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_work_order_id: workOrderId,
    p_items: jsonArray(formData, "items_json"),
    p_notes: optional(formData, "progress_notes"),
  });
  if (error) redirect(resultUrl(error.message, "error", workOrderId));
  revalidatePath(PATH);
  redirect(resultUrl("Execução da ordem atualizada.", "success", workOrderId));
}

export async function acceptWorkOrder(formData: FormData) {
  const workOrderId = text(formData, "work_order_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.work_orders.accept");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("accept_execution_work_order", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_work_order_id: workOrderId,
    p_result: text(formData, "result"),
    p_quality_status: text(formData, "quality_status"),
    p_quality_reference: optional(formData, "quality_reference"),
    p_notes: optional(formData, "acceptance_notes"),
    p_punch_list: jsonArray(formData, "punch_list_json"),
  });
  if (error) redirect(resultUrl(error.message, "error", workOrderId));
  revalidatePath(PATH);
  redirect(resultUrl(text(formData, "result") === "rejected" ? "Aceite devolvido para correção." : "Ordem de serviço aceita e encerrada.", "success", workOrderId));
}

export async function uploadWorkOrderDocuments(formData: FormData) {
  const workOrderId = text(formData, "work_order_id");
  const documentType = text(formData, "document_type") || "other";
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("execution.work_orders.progress");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const files = formData.getAll("documents");
  let uploaded = 0;
  for (const value of files) {
    if (!(value instanceof File) || value.size <= 0) continue;
    if (value.size > 25 * 1024 * 1024) redirect(resultUrl(`${value.name} excede 25 MB.`, "error", workOrderId));
    const allowed = value.type === "application/pdf" || value.type.startsWith("image/") || value.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (!allowed) redirect(resultUrl(`${value.name} não possui formato aceito.`, "error", workOrderId));
    const path = `${companyId}/${projectId}/${workOrderId}/${crypto.randomUUID()}-${safeName(value.name)}`;
    const upload = await supabase.storage.from("work-order-documents").upload(path, new Uint8Array(await value.arrayBuffer()), { contentType: value.type, upsert: false });
    if (upload.error) redirect(resultUrl(upload.error.message, "error", workOrderId));
    const insert = await supabase.from("execution_work_order_documents").insert({
      company_id: companyId, project_id: projectId, work_order_id: workOrderId, document_type: documentType,
      storage_path: path, file_name: value.name, mime_type: value.type, file_size: value.size,
      caption: optional(formData, "caption"), uploaded_by: userId,
    });
    if (insert.error) {
      await supabase.storage.from("work-order-documents").remove([path]);
      redirect(resultUrl(insert.error.message, "error", workOrderId));
    }
    uploaded += 1;
  }
  revalidatePath(PATH);
  redirect(resultUrl(`${uploaded} documento(s) anexado(s).`, "success", workOrderId));
}

export async function removeWorkOrderDocument(formData: FormData) {
  const workOrderId = text(formData, "work_order_id");
  const documentId = text(formData, "document_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.work_orders.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { data: document } = await supabase.from("execution_work_order_documents").select("storage_path,execution_work_orders!inner(status)")
    .eq("id", documentId).eq("company_id", companyId).eq("project_id", projectId).eq("work_order_id", workOrderId).maybeSingle();
  const workOrder = document?.execution_work_orders as unknown as { status?: string } | null;
  if (!document || workOrder?.status !== "draft") redirect(resultUrl("Documentos só podem ser removidos enquanto a ordem está em elaboração.", "error", workOrderId));
  const deletion = await supabase.from("execution_work_order_documents").delete().eq("id", documentId);
  if (deletion.error) redirect(resultUrl(deletion.error.message, "error", workOrderId));
  await supabase.storage.from("work-order-documents").remove([document.storage_path]);
  revalidatePath(PATH);
  redirect(resultUrl("Documento removido.", "success", workOrderId));
}
