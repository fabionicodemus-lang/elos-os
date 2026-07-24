"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/engenharia/orcamentos";
const budgetStatuses = new Set(["draft", "in_progress", "review", "approved", "archived"]);

function optional(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim() || null;
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function numberValue(formData: FormData, key: string, fallback = Number.NaN) {
  const raw = String(formData.get(key) ?? "").trim().replace(/\s/g, "");
  if (!raw) return fallback;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  return Number(normalized);
}

function integerValue(formData: FormData, key: string, fallback = 0) {
  const value = Number.parseInt(String(formData.get(key) ?? ""), 10);
  return Number.isFinite(value) ? value : fallback;
}

function listUrl(message: string, type: "error" | "success" = "error") {
  const params = new URLSearchParams({ [type]: message });
  return `${LIST_PATH}?${params.toString()}`;
}

function detailPath(budgetId: string) {
  return `${LIST_PATH}/${budgetId}`;
}

function detailUrl(budgetId: string, message: string, type: "error" | "success" = "error") {
  const params = new URLSearchParams({ [type]: message });
  return `${detailPath(budgetId)}?${params.toString()}`;
}

async function findBudget(budgetId: string, manage = false) {
  const permission = manage ? "budgets.manage" : "budgets.view";
  const workspace = await requireCompanyPermission(permission);
  const { supabase, companyId, projectId } = workspace;

  let query = supabase
    .from("engineering_budgets")
    .select("id, project_id, status")
    .eq("id", budgetId)
    .eq("company_id", companyId);

  if (projectId) query = query.eq("project_id", projectId);
  const { data: budget } = await query.maybeSingle();
  return { ...workspace, budget };
}

export async function createBudget(formData: FormData) {
  const code = text(formData, "code").toUpperCase();
  const name = text(formData, "name");
  const version = text(formData, "version").toUpperCase() || "R00";
  const areaM2 = numberValue(formData, "area_m2", 0);

  if (!code || !name || !Number.isFinite(areaM2) || areaM2 < 0) {
    redirect(listUrl("Informe código, nome e área válidos."));
  }

  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("budgets.manage");
  if (!projectId) redirect(listUrl("Selecione uma obra antes de criar a revisão."));

  const { data, error } = await supabase
    .from("engineering_budgets")
    .insert({
      company_id: companyId,
      project_id: projectId,
      code,
      name,
      version,
      status: "draft",
      reference_date: optional(formData, "reference_date"),
      area_m2: areaM2,
      bdi_percentage: 0,
      notes: optional(formData, "notes"),
      source_system: "elos_os",
      source_id: `manual_${crypto.randomUUID()}`,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !data?.id) redirect(listUrl(error?.message || "Não foi possível criar a revisão."));
  revalidatePath(LIST_PATH);
  redirect(detailUrl(data.id, "Revisão criada. Agora estruture os grupos e serviços.", "success"));
}

export async function updateBudget(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  const code = text(formData, "code").toUpperCase();
  const name = text(formData, "name");
  const version = text(formData, "version").toUpperCase() || "R00";
  const status = text(formData, "status");
  const areaM2 = numberValue(formData, "area_m2", 0);

  if (!budgetId || !code || !name || !budgetStatuses.has(status) || !Number.isFinite(areaM2) || areaM2 < 0) {
    redirect(detailUrl(budgetId || "invalido", "Revise os dados gerais da revisão."));
  }

  const { supabase, companyId, projectId, budget } = await findBudget(budgetId, true);
  if (!budget) redirect(listUrl("Revisão não localizada."));

  let query = supabase
    .from("engineering_budgets")
    .update({
      code,
      name,
      version,
      status,
      reference_date: optional(formData, "reference_date"),
      area_m2: areaM2,
      bdi_percentage: 0,
      notes: optional(formData, "notes"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", budgetId)
    .eq("company_id", companyId);

  if (projectId) query = query.eq("project_id", projectId);
  const { error } = await query;
  if (error) redirect(detailUrl(budgetId, error.message));

  revalidatePath(LIST_PATH);
  revalidatePath(detailPath(budgetId));
  redirect(detailUrl(budgetId, "Dados da revisão atualizados.", "success"));
}

export async function closeBudgetRevision(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  if (!budgetId) redirect(listUrl("Revisão inválida."));

  const { supabase, companyId, projectId, budget } = await findBudget(budgetId, true);
  if (!budget) redirect(listUrl("Revisão não localizada."));

  let query = supabase
    .from("engineering_budgets")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", budgetId)
    .eq("company_id", companyId)
    .neq("status", "archived");
  if (projectId) query = query.eq("project_id", projectId);

  const { error } = await query;
  if (error) redirect(detailUrl(budgetId, error.message));
  revalidatePath(LIST_PATH);
  revalidatePath(detailPath(budgetId));
  redirect(detailUrl(budgetId, "Revisão fechada e registrada como referência da obra.", "success"));
}

export async function archiveBudget(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  if (!budgetId) redirect(listUrl("Revisão inválida."));

  const { supabase, companyId, projectId, budget } = await findBudget(budgetId, true);
  if (!budget) redirect(listUrl("Revisão não localizada."));

  let query = supabase
    .from("engineering_budgets")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", budgetId)
    .eq("company_id", companyId);
  if (projectId) query = query.eq("project_id", projectId);

  const { error } = await query;
  if (error) redirect(detailUrl(budgetId, error.message));
  revalidatePath(LIST_PATH);
  redirect(listUrl("Revisão arquivada.", "success"));
}

export async function createBudgetGroup(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  const code = text(formData, "code").toUpperCase();
  const name = text(formData, "name");
  const sortOrder = integerValue(formData, "sort_order", 0);

  if (!budgetId || !code || !name) redirect(detailUrl(budgetId || "invalido", "Informe código e nome do grupo."));

  const { supabase, companyId, projectId, userId, budget } = await findBudget(budgetId, true);
  if (!budget || !projectId) redirect(listUrl("Revisão ou obra não localizada."));

  const { error } = await supabase.from("engineering_budget_groups").insert({
    company_id: companyId,
    project_id: projectId,
    budget_id: budgetId,
    code,
    name,
    sort_order: sortOrder,
    notes: optional(formData, "notes"),
    status: "active",
    created_by: userId,
  });

  if (error) redirect(detailUrl(budgetId, error.message));
  revalidatePath(detailPath(budgetId));
  redirect(detailUrl(budgetId, "Grupo adicionado ao orçamento.", "success"));
}

export async function updateBudgetGroup(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  const groupId = text(formData, "group_id");
  const code = text(formData, "code").toUpperCase();
  const name = text(formData, "name");

  if (!budgetId || !groupId || !code || !name) redirect(detailUrl(budgetId || "invalido", "Grupo inválido."));
  const { supabase, companyId, projectId, budget } = await findBudget(budgetId, true);
  if (!budget) redirect(listUrl("Revisão não localizada."));

  let query = supabase
    .from("engineering_budget_groups")
    .update({
      code,
      name,
      sort_order: integerValue(formData, "sort_order", 0),
      notes: optional(formData, "notes"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", groupId)
    .eq("budget_id", budgetId)
    .eq("company_id", companyId)
    .eq("status", "active");
  if (projectId) query = query.eq("project_id", projectId);

  const { error } = await query;
  if (error) redirect(detailUrl(budgetId, error.message));
  revalidatePath(detailPath(budgetId));
  redirect(detailUrl(budgetId, "Grupo atualizado.", "success"));
}

export async function createBudgetItem(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  const description = text(formData, "description");
  const quantity = numberValue(formData, "quantity", 0);
  const material = numberValue(formData, "material_unit_cost", 0);
  const labor = numberValue(formData, "labor_unit_cost", 0);
  const equipment = numberValue(formData, "equipment_unit_cost", 0);
  const other = numberValue(formData, "other_unit_cost", 0);

  if (!budgetId || !description || [quantity, material, labor, equipment, other].some((value) => !Number.isFinite(value) || value < 0)) {
    redirect(detailUrl(budgetId || "invalido", "Informe descrição, quantidade e custos válidos."));
  }

  const { supabase, companyId, projectId, userId, budget } = await findBudget(budgetId, true);
  if (!budget || !projectId) redirect(listUrl("Revisão ou obra não localizada."));

  const groupId = optional(formData, "group_id");
  if (groupId) {
    const { data: group } = await supabase
      .from("engineering_budget_groups")
      .select("id")
      .eq("id", groupId)
      .eq("budget_id", budgetId)
      .eq("company_id", companyId)
      .eq("status", "active")
      .maybeSingle();
    if (!group) redirect(detailUrl(budgetId, "O grupo selecionado não pertence a esta revisão."));
  }

  const { error } = await supabase.from("engineering_budget_items").insert({
    company_id: companyId,
    project_id: projectId,
    budget_id: budgetId,
    group_id: groupId,
    code: optional(formData, "code")?.toUpperCase() ?? null,
    description,
    unit: text(formData, "unit") || "un",
    quantity,
    material_unit_cost: material,
    labor_unit_cost: labor,
    equipment_unit_cost: equipment,
    other_unit_cost: other,
    sort_order: integerValue(formData, "sort_order", 0),
    notes: optional(formData, "notes"),
    status: "active",
    created_by: userId,
  });

  if (error) redirect(detailUrl(budgetId, error.message));
  revalidatePath(detailPath(budgetId));
  revalidatePath(LIST_PATH);
  redirect(detailUrl(budgetId, "Serviço incluído no orçamento.", "success"));
}

export async function updateBudgetItem(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  const itemId = text(formData, "item_id");
  const description = text(formData, "description");
  const quantity = numberValue(formData, "quantity", 0);
  const material = numberValue(formData, "material_unit_cost", 0);
  const labor = numberValue(formData, "labor_unit_cost", 0);
  const equipment = numberValue(formData, "equipment_unit_cost", 0);
  const other = numberValue(formData, "other_unit_cost", 0);

  if (!budgetId || !itemId || !description || [quantity, material, labor, equipment, other].some((value) => !Number.isFinite(value) || value < 0)) {
    redirect(detailUrl(budgetId || "invalido", "Revise os dados do serviço."));
  }

  const { supabase, companyId, projectId, budget } = await findBudget(budgetId, true);
  if (!budget) redirect(listUrl("Revisão não localizada."));

  let query = supabase
    .from("engineering_budget_items")
    .update({
      group_id: optional(formData, "group_id"),
      code: optional(formData, "code")?.toUpperCase() ?? null,
      description,
      unit: text(formData, "unit") || "un",
      quantity,
      material_unit_cost: material,
      labor_unit_cost: labor,
      equipment_unit_cost: equipment,
      other_unit_cost: other,
      sort_order: integerValue(formData, "sort_order", 0),
      notes: optional(formData, "notes"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("budget_id", budgetId)
    .eq("company_id", companyId)
    .eq("status", "active");
  if (projectId) query = query.eq("project_id", projectId);

  const { error } = await query;
  if (error) redirect(detailUrl(budgetId, error.message));
  revalidatePath(detailPath(budgetId));
  revalidatePath(LIST_PATH);
  redirect(detailUrl(budgetId, "Serviço atualizado.", "success"));
}

export async function deactivateBudgetItem(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  const itemId = text(formData, "item_id");
  if (!budgetId || !itemId) redirect(detailUrl(budgetId || "invalido", "Serviço inválido."));

  const { supabase, companyId, projectId, budget } = await findBudget(budgetId, true);
  if (!budget) redirect(listUrl("Revisão não localizada."));

  let query = supabase
    .from("engineering_budget_items")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("budget_id", budgetId)
    .eq("company_id", companyId)
    .eq("status", "active");
  if (projectId) query = query.eq("project_id", projectId);

  const { error } = await query;
  if (error) redirect(detailUrl(budgetId, error.message));
  revalidatePath(detailPath(budgetId));
  revalidatePath(LIST_PATH);
  redirect(detailUrl(budgetId, "Serviço removido do orçamento.", "success"));
}
