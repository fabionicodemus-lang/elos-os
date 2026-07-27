"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";

const LIST_PATH = "/engenharia/plano-contratacoes";
const packageStatuses = new Set([
  "planned",
  "quotation",
  "negotiation",
  "approval",
  "contracted",
  "mobilization",
  "completed",
  "canceled",
]);

type Baseline = {
  id: string;
  budget_id: string;
  project_id: string;
  status: string;
};

type Activity = {
  service_id: string | null;
  planned_start: string;
  planned_cost: number;
  record_status: "active" | "inactive";
};

type Service = { id: string; code: string; description: string };
type BudgetItem = { service_id: string | null; total_direct_cost: number; status: string };
type ExistingPackage = {
  service_id: string;
  supplier_id: string | null;
  quotation_lead_days: number;
  negotiation_lead_days: number;
  contracting_lead_days: number;
  mobilization_lead_days: number;
  status: string;
  responsible: string | null;
  notes: string | null;
  record_status: string;
};

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function numberValue(formData: FormData, key: string, fallback = Number.NaN) {
  const raw = text(formData, key);
  if (!raw) return fallback;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
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

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function subtractDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - Math.max(0, Math.trunc(days)));
  return result;
}

function calculateDates(
  serviceStart: Date,
  quotationDays: number,
  negotiationDays: number,
  contractingDays: number,
  mobilizationDays: number,
) {
  const mobilizationStart = subtractDays(serviceStart, mobilizationDays);
  const contractDeadline = subtractDays(mobilizationStart, contractingDays);
  const negotiationStart = subtractDays(contractDeadline, negotiationDays);
  const quotationStart = subtractDays(negotiationStart, quotationDays);
  return {
    quotation_start: isoDate(quotationStart),
    negotiation_start: isoDate(negotiationStart),
    contract_deadline: isoDate(contractDeadline),
    mobilization_start: isoDate(mobilizationStart),
  };
}

function recommendedLeadTimes(description: string) {
  const value = description.toLocaleLowerCase("pt-BR");
  if (/(elevador|esquadria|fachada|estrutura metálica|gerador|transformador|subestação)/.test(value)) {
    return { quotation: 60, negotiation: 30, contracting: 20, mobilization: 70 };
  }
  if (/(ar condicionado|incêndio|elétrica|hidráulica|automação|impermeabilização)/.test(value)) {
    return { quotation: 40, negotiation: 20, contracting: 15, mobilization: 35 };
  }
  if (/(revestimento|porcelanato|gesso|pintura|marcenaria|paisagismo)/.test(value)) {
    return { quotation: 30, negotiation: 15, contracting: 10, mobilization: 20 };
  }
  return { quotation: 25, negotiation: 15, contracting: 10, mobilization: 15 };
}

async function loadBaseline(formData: FormData) {
  const baselineId = text(formData, "baseline_id");
  const { supabase, companyId, projectId, userId } = await requireCompanyPermission("schedule.manage");
  if (!projectId) redirect(resultUrl("Selecione uma obra antes de usar o plano de contratações."));
  if (!baselineId) redirect(resultUrl("Selecione uma linha de base."));

  const { data: baseline } = await supabase
    .from("engineering_schedule_baselines")
    .select("id, budget_id, project_id, status")
    .eq("id", baselineId)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!baseline || baseline.status === "archived") {
    redirect(resultUrl("A linha de base selecionada não está disponível."));
  }

  return { supabase, companyId, projectId, userId, baseline: baseline as Baseline };
}

export async function generateContractPlanFromSchedule(formData: FormData) {
  const references = await loadBaseline(formData);

  const [activitiesResult, servicesResult, budgetItemsResult, existingResult] = await Promise.all([
    fetchAllRows<Activity>(async (from, to) => {
      const { data, error } = await references.supabase
        .from("engineering_schedule_activities")
        .select("service_id, planned_start, planned_cost, record_status")
        .eq("baseline_id", references.baseline.id)
        .eq("company_id", references.companyId)
        .eq("project_id", references.projectId)
        .eq("record_status", "active")
        .range(from, to);
      return { data: (data ?? []) as Activity[], error };
    }),
    fetchAllRows<Service>(async (from, to) => {
      const { data, error } = await references.supabase
        .from("engineering_services")
        .select("id, code, description")
        .eq("company_id", references.companyId)
        .eq("status", "active")
        .range(from, to);
      return { data: (data ?? []) as Service[], error };
    }),
    fetchAllRows<BudgetItem>(async (from, to) => {
      const { data, error } = await references.supabase
        .from("engineering_budget_items")
        .select("service_id, total_direct_cost, status")
        .eq("budget_id", references.baseline.budget_id)
        .eq("company_id", references.companyId)
        .eq("project_id", references.projectId)
        .eq("status", "active")
        .range(from, to);
      return { data: (data ?? []) as BudgetItem[], error };
    }),
    fetchAllRows<ExistingPackage>(async (from, to) => {
      const { data, error } = await references.supabase
        .from("engineering_contract_packages")
        .select("service_id, supplier_id, quotation_lead_days, negotiation_lead_days, contracting_lead_days, mobilization_lead_days, status, responsible, notes, record_status")
        .eq("baseline_id", references.baseline.id)
        .eq("company_id", references.companyId)
        .range(from, to);
      return { data: (data ?? []) as ExistingPackage[], error };
    }),
  ]);

  const firstError = activitiesResult.error || servicesResult.error || budgetItemsResult.error || existingResult.error;
  if (firstError) redirect(resultUrl(firstError.message, "error", references.baseline.id));

  const serviceMap = new Map(servicesResult.data.map((service) => [service.id, service]));
  const existingMap = new Map(existingResult.data.map((item) => [item.service_id, item]));
  const budgetTotals = new Map<string, number>();
  budgetItemsResult.data.forEach((item) => {
    if (!item.service_id) return;
    budgetTotals.set(item.service_id, (budgetTotals.get(item.service_id) ?? 0) + Number(item.total_direct_cost ?? 0));
  });

  const grouped = new Map<string, Activity[]>();
  activitiesResult.data.forEach((activity) => {
    if (!activity.service_id) return;
    const rows = grouped.get(activity.service_id) ?? [];
    rows.push(activity);
    grouped.set(activity.service_id, rows);
  });

  const rows = [...grouped.entries()].flatMap(([serviceId, activities]) => {
    const service = serviceMap.get(serviceId);
    if (!service) return [];
    const existing = existingMap.get(serviceId);
    const recommended = recommendedLeadTimes(service.description);
    const quotationDays = Number(existing?.quotation_lead_days ?? recommended.quotation);
    const negotiationDays = Number(existing?.negotiation_lead_days ?? recommended.negotiation);
    const contractingDays = Number(existing?.contracting_lead_days ?? recommended.contracting);
    const mobilizationDays = Number(existing?.mobilization_lead_days ?? recommended.mobilization);
    const plannedStart = activities.reduce((earliest, activity) => activity.planned_start < earliest ? activity.planned_start : earliest, activities[0].planned_start);
    const serviceStart = parseIsoDate(plannedStart);
    if (!serviceStart) return [];
    const explicitCost = activities.reduce((sum, activity) => sum + Math.max(0, Number(activity.planned_cost ?? 0)), 0);
    const plannedValue = Math.max(0, budgetTotals.get(serviceId) ?? explicitCost);

    return [{
      company_id: references.companyId,
      project_id: references.projectId,
      baseline_id: references.baseline.id,
      service_id: serviceId,
      supplier_id: existing?.supplier_id ?? null,
      code: `CONT-${service.code}`.toUpperCase(),
      name: service.description,
      planned_service_start: plannedStart,
      quotation_lead_days: quotationDays,
      negotiation_lead_days: negotiationDays,
      contracting_lead_days: contractingDays,
      mobilization_lead_days: mobilizationDays,
      ...calculateDates(serviceStart, quotationDays, negotiationDays, contractingDays, mobilizationDays),
      planned_value: plannedValue,
      status: existing?.status ?? "planned",
      responsible: existing?.responsible ?? null,
      notes: existing?.notes ?? null,
      record_status: existing?.record_status ?? "active",
      created_by: references.userId,
      updated_at: new Date().toISOString(),
    }];
  });

  if (!rows.length) {
    redirect(resultUrl("A linha de base não possui atividades vinculadas a serviços.", "error", references.baseline.id));
  }

  const { error } = await references.supabase
    .from("engineering_contract_packages")
    .upsert(rows, { onConflict: "baseline_id,service_id" });

  if (error) redirect(resultUrl(error.message, "error", references.baseline.id));

  revalidatePath(LIST_PATH);
  redirect(resultUrl(`${rows.length} pacote(s) sincronizado(s) com o cronograma.`, "success", references.baseline.id));
}

export async function updateContractPackage(formData: FormData) {
  const references = await loadBaseline(formData);
  const packageId = text(formData, "package_id");
  const plannedStartRaw = text(formData, "planned_service_start");
  const plannedStart = parseIsoDate(plannedStartRaw);
  const quotationDays = Math.max(0, Math.trunc(numberValue(formData, "quotation_lead_days", 0)));
  const negotiationDays = Math.max(0, Math.trunc(numberValue(formData, "negotiation_lead_days", 0)));
  const contractingDays = Math.max(0, Math.trunc(numberValue(formData, "contracting_lead_days", 0)));
  const mobilizationDays = Math.max(0, Math.trunc(numberValue(formData, "mobilization_lead_days", 0)));
  const plannedValue = Math.max(0, numberValue(formData, "planned_value", 0));
  const status = text(formData, "status");

  if (!packageId || !plannedStart || !packageStatuses.has(status)) {
    redirect(resultUrl("Revise os dados do pacote de contratação.", "error", references.baseline.id));
  }

  const { error } = await references.supabase
    .from("engineering_contract_packages")
    .update({
      supplier_id: optional(formData, "supplier_id"),
      planned_service_start: plannedStartRaw,
      quotation_lead_days: quotationDays,
      negotiation_lead_days: negotiationDays,
      contracting_lead_days: contractingDays,
      mobilization_lead_days: mobilizationDays,
      ...calculateDates(plannedStart, quotationDays, negotiationDays, contractingDays, mobilizationDays),
      planned_value: plannedValue,
      status,
      responsible: optional(formData, "responsible"),
      notes: optional(formData, "notes"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", packageId)
    .eq("baseline_id", references.baseline.id)
    .eq("company_id", references.companyId)
    .eq("project_id", references.projectId);

  if (error) redirect(resultUrl(error.message, "error", references.baseline.id));

  revalidatePath(LIST_PATH);
  redirect(resultUrl("Pacote de contratação atualizado.", "success", references.baseline.id));
}
