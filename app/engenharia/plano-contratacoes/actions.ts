"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";

const PATH = "/engenharia/plano-contratacoes";
const STATUSES = new Set(["planned", "quotation", "negotiation", "approval", "contracted", "mobilization", "completed", "canceled"]);

type Activity = { service_id: string | null; planned_start: string; planned_cost: number };
type Service = { id: string; code: string; description: string };
type BudgetItem = { service_id: string | null; total_direct_cost: number };
type Package = {
  service_id: string;
  supplier_id: string | null;
  quotation_lead_days: number;
  negotiation_lead_days: number;
  contracting_lead_days: number;
  mobilization_lead_days: number;
  status: string;
  responsible: string | null;
  notes: string | null;
};

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (form: FormData, key: string) => text(form, key) || null;
function numberValue(form: FormData, key: string, fallback = 0) {
  const raw = text(form, key);
  if (!raw) return fallback;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : fallback;
}
function url(message: string, type: "error" | "success", baseline?: string) {
  const params = new URLSearchParams({ [type]: message });
  if (baseline) params.set("baseline", baseline);
  return `${PATH}?${params}`;
}
function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const result = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(result.getTime()) ? null : result;
}
function iso(value: Date) { return value.toISOString().slice(0, 10); }
function minus(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() - Math.max(0, Math.trunc(days)));
  return result;
}
function dates(start: Date, quotation: number, negotiation: number, contracting: number, mobilization: number) {
  const mobilizationStart = minus(start, mobilization);
  const contractDeadline = minus(mobilizationStart, contracting);
  const negotiationStart = minus(contractDeadline, negotiation);
  return {
    quotation_start: iso(minus(negotiationStart, quotation)),
    negotiation_start: iso(negotiationStart),
    contract_deadline: iso(contractDeadline),
    mobilization_start: iso(mobilizationStart),
  };
}
function recommended(description: string) {
  const value = description.toLocaleLowerCase("pt-BR");
  if (/(elevador|esquadria|fachada|estrutura metálica|gerador|transformador|subestação)/.test(value)) return [60, 30, 20, 70];
  if (/(ar condicionado|incêndio|elétrica|hidráulica|automação|impermeabilização)/.test(value)) return [40, 20, 15, 35];
  if (/(revestimento|porcelanato|gesso|pintura|marcenaria|paisagismo)/.test(value)) return [30, 15, 10, 20];
  return [25, 15, 10, 15];
}

async function context(form: FormData) {
  const baselineId = text(form, "baseline_id");
  const workspace = await requireCompanyPermission("schedule.manage");
  if (!workspace.projectId) redirect(url("Selecione uma obra.", "error"));
  if (!baselineId) redirect(url("Selecione uma linha de base.", "error"));
  const { data: baseline } = await workspace.supabase
    .from("engineering_schedule_baselines")
    .select("id, budget_id, status")
    .eq("id", baselineId)
    .eq("company_id", workspace.companyId)
    .eq("project_id", workspace.projectId)
    .maybeSingle();
  if (!baseline || baseline.status === "archived") redirect(url("Linha de base indisponível.", "error"));
  // A obra já foi validada acima; devolver o contexto com projectId não-nulo
  // evita espalhar `!` por cada consulta e gravação daqui para baixo.
  return {
    ...workspace,
    projectId: workspace.projectId,
    baseline: baseline as { id: string; budget_id: string; status: string },
  };
}

export async function generateContractPlanFromSchedule(form: FormData) {
  const ctx = await context(form);
  const [activitiesResult, servicesResult, itemsResult, packagesResult] = await Promise.all([
    fetchAllRows<Activity>(async (from, to) => {
      const { data, error } = await ctx.supabase.from("engineering_schedule_activities")
        .select("service_id, planned_start, planned_cost").eq("baseline_id", ctx.baseline.id)
        .eq("company_id", ctx.companyId).eq("project_id", ctx.projectId!).eq("record_status", "active").range(from, to);
      return { data: (data ?? []) as Activity[], error };
    }),
    fetchAllRows<Service>(async (from, to) => {
      const { data, error } = await ctx.supabase.from("engineering_services")
        .select("id, code, description").eq("company_id", ctx.companyId).eq("status", "active").range(from, to);
      return { data: (data ?? []) as Service[], error };
    }),
    fetchAllRows<BudgetItem>(async (from, to) => {
      const { data, error } = await ctx.supabase.from("engineering_budget_items")
        .select("service_id, total_direct_cost").eq("budget_id", ctx.baseline.budget_id)
        .eq("company_id", ctx.companyId).eq("project_id", ctx.projectId!).eq("status", "active").range(from, to);
      return { data: (data ?? []) as BudgetItem[], error };
    }),
    fetchAllRows<Package>(async (from, to) => {
      const { data, error } = await ctx.supabase.from("engineering_contract_packages")
        .select("service_id, supplier_id, quotation_lead_days, negotiation_lead_days, contracting_lead_days, mobilization_lead_days, status, responsible, notes")
        .eq("baseline_id", ctx.baseline.id).eq("company_id", ctx.companyId).range(from, to);
      return { data: (data ?? []) as Package[], error };
    }),
  ]);
  const error = activitiesResult.error || servicesResult.error || itemsResult.error || packagesResult.error;
  if (error) redirect(url(error.message, "error", ctx.baseline.id));

  const serviceMap = new Map(servicesResult.data.map((item) => [item.id, item]));
  const existingMap = new Map(packagesResult.data.map((item) => [item.service_id, item]));
  const budgetMap = new Map<string, number>();
  itemsResult.data.forEach((item) => item.service_id && budgetMap.set(item.service_id, (budgetMap.get(item.service_id) ?? 0) + Number(item.total_direct_cost ?? 0)));
  const grouped = new Map<string, Activity[]>();
  activitiesResult.data.forEach((item) => {
    if (!item.service_id) return;
    grouped.set(item.service_id, [...(grouped.get(item.service_id) ?? []), item]);
  });

  const rows = [...grouped].flatMap(([serviceId, activities]) => {
    const service = serviceMap.get(serviceId);
    if (!service) return [];
    const saved = existingMap.get(serviceId);
    const defaults = recommended(service.description);
    const leads = [saved?.quotation_lead_days ?? defaults[0], saved?.negotiation_lead_days ?? defaults[1], saved?.contracting_lead_days ?? defaults[2], saved?.mobilization_lead_days ?? defaults[3]].map(Number);
    const plannedStart = activities.map((item) => item.planned_start).sort()[0];
    const start = date(plannedStart);
    if (!start) return [];
    const explicit = activities.reduce((sum, item) => sum + Math.max(0, Number(item.planned_cost ?? 0)), 0);
    return [{
      company_id: ctx.companyId, project_id: ctx.projectId, baseline_id: ctx.baseline.id, service_id: serviceId,
      supplier_id: saved?.supplier_id ?? null, code: `CONT-${service.code}`.toUpperCase(), name: service.description,
      planned_service_start: plannedStart, quotation_lead_days: leads[0], negotiation_lead_days: leads[1],
      contracting_lead_days: leads[2], mobilization_lead_days: leads[3], ...dates(start, leads[0], leads[1], leads[2], leads[3]),
      planned_value: Math.max(0, budgetMap.get(serviceId) ?? explicit), status: saved?.status ?? "planned",
      responsible: saved?.responsible ?? null, notes: saved?.notes ?? null, record_status: "active", created_by: ctx.userId,
      updated_at: new Date().toISOString(),
    }];
  });
  if (!rows.length) redirect(url("A linha de base não possui atividades vinculadas a serviços.", "error", ctx.baseline.id));
  const { error: saveError } = await ctx.supabase.from("engineering_contract_packages").upsert(rows, { onConflict: "baseline_id,service_id" });
  if (saveError) redirect(url(saveError.message, "error", ctx.baseline.id));
  revalidatePath(PATH);
  redirect(url(`${rows.length} pacote(s) sincronizado(s) com o cronograma.`, "success", ctx.baseline.id));
}

export async function updateContractPackage(form: FormData) {
  const ctx = await context(form);
  const packageId = text(form, "package_id");
  const startText = text(form, "planned_service_start");
  const start = date(startText);
  const quotation = Math.max(0, Math.trunc(numberValue(form, "quotation_lead_days")));
  const negotiation = Math.max(0, Math.trunc(numberValue(form, "negotiation_lead_days")));
  const contracting = Math.max(0, Math.trunc(numberValue(form, "contracting_lead_days")));
  const mobilization = Math.max(0, Math.trunc(numberValue(form, "mobilization_lead_days")));
  const status = text(form, "status");
  if (!packageId || !start || !STATUSES.has(status)) redirect(url("Revise os dados do pacote.", "error", ctx.baseline.id));
  const { error } = await ctx.supabase.from("engineering_contract_packages").update({
    supplier_id: optional(form, "supplier_id"), planned_service_start: startText,
    quotation_lead_days: quotation, negotiation_lead_days: negotiation, contracting_lead_days: contracting,
    mobilization_lead_days: mobilization, ...dates(start, quotation, negotiation, contracting, mobilization),
    planned_value: Math.max(0, numberValue(form, "planned_value")), status,
    responsible: optional(form, "responsible"), notes: optional(form, "notes"), updated_at: new Date().toISOString(),
  }).eq("id", packageId).eq("baseline_id", ctx.baseline.id).eq("company_id", ctx.companyId).eq("project_id", ctx.projectId!);
  if (error) redirect(url(error.message, "error", ctx.baseline.id));
  revalidatePath(PATH);
  redirect(url("Pacote de contratação atualizado.", "success", ctx.baseline.id));
}
