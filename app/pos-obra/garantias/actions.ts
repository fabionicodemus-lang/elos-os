"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/pos-obra/garantias";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function integer(formData: FormData, key: string, fallback = 0) {
  const value = Number.parseInt(text(formData, key), 10);
  return Number.isFinite(value) ? value : fallback;
}
function money(formData: FormData, key: string) {
  const raw = text(formData, key).replace(/\s/g, "");
  if (!raw) return 0;
  const value = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  return Number.isFinite(value) ? value : Number.NaN;
}
function resultUrl(message: string, type: "success" | "error", params?: Record<string, string | null | undefined>) {
  const query = new URLSearchParams({ [type]: message });
  Object.entries(params ?? {}).forEach(([key, value]) => { if (value) query.set(key, value); });
  return `${PATH}?${query.toString()}`;
}
function safeName(name: string) {
  const extension = name.includes(".") ? `.${name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  const stem = name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "documento";
  return `${stem}${extension}`;
}
function refresh() {
  revalidatePath(PATH);
  revalidatePath("/pos-obra/assistencias");
}

export async function saveWarrantyPolicy(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.warranties.manage");
  const useAllProjects = formData.get("use_all_projects") === "on";
  const { data, error } = await supabase.rpc("save_postwork_warranty_policy", {
    p_company_id: companyId,
    p_project_id: useAllProjects ? null : projectId,
    p_policy_id: optional(formData, "policy_id"),
    p_code: text(formData, "code"),
    p_name: text(formData, "name"),
    p_scope_type: text(formData, "scope_type") || "system",
    p_category: text(formData, "category") || "other",
    p_start_rule: text(formData, "start_rule") || "custom",
    p_term_months: integer(formData, "term_months"),
    p_alert_days: integer(formData, "alert_days", 60),
    p_supplier_id: optional(formData, "supplier_id"),
    p_manufacturer: optional(formData, "manufacturer"),
    p_coverage_terms: text(formData, "coverage_terms"),
    p_exclusions: optional(formData, "exclusions"),
    p_maintenance_requirements: optional(formData, "maintenance_requirements"),
    p_status: text(formData, "status") || "active",
  });
  if (error || !data) redirect(resultUrl(error?.message ?? "Não foi possível salvar a regra de garantia.", "error"));
  refresh();
  redirect(resultUrl("Regra de garantia salva.", "success", { policy: String(data) }));
}

export async function createWarrantyAsset(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.warranties.manage");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error"));
  const { data, error } = await supabase.rpc("create_postwork_warranty_asset", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_policy_id: optional(formData, "policy_id"),
    p_unit_id: optional(formData, "unit_id"),
    p_supplier_id: optional(formData, "supplier_id"),
    p_item_name: text(formData, "item_name"),
    p_location_detail: optional(formData, "location_detail"),
    p_brand: optional(formData, "brand"),
    p_model: optional(formData, "model"),
    p_serial_number: optional(formData, "serial_number"),
    p_invoice_number: optional(formData, "invoice_number"),
    p_purchase_date: optional(formData, "purchase_date"),
    p_installation_date: optional(formData, "installation_date"),
    p_start_date: optional(formData, "start_date"),
    p_notes: optional(formData, "notes"),
  });
  if (error || !data) redirect(resultUrl(error?.message ?? "Não foi possível ativar a garantia.", "error"));
  refresh();
  redirect(resultUrl("Item garantido cadastrado e vigência calculada.", "success", { asset: String(data) }));
}

export async function cancelWarrantyAsset(formData: FormData) {
  const assetId = text(formData, "asset_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.warranties.manage");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", { asset: assetId }));
  const { error } = await supabase.rpc("cancel_postwork_warranty_asset", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_asset_id: assetId,
    p_reason: text(formData, "reason"),
  });
  if (error) redirect(resultUrl(error.message, "error", { asset: assetId }));
  refresh();
  redirect(resultUrl("Item de garantia cancelado com justificativa.", "success", { asset: assetId }));
}

export async function scheduleWarrantyMaintenance(formData: FormData) {
  const assetId = text(formData, "asset_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.warranties.maintenance");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", { asset: assetId }));
  const { error } = await supabase.rpc("schedule_postwork_warranty_maintenance", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_asset_id: assetId,
    p_supplier_id: optional(formData, "supplier_id"),
    p_title: text(formData, "title"),
    p_due_date: optional(formData, "due_date"),
  });
  if (error) redirect(resultUrl(error.message, "error", { asset: assetId }));
  refresh();
  redirect(resultUrl("Manutenção incluída na agenda da garantia.", "success", { asset: assetId }));
}

export async function completeWarrantyMaintenance(formData: FormData) {
  const assetId = text(formData, "asset_id");
  const cost = money(formData, "cost");
  if (!Number.isFinite(cost)) redirect(resultUrl("Informe um custo válido.", "error", { asset: assetId }));
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.warranties.maintenance");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", { asset: assetId }));
  const { error } = await supabase.rpc("complete_postwork_warranty_maintenance", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_maintenance_id: text(formData, "maintenance_id"),
    p_notes: text(formData, "completion_notes"),
    p_cost: cost,
  });
  if (error) redirect(resultUrl(error.message, "error", { asset: assetId }));
  refresh();
  redirect(resultUrl("Manutenção concluída e registrada no histórico.", "success", { asset: assetId }));
}

export async function analyzeAssistanceWarranty(formData: FormData) {
  const ticketId = text(formData, "ticket_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.warranties.analyze");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", { ticket: ticketId }));
  const { data, error } = await supabase.rpc("analyze_postwork_assistance_warranty", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_ticket_id: ticketId,
    p_policy_id: optional(formData, "policy_id"),
    p_asset_id: optional(formData, "asset_id"),
    p_status: text(formData, "warranty_status"),
    p_reason: optional(formData, "warranty_reason"),
  });
  if (error) redirect(resultUrl(error.message, "error", { ticket: ticketId }));
  refresh();
  const labels: Record<string, string> = { covered: "Cobertura confirmada.", not_covered: "Chamado classificado como não coberto.", courtesy: "Atendimento registrado como cortesia.", not_applicable: "Garantia marcada como não aplicável.", pending: "Análise mantida como pendente." };
  redirect(resultUrl(labels[String(data)] ?? "Análise de garantia registrada.", "success", { ticket: ticketId }));
}

export async function uploadWarrantyDocuments(formData: FormData) {
  const policyId = optional(formData, "policy_id");
  const assetId = optional(formData, "asset_id");
  const maintenanceId = optional(formData, "maintenance_id");
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("postwork.warranties.manage");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error"));
  if (!policyId && !assetId) redirect(resultUrl("Selecione a regra ou o item de garantia.", "error"));

  if (policyId) {
    const policy = await supabase.from("postwork_warranty_policies").select("id").eq("id", policyId).eq("company_id", companyId).maybeSingle();
    if (!policy.data) redirect(resultUrl("Regra de garantia não localizada.", "error"));
  }
  if (assetId) {
    const asset = await supabase.from("postwork_warranty_assets").select("id").eq("id", assetId).eq("company_id", companyId).eq("project_id", projectId).maybeSingle();
    if (!asset.data) redirect(resultUrl("Item garantido não localizado.", "error"));
  }

  let uploaded = 0;
  for (const value of formData.getAll("documents")) {
    if (!(value instanceof File) || value.size <= 0) continue;
    if (value.size > 25 * 1024 * 1024) redirect(resultUrl(`${value.name} excede 25 MB.`, "error", { asset: assetId }));
    const allowed = value.type === "application/pdf" || value.type.startsWith("image/") || value.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || value.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (!allowed) redirect(resultUrl(`${value.name} não possui formato aceito.`, "error", { asset: assetId }));
    const ownerKey = assetId ?? policyId!;
    const path = `${companyId}/${projectId}/${ownerKey}/${crypto.randomUUID()}-${safeName(value.name)}`;
    const storage = await supabase.storage.from("postwork-warranties").upload(path, new Uint8Array(await value.arrayBuffer()), { contentType: value.type, upsert: false });
    if (storage.error) redirect(resultUrl(storage.error.message, "error", { asset: assetId }));
    const insert = await supabase.from("postwork_warranty_documents").insert({
      company_id: companyId,
      project_id: projectId,
      policy_id: policyId,
      asset_id: assetId,
      maintenance_id: maintenanceId,
      document_type: text(formData, "document_type") || "other",
      storage_path: path,
      file_name: value.name,
      mime_type: value.type,
      file_size: value.size,
      caption: optional(formData, "caption"),
      uploaded_by: userId,
    });
    if (insert.error) {
      await supabase.storage.from("postwork-warranties").remove([path]);
      redirect(resultUrl(insert.error.message, "error", { asset: assetId }));
    }
    uploaded += 1;
  }
  refresh();
  redirect(resultUrl(`${uploaded} documento(s) anexado(s).`, "success", { asset: assetId, policy: policyId }));
}

export async function removeWarrantyDocument(formData: FormData) {
  const documentId = text(formData, "document_id");
  const assetId = optional(formData, "asset_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("postwork.warranties.manage");
  if (!projectId) redirect(resultUrl("Selecione um empreendimento.", "error", { asset: assetId }));
  const { data } = await supabase.from("postwork_warranty_documents").select("storage_path").eq("id", documentId).eq("company_id", companyId).eq("project_id", projectId).maybeSingle();
  if (!data) redirect(resultUrl("Documento não localizado.", "error", { asset: assetId }));
  const deletion = await supabase.from("postwork_warranty_documents").delete().eq("id", documentId);
  if (deletion.error) redirect(resultUrl(deletion.error.message, "error", { asset: assetId }));
  await supabase.storage.from("postwork-warranties").remove([data.storage_path]);
  refresh();
  redirect(resultUrl("Documento removido.", "success", { asset: assetId }));
}
