"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/execucao/contratos-servicos/novo";

function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function numberValue(formData: FormData, key: string, fallback = 0) {
  const value = Number(text(formData, key).replace(",", "."));
  return Number.isFinite(value) ? value : fallback;
}
function booleanValue(formData: FormData, key: string) { return ["1", "true", "on", "yes"].includes(text(formData, key).toLowerCase()); }
function jsonArray(formData: FormData, key: string) {
  try { const value = JSON.parse(text(formData, key) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
}
function url(message: string, type: "success" | "error", requestId?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (requestId) params.set("request", requestId);
  return `${PATH}?${params.toString()}`;
}

export async function saveServiceRequest(formData: FormData) {
  const requestId = optional(formData, "request_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contracts.manage");
  if (!projectId) redirect(url("Selecione uma obra antes de solicitar o serviço.", "error"));
  const { data, error } = await supabase.rpc("save_execution_service_request", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_request_id: requestId,
    p_budget_id: optional(formData, "budget_id"),
    p_service_id: optional(formData, "service_id"),
    p_location_id: optional(formData, "location_id"),
    p_schedule_activity_id: optional(formData, "schedule_activity_id"),
    p_title: text(formData, "title"),
    p_scope_summary: text(formData, "scope_summary"),
    p_requested_quantity: numberValue(formData, "requested_quantity"),
    p_estimated_unit_price: numberValue(formData, "estimated_unit_price"),
    p_desired_start: optional(formData, "desired_start"),
    p_desired_finish: optional(formData, "desired_finish"),
    p_notes: optional(formData, "notes"),
  });
  if (error || !data) redirect(url(error?.message ?? "Não foi possível salvar a solicitação.", "error", requestId ?? undefined));
  revalidatePath(PATH);
  redirect(url(requestId ? "Solicitação atualizada." : "Solicitação de serviço criada.", "success", String(data)));
}

export async function openServiceCompetition(formData: FormData) {
  const requestId = text(formData, "request_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contracts.manage");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("open_execution_service_competition", { p_company_id: companyId, p_project_id: projectId, p_request_id: requestId });
  if (error) redirect(url(error.message, "error", requestId));
  revalidatePath(PATH);
  redirect(url("Mapa de concorrência aberto. Registre as propostas dos fornecedores.", "success", requestId));
}

export async function saveServiceProposal(formData: FormData) {
  const requestId = text(formData, "request_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contracts.manage");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("save_execution_service_proposal", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_request_id: requestId,
    p_supplier_id: optional(formData, "supplier_id"),
    p_proposal_number: optional(formData, "proposal_number"),
    p_proposal_date: optional(formData, "proposal_date"),
    p_validity_date: optional(formData, "validity_date"),
    p_total_price: numberValue(formData, "total_price"),
    p_duration_days: numberValue(formData, "duration_days"),
    p_payment_terms: optional(formData, "payment_terms"),
    p_warranty_months: numberValue(formData, "warranty_months"),
    p_technical_score: numberValue(formData, "technical_score"),
    p_commercial_score: numberValue(formData, "commercial_score"),
    p_is_qualified: booleanValue(formData, "is_qualified"),
    p_notes: optional(formData, "notes"),
  });
  if (error) redirect(url(error.message, "error", requestId));
  revalidatePath(PATH);
  redirect(url("Proposta registrada no mapa de concorrência.", "success", requestId));
}

export async function approveServiceCompetition(formData: FormData) {
  const requestId = text(formData, "request_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contracts.approve");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const { error } = await supabase.rpc("approve_execution_service_competition", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_request_id: requestId,
    p_proposal_id: optional(formData, "proposal_id"),
    p_justification: optional(formData, "justification"),
  });
  if (error) redirect(url(error.message, "error", requestId));
  revalidatePath(PATH);
  redirect(url("Mapa aprovado e fornecedor definido. Agora configure as etapas de medição.", "success", requestId));
}

export async function createContractFromServiceRequest(formData: FormData) {
  const requestId = text(formData, "request_id");
  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contracts.manage");
  if (!projectId) redirect(url("Selecione uma obra.", "error"));
  const stages = jsonArray(formData, "stages_json");
  const { data, error } = await supabase.rpc("create_execution_service_contract_from_request", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_request_id: requestId,
    p_start_date: optional(formData, "start_date"),
    p_end_date: optional(formData, "end_date"),
    p_retention_percent: numberValue(formData, "retention_percent"),
    p_guarantee_percent: numberValue(formData, "guarantee_percent"),
    p_payment_days: numberValue(formData, "payment_days", 15),
    p_adjustment_index: optional(formData, "adjustment_index"),
    p_stages: stages,
  });
  if (error || !data) redirect(url(error?.message ?? "Não foi possível formular o contrato.", "error", requestId));
  revalidatePath(PATH);
  revalidatePath("/execucao/contratos-servicos");
  revalidatePath("/execucao/medicoes-contratos");
  redirect(`/execucao/contratos-servicos?contract=${encodeURIComponent(String(data))}&success=${encodeURIComponent("Contrato criado e ativado com etapas de medição. Já está disponível para medições.")}`);
}
