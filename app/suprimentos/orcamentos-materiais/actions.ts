"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/suprimentos/orcamentos-materiais";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function numberValue(formData: FormData, key: string, fallback = 0) { const value = Number(text(formData, key).replace(",", ".")); return Number.isFinite(value) ? value : fallback; }
function integerValue(formData: FormData, key: string) { const value = Number.parseInt(text(formData, key), 10); return Number.isFinite(value) ? value : null; }
function jsonArray(formData: FormData, key: string) { try { const value = JSON.parse(text(formData, key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } }
function safeName(name: string) {
  const extension = name.includes(".") ? `.${name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  const stem = name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "documento";
  return `${stem}${extension}`;
}
function resultUrl(message: string, type: "success" | "error", quotation?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (quotation) params.set("quotation", quotation);
  return `${PATH}?${params.toString()}`;
}
function refresh() {
  revalidatePath(PATH);
  revalidatePath("/execucao/solicitacoes-materiais");
  revalidatePath("/dashboard");
}

export async function saveMaterialQuotation(formData: FormData) {
  const quotationId = optional(formData, "quotation_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.quotations.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra antes de criar a cotação.", "error"));
  const items = jsonArray(formData, "items_json");
  const suppliers = jsonArray(formData, "suppliers_json");
  const { data, error } = await supabase.rpc("save_procurement_material_quotation", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_quotation_id: quotationId,
    p_title: text(formData, "title"),
    p_award_mode: text(formData, "award_mode") || "item",
    p_response_deadline: optional(formData, "response_deadline"),
    p_desired_delivery_date: optional(formData, "desired_delivery_date"),
    p_payment_terms: optional(formData, "payment_terms"),
    p_delivery_address: optional(formData, "delivery_address"),
    p_notes: optional(formData, "notes"),
    p_items: items,
    p_suppliers: suppliers,
  });
  if (error || !data) redirect(resultUrl(error?.message ?? "Não foi possível salvar a cotação.", "error", quotationId ?? undefined));
  refresh();
  redirect(resultUrl(quotationId ? "Cotação atualizada." : "Cotação criada em elaboração.", "success", String(data)));
}

export async function openMaterialQuotation(formData: FormData) {
  const quotationId = text(formData, "quotation_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.quotations.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("open_procurement_material_quotation", { p_company_id: companyId, p_project_id: projectId, p_quotation_id: quotationId });
  if (error) redirect(resultUrl(error.message, "error", quotationId));
  refresh();
  redirect(resultUrl("Cotação aberta para recebimento das propostas.", "success", quotationId));
}

export async function saveMaterialSupplierOffer(formData: FormData) {
  const quotationId = text(formData, "quotation_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.quotations.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("save_procurement_material_supplier_offer", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_quotation_id: quotationId,
    p_supplier_id: text(formData, "supplier_id"),
    p_proposal_number: optional(formData, "proposal_number"),
    p_proposal_date: optional(formData, "proposal_date"),
    p_validity_date: optional(formData, "validity_date"),
    p_payment_terms: optional(formData, "payment_terms"),
    p_delivery_days: integerValue(formData, "delivery_days"),
    p_freight_terms: optional(formData, "freight_terms"),
    p_warranty_terms: optional(formData, "warranty_terms"),
    p_notes: optional(formData, "notes"),
    p_items: jsonArray(formData, "items_json"),
  });
  if (error) redirect(resultUrl(error.message, "error", quotationId));
  refresh();
  redirect(resultUrl("Proposta registrada e mapa comparativo atualizado.", "success", quotationId));
}

export async function startMaterialQuotationAnalysis(formData: FormData) {
  const quotationId = text(formData, "quotation_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.quotations.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("start_procurement_material_quotation_analysis", { p_company_id: companyId, p_project_id: projectId, p_quotation_id: quotationId });
  if (error) redirect(resultUrl(error.message, "error", quotationId));
  refresh();
  redirect(resultUrl("Recebimento encerrado. Cotação enviada para análise.", "success", quotationId));
}

export async function approveMaterialQuotation(formData: FormData) {
  const quotationId = text(formData, "quotation_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.quotations.approve");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("approve_procurement_material_quotation", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_quotation_id: quotationId,
    p_approval_notes: optional(formData, "approval_notes"),
    p_awards: jsonArray(formData, "awards_json"),
  });
  if (error) redirect(resultUrl(error.message, "error", quotationId));
  refresh();
  redirect(resultUrl("Cotação aprovada. Vencedores liberados para o Pedido de Compra.", "success", quotationId));
}

export async function cancelMaterialQuotation(formData: FormData) {
  const quotationId = text(formData, "quotation_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.quotations.cancel");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("cancel_procurement_material_quotation", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_quotation_id: quotationId,
    p_reason: text(formData, "reason"),
  });
  if (error) redirect(resultUrl(error.message, "error", quotationId));
  refresh();
  redirect(resultUrl("Cotação cancelada com rastreabilidade.", "success", quotationId));
}

export async function uploadMaterialQuotationDocuments(formData: FormData) {
  const quotationId = text(formData, "quotation_id");
  const supplierId = optional(formData, "supplier_id");
  const documentType = text(formData, "document_type") || "other";
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("procurement.quotations.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  let uploaded = 0;
  for (const value of formData.getAll("documents")) {
    if (!(value instanceof File) || value.size <= 0) continue;
    if (value.size > 25 * 1024 * 1024) redirect(resultUrl(`${value.name} excede 25 MB.`, "error", quotationId));
    const allowed = value.type === "application/pdf" || value.type.startsWith("image/") || value.type.includes("spreadsheet") || value.type.includes("wordprocessingml");
    if (!allowed) redirect(resultUrl(`${value.name} não possui formato aceito.`, "error", quotationId));
    const path = `${companyId}/${projectId}/${quotationId}/${crypto.randomUUID()}-${safeName(value.name)}`;
    const storage = await supabase.storage.from("material-quotation-documents").upload(path, new Uint8Array(await value.arrayBuffer()), { contentType: value.type, upsert: false });
    if (storage.error) redirect(resultUrl(storage.error.message, "error", quotationId));
    const insert = await supabase.from("procurement_material_quotation_documents").insert({ company_id: companyId, project_id: projectId, quotation_id: quotationId, supplier_id: supplierId, document_type: documentType, storage_path: path, file_name: value.name, mime_type: value.type, file_size: value.size, caption: optional(formData, "caption"), uploaded_by: userId });
    if (insert.error) { await supabase.storage.from("material-quotation-documents").remove([path]); redirect(resultUrl(insert.error.message, "error", quotationId)); }
    uploaded += 1;
  }
  refresh();
  redirect(resultUrl(`${uploaded} documento(s) anexado(s).`, "success", quotationId));
}

export async function removeMaterialQuotationDocument(formData: FormData) {
  const quotationId = text(formData, "quotation_id");
  const documentId = text(formData, "document_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("procurement.quotations.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));
  const { data: document } = await supabase.from("procurement_material_quotation_documents").select("storage_path").eq("id", documentId).eq("company_id", companyId).eq("project_id", projectId).eq("quotation_id", quotationId).maybeSingle();
  if (!document) redirect(resultUrl("Documento não encontrado.", "error", quotationId));
  const deletion = await supabase.from("procurement_material_quotation_documents").delete().eq("id", documentId);
  if (deletion.error) redirect(resultUrl(deletion.error.message, "error", quotationId));
  await supabase.storage.from("material-quotation-documents").remove([document.storage_path]);
  refresh();
  redirect(resultUrl("Documento removido.", "success", quotationId));
}
