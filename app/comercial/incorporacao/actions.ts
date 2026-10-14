"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const BASE = "/comercial/incorporacao";

function optional(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim() || null;
}

function money(value: FormDataEntryValue | null, fallback = Number.NaN) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) return fallback;
  const parsed = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function intValue(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function path(saleId: string, message: string, type: "error" | "success" = "success") {
  return `${BASE}/${saleId}?${new URLSearchParams({ [type]: message }).toString()}`;
}

async function saleContext(permission: string, saleId: string) {
  const ctx = await requireCompanyPermission(permission);
  const { data: sale } = await ctx.supabase
    .from("sales")
    .select("id,project_id,client_id,status")
    .eq("id", saleId)
    .eq("company_id", ctx.companyId)
    .maybeSingle();
  if (!sale) redirect(`${BASE}?error=${encodeURIComponent("Venda não encontrada no ambiente ativo.")}`);
  return { ...ctx, sale };
}

function refresh(saleId: string) {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/${saleId}`);
  revalidatePath(`/comercial/vendas/${saleId}`);
  revalidatePath("/comercial/planos-de-pagamento");
}

export async function saveSaleParty(formData: FormData) {
  const saleId = String(formData.get("sale_id") ?? "");
  const clientId = String(formData.get("client_id") ?? "");
  const role = String(formData.get("role") ?? "co_buyer");
  const ownership = money(formData.get("ownership_percent"), Number.NaN);
  const primary = String(formData.get("is_primary") ?? "") === "1";
  const allowed = ["buyer", "co_buyer", "spouse", "guarantor", "assignee", "representative", "other"];
  if (!saleId || !clientId || !allowed.includes(role) || (Number.isFinite(ownership) && (ownership < 0 || ownership > 100))) {
    redirect(path(saleId, "Dados do participante inválidos.", "error"));
  }
  const { supabase, companyId, userId } = await saleContext("commercial.incorporation.manage", saleId);
  const { error } = await supabase.rpc("commercial_save_sale_party", {
    p_company_id: companyId,
    p_sale_id: saleId,
    p_client_id: clientId,
    p_role: role,
    p_ownership_percent: Number.isFinite(ownership) ? ownership : null,
    p_is_primary: primary,
    p_joined_at: optional(formData, "joined_at"),
    p_notes: optional(formData, "notes"),
    p_user_id: userId,
  });
  if (error) redirect(path(saleId, error.message, "error"));
  refresh(saleId);
  redirect(path(saleId, "Participante contratual salvo."));
}

export async function saveContractDocument(formData: FormData) {
  const saleId = String(formData.get("sale_id") ?? "");
  const kind = String(formData.get("kind") ?? "purchase_agreement");
  const allowed = ["purchase_agreement", "addendum", "assignment", "renegotiation", "confession", "termination", "other"];
  if (!saleId || !allowed.includes(kind)) redirect(path(saleId, "Tipo de documento inválido.", "error"));
  const { supabase, companyId, userId, sale } = await saleContext("commercial.incorporation.manage", saleId);
  const status = String(formData.get("status") ?? "draft");
  const { error } = await supabase.from("commercial_sale_contracts").insert({
    company_id: companyId,
    project_id: sale.project_id,
    sale_id: saleId,
    kind,
    document_number: optional(formData, "document_number"),
    signed_at: optional(formData, "signed_at"),
    effective_date: optional(formData, "effective_date"),
    status: ["draft", "signed", "cancelled"].includes(status) ? status : "draft",
    document_url: optional(formData, "document_url"),
    notes: optional(formData, "notes"),
    created_by: userId,
  });
  if (error) redirect(path(saleId, error.message, "error"));
  refresh(saleId);
  redirect(path(saleId, "Documento contratual registrado."));
}

export async function saveConsideration(formData: FormData) {
  const saleId = String(formData.get("sale_id") ?? "");
  const kind = String(formData.get("kind") ?? "real_estate");
  const amount = money(formData.get("accepted_value"));
  const appraisal = money(formData.get("appraised_value"), Number.NaN);
  const description = String(formData.get("description") ?? "").trim();
  if (!saleId || !description || !["real_estate", "land", "vehicle", "service", "credit", "other"].includes(kind) || !Number.isFinite(amount) || amount <= 0) {
    redirect(path(saleId, "Preencha a permuta com descrição e valor válidos.", "error"));
  }
  const { supabase, companyId, userId, sale } = await saleContext("commercial.incorporation.manage", saleId);
  const { error } = await supabase.from("commercial_sale_considerations").insert({
    company_id: companyId,
    project_id: sale.project_id,
    sale_id: saleId,
    kind,
    description,
    asset_identifier: optional(formData, "asset_identifier"),
    appraised_value: Number.isFinite(appraisal) ? appraisal : null,
    accepted_value: amount,
    due_date: optional(formData, "due_date"),
    status: "planned",
    notes: optional(formData, "notes"),
    created_by: userId,
  });
  if (error) redirect(path(saleId, error.message, "error"));
  refresh(saleId);
  redirect(path(saleId, "Permuta/dação registrada na composição da venda."));
}

export async function changeConsiderationStatus(formData: FormData) {
  const saleId = String(formData.get("sale_id") ?? "");
  const id = String(formData.get("consideration_id") ?? "");
  const status = String(formData.get("status") ?? "planned");
  if (!id || !["planned", "received", "transferred", "cancelled"].includes(status)) {
    redirect(path(saleId, "Status inválido.", "error"));
  }
  const { supabase, companyId } = await saleContext("commercial.incorporation.manage", saleId);
  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "received") update.received_at = new Date().toISOString().slice(0, 10);
  if (status === "planned" || status === "cancelled") update.received_at = null;
  const { error } = await supabase.from("commercial_sale_considerations").update(update).eq("id", id).eq("sale_id", saleId).eq("company_id", companyId);
  if (error) redirect(path(saleId, error.message, "error"));
  refresh(saleId);
  redirect(path(saleId, "Situação da permuta atualizada."));
}

export async function saveAmendment(formData: FormData) {
  const saleId = String(formData.get("sale_id") ?? "");
  const kind = String(formData.get("kind") ?? "payment_plan");
  const reason = String(formData.get("reason") ?? "").trim();
  const impact = money(formData.get("financial_impact"), 0);
  if (!saleId || reason.length < 5 || !["payment_plan", "price", "index", "party", "assignment", "deadline", "other"].includes(kind)) {
    redirect(path(saleId, "Informe tipo e motivo do aditivo.", "error"));
  }
  const { supabase, companyId, userId, sale } = await saleContext("commercial.incorporation.manage", saleId);
  const { error } = await supabase.from("commercial_sale_amendments").insert({
    company_id: companyId,
    project_id: sale.project_id,
    sale_id: saleId,
    kind,
    effective_date: String(formData.get("effective_date") ?? new Date().toISOString().slice(0, 10)),
    reason,
    financial_impact: Number.isFinite(impact) ? impact : 0,
    status: "draft",
    notes: optional(formData, "notes"),
    created_by: userId,
  });
  if (error) redirect(path(saleId, error.message, "error"));
  refresh(saleId);
  redirect(path(saleId, "Aditivo preparado para aprovação."));
}

export async function changeAmendmentStatus(formData: FormData) {
  const saleId = String(formData.get("sale_id") ?? "");
  const id = String(formData.get("amendment_id") ?? "");
  const status = String(formData.get("status") ?? "approved");
  if (!id || !["approved", "executed", "cancelled"].includes(status)) {
    redirect(path(saleId, "Situação do aditivo inválida.", "error"));
  }
  const { supabase, companyId, userId } = await saleContext("commercial.incorporation.approve", saleId);
  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "approved" || status === "executed") {
    update.approved_by = userId;
    update.approved_at = new Date().toISOString();
  }
  if (status === "executed") {
    update.executed_by = userId;
    update.executed_at = new Date().toISOString();
  }
  const { error } = await supabase.from("commercial_sale_amendments").update(update).eq("id", id).eq("sale_id", saleId).eq("company_id", companyId);
  if (error) redirect(path(saleId, error.message, "error"));
  refresh(saleId);
  redirect(path(saleId, "Aditivo atualizado."));
}

export async function saveTransferProcess(formData: FormData) {
  const saleId = String(formData.get("sale_id") ?? "");
  const status = String(formData.get("status") ?? "not_started");
  const allowed = ["not_started", "documents_pending", "submitted", "approved", "contracting", "released", "failed", "cancelled"];
  if (!saleId || !allowed.includes(status)) redirect(path(saleId, "Status de repasse inválido.", "error"));
  const { supabase, companyId, userId, sale } = await saleContext("commercial.incorporation.finance", saleId);
  const requested = money(formData.get("requested_amount"), Number.NaN);
  const approved = money(formData.get("approved_amount"), Number.NaN);
  const released = money(formData.get("released_amount"), Number.NaN);
  const financingType = String(formData.get("financing_type") ?? "bank_financing");
  if (!["bank_financing", "consortium", "own_funds", "other"].includes(financingType)) {
    redirect(path(saleId, "Modalidade de repasse inválida.", "error"));
  }
  const { error } = await supabase.from("commercial_transfer_processes").upsert({
    company_id: companyId,
    project_id: sale.project_id,
    sale_id: saleId,
    bank_name: optional(formData, "bank_name"),
    financing_type: financingType,
    requested_amount: Number.isFinite(requested) ? requested : null,
    approved_amount: Number.isFinite(approved) ? approved : null,
    released_amount: Number.isFinite(released) ? released : null,
    expected_release_date: optional(formData, "expected_release_date"),
    released_at: status === "released" ? optional(formData, "released_at") ?? new Date().toISOString().slice(0, 10) : null,
    protocol: optional(formData, "protocol"),
    status,
    notes: optional(formData, "notes"),
    created_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "sale_id" });
  if (error) redirect(path(saleId, error.message, "error"));
  refresh(saleId);
  redirect(path(saleId, "Processo de repasse atualizado."));
}

export async function saveCollectionCase(formData: FormData) {
  const saleId = String(formData.get("sale_id") ?? "");
  const receivableId = optional(formData, "receivable_id");
  const stage = String(formData.get("stage") ?? "contact");
  const status = String(formData.get("status") ?? "open");
  const promised = money(formData.get("promised_amount"), Number.NaN);
  if (!saleId || !["contact", "notice", "agreement", "legal"].includes(stage) || !["open", "negotiating", "promise", "agreement", "legal", "closed", "cancelled"].includes(status)) {
    redirect(path(saleId, "Etapa ou status de cobrança inválido.", "error"));
  }
  const { supabase, companyId, userId, sale } = await saleContext("commercial.incorporation.finance", saleId);
  if (receivableId) {
    const { data } = await supabase.from("receivables").select("id").eq("id", receivableId).eq("sale_id", saleId).eq("company_id", companyId).maybeSingle();
    if (!data) redirect(path(saleId, "Parcela não pertence a esta venda.", "error"));
  }
  const { error } = await supabase.from("commercial_collection_cases").insert({
    company_id: companyId,
    project_id: sale.project_id,
    sale_id: saleId,
    receivable_id: receivableId,
    stage,
    status,
    last_contact_at: optional(formData, "last_contact_at"),
    promised_date: optional(formData, "promised_date"),
    promised_amount: Number.isFinite(promised) ? promised : null,
    assigned_to: userId,
    notes: optional(formData, "notes"),
    created_by: userId,
  });
  if (error) redirect(path(saleId, error.message, "error"));
  refresh(saleId);
  redirect(path(saleId, "Ocorrência de cobrança registrada."));
}

export async function prepareTermination(formData: FormData) {
  const saleId = String(formData.get("sale_id") ?? "");
  const retention = money(formData.get("retention_percent"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!saleId || !Number.isFinite(retention) || retention < 0 || retention > 100 || reason.length < 5) {
    redirect(path(saleId, "Informe retenção e motivo válidos.", "error"));
  }
  const { supabase, companyId, userId } = await saleContext("commercial.incorporation.manage", saleId);
  const { error } = await supabase.rpc("commercial_prepare_termination", {
    p_company_id: companyId,
    p_sale_id: saleId,
    p_retention_percent: retention,
    p_refund_due_date: optional(formData, "refund_due_date"),
    p_reason: reason,
    p_user_id: userId,
  });
  if (error) redirect(path(saleId, error.message, "error"));
  refresh(saleId);
  redirect(path(saleId, "Simulação de distrato preparada. Revise antes de executar."));
}

export async function executeTermination(formData: FormData) {
  const saleId = String(formData.get("sale_id") ?? "");
  const terminationId = String(formData.get("termination_id") ?? "");
  if (!saleId || !terminationId) redirect(path(saleId, "Distrato inválido.", "error"));
  const { supabase, companyId, userId } = await saleContext("commercial.incorporation.approve", saleId);
  const { error } = await supabase.rpc("commercial_execute_termination", {
    p_company_id: companyId,
    p_termination_id: terminationId,
    p_user_id: userId,
  });
  if (error) redirect(path(saleId, error.message, "error"));
  refresh(saleId);
  revalidatePath("/financeiro/contas-a-pagar");
  redirect(path(saleId, "Distrato executado. Unidade liberada e devolução financeira gerada quando aplicável."));
}

export async function savePriceTable(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const validFrom = String(formData.get("valid_from") ?? "");
  if (!projectId || !name || !validFrom) {
    redirect(`${BASE}/tabelas?error=${encodeURIComponent("Informe empreendimento, nome e vigência.")}`);
  }
  const { supabase, companyId, userId } = await requireCompanyPermission("commercial.incorporation.manage");
  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).eq("company_id", companyId).maybeSingle();
  if (!project) redirect(`${BASE}/tabelas?error=${encodeURIComponent("Empreendimento inválido.")}`);
  const version = Math.max(1, intValue(formData.get("version_no"), 1));
  const { error } = await supabase.from("commercial_price_tables").insert({
    company_id: companyId,
    project_id: projectId,
    name,
    version_no: version,
    valid_from: validFrom,
    valid_until: optional(formData, "valid_until"),
    status: "draft",
    default_correction_index_id: optional(formData, "correction_index_id"),
    notes: optional(formData, "notes"),
    created_by: userId,
  });
  if (error) redirect(`${BASE}/tabelas?error=${encodeURIComponent(error.message)}`);
  revalidatePath(`${BASE}/tabelas`);
  redirect(`${BASE}/tabelas?success=${encodeURIComponent("Tabela criada.")}`);
}

export async function savePriceItem(formData: FormData) {
  const tableId = String(formData.get("price_table_id") ?? "");
  const unitId = String(formData.get("unit_id") ?? "");
  const listPrice = money(formData.get("list_price"));
  if (!tableId || !unitId || !Number.isFinite(listPrice) || listPrice <= 0) {
    redirect(`${BASE}/tabelas?error=${encodeURIComponent("Unidade e preço são obrigatórios.")}`);
  }
  const { supabase, companyId, userId } = await requireCompanyPermission("commercial.incorporation.manage");
  const { data: table } = await supabase.from("commercial_price_tables").select("id,project_id,status").eq("id", tableId).eq("company_id", companyId).maybeSingle();
  if (!table || table.status === "archived") redirect(`${BASE}/tabelas?error=${encodeURIComponent("Tabela indisponível.")}`);
  const cash = money(formData.get("cash_price"), Number.NaN);
  const minimum = money(formData.get("minimum_price"), Number.NaN);
  if (Number.isFinite(minimum) && minimum > listPrice) {
    redirect(`${BASE}/tabelas?error=${encodeURIComponent("Preço mínimo não pode superar o preço de tabela.")}`);
  }
  const { error } = await supabase.from("commercial_price_table_items").upsert({
    company_id: companyId,
    project_id: table.project_id,
    price_table_id: tableId,
    unit_id: unitId,
    list_price: listPrice,
    cash_price: Number.isFinite(cash) ? cash : null,
    minimum_price: Number.isFinite(minimum) ? minimum : null,
    notes: optional(formData, "notes"),
    created_by: userId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "price_table_id,unit_id" });
  if (error) redirect(`${BASE}/tabelas?error=${encodeURIComponent(error.message)}`);
  revalidatePath(`${BASE}/tabelas`);
  redirect(`${BASE}/tabelas?success=${encodeURIComponent("Preço da unidade salvo.")}`);
}

export async function activatePriceTable(formData: FormData) {
  const tableId = String(formData.get("price_table_id") ?? "");
  const { supabase, companyId, userId } = await requireCompanyPermission("commercial.incorporation.manage");
  const { error } = await supabase.rpc("commercial_activate_price_table", {
    p_company_id: companyId,
    p_price_table_id: tableId,
    p_user_id: userId,
  });
  if (error) redirect(`${BASE}/tabelas?error=${encodeURIComponent(error.message)}`);
  revalidatePath(`${BASE}/tabelas`);
  revalidatePath("/comercial/propostas");
  revalidatePath("/empreendimentos/unidades");
  redirect(`${BASE}/tabelas?success=${encodeURIComponent("Tabela ativada e preços das unidades atualizados.")}`);
}
