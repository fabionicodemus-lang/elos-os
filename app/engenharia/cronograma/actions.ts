"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";

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
type Composition = { id: string; service_id: string };
type CompositionItem = { composition_id: string; input_id: string; effective_coefficient: number };
type Price = { input_id: string; project_id: string | null; final_unit_price: number };

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

  const [takeoffsResult, servicesResult, locationsResult, compositionsResult, itemsResult, pricesResult] = await Promise.all([
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
    fetchAllRows<Composition>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_service_compositions")
        .select("id, service_id")
        .eq("company_id", companyId)
        .eq("status", "active")
        .range(from, to);
      return { data: (data ?? []) as Composition[], error };
    }),
    fetchAllRows<CompositionItem>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_service_composition_items")
        .select("composition_id, input_id, effective_coefficient")
        .eq("company_id", companyId)
        .eq("status", "active")
        .range(from, to);
      return { data: (data ?? []) as CompositionItem[], error };
    }),
    fetchAllRows<Price>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_input_prices")
        .select("input_id, project_id, final_unit_price")
        .eq("company_id", companyId)
        .eq("status", "active")
        .eq("is_adopted", true)
        .range(from, to);
      return { data: (data ?? []) as Price[], error };
    }),
  ]);

  if (takeoffsResult.error || servicesResult.error || locationsResult.error || compositionsResult.error || itemsResult.error || pricesResult.error) {
    redirect(resultUrl("Não foi possível carregar os dados necessários para gerar o cronograma.", "error", baseline.id));
  }
  if (takeoffsResult.data.length === 0) {
    redirect(resultUrl("A revisão não possui levantamentos aprovados para gerar atividades.", "error", baseline.id));
  }

  const serviceMap = new Map(servicesResult.data.map((service) => [service.id, service]));
  const locationMap = new Map(locationsResult.data.map((location) => [location.id, location]));
  const compositionMap = new Map(compositionsResult.data.map((composition) => [composition.service_id, composition.id]));
  const itemsByComposition = new Map<string, CompositionItem[]>();
  itemsResult.data.forEach((item) => {
    const values = itemsByComposition.get(item.composition_id) ?? [];
    values.push(item);
    itemsByComposition.set(item.composition_id, values);
  });
  const corporatePriceMap = new Map<string, number>();
  const projectPriceMap = new Map<string, number>();
  pricesResult.data.forEach((price) => {
    if (price.project_id === projectId) projectPriceMap.set(price.input_id, Number(price.final_unit_price));
    else if (!price.project_id) corporatePriceMap.set(price.input_id, Number(price.final_unit_price));
  });

  const serviceUnitCost = new Map<string, number>();
  servicesResult.data.forEach((service) => {
    const compositionId = compositionMap.get(service.id);
    const items = compositionId ? itemsByComposition.get(compositionId) ?? [] : [];
    const total = items.reduce((sum, item) => {
      const price = projectPriceMap.get(item.input_id) ?? corporatePriceMap.get(item.input_id) ?? 0;
      return sum + Number(item.effective_coefficient) * price;
    }, 0);
    serviceUnitCost.set(service.id, total);
  });

  const grouped = new Map<string, Takeoff>();
  takeoffsResult.data.forEach((takeoff) => {
    const key = `${takeoff.service_id}:${takeoff.location_id ?? "none"}`;
    const current = grouped.get(key);
    if (current) current.total_quantity = Number(current.total_quantity) + Number(takeoff.total_quantity);
    else grouped.set(key, { ...takeoff, total_quantity: Number(takeoff.total_quantity) });
  });

  const rows = [...grouped.values()].sort((a, b) => {
    const serviceCompare = (serviceMap.get(a.service_id)?.code ?? "").localeCompare(serviceMap.get(b.service_id)?.code ?? "", "pt-BR");
    if (serviceCompare !== 0) return serviceCompare;
    return Number(locationMap.get(a.location_id ?? "")?.sort_order ?? 0) - Number(locationMap.get(b.location_id ?? "")?.sort_order ?? 0);
  });

  const currentByService = new Map<string, Date>();
  const previousCodeByService = new Map<string, string>();
  const generatedActivities: Record<string, unknown>[] = [];
  const predecessorCodes: { successorCode: string; predecessorCode: string }[] = [];
  const codeOccurrences = new Map<string, number>();

  rows.forEach((takeoff, index) => {
    const service = serviceMap.get(takeoff.service_id);
    if (!service) return;
    const location = takeoff.location_id ? locationMap.get(takeoff.location_id) : null;
    const baseCode = `${service.code}-${location?.code ?? "GERAL"}`.toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").slice(0, 54);
    const occurrence = (codeOccurrences.get(baseCode) ?? 0) + 1;
    codeOccurrences.set(baseCode, occurrence);
    const code = occurrence === 1 ? baseCode : `${baseCode}-${occurrence}`;
    const quantity = Math.max(0, Number(takeoff.total_quantity));
    const duration = 5;
    const productivity = quantity > 0 ? quantity / duration : 1;
    const start = currentByService.get(service.id) ?? normalizeStartDate(parseIsoDate(baseline.start_date)!, baseline.work_on_saturday);
    const finish = addWorkdays(start, duration, baseline.work_on_saturday);
    const plannedCost = quantity * (serviceUnitCost.get(service.id) ?? 0);

    generatedActivities.push({
      company_id: companyId,
      project_id: projectId,
      baseline_id: baseline.id,
      service_id: service.id,
      location_id: location?.id ?? null,
      code,
      name: `${service.description}${location ? ` · ${location.name}` : ""}`,
      unit_snapshot: takeoff.unit_snapshot || service.unit,
      quantity_snapshot: quantity,
      productivity_per_team_day: productivity,
      team_count: 1,
      duration_days: duration,
      planned_start: toIsoDate(start),
      planned_finish: toIsoDate(finish),
      planned_cost: plannedCost,
      sort_order: index + 1,
      planning_status: "draft",
      source: "takeoff",
      notes: "Premissa inicial: 5 dias úteis com 1 equipe. Revisar produtividade, equipe e predecessora.",
      record_status: "active",
      created_by: userId,
    });

    const previousCode = previousCodeByService.get(service.id);
    if (previousCode) predecessorCodes.push({ successorCode: code, predecessorCode: previousCode });
    previousCodeByService.set(service.id, code);
    const nextStart = new Date(finish);
    nextStart.setUTCDate(nextStart.getUTCDate() + 1);
    currentByService.set(service.id, normalizeStartDate(nextStart, baseline.work_on_saturday));
  });

  if (generatedActivities.length === 0) redirect(resultUrl("Nenhuma atividade pôde ser gerada.", "error", baseline.id));

  const { data: inserted, error: insertError } = await supabase
    .from("engineering_schedule_activities")
    .insert(generatedActivities)
    .select("id, code");
  if (insertError || !inserted) redirect(resultUrl(insertError?.message ?? "Não foi possível gerar as atividades.", "error", baseline.id));

  const activityIdByCode = new Map(inserted.map((activity) => [activity.code, activity.id]));
  const dependencies = predecessorCodes
    .map((dependency) => ({
      company_id: companyId,
      project_id: projectId,
      baseline_id: baseline.id,
      predecessor_id: activityIdByCode.get(dependency.predecessorCode),
      successor_id: activityIdByCode.get(dependency.successorCode),
      relation_type: "FS",
      lag_days: 0,
      created_by: userId,
    }))
    .filter((dependency) => dependency.predecessor_id && dependency.successor_id);

  if (dependencies.length > 0) {
    const { error: dependencyError } = await supabase.from("engineering_schedule_dependencies").insert(dependencies);
    if (dependencyError) redirect(resultUrl(dependencyError.message, "error", baseline.id));
  }

  revalidatePath(LIST_PATH);
  redirect(resultUrl(`${generatedActivities.length} atividade(s) gerada(s) a partir do levantamento aprovado. Revise as premissas de produtividade.`, "success", baseline.id));
}
