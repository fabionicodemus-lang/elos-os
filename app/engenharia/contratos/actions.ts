"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/engenharia/contratos";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function numberValue(formData: FormData, key: string, fallback = 0) {
  const raw = text(formData, key).replace(/\s/g, "");
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : fallback;
}

function resultUrl(message: string, type: "success" | "error", contractId?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (contractId) params.set("contract", contractId);
  return `${PATH}?${params.toString()}`;
}

function revalidateContracts() {
  revalidatePath(PATH);
  revalidatePath("/execucao/contratos-servicos");
  revalidatePath("/execucao/medicoes-contratos");
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-de-caixa");
  revalidatePath("/dashboard");
}

export async function createSimpleContractMeasurement(formData: FormData) {
  const contractId = text(formData, "contract_id");
  const competenceRaw = text(formData, "competence");
  const competence = competenceRaw.length === 7 ? `${competenceRaw}-01` : competenceRaw;
  const grossAmount = numberValue(formData, "gross_amount");
  const progressPercent = numberValue(formData, "progress_percent");
  const confirmed = formData.get("over_contract_confirmed") === "on";

  if (!contractId || !competence || (grossAmount <= 0 && progressPercent <= 0)) {
    redirect(resultUrl("Informe contrato, competência e valor ou percentual da medição.", "error", contractId || undefined));
  }

  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.measurements.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error"));

  const { data, error } = await supabase.rpc("create_simple_execution_contract_measurement", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_contract_id: contractId,
    p_competence: competence,
    p_gross_amount: grossAmount,
    p_progress_percent: progressPercent,
    p_over_contract_confirmed: confirmed,
    p_notes: optional(formData, "notes"),
  });

  if (error || !data) redirect(resultUrl(error?.message ?? "Não foi possível registrar a medição.", "error", contractId));
  revalidateContracts();
  redirect(resultUrl("Medição mensal registrada e enviada para aprovação.", "success", contractId));
}

export async function approveCommittedContractMeasurement(formData: FormData) {
  const measurementId = text(formData, "measurement_id");
  const contractId = text(formData, "contract_id");
  if (!measurementId) redirect(resultUrl("Medição inválida.", "error", contractId || undefined));

  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.measurements.approve");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error", contractId || undefined));

  const { error } = await supabase.rpc("approve_execution_contract_measurement", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_measurement_id: measurementId,
    p_notes: optional(formData, "approval_notes"),
  });

  if (error) redirect(resultUrl(error.message, "error", contractId || undefined));
  revalidateContracts();
  redirect(resultUrl("Medição aprovada. A conta a pagar foi gerada automaticamente.", "success", contractId || undefined));
}

export async function reverseCommittedContractMeasurement(formData: FormData) {
  const measurementId = text(formData, "measurement_id");
  const contractId = text(formData, "contract_id");
  const reason = text(formData, "reason");
  if (!measurementId || !reason) redirect(resultUrl("Informe o motivo do estorno.", "error", contractId || undefined));

  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.measurements.reverse");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error", contractId || undefined));

  const { error } = await supabase.rpc("reverse_execution_contract_measurement", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_measurement_id: measurementId,
    p_reason: reason,
  });

  if (error) redirect(resultUrl(error.message, "error", contractId || undefined));
  revalidateContracts();
  redirect(resultUrl("Medição estornada e conta a pagar aberta cancelada.", "success", contractId || undefined));
}

export async function addCommittedContractAmendment(formData: FormData) {
  const contractId = text(formData, "contract_id");
  const type = text(formData, "amendment_type");
  let valueChange = numberValue(formData, "value_change");
  if (type === "suppression" && valueChange > 0) valueChange *= -1;

  const itemIds = formData.getAll("allocation_contract_item_id").map(String);
  const values = formData.getAll("allocation_value").map((value) => {
    const raw = String(value ?? "").trim().replace(/\s/g, "");
    const parsed = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const items = itemIds.map((contractItemId, index) => {
    let allocation = values[index] ?? 0;
    if (type === "suppression" && allocation > 0) allocation *= -1;
    return { contract_item_id: contractItemId, value_change: allocation };
  }).filter((item) => Math.abs(item.value_change) > 0.001);

  if (!contractId || !type) redirect(resultUrl("Contrato ou tipo de aditivo inválido.", "error", contractId || undefined));

  const { supabase, companyId, projectId } = await requireCompanyPermission("execution.contracts.amend");
  if (!projectId) redirect(resultUrl("Selecione uma obra.", "error", contractId));

  const { error } = await supabase.rpc("add_execution_service_contract_amendment_with_items", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_contract_id: contractId,
    p_type: type,
    p_description: text(formData, "description"),
    p_value_change: valueChange,
    p_new_end_date: optional(formData, "new_end_date"),
    p_justification: text(formData, "justification"),
    p_items: items,
  });

  if (error) redirect(resultUrl(error.message, "error", contractId));
  revalidateContracts();
  redirect(resultUrl("Aditivo aprovado e alocado aos serviços do contrato.", "success", contractId));
}
