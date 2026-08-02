"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/execucao/contratacoes-servicos";
const CONTRACTS = "/execucao/contratos-servicos";
const MEASUREMENTS = "/execucao/medicoes-por-etapas";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function numeric(formData: FormData, key: string, fallback = 0) {
  const raw = text(formData, key).replace(/\s/g, "");
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : fallback;
}
function integer(formData: FormData, key: string, fallback = 0) { return Math.trunc(numeric(formData, key, fallback)); }
function jsonArray(formData: FormData, key: string) {
  try { const value = JSON.parse(text(formData, key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
}
function target(message: string, type: "success" | "error", extra: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams({ [type]: message });
  Object.entries(extra).forEach(([key, value]) => { if (value) params.set(key, value); });
  return `${PATH}?${params.toString()}`;
}
function refresh() {
  revalidatePath(PATH);
  revalidatePath(CONTRACTS);
  revalidatePath(MEASUREMENTS);
  revalidatePath("/execucao/medicoes-contratos");
}

export async function saveServiceRequest(formData: FormData) {
  const requestId = optional(formData, "request_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contract_procurement.manage");
  if (!projectId) redirect(target("Selecione uma obra.", "error"));
  const { data, error } = await supabase.rpc("save_execution_service_request", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_request_id: requestId,
    p_budget_id: optional(formData, "budget_id"),
    p_title: text(formData, "title"),
    p_scope_summary: text(formData, "scope_summary"),
    p_needed_start: optional(formData, "needed_start"),
    p_needed_finish: optional(formData, "needed_finish"),
    p_notes: optional(formData, "notes"),
    p_items: jsonArray(formData, "items_json"),
  });
  if (error || !data) redirect(target(error?.message ?? "Não foi possível salvar a solicitação.", "error", { view: "requests", request: requestId ?? undefined }));
  refresh();
  redirect(target(requestId ? "Solicitação atualizada." : "Solicitação de serviços criada.", "success", { view: "requests", request: String(data) }));
}

async function changeRequest(formData: FormData, action: "submit" | "approve" | "cancel", permission: string, success: string) {
  const { supabase, companyId, projectId } = await requireCompanyPermission(permission);
  if (!projectId) redirect(target("Selecione uma obra.", "error"));
  const requestId = text(formData, "request_id");
  const { error } = await supabase.rpc("change_execution_service_request_status", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_request_id: requestId,
    p_action: action,
    p_notes: optional(formData, "notes"),
  });
  if (error) redirect(target(error.message, "error", { view: "requests", request: requestId }));
  refresh();
  redirect(target(success, "success", { view: "requests", request: requestId }));
}

export async function submitServiceRequest(formData: FormData) { return changeRequest(formData, "submit", "execution.contract_procurement.manage", "Solicitação enviada para aprovação."); }
export async function approveServiceRequest(formData: FormData) { return changeRequest(formData, "approve", "execution.contract_procurement.approve", "Solicitação aprovada e liberada para concorrência."); }
export async function cancelServiceRequest(formData: FormData) { return changeRequest(formData, "cancel", "execution.contract_procurement.approve", "Solicitação cancelada."); }

export async function startServiceCompetition(formData: FormData) {
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contract_procurement.manage");
  if (!projectId) redirect(target("Selecione uma obra.", "error"));
  const requestId = text(formData, "request_id");
  const { data, error } = await supabase.rpc("start_execution_service_competition", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_request_id: requestId,
    p_response_deadline: optional(formData, "response_deadline"),
    p_award_criteria: optional(formData, "award_criteria"),
    p_notes: optional(formData, "notes"),
  });
  if (error || !data) redirect(target(error?.message ?? "Não foi possível abrir o mapa.", "error", { view: "requests", request: requestId }));
  refresh();
  redirect(target("Mapa de concorrência aberto.", "success", { view: "competitions", competition: String(data) }));
}

export async function saveServiceCompetitionOffer(formData: FormData) {
  const competitionId = text(formData, "competition_id");
  const offerId = optional(formData, "offer_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contract_procurement.manage");
  if (!projectId) redirect(target("Selecione uma obra.", "error"));
  const { data, error } = await supabase.rpc("save_execution_service_competition_offer", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_competition_id: competitionId,
    p_offer_id: offerId,
    p_supplier_id: optional(formData, "supplier_id"),
    p_proposal_number: optional(formData, "proposal_number"),
    p_proposal_date: optional(formData, "proposal_date"),
    p_validity_date: optional(formData, "validity_date"),
    p_payment_days: integer(formData, "payment_days", 15),
    p_proposed_start: optional(formData, "proposed_start"),
    p_proposed_finish: optional(formData, "proposed_finish"),
    p_technical_score: optional(formData, "technical_score") ? numeric(formData, "technical_score") : null,
    p_commercial_score: optional(formData, "commercial_score") ? numeric(formData, "commercial_score") : null,
    p_notes: optional(formData, "notes"),
    p_items: jsonArray(formData, "items_json"),
  });
  if (error || !data) redirect(target(error?.message ?? "Não foi possível salvar a proposta.", "error", { view: "competitions", competition: competitionId }));
  refresh();
  redirect(target(offerId ? "Proposta atualizada." : "Proposta incluída no mapa.", "success", { view: "competitions", competition: competitionId }));
}

export async function approveServiceCompetition(formData: FormData) {
  const competitionId = text(formData, "competition_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contract_procurement.approve");
  if (!projectId) redirect(target("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("approve_execution_service_competition", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_competition_id: competitionId,
    p_winner_offer_id: optional(formData, "winner_offer_id"),
    p_notes: optional(formData, "approval_notes"),
  });
  if (error) redirect(target(error.message, "error", { view: "competitions", competition: competitionId }));
  refresh();
  redirect(target("Mapa aprovado e fornecedor vencedor definido.", "success", { view: "competitions", competition: competitionId }));
}

export async function generateContractFromCompetition(formData: FormData) {
  const competitionId = text(formData, "competition_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contract_procurement.contract");
  if (!projectId) redirect(target("Selecione uma obra.", "error"));
  const { data, error } = await supabase.rpc("generate_execution_service_contract_from_competition", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_competition_id: competitionId,
    p_title: text(formData, "title"),
    p_scope_summary: text(formData, "scope_summary"),
    p_start_date: optional(formData, "start_date"),
    p_end_date: optional(formData, "end_date"),
    p_signed_date: optional(formData, "signed_date"),
    p_retention_percent: numeric(formData, "retention_percent"),
    p_guarantee_percent: numeric(formData, "guarantee_percent"),
    p_guarantee_months: integer(formData, "guarantee_months", 60),
    p_payment_days: integer(formData, "payment_days", 15),
    p_adjustment_index: optional(formData, "adjustment_index"),
    p_adjustment_base_date: optional(formData, "adjustment_base_date"),
    p_contact_name: optional(formData, "contact_name"),
    p_contact_phone: optional(formData, "contact_phone"),
    p_contact_email: optional(formData, "contact_email"),
    p_notes: optional(formData, "notes"),
    p_stages: jsonArray(formData, "stages_json"),
  });
  if (error || !data) redirect(target(error?.message ?? "Não foi possível gerar o contrato.", "error", { view: "competitions", competition: competitionId }));
  refresh();
  redirect(`${CONTRACTS}?contract=${data}&success=${encodeURIComponent("Contrato gerado a partir do mapa aprovado. Revise e ative após conferir as etapas.")}`);
}

export async function saveContractStages(formData: FormData) {
  const contractId = text(formData, "contract_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contract_procurement.contract");
  if (!projectId) redirect(target("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("save_execution_service_contract_stages", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_contract_id: contractId,
    p_stages: jsonArray(formData, "stages_json"),
  });
  if (error) redirect(target(error.message, "error", { view: "contracts", contract: contractId }));
  refresh();
  redirect(target("Etapas de medição atualizadas e fechadas em 100%.", "success", { view: "contracts", contract: contractId }));
}
