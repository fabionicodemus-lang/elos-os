"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/comercial/propostas";

function pageUrl(message: string, type: "error" | "success" = "error") {
  return `${PATH}?${new URLSearchParams({ [type]: message }).toString()}`;
}

function detailUrl(proposalId: string, message: string, type: "error" | "success" = "error") {
  return `${PATH}/${proposalId}?${new URLSearchParams({ [type]: message }).toString()}`;
}

function optional(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim() || null;
}

function parseMoney(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) return Number.NaN;
  return Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
}

function parseInteger(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function revalidateProposal(proposalId?: string) {
  revalidatePath(PATH);
  if (proposalId) revalidatePath(`${PATH}/${proposalId}`);
  revalidatePath("/comercial/vendas");
  revalidatePath("/comercial/planos-de-pagamento");
  revalidatePath("/empreendimentos/unidades");
}

async function validateProposalEnvironment(
  companyId: string,
  projectId: string,
  clientId: string,
  unitId: string,
  supabase: Awaited<ReturnType<typeof requireCompanyPermission>>["supabase"],
) {
  const [clientResult, unitResult] = await Promise.all([
    supabase.from("clients").select("id,status").eq("id", clientId).eq("company_id", companyId).maybeSingle(),
    supabase.from("units").select("id,status,list_price").eq("id", unitId).eq("company_id", companyId).eq("project_id", projectId).maybeSingle(),
  ]);

  if (!clientResult.data || clientResult.data.status !== "active") {
    throw new Error("Selecione um cliente ativo da empresa atual.");
  }
  if (!unitResult.data || unitResult.data.status === "inactive" || unitResult.data.status === "sold") {
    throw new Error("A unidade selecionada não está disponível para proposta.");
  }

  return unitResult.data;
}

export async function createProposal(formData: FormData) {
  const clientId = String(formData.get("client_id") ?? "").trim();
  const unitId = String(formData.get("unit_id") ?? "").trim();
  const proposalDate = String(formData.get("proposal_date") ?? "").trim();
  const validUntil = String(formData.get("valid_until") ?? "").trim();
  const listPrice = parseMoney(formData.get("list_price"));
  const proposedAmount = parseMoney(formData.get("proposed_amount"));
  const commissionPctRaw = parseMoney(formData.get("commission_pct"));
  const commissionPct = Number.isFinite(commissionPctRaw) && commissionPctRaw >= 0 ? commissionPctRaw : 0;

  if (!clientId || !unitId || !proposalDate || !validUntil || validUntil < proposalDate || !Number.isFinite(listPrice) || listPrice < 0 || !Number.isFinite(proposedAmount) || proposedAmount <= 0) {
    redirect(pageUrl("Informe cliente, unidade, datas e valores válidos."));
  }

  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("commercial.proposals.manage");
  if (!projectId) redirect(pageUrl("Selecione um empreendimento antes de criar a proposta."));

  try {
    const unit = await validateProposalEnvironment(companyId, projectId, clientId, unitId, supabase);
    const resolvedListPrice = listPrice > 0 ? listPrice : Number(unit.list_price ?? 0);
    const numberResult = await supabase.rpc("commercial_proposal_next_number", {
      p_company_id: companyId,
      p_project_id: projectId,
      p_proposal_date: proposalDate,
    });
    if (numberResult.error || !numberResult.data) throw new Error(numberResult.error?.message || "Não foi possível numerar a proposta.");

    const insertResult = await supabase.from("commercial_proposals").insert({
      company_id: companyId,
      project_id: projectId,
      unit_id: unitId,
      client_id: clientId,
      number: String(numberResult.data),
      proposal_date: proposalDate,
      valid_until: validUntil,
      list_price: resolvedListPrice,
      proposed_amount: proposedAmount,
      commission_pct: commissionPct,
      broker_name: optional(formData, "broker_name"),
      source_channel: optional(formData, "source_channel"),
      terms: optional(formData, "terms"),
      notes: optional(formData, "notes"),
      status: "draft",
      created_by: userId,
      updated_by: userId,
    }).select("id").single();

    if (insertResult.error || !insertResult.data) throw new Error(insertResult.error?.message || "Não foi possível criar a proposta.");
    revalidateProposal(insertResult.data.id);
    redirect(detailUrl(insertResult.data.id, "Proposta criada. Cadastre agora as condições de pagamento.", "success"));
  } catch (error) {
    redirect(pageUrl(error instanceof Error ? error.message : "Não foi possível criar a proposta."));
  }
}

export async function updateProposal(formData: FormData) {
  const proposalId = String(formData.get("proposal_id") ?? "").trim();
  const clientId = String(formData.get("client_id") ?? "").trim();
  const unitId = String(formData.get("unit_id") ?? "").trim();
  const proposalDate = String(formData.get("proposal_date") ?? "").trim();
  const validUntil = String(formData.get("valid_until") ?? "").trim();
  const listPrice = parseMoney(formData.get("list_price"));
  const proposedAmount = parseMoney(formData.get("proposed_amount"));
  const commissionPctRaw = parseMoney(formData.get("commission_pct"));
  const commissionPct = Number.isFinite(commissionPctRaw) && commissionPctRaw >= 0 ? commissionPctRaw : 0;

  if (!proposalId || !clientId || !unitId || !proposalDate || !validUntil || validUntil < proposalDate || !Number.isFinite(listPrice) || listPrice < 0 || !Number.isFinite(proposedAmount) || proposedAmount <= 0) {
    redirect(detailUrl(proposalId, "Preencha os dados obrigatórios com valores válidos."));
  }

  const { supabase, companyId, userId } = await requireCompanyPermission("commercial.proposals.manage");
  const currentResult = await supabase.from("commercial_proposals").select("id,project_id,status").eq("id", proposalId).eq("company_id", companyId).maybeSingle();
  if (!currentResult.data) redirect(detailUrl(proposalId, "Proposta não encontrada."));
  if (!['draft','sent','negotiation'].includes(currentResult.data.status)) {
    redirect(detailUrl(proposalId, "Crie uma nova versão para alterar uma proposta aprovada ou encerrada."));
  }

  try {
    await validateProposalEnvironment(companyId, currentResult.data.project_id, clientId, unitId, supabase);
    const result = await supabase.from("commercial_proposals").update({
      client_id: clientId,
      unit_id: unitId,
      proposal_date: proposalDate,
      valid_until: validUntil,
      list_price: listPrice,
      proposed_amount: proposedAmount,
      commission_pct: commissionPct,
      broker_name: optional(formData, "broker_name"),
      source_channel: optional(formData, "source_channel"),
      terms: optional(formData, "terms"),
      notes: optional(formData, "notes"),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }).eq("id", proposalId).eq("company_id", companyId);
    if (result.error) throw new Error(result.error.message);
    revalidateProposal(proposalId);
    redirect(detailUrl(proposalId, "Dados da proposta atualizados.", "success"));
  } catch (error) {
    redirect(detailUrl(proposalId, error instanceof Error ? error.message : "Não foi possível atualizar a proposta."));
  }
}

export async function saveProposalPaymentItem(formData: FormData) {
  const proposalId = String(formData.get("proposal_id") ?? "").trim();
  const itemId = String(formData.get("item_id") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const installmentCount = parseInteger(formData.get("installment_count"), 1);
  const firstDueDate = String(formData.get("first_due_date") ?? "").trim();
  const intervalMonths = parseInteger(formData.get("interval_months"), 1);
  const amountPerInstallment = parseMoney(formData.get("amount_per_installment"));
  const interestRaw = parseMoney(formData.get("interest_rate_monthly"));
  const interestRate = Number.isFinite(interestRaw) && interestRaw >= 0 ? interestRaw : null;
  const sortOrder = parseInteger(formData.get("sort_order"), 0);

  if (!proposalId || !['entry','monthly','reinforcement','keys','post_keys','other'].includes(category) || !description || !firstDueDate || installmentCount <= 0 || installmentCount > 240 || intervalMonths < 0 || !Number.isFinite(amountPerInstallment) || amountPerInstallment <= 0) {
    redirect(detailUrl(proposalId, "Informe uma condição de pagamento válida."));
  }

  const { supabase, companyId, userId } = await requireCompanyPermission("commercial.proposals.manage");
  const proposalResult = await supabase.from("commercial_proposals").select("id,status").eq("id", proposalId).eq("company_id", companyId).maybeSingle();
  if (!proposalResult.data || !['draft','sent','negotiation'].includes(proposalResult.data.status)) {
    redirect(detailUrl(proposalId, "As condições só podem ser editadas antes da aprovação."));
  }

  const payload = {
    company_id: companyId,
    proposal_id: proposalId,
    category,
    description,
    installment_count: installmentCount,
    first_due_date: firstDueDate,
    interval_months: intervalMonths,
    amount_per_installment: amountPerInstallment,
    adjustment_index: optional(formData, "adjustment_index"),
    interest_rate_monthly: interestRate,
    sort_order: sortOrder,
    notes: optional(formData, "notes"),
    updated_at: new Date().toISOString(),
  };

  const result = itemId
    ? await supabase.from("commercial_proposal_payment_items").update(payload).eq("id", itemId).eq("proposal_id", proposalId).eq("company_id", companyId)
    : await supabase.from("commercial_proposal_payment_items").insert({ ...payload, created_by: userId });

  if (result.error) redirect(detailUrl(proposalId, result.error.message));
  revalidateProposal(proposalId);
  redirect(detailUrl(proposalId, itemId ? "Condição atualizada." : "Condição adicionada.", "success"));
}

export async function deleteProposalPaymentItem(formData: FormData) {
  const proposalId = String(formData.get("proposal_id") ?? "").trim();
  const itemId = String(formData.get("item_id") ?? "").trim();
  if (!proposalId || !itemId) redirect(detailUrl(proposalId, "Condição inválida."));

  const { supabase, companyId } = await requireCompanyPermission("commercial.proposals.manage");
  const proposalResult = await supabase.from("commercial_proposals").select("status").eq("id", proposalId).eq("company_id", companyId).maybeSingle();
  if (!proposalResult.data || !['draft','sent','negotiation'].includes(proposalResult.data.status)) {
    redirect(detailUrl(proposalId, "As condições só podem ser excluídas antes da aprovação."));
  }

  const result = await supabase.from("commercial_proposal_payment_items").delete().eq("id", itemId).eq("proposal_id", proposalId).eq("company_id", companyId);
  if (result.error) redirect(detailUrl(proposalId, result.error.message));
  revalidateProposal(proposalId);
  redirect(detailUrl(proposalId, "Condição removida.", "success"));
}

export async function setProposalStatus(formData: FormData) {
  const proposalId = String(formData.get("proposal_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const reservationUntil = optional(formData, "reservation_until");
  if (!proposalId || !['draft','sent','negotiation','approved','rejected','expired','cancelled'].includes(status)) {
    redirect(detailUrl(proposalId, "Situação inválida."));
  }

  const permission = status === "approved" ? "commercial.proposals.approve" : "commercial.proposals.manage";
  const { supabase, companyId, userId } = await requireCompanyPermission(permission);
  const result = await supabase.rpc("commercial_set_proposal_status", {
    p_company_id: companyId,
    p_proposal_id: proposalId,
    p_status: status,
    p_reservation_until: reservationUntil,
    p_user_id: userId,
  });
  if (result.error) redirect(detailUrl(proposalId, result.error.message));
  revalidateProposal(proposalId);
  const labels: Record<string, string> = { draft: "Rascunho", sent: "Enviada", negotiation: "Em negociação", approved: "Aprovada e unidade reservada", rejected: "Recusada", expired: "Vencida", cancelled: "Cancelada" };
  redirect(detailUrl(proposalId, `Situação alterada para ${labels[status]}.`, "success"));
}

export async function createProposalRevision(formData: FormData) {
  const proposalId = String(formData.get("proposal_id") ?? "").trim();
  const validUntil = String(formData.get("valid_until") ?? "").trim();
  if (!proposalId || !validUntil) redirect(detailUrl(proposalId, "Informe a validade da nova versão."));

  const { supabase, companyId, userId } = await requireCompanyPermission("commercial.proposals.manage");
  const result = await supabase.rpc("commercial_create_proposal_revision", {
    p_company_id: companyId,
    p_proposal_id: proposalId,
    p_valid_until: validUntil,
    p_user_id: userId,
  });
  if (result.error || !result.data) redirect(detailUrl(proposalId, result.error?.message || "Não foi possível criar a versão."));
  revalidateProposal(proposalId);
  revalidateProposal(String(result.data));
  redirect(detailUrl(String(result.data), "Nova versão criada com as condições anteriores copiadas.", "success"));
}

export async function convertProposalToSale(formData: FormData) {
  const proposalId = String(formData.get("proposal_id") ?? "").trim();
  const saleDate = String(formData.get("sale_date") ?? "").trim();
  const contractNumber = optional(formData, "contract_number");
  if (!proposalId || !saleDate) redirect(detailUrl(proposalId, "Informe a data da venda."));

  const { supabase, companyId, userId } = await requireCompanyPermission("commercial.proposals.convert");
  const result = await supabase.rpc("commercial_convert_proposal", {
    p_company_id: companyId,
    p_proposal_id: proposalId,
    p_sale_date: saleDate,
    p_contract_number: contractNumber,
    p_user_id: userId,
  });
  if (result.error || !result.data) redirect(detailUrl(proposalId, result.error?.message || "Não foi possível converter a proposta."));
  revalidateProposal(proposalId);
  redirect(`/comercial/vendas/${result.data}?${new URLSearchParams({ success: "Proposta convertida em venda e plano de pagamento criado." }).toString()}`);
}
