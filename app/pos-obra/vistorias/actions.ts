"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/pos-obra/vistorias";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function integer(formData: FormData, key: string, fallback = 0) {
  const value = Number.parseInt(text(formData, key), 10);
  return Number.isFinite(value) ? value : fallback;
}
function resultUrl(message: string, type: "success" | "error", inspectionId?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (inspectionId) params.set("inspection", inspectionId);
  return `${PATH}?${params.toString()}`;
}
function safeName(name: string) {
  const extension = name.includes(".") ? `.${name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  const stem = name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "evidencia";
  return `${stem}${extension}`;
}
function refresh() { revalidatePath(PATH); }

function parseTemplateItems(raw: string) {
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [environment, title, criterion, code] = line.split("|").map((part) => part.trim());
    return { environment: environment || "Geral", title: title || `Item ${index + 1}`, criterion: criterion || null, code: code || null, is_mandatory: true };
  });
}

export async function saveInspectionTemplate(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.inspections.manage");
  const items = parseTemplateItems(text(formData, "items_text"));
  const { data, error } = await supabase.rpc("save_postwork_inspection_template", {
    p_company_id: companyId,
    p_project_id: optional(formData, "use_all_projects") ? null : projectId,
    p_template_id: optional(formData, "template_id"),
    p_name: text(formData, "name"),
    p_inspection_type: text(formData, "inspection_type") || "unit_delivery",
    p_instructions: optional(formData, "instructions"),
    p_items: items,
  });
  if (error || !data) redirect(resultUrl(error?.message ?? "Não foi possível salvar o modelo.", "error"));
  refresh();
  redirect(resultUrl("Modelo de checklist salvo.", "success"));
}

export async function createUnitInspection(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.inspections.manage");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error"));
  const { data, error } = await supabase.rpc("create_postwork_unit_inspection", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_unit_id: optional(formData, "unit_id"),
    p_client_id: optional(formData, "client_id"),
    p_template_id: optional(formData, "template_id"),
    p_inspection_type: text(formData, "inspection_type") || "unit_delivery",
    p_scheduled_at: optional(formData, "scheduled_at"),
    p_inspector_name: optional(formData, "inspector_name"),
    p_customer_attendee_name: optional(formData, "customer_attendee_name"),
    p_contact_phone: optional(formData, "contact_phone"),
    p_access_notes: optional(formData, "access_notes"),
    p_general_notes: optional(formData, "general_notes"),
  });
  if (error || !data) redirect(resultUrl(error?.message ?? "Não foi possível criar a vistoria.", "error"));
  refresh();
  redirect(resultUrl("Vistoria criada com o checklist do modelo.", "success", String(data)));
}

export async function startUnitInspection(formData: FormData) {
  const inspectionId = text(formData, "inspection_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.inspections.fill");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error"));
  const { error } = await supabase.rpc("start_postwork_unit_inspection", { p_company_id: companyId, p_project_id: projectId, p_inspection_id: inspectionId });
  if (error) redirect(resultUrl(error.message, "error", inspectionId));
  refresh();
  redirect(resultUrl("Vistoria iniciada. Preencha todos os itens obrigatórios.", "success", inspectionId));
}

export async function completeUnitInspection(formData: FormData) {
  const inspectionId = text(formData, "inspection_id");
  const itemIds = formData.getAll("item_id").map(String);
  const items = itemIds.map((itemId) => ({
    item_id: itemId,
    result: text(formData, `result_${itemId}`) || "pending",
    notes: optional(formData, `notes_${itemId}`),
    correction_due_date: optional(formData, `due_${itemId}`),
    correction_responsible_name: optional(formData, `responsible_${itemId}`),
    supplier_id: optional(formData, `supplier_${itemId}`),
  }));
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.inspections.fill");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", inspectionId));
  const { data, error } = await supabase.rpc("complete_postwork_unit_inspection", {
    p_company_id: companyId, p_project_id: projectId, p_inspection_id: inspectionId,
    p_items: items, p_general_notes: optional(formData, "general_notes"),
  });
  if (error) redirect(resultUrl(error.message, "error", inspectionId));
  refresh();
  redirect(resultUrl(data === "approved" ? "Vistoria concluída e aprovada sem pendências." : "Vistoria concluída com pendências abertas.", "success", inspectionId));
}

export async function markInspectionItemCorrected(formData: FormData) {
  const inspectionId = text(formData, "inspection_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.inspections.correct");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", inspectionId));
  const { error } = await supabase.rpc("mark_postwork_inspection_item_corrected", {
    p_company_id: companyId, p_project_id: projectId, p_inspection_id: inspectionId,
    p_item_id: text(formData, "item_id"), p_correction_notes: text(formData, "correction_notes"),
    p_responsible_name: optional(formData, "responsible_name"), p_supplier_id: optional(formData, "supplier_id"),
  });
  if (error) redirect(resultUrl(error.message, "error", inspectionId));
  refresh();
  redirect(resultUrl("Correção registrada. A pendência está pronta para reinspeção.", "success", inspectionId));
}

export async function verifyInspectionItem(formData: FormData) {
  const inspectionId = text(formData, "inspection_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.inspections.correct");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", inspectionId));
  const { data, error } = await supabase.rpc("verify_postwork_inspection_item", {
    p_company_id: companyId, p_project_id: projectId, p_inspection_id: inspectionId,
    p_item_id: text(formData, "item_id"), p_verification_result: text(formData, "verification_result"),
    p_notes: optional(formData, "verification_notes"),
  });
  if (error) redirect(resultUrl(error.message, "error", inspectionId));
  refresh();
  redirect(resultUrl(data === "approved" ? "Última pendência aprovada. A unidade está pronta para entrega." : "Reinspeção registrada.", "success", inspectionId));
}

export async function transferInspectionItemToAssistance(formData: FormData) {
  const inspectionId = text(formData, "inspection_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.inspections.correct");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", inspectionId));
  const { data, error } = await supabase.rpc("transfer_postwork_inspection_item_to_assistance", {
    p_company_id: companyId, p_project_id: projectId, p_inspection_id: inspectionId,
    p_item_id: text(formData, "item_id"), p_priority: text(formData, "priority") || "normal",
    p_due_at: optional(formData, "sla_due_at"),
  });
  if (error || !data) redirect(resultUrl(error?.message ?? "Não foi possível criar a Assistência Técnica.", "error", inspectionId));
  refresh();
  redirect(resultUrl("Pendência transferida para Assistência Técnica com vínculo rastreável.", "success", inspectionId));
}

export async function deliverUnitInspection(formData: FormData) {
  const inspectionId = text(formData, "inspection_id");
  const ratingText = optional(formData, "customer_rating");
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.inspections.deliver");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", inspectionId));
  const { error } = await supabase.rpc("deliver_postwork_unit_inspection", {
    p_company_id: companyId, p_project_id: projectId, p_inspection_id: inspectionId,
    p_accepted_by_name: text(formData, "accepted_by_name"), p_accepted_by_document: optional(formData, "accepted_by_document"),
    p_delivery_notes: optional(formData, "delivery_notes"), p_keys: integer(formData, "keys_delivered"), p_tags: integer(formData, "tags_delivered"),
    p_water: optional(formData, "water_meter_reading"), p_energy: optional(formData, "energy_meter_reading"), p_gas: optional(formData, "gas_meter_reading"),
    p_rating: ratingText ? Number.parseInt(ratingText, 10) : null,
  });
  if (error) redirect(resultUrl(error.message, "error", inspectionId));
  refresh();
  redirect(resultUrl("Entrega formalizada e termo de recebimento registrado.", "success", inspectionId));
}

export async function cancelUnitInspection(formData: FormData) {
  const inspectionId = text(formData, "inspection_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.inspections.manage");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", inspectionId));
  const { error } = await supabase.rpc("cancel_postwork_unit_inspection", {
    p_company_id: companyId, p_project_id: projectId, p_inspection_id: inspectionId, p_reason: text(formData, "reason"),
  });
  if (error) redirect(resultUrl(error.message, "error", inspectionId));
  refresh();
  redirect(resultUrl("Vistoria cancelada com justificativa.", "success", inspectionId));
}

export async function uploadInspectionDocuments(formData: FormData) {
  const inspectionId = text(formData, "inspection_id");
  const inspectionItemId = optional(formData, "inspection_item_id");
  const documentType = text(formData, "document_type") || "evidence";
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("postwork.inspections.fill");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", inspectionId));
  const inspection = await supabase.from("postwork_unit_inspections").select("id").eq("id", inspectionId).eq("company_id", companyId).eq("project_id", projectId).maybeSingle();
  if (!inspection.data) redirect(resultUrl("Vistoria não localizada.", "error", inspectionId));
  if (inspectionItemId) {
    const item = await supabase.from("postwork_unit_inspection_items").select("id").eq("id", inspectionItemId).eq("inspection_id", inspectionId).maybeSingle();
    if (!item.data) redirect(resultUrl("Item da vistoria não localizado.", "error", inspectionId));
  }
  let uploaded = 0;
  for (const value of formData.getAll("documents")) {
    if (!(value instanceof File) || value.size <= 0) continue;
    if (value.size > 25 * 1024 * 1024) redirect(resultUrl(`${value.name} excede 25 MB.`, "error", inspectionId));
    const allowed = value.type === "application/pdf" || value.type.startsWith("image/") || value.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (!allowed) redirect(resultUrl(`${value.name} não possui formato aceito.`, "error", inspectionId));
    const path = `${companyId}/${projectId}/${inspectionId}/${crypto.randomUUID()}-${safeName(value.name)}`;
    const storage = await supabase.storage.from("postwork-inspections").upload(path, new Uint8Array(await value.arrayBuffer()), { contentType: value.type, upsert: false });
    if (storage.error) redirect(resultUrl(storage.error.message, "error", inspectionId));
    const insert = await supabase.from("postwork_inspection_documents").insert({
      company_id: companyId, project_id: projectId, inspection_id: inspectionId, inspection_item_id: inspectionItemId,
      document_type: documentType, storage_path: path, file_name: value.name, mime_type: value.type, file_size: value.size,
      caption: optional(formData, "caption"), uploaded_by: userId,
    });
    if (insert.error) {
      await supabase.storage.from("postwork-inspections").remove([path]);
      redirect(resultUrl(insert.error.message, "error", inspectionId));
    }
    uploaded += 1;
  }
  refresh();
  redirect(resultUrl(`${uploaded} documento(s) anexado(s).`, "success", inspectionId));
}

export async function removeInspectionDocument(formData: FormData) {
  const inspectionId = text(formData, "inspection_id");
  const documentId = text(formData, "document_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.inspections.manage");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", inspectionId));
  const { data } = await supabase.from("postwork_inspection_documents").select("storage_path").eq("id", documentId).eq("inspection_id", inspectionId).eq("company_id", companyId).eq("project_id", projectId).maybeSingle();
  if (!data) redirect(resultUrl("Documento não localizado.", "error", inspectionId));
  const deletion = await supabase.from("postwork_inspection_documents").delete().eq("id", documentId);
  if (deletion.error) redirect(resultUrl(deletion.error.message, "error", inspectionId));
  await supabase.storage.from("postwork-inspections").remove([data.storage_path]);
  refresh();
  redirect(resultUrl("Documento removido.", "success", inspectionId));
}
