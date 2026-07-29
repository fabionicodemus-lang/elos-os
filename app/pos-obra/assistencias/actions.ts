"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/pos-obra/assistencias";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function checkbox(formData: FormData, key: string) { return formData.get(key) === "on" || formData.get(key) === "true"; }
function parseMoney(value: FormDataEntryValue | null, fallback = 0) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) return fallback;
  const parsed = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function resultUrl(message: string, type: "success" | "error", ticketId?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (ticketId) params.set("ticket", ticketId);
  return `${PATH}?${params.toString()}`;
}
function safeName(name: string) {
  const extension = name.includes(".") ? `.${name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  const stem = name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "evidencia";
  return `${stem}${extension}`;
}
function revalidate(ticketId?: string) {
  revalidatePath(PATH);
  if (ticketId) revalidatePath(`${PATH}?ticket=${ticketId}`);
}

export async function createAssistanceTicket(formData: FormData) {
  const scopeType = text(formData, "scope_type");
  const unitId = optional(formData, "unit_id");
  const clientId = optional(formData, "client_id");
  const openedAt = text(formData, "opened_at");
  const category = text(formData, "category");
  const priority = text(formData, "priority");
  const title = text(formData, "title");
  const description = text(formData, "description");
  const locationDetail = optional(formData, "location_detail");

  if (!openedAt || !title || !description || !["unit", "common_area"].includes(scopeType) || !["low", "normal", "high", "urgent"].includes(priority)) {
    redirect(resultUrl("Preencha tipo, data, prioridade, título e descrição.", "error"));
  }
  if (scopeType === "unit" && !unitId) redirect(resultUrl("Selecione a unidade do chamado.", "error"));
  if (scopeType === "common_area" && !locationDetail) redirect(resultUrl("Informe o local da área comum.", "error"));

  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("postwork.assistance.manage");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento antes de abrir o chamado.", "error"));

  let saleId: string | null = null;
  if (unitId) {
    const unit = await supabase.from("units").select("id").eq("id", unitId).eq("company_id", companyId).eq("project_id", projectId).maybeSingle();
    if (!unit.data) redirect(resultUrl("A unidade não pertence ao empreendimento ativo.", "error"));
  }
  if (clientId) {
    const client = await supabase.from("clients").select("id").eq("id", clientId).eq("company_id", companyId).maybeSingle();
    if (!client.data) redirect(resultUrl("O cliente não pertence à empresa ativa.", "error"));
  }
  if (unitId) {
    let saleQuery = supabase.from("sales").select("id,client_id").eq("company_id", companyId).eq("project_id", projectId).eq("unit_id", unitId).eq("status", "active");
    if (clientId) saleQuery = saleQuery.eq("client_id", clientId);
    const sale = await saleQuery.order("sale_date", { ascending: false }).limit(1).maybeSingle();
    saleId = sale.data?.id ?? null;
  }

  const numberResult = await supabase.rpc("postwork_next_assistance_number", { p_company_id: companyId, p_project_id: projectId, p_opened_at: openedAt });
  if (numberResult.error || !numberResult.data) redirect(resultUrl(numberResult.error?.message || "Não foi possível numerar o chamado.", "error"));

  const slaHours: Record<string, number> = { urgent: 24, high: 72, normal: 168, low: 240 };
  const explicitSla = optional(formData, "sla_due_at");
  const slaDueAt = explicitSla || new Date(Date.now() + slaHours[priority] * 3600000).toISOString();
  const insert = await supabase.from("postwork_assistance_tickets").insert({
    company_id: companyId, project_id: projectId, unit_id: unitId, client_id: clientId, sale_id: saleId,
    number: String(numberResult.data), opened_at: openedAt, channel: text(formData, "channel") || "internal",
    scope_type: scopeType, category, priority, title, description, location_detail: locationDetail,
    warranty_claimed: checkbox(formData, "warranty_claimed"), warranty_status: checkbox(formData, "warranty_claimed") ? "pending" : "not_applicable",
    sla_due_at: slaDueAt, contact_name: optional(formData, "contact_name"), contact_phone: optional(formData, "contact_phone"),
    contact_email: optional(formData, "contact_email"), access_notes: optional(formData, "access_notes"),
    status: "open", created_by: userId, updated_by: userId,
  }).select("id").single();
  if (insert.error || !insert.data) redirect(resultUrl(insert.error?.message || "Não foi possível abrir o chamado.", "error"));

  await supabase.from("postwork_assistance_audit").insert({
    company_id: companyId, project_id: projectId, ticket_id: insert.data.id, action: "opened", new_status: "open",
    notes: description, details: { channel: text(formData, "channel") || "internal", priority, category }, changed_by: userId,
  });
  revalidate(insert.data.id);
  redirect(resultUrl(`Chamado ${numberResult.data} aberto.`, "success", insert.data.id));
}

export async function updateAssistanceTicket(formData: FormData) {
  const ticketId = text(formData, "ticket_id");
  const supplierCost = parseMoney(formData.get("supplier_cost"));
  const materialCost = parseMoney(formData.get("material_cost"));
  const customerCharge = parseMoney(formData.get("customer_charge"));
  if (!ticketId || [supplierCost, materialCost, customerCharge].some((value) => !Number.isFinite(value) || value < 0)) {
    redirect(resultUrl("Informe valores válidos.", "error", ticketId));
  }
  const { supabase, companyId, userId } = await requireCompanyPermission("postwork.assistance.manage");
  const current = await supabase.from("postwork_assistance_tickets").select("id,status").eq("id", ticketId).eq("company_id", companyId).maybeSingle();
  if (!current.data) redirect(resultUrl("Chamado não encontrado.", "error"));
  const result = await supabase.from("postwork_assistance_tickets").update({
    priority: text(formData, "priority"), category: text(formData, "category"), title: text(formData, "title"),
    description: text(formData, "description"), location_detail: optional(formData, "location_detail"),
    sla_due_at: optional(formData, "sla_due_at"), responsible_name: optional(formData, "responsible_name"),
    supplier_id: optional(formData, "supplier_id"), contact_name: optional(formData, "contact_name"),
    contact_phone: optional(formData, "contact_phone"), contact_email: optional(formData, "contact_email"),
    access_notes: optional(formData, "access_notes"), supplier_cost: supplierCost, material_cost: materialCost,
    customer_charge: customerCharge, updated_by: userId, updated_at: new Date().toISOString(),
  }).eq("id", ticketId).eq("company_id", companyId);
  if (result.error) redirect(resultUrl(result.error.message, "error", ticketId));
  revalidate(ticketId);
  redirect(resultUrl("Dados do chamado atualizados.", "success", ticketId));
}

export async function setAssistanceStatus(formData: FormData) {
  const ticketId = text(formData, "ticket_id");
  const status = text(formData, "status");
  const { supabase, companyId, userId } = await requireCompanyPermission(
    ["open", "triage", "awaiting_supplier"].includes(status) ? "postwork.assistance.manage" :
      status === "inspection_scheduled" ? "postwork.assistance.inspect" :
        ["approved", "in_progress", "awaiting_acceptance"].includes(status) ? "postwork.assistance.execute" : "postwork.assistance.close",
  );
  const result = await supabase.rpc("postwork_set_assistance_status", {
    p_company_id: companyId, p_ticket_id: ticketId, p_status: status, p_notes: optional(formData, "notes"),
    p_warranty_status: optional(formData, "warranty_status"), p_warranty_reason: optional(formData, "warranty_reason"), p_user_id: userId,
  });
  if (result.error) redirect(resultUrl(result.error.message, "error", ticketId));
  revalidate(ticketId);
  redirect(resultUrl("Etapa do chamado atualizada.", "success", ticketId));
}

export async function scheduleAssistanceVisit(formData: FormData) {
  const ticketId = text(formData, "ticket_id");
  const scheduledAt = text(formData, "scheduled_at");
  if (!ticketId || !scheduledAt) redirect(resultUrl("Informe a data e hora da visita.", "error", ticketId));
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("postwork.assistance.inspect");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", ticketId));
  const ticket = await supabase.from("postwork_assistance_tickets").select("id,status").eq("id", ticketId).eq("company_id", companyId).eq("project_id", projectId).maybeSingle();
  if (!ticket.data || ["resolved", "rejected", "cancelled"].includes(ticket.data.status)) redirect(resultUrl("Chamado indisponível para agendamento.", "error", ticketId));
  const visit = await supabase.from("postwork_assistance_visits").insert({
    company_id: companyId, project_id: projectId, ticket_id: ticketId, visit_type: text(formData, "visit_type") || "inspection",
    scheduled_at: scheduledAt, technician_name: optional(formData, "technician_name"), supplier_id: optional(formData, "supplier_id"),
    notes: optional(formData, "notes"), created_by: userId,
  }).select("id").single();
  if (visit.error || !visit.data) redirect(resultUrl(visit.error?.message || "Não foi possível agendar a visita.", "error", ticketId));
  const update = await supabase.from("postwork_assistance_tickets").update({ status: "inspection_scheduled", scheduled_at: scheduledAt, supplier_id: optional(formData, "supplier_id"), updated_by: userId, updated_at: new Date().toISOString() }).eq("id", ticketId);
  if (update.error) {
    await supabase.from("postwork_assistance_visits").delete().eq("id", visit.data.id);
    redirect(resultUrl(update.error.message, "error", ticketId));
  }
  await supabase.from("postwork_assistance_audit").insert({ company_id: companyId, project_id: projectId, ticket_id: ticketId, action: "visit_scheduled", previous_status: ticket.data.status, new_status: "inspection_scheduled", notes: optional(formData, "notes"), details: { visit_id: visit.data.id, scheduled_at: scheduledAt, visit_type: text(formData, "visit_type") || "inspection" }, changed_by: userId });
  revalidate(ticketId);
  redirect(resultUrl("Visita técnica agendada.", "success", ticketId));
}

export async function completeAssistanceVisit(formData: FormData) {
  const ticketId = text(formData, "ticket_id");
  const visitId = text(formData, "visit_id");
  const outcome = text(formData, "outcome") || "completed";
  if (!ticketId || !visitId || !["completed", "no_access", "cancelled"].includes(outcome)) redirect(resultUrl("Visita inválida.", "error", ticketId));
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("postwork.assistance.inspect");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", ticketId));
  const visit = await supabase.from("postwork_assistance_visits").select("id,visit_type,status").eq("id", visitId).eq("ticket_id", ticketId).eq("company_id", companyId).maybeSingle();
  if (!visit.data || !["scheduled", "confirmed", "rescheduled"].includes(visit.data.status)) redirect(resultUrl("A visita não está disponível para conclusão.", "error", ticketId));
  const result = await supabase.from("postwork_assistance_visits").update({
    status: outcome, started_at: optional(formData, "started_at"), finished_at: optional(formData, "finished_at") || new Date().toISOString(),
    diagnosis: optional(formData, "diagnosis"), service_performed: optional(formData, "service_performed"),
    materials_used: optional(formData, "materials_used"), requires_return: checkbox(formData, "requires_return"),
    return_recommendation: optional(formData, "return_recommendation"), notes: optional(formData, "notes"),
    completed_by: userId, updated_at: new Date().toISOString(),
  }).eq("id", visitId);
  if (result.error) redirect(resultUrl(result.error.message, "error", ticketId));
  const nextStatus = outcome === "completed" ? (visit.data.visit_type === "execution" && !checkbox(formData, "requires_return") ? "awaiting_acceptance" : "triage") : "triage";
  await supabase.from("postwork_assistance_tickets").update({
    status: nextStatus, scheduled_at: null,
    diagnosis: optional(formData, "diagnosis"), execution_notes: optional(formData, "service_performed"),
    updated_by: userId, updated_at: new Date().toISOString(),
  }).eq("id", ticketId).eq("company_id", companyId);
  await supabase.from("postwork_assistance_audit").insert({ company_id: companyId, project_id: projectId, ticket_id: ticketId, action: `visit_${outcome}`, new_status: nextStatus, notes: optional(formData, "notes"), details: { visit_id: visitId, visit_type: visit.data.visit_type, diagnosis: optional(formData, "diagnosis"), service_performed: optional(formData, "service_performed"), requires_return: checkbox(formData, "requires_return") }, changed_by: userId });
  revalidate(ticketId);
  redirect(resultUrl(outcome === "completed" ? "Visita concluída e registrada." : "Resultado da visita registrado.", "success", ticketId));
}

export async function acceptAssistanceResolution(formData: FormData) {
  const ticketId = text(formData, "ticket_id");
  const acceptedByName = text(formData, "accepted_by_name");
  const rating = Number.parseInt(text(formData, "customer_rating"), 10);
  const notes = text(formData, "notes");
  if (!ticketId || !acceptedByName || !Number.isFinite(rating) || rating < 1 || rating > 5 || !notes) redirect(resultUrl("Informe responsável pelo aceite, nota e solução.", "error", ticketId));
  const { supabase, companyId, userId } = await requireCompanyPermission("postwork.assistance.close");
  const statusResult = await supabase.rpc("postwork_set_assistance_status", { p_company_id: companyId, p_ticket_id: ticketId, p_status: "resolved", p_notes: notes, p_warranty_status: null, p_warranty_reason: null, p_user_id: userId });
  if (statusResult.error) redirect(resultUrl(statusResult.error.message, "error", ticketId));
  const update = await supabase.from("postwork_assistance_tickets").update({ accepted_by_name: acceptedByName, customer_rating: rating, accepted_at: new Date().toISOString(), updated_by: userId, updated_at: new Date().toISOString() }).eq("id", ticketId).eq("company_id", companyId);
  if (update.error) redirect(resultUrl(update.error.message, "error", ticketId));
  revalidate(ticketId);
  redirect(resultUrl("Assistência aceita e encerrada.", "success", ticketId));
}

export async function addAssistanceNote(formData: FormData) {
  const ticketId = text(formData, "ticket_id");
  const notes = text(formData, "notes");
  if (!ticketId || !notes) redirect(resultUrl("Escreva a observação.", "error", ticketId));
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("postwork.assistance.manage");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", ticketId));
  const result = await supabase.from("postwork_assistance_audit").insert({ company_id: companyId, project_id: projectId, ticket_id: ticketId, action: "note", notes, changed_by: userId });
  if (result.error) redirect(resultUrl(result.error.message, "error", ticketId));
  revalidate(ticketId);
  redirect(resultUrl("Observação adicionada ao histórico.", "success", ticketId));
}

export async function uploadAssistanceDocuments(formData: FormData) {
  const ticketId = text(formData, "ticket_id");
  const documentType = text(formData, "document_type") || "evidence";
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("postwork.assistance.inspect");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", ticketId));
  const files = formData.getAll("documents");
  let uploaded = 0;
  for (const value of files) {
    if (!(value instanceof File) || value.size <= 0) continue;
    if (value.size > 25 * 1024 * 1024) redirect(resultUrl(`${value.name} excede 25 MB.`, "error", ticketId));
    const allowed = value.type === "application/pdf" || value.type.startsWith("image/") || value.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (!allowed) redirect(resultUrl(`${value.name} não possui formato aceito.`, "error", ticketId));
    const path = `${companyId}/${projectId}/${ticketId}/${crypto.randomUUID()}-${safeName(value.name)}`;
    const upload = await supabase.storage.from("postwork-assistance").upload(path, new Uint8Array(await value.arrayBuffer()), { contentType: value.type, upsert: false });
    if (upload.error) redirect(resultUrl(upload.error.message, "error", ticketId));
    const insert = await supabase.from("postwork_assistance_documents").insert({ company_id: companyId, project_id: projectId, ticket_id: ticketId, document_type: documentType, storage_path: path, file_name: value.name, mime_type: value.type, file_size: value.size, caption: optional(formData, "caption"), uploaded_by: userId });
    if (insert.error) {
      await supabase.storage.from("postwork-assistance").remove([path]);
      redirect(resultUrl(insert.error.message, "error", ticketId));
    }
    uploaded += 1;
  }
  revalidate(ticketId);
  redirect(resultUrl(`${uploaded} arquivo(s) anexado(s).`, "success", ticketId));
}

export async function removeAssistanceDocument(formData: FormData) {
  const ticketId = text(formData, "ticket_id");
  const documentId = text(formData, "document_id");
  const { supabase, companyId } = await requireCompanyPermission("postwork.assistance.manage");
  const document = await supabase.from("postwork_assistance_documents").select("storage_path").eq("id", documentId).eq("ticket_id", ticketId).eq("company_id", companyId).maybeSingle();
  if (!document.data) redirect(resultUrl("Arquivo não encontrado.", "error", ticketId));
  const deletion = await supabase.from("postwork_assistance_documents").delete().eq("id", documentId);
  if (deletion.error) redirect(resultUrl(deletion.error.message, "error", ticketId));
  await supabase.storage.from("postwork-assistance").remove([document.data.storage_path]);
  revalidate(ticketId);
  redirect(resultUrl("Arquivo removido.", "success", ticketId));
}
