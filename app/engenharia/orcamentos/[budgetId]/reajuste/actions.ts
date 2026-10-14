"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

function path(budgetId: string) { return `/engenharia/orcamentos/${budgetId}/reajuste`; }
function go(budgetId: string, message: string, type: "success" | "error" = "success"): never {
  redirect(`${path(budgetId)}?${type}=${encodeURIComponent(message)}`);
}
function text(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function optional(formData: FormData, key: string) { return text(formData, key) || null; }
function amountValue(formData: FormData, key: string) {
  const raw = text(formData, key).replace(/\s/g, "");
  if (!raw) return Number.NaN;
  return Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
}

async function budgetContext(budgetId: string) {
  const workspace = await requireCompanyPermission("budgets.manage");
  const { data: budget } = await workspace.supabase.from("engineering_budgets")
    .select("id, company_id, project_id, status, adjustment_enabled, correction_index_id")
    .eq("id", budgetId).eq("company_id", workspace.companyId).maybeSingle();
  return { ...workspace, budget };
}

export async function configureBudgetAdjustment(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  const enabled = formData.get("adjustment_enabled") === "on";
  const correctionIndexId = enabled ? optional(formData, "correction_index_id") : null;
  const baseMonth = enabled ? optional(formData, "correction_base_month") : null;
  if (!budgetId) go("invalido", "Orçamento inválido.", "error");
  if (enabled && (!correctionIndexId || !baseMonth)) go(budgetId, "Escolha o índice e a competência-base.", "error");
  const { supabase, companyId, budget } = await budgetContext(budgetId);
  if (!budget) go(budgetId, "Orçamento não localizado.", "error");
  const { error } = await supabase.from("engineering_budgets").update({
    adjustment_enabled: enabled,
    correction_index_id: correctionIndexId,
    correction_base_month: baseMonth ? `${baseMonth.slice(0, 7)}-01` : null,
    correction_base_value: null,
    updated_at: new Date().toISOString(),
  }).eq("id", budgetId).eq("company_id", companyId);
  if (error) go(budgetId, error.message, "error");
  revalidatePath(path(budgetId));
  revalidatePath("/engenharia/custo-orcamento");
  go(budgetId, enabled ? "Reajuste mensal ativado para o orçamento." : "Reajuste mensal desativado.");
}

export async function createBudgetAmendment(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  const code = text(formData, "code").toUpperCase();
  const description = text(formData, "description");
  const approvalDate = optional(formData, "approval_date");
  const correctionIndexId = optional(formData, "correction_index_id");
  const adjustmentEnabled = formData.get("adjustment_enabled") === "on";
  if (!budgetId || !code || !description) go(budgetId || "invalido", "Informe código e descrição do aditivo.", "error");
  const { supabase, companyId, userId, budget } = await budgetContext(budgetId);
  if (!budget) go(budgetId, "Orçamento não localizado.", "error");
  const { error } = await supabase.from("engineering_budget_amendments").insert({
    company_id: companyId,
    project_id: budget.project_id,
    budget_id: budgetId,
    code,
    description,
    approval_date: approvalDate,
    status: "draft",
    adjustment_enabled: adjustmentEnabled,
    correction_index_id: correctionIndexId || (adjustmentEnabled ? budget.correction_index_id : null),
    correction_base_month: approvalDate ? `${approvalDate.slice(0, 7)}-01` : null,
    notes: optional(formData, "notes"),
    created_by: userId,
  });
  if (error) go(budgetId, error.message, "error");
  revalidatePath(path(budgetId));
  go(budgetId, "Aditivo criado em rascunho. Inclua os centros de custo antes de aprovar.");
}

export async function addBudgetAmendmentItem(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  const amendmentId = text(formData, "amendment_id");
  const budgetItemId = optional(formData, "budget_item_id");
  const amount = amountValue(formData, "amount");
  const { supabase, companyId, userId, budget } = await budgetContext(budgetId);
  if (!budget || !amendmentId || !Number.isFinite(amount) || amount === 0) go(budgetId, "Revise o item e o valor do aditivo.", "error");
  let serviceId: string | null = null;
  let code = "ADITIVO";
  let name = "Ajuste geral do orçamento";
  if (budgetItemId) {
    const { data: item } = await supabase.from("engineering_budget_items").select("id, service_id, code, description")
      .eq("id", budgetItemId).eq("budget_id", budgetId).eq("company_id", companyId).maybeSingle();
    if (!item) go(budgetId, "Serviço do orçamento não localizado.", "error");
    serviceId = item.service_id;
    code = item.code || code;
    name = item.description;
  }
  const { error } = await supabase.from("engineering_budget_amendment_items").insert({
    company_id: companyId,
    project_id: budget.project_id,
    budget_id: budgetId,
    amendment_id: amendmentId,
    service_id: serviceId,
    budget_item_id: budgetItemId,
    service_code_snapshot: code,
    service_name_snapshot: name,
    amount,
    notes: optional(formData, "notes"),
    created_by: userId,
  });
  if (error) go(budgetId, error.message, "error");
  revalidatePath(path(budgetId));
  go(budgetId, "Item incluído no aditivo.");
}

export async function approveBudgetAmendment(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  const amendmentId = text(formData, "amendment_id");
  const { supabase, companyId, budget } = await budgetContext(budgetId);
  if (!budget || !amendmentId) go(budgetId, "Aditivo inválido.", "error");
  const { count } = await supabase.from("engineering_budget_amendment_items").select("id", { count: "exact", head: true })
    .eq("company_id", companyId).eq("amendment_id", amendmentId);
  if ((count ?? 0) === 0) go(budgetId, "Inclua ao menos um item antes de aprovar o aditivo.", "error");
  const { error } = await supabase.from("engineering_budget_amendments").update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", amendmentId).eq("budget_id", budgetId).eq("company_id", companyId).eq("status", "draft");
  if (error) go(budgetId, error.message, "error");
  revalidatePath(path(budgetId));
  revalidatePath("/engenharia/custo-orcamento");
  go(budgetId, "Aditivo aprovado e incorporado ao controle orçamentário.");
}

export async function cancelBudgetAmendment(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  const amendmentId = text(formData, "amendment_id");
  const { supabase, companyId, budget } = await budgetContext(budgetId);
  if (!budget || !amendmentId) go(budgetId, "Aditivo inválido.", "error");
  const { error } = await supabase.from("engineering_budget_amendments").update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", amendmentId).eq("budget_id", budgetId).eq("company_id", companyId);
  if (error) go(budgetId, error.message, "error");
  revalidatePath(path(budgetId));
  revalidatePath("/engenharia/custo-orcamento");
  go(budgetId, "Aditivo cancelado.");
}