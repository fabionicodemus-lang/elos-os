"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fetchAllRows } from "@/lib/supabase-pagination";
import type { Update } from "@/lib/supabase/types";
import { requireCompanyPermission } from "@/lib/workspace";
import { planScheduleFromBudget } from "./schedule-generation.mjs";
import { extractSchedulePayload } from "./schedule-portable.mjs";
import { rescheduleFromMove } from "./schedule-cascade.mjs";

const LIST_PATH = "/engenharia/cronograma";
const baselineStatuses = new Set(["draft", "review", "approved", "archived"]);
const planningStatuses = new Set(["draft", "reviewed", "approved"]);
const relationTypes = new Set(["FS", "SS", "FF", "SF"]);

type Takeoff = {
  id: string;
  service_id: string;
  location_id: string | null;
  total_quantity: number;
  unit_snapshot: string;
};
type Service = { id: string; code: string; description: string; unit: string };
type Location = { id: string; code: string; name: string; sort_order: number };
type BudgetItem = { service_id: string | null; total_direct_cost: number; status: "active" | "inactive" };

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function numberValue(formData: FormData, key: string, fallback = Number.NaN) {
  const rawValue = text(formData, key);
  if (!rawValue) return fallback;
  const normalized = rawValue.includes(",")
    ? rawValue.replace(/\./g, "").replace(",", ".")
    : rawValue;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : fallback;
}

function resultUrl(message: string, type: "error" | "success" = "error", baselineId?: string | null) {
  const params = new URLSearchParams({ [type]: message });
  if (baselineId) params.set("baseline", baselineId);
  return `${LIST_PATH}?${params.toString()}`;
}

function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isWorkday(date: Date, saturday: boolean) {
  const day = date.getUTCDay();
  return day !== 0 && (saturday || day !== 6);
}

function normalizeStartDate(date: Date, saturday: boolean) {
  const current = new Date(date);
  while (!isWorkday(current, saturday)) current.setUTCDate(current.getUTCDate() + 1);
  return current;
}

function addWorkdays(start: Date, durationDays: number, saturday: boolean) {
  const current = normalizeStartDate(start, saturday);
  let remaining = Math.max(1, Math.trunc(durationDays)) - 1;
  while (remaining > 0) {
    current.setUTCDate(current.getUTCDate() + 1);
    if (isWorkday(current, saturday)) remaining -= 1;
  }
  return current;
}

async function loadBaseline(formData: FormData, permission = "schedule.manage") {
  const baselineId = text(formData, "baseline_id");
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission(permission);
  if (!projectId) redirect(resultUrl("Selecione uma obra antes de usar o cronograma."));
  if (!baselineId) redirect(resultUrl("Selecione uma linha de base."));

  const { data: baseline } = await supabase
    .from("engineering_schedule_baselines")
    .select("id, project_id, budget_id, start_date, work_on_saturday, status")
    .eq("id", baselineId)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!baseline || baseline.status === "archived") {
    redirect(resultUrl("A linha de base selecionada não está disponível."));
  }

  return { supabase, companyId, projectId, userId, baseline };
}

export async function createScheduleBaseline(formData: FormData) {
  const code = text(formData, "code").toUpperCase();
  const name = text(formData, "name");
  const version = text(formData, "version").toUpperCase() || "LB-00";
  const budgetId = text(formData, "budget_id");
  const startDate = text(formData, "start_date");
  const workOnSaturday = formData.get("work_on_saturday") === "on";

  if (!code || !name || !budgetId || !parseIsoDate(startDate)) {
    redirect(resultUrl("Informe código, nome, revisão do orçamento e data de início."));
  }

  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("schedule.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra."));

  const { data: budget } = await supabase
    .from("engineering_budgets")
    .select("id, status, is_base")
    .eq("id", budgetId)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!budget || budget.status === "archived") {
    redirect(resultUrl("A revisão do orçamento não está disponível."));
  }
  if (budget.status !== "approved") {
    redirect(resultUrl("A linha de base exige uma revisão de orçamento aprovada."));
  }
  if (budget.is_base !== true) {
    redirect(resultUrl("A linha de base deve usar o orçamento base aprovado da obra."));
  }

  const { data, error } = await supabase
    .from("engineering_schedule_baselines")
    .insert({
      company_id: companyId,
      project_id: projectId,
      budget_id: budgetId,
      code,
      name,
      version,
      start_date: startDate,
      work_on_saturday: workOnSaturday,
      notes: optional(formData, "notes"),
      status: "draft",
      created_by: userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    const message = error?.code === "23505" ? "Já existe uma linha de base com esse código e versão." : error?.message ?? "Não foi possível criar a linha de base.";
    redirect(resultUrl(message));
  }

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Linha de base criada. Agora gere ou cadastre as atividades.", "success", data.id));
}

export async function createScheduleActivity(formData: FormData) {
  const references = await loadBaseline(formData);
  const code = text(formData, "code").toUpperCase();
  const name = text(formData, "name");
  const serviceId = optional(formData, "service_id");
  const locationId = optional(formData, "location_id");
  const unit = text(formData, "unit") || "un";
  const quantity = numberValue(formData, "quantity", 0);
  const productivity = numberValue(formData, "productivity", 1);
  const teamCount = numberValue(formData, "team_count", 1);
  const plannedStartRaw = text(formData, "planned_start");
  const plannedStartDate = parseIsoDate(plannedStartRaw);
  const status = text(formData, "planning_status") || "draft";
  const predecessorId = optional(formData, "predecessor_id");
  const relationType = text(formData, "relation_type") || "FS";
  const lagDays = Math.trunc(numberValue(formData, "lag_days", 0));

  if (!code || !name || !plannedStartDate || quantity < 0 || productivity <= 0 || teamCount <= 0 || !planningStatuses.has(status) || !relationTypes.has(relationType)) {
    redirect(resultUrl("Revise os dados da atividade.", "error", references.baseline.id));
  }

  const durationDays = Math.max(1, Math.ceil(quantity / (productivity * teamCount)));
  const normalizedStart = normalizeStartDate(plannedStartDate, references.baseline.work_on_saturday);
  const plannedFinish = addWorkdays(normalizedStart, durationDays, references.baseline.work_on_saturday);

  const { data, error } = await references.supabase
    .from("engineering_schedule_activities")
    .insert({
      company_id: references.companyId,
      project_id: references.projectId,
      baseline_id: references.baseline.id,
      service_id: serviceId,
      location_id: locationId,
      code,
      name,
      unit_snapshot: unit,
      quantity_snapshot: quantity,
      productivity_per_team_day: productivity,
      team_count: teamCount,
      duration_days: durationDays,
      planned_start: toIsoDate(normalizedStart),
      planned_finish: toIsoDate(plannedFinish),
      planned_cost: Math.max(0, numberValue(formData, "planned_cost", 0)),
      sort_order: Math.trunc(numberValue(formData, "sort_order", 0)),
      planning_status: status,
      source: "manual",
      notes: optional(formData, "notes"),
      record_status: "active",
      created_by: references.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    const message = error?.code === "23505" ? `Já existe uma atividade com o código ${code}.` : error?.message ?? "Não foi possível criar a atividade.";
    redirect(resultUrl(message, "error", references.baseline.id));
  }

  if (predecessorId) {
    const { error: dependencyError } = await references.supabase.from("engineering_schedule_dependencies").insert({
      company_id: references.companyId,
      project_id: references.projectId,
      baseline_id: references.baseline.id,
      predecessor_id: predecessorId,
      successor_id: data.id,
      relation_type: relationType,
      lag_days: Number.isFinite(lagDays) ? lagDays : 0,
      created_by: references.userId,
    });
    if (dependencyError) redirect(resultUrl(dependencyError.message, "error", references.baseline.id));
  }

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Atividade adicionada ao cronograma.", "success", references.baseline.id));
}

export async function updateScheduleActivity(formData: FormData) {
  const references = await loadBaseline(formData);
  const activityId = text(formData, "activity_id");
  const code = text(formData, "code").toUpperCase();
  const name = text(formData, "name");
  const serviceId = optional(formData, "service_id");
  const locationId = optional(formData, "location_id");
  const quantity = numberValue(formData, "quantity", 0);
  const productivity = numberValue(formData, "productivity", 1);
  const teamCount = numberValue(formData, "team_count", 1);
  const plannedStartDate = parseIsoDate(text(formData, "planned_start"));
  const status = text(formData, "planning_status");
  const recordStatus = text(formData, "record_status") || "active";
  const predecessorId = optional(formData, "predecessor_id");
  const relationType = text(formData, "relation_type") || "FS";
  const lagDays = Math.trunc(numberValue(formData, "lag_days", 0));

  if (!activityId || !code || !name || !plannedStartDate || quantity < 0 || productivity <= 0 || teamCount <= 0 || !planningStatuses.has(status) || !["active", "inactive"].includes(recordStatus) || !relationTypes.has(relationType) || predecessorId === activityId) {
    redirect(resultUrl("Revise os dados da atividade.", "error", references.baseline.id));
  }

  const durationDays = Math.max(1, Math.ceil(quantity / (productivity * teamCount)));
  const normalizedStart = normalizeStartDate(plannedStartDate, references.baseline.work_on_saturday);
  const plannedFinish = addWorkdays(normalizedStart, durationDays, references.baseline.work_on_saturday);

  const { error } = await references.supabase
    .from("engineering_schedule_activities")
    .update({
      service_id: serviceId,
      location_id: locationId,
      code,
      name,
      unit_snapshot: text(formData, "unit") || "un",
      quantity_snapshot: quantity,
      productivity_per_team_day: productivity,
      team_count: teamCount,
      duration_days: durationDays,
      planned_start: toIsoDate(normalizedStart),
      planned_finish: toIsoDate(plannedFinish),
      planned_cost: Math.max(0, numberValue(formData, "planned_cost", 0)),
      sort_order: Math.trunc(numberValue(formData, "sort_order", 0)),
      planning_status: status,
      notes: optional(formData, "notes"),
      record_status: recordStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", activityId)
    .eq("baseline_id", references.baseline.id)
    .eq("company_id", references.companyId)
    .eq("project_id", references.projectId);

  if (error) redirect(resultUrl(error.message, "error", references.baseline.id));

  const { error: deleteError } = await references.supabase
    .from("engineering_schedule_dependencies")
    .delete()
    .eq("successor_id", activityId)
    .eq("baseline_id", references.baseline.id)
    .eq("company_id", references.companyId);
  if (deleteError) redirect(resultUrl(deleteError.message, "error", references.baseline.id));

  if (predecessorId) {
    const { error: dependencyError } = await references.supabase.from("engineering_schedule_dependencies").insert({
      company_id: references.companyId,
      project_id: references.projectId,
      baseline_id: references.baseline.id,
      predecessor_id: predecessorId,
      successor_id: activityId,
      relation_type: relationType,
      lag_days: Number.isFinite(lagDays) ? lagDays : 0,
      created_by: references.userId,
    });
    if (dependencyError) redirect(resultUrl(dependencyError.message, "error", references.baseline.id));
  }

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Atividade atualizada.", "success", references.baseline.id));
}

export async function updateScheduleBaselineStatus(formData: FormData) {
  const references = await loadBaseline(formData);
  const status = text(formData, "status");
  if (!baselineStatuses.has(status) || status === "archived") {
    redirect(resultUrl("Status inválido para a linha de base.", "error", references.baseline.id));
  }

  if (status === "approved") {
    const { count } = await references.supabase
      .from("engineering_schedule_activities")
      .select("id", { count: "exact", head: true })
      .eq("baseline_id", references.baseline.id)
      .eq("record_status", "active")
      .neq("planning_status", "approved");
    if ((count ?? 0) > 0) redirect(resultUrl("Aprove todas as atividades antes de oficializar a linha de base.", "error", references.baseline.id));
  }

  const { error } = await references.supabase
    .from("engineering_schedule_baselines")
    .update({
      status,
      approved_at: status === "approved" ? new Date().toISOString() : null,
      approved_by: status === "approved" ? references.userId : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", references.baseline.id)
    .eq("company_id", references.companyId)
    .eq("project_id", references.projectId);

  if (error) redirect(resultUrl(error.message, "error", references.baseline.id));
  revalidatePath(LIST_PATH);
  redirect(resultUrl(status === "approved" ? "Linha de base aprovada e oficializada." : "Status da linha de base atualizado.", "success", references.baseline.id));
}

export async function generateScheduleFromTakeoffs(formData: FormData) {
  const references = await loadBaseline(formData);
  const { supabase, companyId, projectId, userId, baseline } = references;

  const existingCountResult = await supabase
    .from("engineering_schedule_activities")
    .select("id", { count: "exact", head: true })
    .eq("baseline_id", baseline.id)
    .eq("record_status", "active");
  if ((existingCountResult.count ?? 0) > 0) {
    redirect(resultUrl("Esta linha de base já possui atividades. Use outra revisão para gerar novamente.", "error", baseline.id));
  }

  const [takeoffsResult, servicesResult, locationsResult, budgetItemsResult] = await Promise.all([
    fetchAllRows<Takeoff>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_takeoffs")
        .select("id, service_id, location_id, total_quantity, unit_snapshot")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("budget_id", baseline.budget_id)
        .eq("status", "approved")
        .eq("record_status", "active")
        .order("created_at")
        .range(from, to);
      return { data: (data ?? []) as Takeoff[], error };
    }),
    fetchAllRows<Service>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_services")
        .select("id, code, description, unit")
        .eq("company_id", companyId)
        .eq("status", "active")
        .range(from, to);
      return { data: (data ?? []) as Service[], error };
    }),
    fetchAllRows<Location>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_takeoff_locations")
        .select("id, code, name, sort_order")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("status", "active")
        .order("sort_order")
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as Location[], error };
    }),
    fetchAllRows<BudgetItem>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_budget_items")
        .select("service_id, total_direct_cost, status")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("budget_id", baseline.budget_id)
        .range(from, to);
      return { data: (data ?? []) as BudgetItem[], error };
    }),
  ]);

  if (takeoffsResult.error || servicesResult.error || locationsResult.error || budgetItemsResult.error) {
    redirect(resultUrl("Não foi possível carregar os dados necessários para gerar o cronograma.", "error", baseline.id));
  }

  const budgetHasService = budgetItemsResult.data.some((item) => item.service_id && item.status === "active" && Number(item.total_direct_cost) > 0);
  if (!budgetHasService && takeoffsResult.data.length === 0) {
    redirect(resultUrl("A revisão do orçamento não possui serviços com valor para gerar o cronograma.", "error", baseline.id));
  }

  // Fundação: todo serviço do orçamento vira atividade e a soma das partes de um
  // serviço sempre iguala o valor daquele serviço no orçamento (rateio por quantidade).
  const plan = planScheduleFromBudget({
    services: servicesResult.data,
    budgetItems: budgetItemsResult.data,
    takeoffCells: takeoffsResult.data.map((takeoff) => ({
      service_id: takeoff.service_id,
      location_id: takeoff.location_id,
      total_quantity: Number(takeoff.total_quantity),
      unit_snapshot: takeoff.unit_snapshot,
    })),
    locations: locationsResult.data,
  });

  if (plan.activities.length === 0) redirect(resultUrl("Nenhuma atividade pôde ser gerada.", "error", baseline.id));

  // Datas: 5 dias úteis com 1 equipe como premissa; cada serviço encadeia seus locais no tempo.
  const duration = 5;
  const currentByService = new Map<string, Date>();
  const generatedActivities = plan.activities.map((activity, index) => {
    const start = currentByService.get(activity.serviceId) ?? normalizeStartDate(parseIsoDate(baseline.start_date)!, baseline.work_on_saturday);
    const finish = addWorkdays(start, duration, baseline.work_on_saturday);
    const nextStart = new Date(finish);
    nextStart.setUTCDate(nextStart.getUTCDate() + 1);
    currentByService.set(activity.serviceId, normalizeStartDate(nextStart, baseline.work_on_saturday));
    const quantity = Math.max(0, Number(activity.quantity));
    return {
      company_id: companyId,
      project_id: projectId,
      baseline_id: baseline.id,
      service_id: activity.serviceId,
      location_id: activity.locationId,
      code: activity.code,
      name: activity.name,
      unit_snapshot: activity.unit,
      quantity_snapshot: quantity,
      productivity_per_team_day: quantity > 0 ? quantity / duration : 1,
      team_count: 1,
      duration_days: duration,
      planned_start: toIsoDate(start),
      planned_finish: toIsoDate(finish),
      planned_cost: activity.plannedCost,
      sort_order: index + 1,
      planning_status: "draft",
      source: "takeoff",
      notes: "Premissa inicial: 5 dias úteis com 1 equipe. Valor ancorado no orçamento. Revisar produtividade, equipe e predecessora.",
      record_status: "active",
      created_by: userId,
    };
  });

  const { data: inserted, error: insertError } = await supabase
    .from("engineering_schedule_activities")
    .insert(generatedActivities)
    .select("id, code");
  if (insertError || !inserted) redirect(resultUrl(insertError?.message ?? "Não foi possível gerar as atividades.", "error", baseline.id));

  const activityIdByCode = new Map(inserted.map((activity) => [activity.code, activity.id]));
  // Monta apenas as dependências cujos dois lados existem, em vez de montar
  // tudo e filtrar depois — assim o tipo da linha já nasce sem `undefined`.
  const dependencies = plan.dependencies.flatMap((dependency) => {
    const predecessorId = activityIdByCode.get(dependency.predecessorCode);
    const successorId = activityIdByCode.get(dependency.successorCode);
    if (!predecessorId || !successorId) return [];
    return [{
      company_id: companyId,
      project_id: projectId,
      baseline_id: baseline.id,
      predecessor_id: predecessorId,
      successor_id: successorId,
      relation_type: "FS",
      lag_days: 0,
      created_by: userId,
    }];
  });

  if (dependencies.length > 0) {
    const { error: dependencyError } = await supabase.from("engineering_schedule_dependencies").insert(dependencies);
    if (dependencyError) redirect(resultUrl(dependencyError.message, "error", baseline.id));
  }

  revalidatePath(LIST_PATH);
  const budgetValueLabel = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(plan.totals.budgetValue);
  redirect(resultUrl(`${plan.activities.length} atividade(s) gerada(s) para ${plan.totals.serviceCount} serviço(s) do orçamento (${budgetValueLabel}). Valores ancorados no orçamento; revise as premissas de produtividade.`, "success", baseline.id));
}

type ScheduleActivityRow = {
  id: string;
  code: string;
  planned_start: string;
  planned_finish: string;
  duration_days: number;
  team_count: number;
  productivity_per_team_day: number;
  quantity_snapshot: number;
  planning_status: string;
};

// Reimporta o cronograma a partir do HTML exportado (editado por IA). Aplica
// SOMENTE planejamento no tempo (datas, durações, equipes/produtividade) e as
// amarrações. Valores, serviço, local e quantidade ficam travados no orçamento.
export async function importScheduleFromHtml(formData: FormData) {
  const references = await loadBaseline(formData);
  const { supabase, companyId, projectId, userId, baseline } = references;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(resultUrl("Selecione o arquivo HTML do cronograma exportado.", "error", baseline.id));
  }
  if (file.size > 8 * 1024 * 1024) {
    redirect(resultUrl("Arquivo muito grande. Use o HTML exportado pelo próprio sistema.", "error", baseline.id));
  }

  const html = await file.text();
  const extracted = extractSchedulePayload(html);
  if (!extracted.ok) redirect(resultUrl(extracted.error, "error", baseline.id));
  const payload = extracted.payload;

  if (payload.meta.baselineId && payload.meta.baselineId !== baseline.id) {
    redirect(resultUrl("Este arquivo pertence a outra linha de base. Selecione a linha de base correspondente.", "error", baseline.id));
  }

  const currentActivities = await fetchAllRows<ScheduleActivityRow>(async (from, to) => {
    const { data, error } = await supabase
      .from("engineering_schedule_activities")
      .select("id, code, planned_start, planned_finish, duration_days, team_count, productivity_per_team_day, quantity_snapshot, planning_status")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .eq("baseline_id", baseline.id)
      .eq("record_status", "active")
      .range(from, to);
    return { data: (data ?? []) as ScheduleActivityRow[], error };
  });
  if (currentActivities.error) redirect(resultUrl("Não foi possível carregar as atividades atuais.", "error", baseline.id));

  const activityByCode = new Map(currentActivities.data.map((activity) => [activity.code, activity]));
  const saturday = baseline.work_on_saturday;

  // Tipar as alterações contra a própria tabela faz o build recusar uma coluna
  // que não exista — o arquivo reimportado é montado fora do Elos OS.
  const updates: { id: string; changes: Update<"engineering_schedule_activities"> }[] = [];
  let unmatched = 0;
  payload.activities.forEach((incoming) => {
    const current = activityByCode.get(incoming.code);
    if (!current) { unmatched += 1; return; }

    const startDate = parseIsoDate(String(incoming.plannedStart ?? "").slice(0, 10));
    if (!startDate) { unmatched += 1; return; }
    const duration = Math.max(1, Math.trunc(Number(incoming.durationDays) || current.duration_days || 1));
    const normalizedStart = normalizeStartDate(startDate, saturday);
    const finish = addWorkdays(normalizedStart, duration, saturday);

    const teamCount = Number(incoming.teamCount);
    const productivity = Number(incoming.productivity);
    const status = String(incoming.planningStatus ?? "");

    updates.push({
      id: current.id,
      changes: {
        planned_start: toIsoDate(normalizedStart),
        planned_finish: toIsoDate(finish),
        duration_days: duration,
        team_count: Number.isFinite(teamCount) && teamCount > 0 ? teamCount : current.team_count,
        productivity_per_team_day: Number.isFinite(productivity) && productivity > 0 ? productivity : current.productivity_per_team_day,
        planning_status: planningStatuses.has(status) ? status : current.planning_status,
        updated_at: new Date().toISOString(),
      },
    });
  });

  if (updates.length === 0) {
    redirect(resultUrl("Nenhuma atividade do arquivo corresponde a esta linha de base (confira os códigos).", "error", baseline.id));
  }

  for (const update of updates) {
    const { error } = await supabase
      .from("engineering_schedule_activities")
      .update(update.changes)
      .eq("id", update.id)
      .eq("baseline_id", baseline.id)
      .eq("company_id", companyId)
      .eq("project_id", projectId);
    if (error) redirect(resultUrl(`Falha ao atualizar atividade: ${error.message}`, "error", baseline.id));
  }

  // Reconstrói as amarrações a partir do arquivo (por código).
  const { error: deleteError } = await supabase
    .from("engineering_schedule_dependencies")
    .delete()
    .eq("baseline_id", baseline.id)
    .eq("company_id", companyId);
  if (deleteError) redirect(resultUrl(deleteError.message, "error", baseline.id));

  const seen = new Set<string>();
  const newDependencies = (payload.dependencies ?? [])
    .map((dependency) => {
      const predecessor = activityByCode.get(dependency.predecessorCode);
      const successor = activityByCode.get(dependency.successorCode);
      const relation = String(dependency.relationType ?? "FS");
      if (!predecessor || !successor || predecessor.id === successor.id || !relationTypes.has(relation)) return null;
      const key = `${predecessor.id}:${successor.id}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        company_id: companyId,
        project_id: projectId,
        baseline_id: baseline.id,
        predecessor_id: predecessor.id,
        successor_id: successor.id,
        relation_type: relation,
        lag_days: Math.trunc(Number(dependency.lagDays) || 0),
        created_by: userId,
      };
    })
    .filter((dependency): dependency is NonNullable<typeof dependency> => dependency !== null);

  if (newDependencies.length > 0) {
    const { error: dependencyError } = await supabase.from("engineering_schedule_dependencies").insert(newDependencies);
    if (dependencyError) redirect(resultUrl(dependencyError.message, "error", baseline.id));
  }

  revalidatePath(LIST_PATH);
  const unmatchedNote = unmatched > 0 ? ` ${unmatched} atividade(s) do arquivo sem correspondência foram ignoradas.` : "";
  redirect(resultUrl(`Cronograma reimportado: ${updates.length} atividade(s) e ${newDependencies.length} amarração(ões) atualizadas. Valores mantidos travados no orçamento.${unmatchedNote}`, "success", baseline.id));
}

type CascadeActivityRow = { id: string; planned_start: string; planned_finish: string; duration_days: number };
type CascadeDependencyRow = { predecessor_id: string; successor_id: string; relation_type: "FS" | "SS" | "FF" | "SF"; lag_days: number };

// Move uma atividade no tempo (arrastar) e reprograma as sucessoras em cascata,
// respeitando as amarrações (FS/SS/FF/SF + defasagem). Persiste apenas o
// planejamento no tempo; valores permanecem intactos.
export async function moveScheduleActivity(formData: FormData) {
  const references = await loadBaseline(formData);
  const { supabase, companyId, projectId, baseline } = references;

  const activityId = text(formData, "activity_id");
  const newStart = text(formData, "new_start").slice(0, 10);
  const cascade = formData.get("cascade") !== "off";
  if (!activityId || !parseIsoDate(newStart)) {
    redirect(`${LIST_PATH}?baseline=${baseline.id}`);
  }

  const [activitiesResult, dependenciesResult] = await Promise.all([
    fetchAllRows<CascadeActivityRow>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_schedule_activities")
        .select("id, planned_start, planned_finish, duration_days")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("baseline_id", baseline.id)
        .eq("record_status", "active")
        .range(from, to);
      return { data: (data ?? []) as CascadeActivityRow[], error };
    }),
    fetchAllRows<CascadeDependencyRow>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_schedule_dependencies")
        .select("predecessor_id, successor_id, relation_type, lag_days")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("baseline_id", baseline.id)
        .range(from, to);
      return { data: (data ?? []) as CascadeDependencyRow[], error };
    }),
  ]);

  if (activitiesResult.error || dependenciesResult.error) {
    redirect(resultUrl("Não foi possível carregar o cronograma para mover a atividade.", "error", baseline.id));
  }
  if (!activitiesResult.data.some((activity) => activity.id === activityId)) {
    redirect(`${LIST_PATH}?baseline=${baseline.id}`);
  }

  const reschedule = rescheduleFromMove({
    activities: activitiesResult.data,
    dependencies: dependenciesResult.data,
    movedId: activityId,
    newStart,
    workOnSaturday: baseline.work_on_saturday,
    cascade,
  });

  const changed = new Set(reschedule.changed);
  const updates = reschedule.activities.filter((activity) => changed.has(activity.id));
  const timestamp = new Date().toISOString();
  for (const update of updates) {
    const { error } = await supabase
      .from("engineering_schedule_activities")
      .update({ planned_start: update.plannedStart, planned_finish: update.plannedFinish, updated_at: timestamp })
      .eq("id", update.id)
      .eq("baseline_id", baseline.id)
      .eq("company_id", companyId)
      .eq("project_id", projectId);
    if (error) redirect(resultUrl(`Falha ao mover atividade: ${error.message}`, "error", baseline.id));
  }

  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}?baseline=${baseline.id}`);
}
