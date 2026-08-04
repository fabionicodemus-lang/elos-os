"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function numberValue(formData: FormData, key: string, fallback = Number.NaN) {
  const raw = text(formData, key).replace(/\s/g, "");
  if (!raw) return fallback;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  return Number(normalized);
}

function integerValue(formData: FormData, key: string, fallback = 0) {
  const value = Number.parseInt(text(formData, key), 10);
  return Number.isFinite(value) ? value : fallback;
}

function itemPath(budgetId: string, itemId: string) {
  return `/engenharia/orcamentos/${budgetId}/itens/${itemId}`;
}

function resultUrl(
  budgetId: string,
  itemId: string,
  message: string,
  type: "error" | "success" = "error",
) {
  const params = new URLSearchParams({ [type]: message });
  return `${itemPath(budgetId, itemId)}?${params.toString()}`;
}

function compositionPayload(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  const budgetItemId = text(formData, "budget_item_id");
  const inputId = text(formData, "input_id");
  const coefficient = numberValue(formData, "coefficient");
  const wastePercentage = numberValue(formData, "waste_percentage", 0);
  const unitPrice = numberValue(formData, "unit_price");
  const sortOrder = integerValue(formData, "sort_order", 0);

  if (
    !budgetId ||
    !budgetItemId ||
    !inputId ||
    !Number.isFinite(coefficient) ||
    coefficient <= 0 ||
    !Number.isFinite(wastePercentage) ||
    wastePercentage < 0 ||
    wastePercentage > 1000 ||
    !Number.isFinite(unitPrice) ||
    unitPrice < 0
  ) {
    return null;
  }

  return {
    budgetId,
    budgetItemId,
    inputId,
    coefficient,
    wastePercentage,
    unitPrice,
    sortOrder,
    notes: optional(formData, "notes"),
  };
}

async function saveCompositionItem(formData: FormData, itemId: string | null) {
  const fallbackBudgetId = text(formData, "budget_id");
  const fallbackBudgetItemId = text(formData, "budget_item_id");
  const payload = compositionPayload(formData);

  if (!payload) {
    redirect(resultUrl(
      fallbackBudgetId || "invalido",
      fallbackBudgetItemId || "invalido",
      "Revise o insumo, o coeficiente, a perda e o preço unitário.",
    ));
  }

  const { supabase, companyId } = await requireCompanyPermission("budgets.manage");
  const { error } = await supabase.rpc("save_engineering_budget_composition_item", {
    p_company_id: companyId,
    p_budget_id: payload.budgetId,
    p_budget_item_id: payload.budgetItemId,
    p_item_id: itemId,
    p_input_id: payload.inputId,
    p_coefficient: payload.coefficient,
    p_waste_percentage: payload.wastePercentage,
    p_unit_price: payload.unitPrice,
    p_sort_order: payload.sortOrder,
    p_notes: payload.notes,
  });

  if (error) {
    redirect(resultUrl(payload.budgetId, payload.budgetItemId, error.message));
  }

  revalidatePath(itemPath(payload.budgetId, payload.budgetItemId));
  revalidatePath(`/engenharia/orcamentos/${payload.budgetId}`);
  revalidatePath("/engenharia/orcamento-analitico");
  revalidatePath("/engenharia/curvas");
  revalidatePath("/engenharia/previsao-financeira");
  redirect(resultUrl(
    payload.budgetId,
    payload.budgetItemId,
    itemId ? "Insumo e custo atualizados nesta revisão." : "Insumo adicionado à composição desta revisão.",
    "success",
  ));
}

export async function addBudgetCompositionInput(formData: FormData) {
  await saveCompositionItem(formData, null);
}

export async function updateBudgetCompositionInput(formData: FormData) {
  const itemId = text(formData, "composition_item_id");
  if (!itemId) {
    const budgetId = text(formData, "budget_id");
    const budgetItemId = text(formData, "budget_item_id");
    redirect(resultUrl(budgetId || "invalido", budgetItemId || "invalido", "Item da composição inválido."));
  }

  await saveCompositionItem(formData, itemId);
}

export async function removeBudgetCompositionInput(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  const budgetItemId = text(formData, "budget_item_id");
  const itemId = text(formData, "composition_item_id");

  if (!budgetId || !budgetItemId || !itemId) {
    redirect(resultUrl(
      budgetId || "invalido",
      budgetItemId || "invalido",
      "Item da composição inválido.",
    ));
  }

  const { supabase, companyId } = await requireCompanyPermission("budgets.manage");
  const { error } = await supabase.rpc("remove_engineering_budget_composition_item", {
    p_company_id: companyId,
    p_budget_id: budgetId,
    p_budget_item_id: budgetItemId,
    p_item_id: itemId,
  });

  if (error) redirect(resultUrl(budgetId, budgetItemId, error.message));

  revalidatePath(itemPath(budgetId, budgetItemId));
  revalidatePath(`/engenharia/orcamentos/${budgetId}`);
  revalidatePath("/engenharia/orcamento-analitico");
  revalidatePath("/engenharia/curvas");
  revalidatePath("/engenharia/previsao-financeira");
  redirect(resultUrl(
    budgetId,
    budgetItemId,
    "Insumo excluído somente desta revisão do orçamento.",
    "success",
  ));
}
