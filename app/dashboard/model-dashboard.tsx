import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { createClient } from "@/lib/supabase/server";
import { bootstrapWorkspace } from "./actions";
import {
  BudgetSummary,
  CashFlowChart,
  CommercialSummary,
  CriticalPoints,
  ModelCard,
  ModelKpi,
  PhysicalCurve,
  StageProgress,
  compactDashboardMoney,
  type CashFlowMonth,
  type DashboardRisk,
  type PhysicalMonth,
  type StageProgressRow,
} from "./dashboard-model-components";
import { DashboardPrintButton } from "./dashboard-print-button";
import "../dashboard-model.css";

const DAY_MS = 86_400_000;

type Company = { id: string; name: string; slug: string };
type Role = { id: string; key: string; name: string };
type Membership = { company_id: string; role_id: string; companies: Company | Company[] | null; roles: Role | Role[] | null };
type Project = {
  id: string;
  company_id: string;
  name: string;
  code: string | null;
  status: string;
  construction_start_date: string | null;
  delivery_date: string | null;
  total_units: number | null;
};
type UnitRow = { id: string; project_id: string; code: string; status: string; list_price: number | null };
type ProposalSummary = { pipeline_count: number; pipeline_amount: number; expiring_count: number };
type SalesSummary = { active_count: number; total_amount: number; average_ticket: number };
type PayablesSummary = { open_count: number; open_amount: number; paid_amount: number };
type ReceivablesSummary = { open_count: number; open_amount: number; paid_amount: number; overdue_count: number };
type AssistanceSummary = { overdue_count: number; urgent_count: number; open_count: number };
type PayableRow = {
  id: string;
  project_id: string | null;
  due_date: string;
  amount: number;
  status: "open" | "paid" | "cancelled";
  paid_at: string | null;
  paid_amount: number | null;
};
type ReceivableRow = {
  id: string;
  project_id: string | null;
  due_date: string;
  amount: number;
  adjusted_amount: number | null;
  status: "open" | "paid" | "cancelled";
  paid_at: string | null;
  paid_amount: number | null;
};
type PurchaseOrderRow = {
  id: string;
  project_id: string;
  status: string;
  total_amount: number;
  received_amount: number;
  expected_delivery_date: string | null;
};
type Budget = { id: string; code: string; name: string; version: string; status: string; updated_at: string };
type BudgetItem = { id: string; budget_id: string; total_direct_cost: number; status: string };
type Baseline = { id: string; budget_id: string; code: string; name: string; version: string; status: string; updated_at: string };
type ScheduleActivity = {
  id: string;
  baseline_id: string;
  service_id: string | null;
  quantity_snapshot: number;
  duration_days: number;
  planned_start: string;
  planned_finish: string;
  planned_cost: number;
  record_status: string;
};
type ScheduleMeasurement = {
  id: string;
  activity_id: string;
  measurement_date: string;
  progress_percent: number;
  current_finish: string | null;
  created_at: string;
};
type ScheduleWeight = { service_id: string; physical_weight_percent: number; distribution_method: "quantity" | "cost" | "duration" | "equal" };
type EngineeringService = { id: string; code: string; description: string; group_code: string | null };
type PhysicalSnapshot = { planned: number; actual: number; delayed: number; forecastIso: string | null; baseline: string };

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function localDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`);
}

function addMonths(value: string, months: number) {
  const date = parseDate(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 12)).toISOString().slice(0, 10);
}

function monthEnd(value: string) {
  const date = parseDate(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10);
}

function monthKey(value: string) {
  return value.slice(0, 7);
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(parseDate(value)).replace(" de ", "/").replace(".", "");
}

function dateBR(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(parseDate(value)) : "—";
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

function daysBetween(from: string, to: string) {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / DAY_MS);
}

function emptyResult<T>() {
  return Promise.resolve({ data: [] as T[], error: null });
}

function normalized(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!values.length) return [];
  if (total <= 0) return values.map(() => 100 / values.length);
  return values.map((value) => value / total * 100);
}

function plannedProgress(activity: ScheduleActivity, selectedDate: string) {
  const date = parseDate(selectedDate);
  const start = parseDate(activity.planned_start);
  const finish = parseDate(activity.planned_finish);
  if (date < start) return 0;
  if (date >= finish) return 100;
  const total = Math.max(1, Math.round((finish.getTime() - start.getTime()) / DAY_MS) + 1);
  const elapsed = Math.max(0, Math.round((date.getTime() - start.getTime()) / DAY_MS) + 1);
  return Math.min(100, elapsed / total * 100);
}

function distributionValue(activity: ScheduleActivity, method: ScheduleWeight["distribution_method"]) {
  if (method === "equal") return 1;
  if (method === "cost") return Math.max(0, Number(activity.planned_cost));
  if (method === "duration") return Math.max(0, Number(activity.duration_days));
  return Math.max(0, Number(activity.quantity_snapshot));
}

function calculateActivityWeights(activities: ScheduleActivity[], weights: ScheduleWeight[]) {
  const active = activities.filter((activity) => activity.record_status === "active");
  const groups = new Map<string, ScheduleActivity[]>();
  active.forEach((activity) => {
    const key = activity.service_id ?? `activity:${activity.id}`;
    groups.set(key, [...(groups.get(key) ?? []), activity]);
  });
  const entries = [...groups.entries()];
  const allLinked = active.every((activity) => Boolean(activity.service_id));
  const configured = allLinked && weights.length === entries.length && Math.abs(weights.reduce((sum, item) => sum + Number(item.physical_weight_percent), 0) - 100) <= 0.01;
  const configuredMap = new Map(weights.map((item) => [item.service_id, item]));
  const groupCosts = entries.map(([, rows]) => rows.reduce((sum, row) => sum + Math.max(0, Number(row.planned_cost)), 0));
  const groupDurations = entries.map(([, rows]) => rows.reduce((sum, row) => sum + Math.max(1, Number(row.duration_days)), 0));
  const suggestions = normalized(groupCosts.reduce((sum, value) => sum + value, 0) > 0 ? groupCosts : groupDurations);
  const activityWeights = new Map<string, number>();

  entries.forEach(([groupKey, rows], groupIndex) => {
    const current = configured ? configuredMap.get(groupKey) : null;
    const groupWeight = Number(current?.physical_weight_percent ?? suggestions[groupIndex] ?? 0);
    const method = current?.distribution_method ?? "quantity";
    let values = rows.map((activity) => distributionValue(activity, method));
    if (values.reduce((sum, value) => sum + value, 0) <= 0) values = rows.map((activity) => Math.max(1, Number(activity.duration_days)));
    const total = values.reduce((sum, value) => sum + value, 0) || rows.length || 1;
    rows.forEach((activity, index) => activityWeights.set(activity.id, groupWeight * values[index] / total));
  });

  return activityWeights;
}

function calculatePhysicalSnapshot(
  activities: ScheduleActivity[],
  measurements: ScheduleMeasurement[],
  activityWeights: Map<string, number>,
  selectedDate: string,
  baseline: Baseline | null,
): PhysicalSnapshot {
  const active = activities.filter((activity) => activity.record_status === "active");
  if (!baseline || !active.length) return { planned: 0, actual: 0, delayed: 0, forecastIso: null, baseline: "Não definida" };

  const latest = new Map<string, ScheduleMeasurement>();
  measurements
    .filter((item) => item.measurement_date <= selectedDate)
    .sort((a, b) => a.measurement_date.localeCompare(b.measurement_date) || a.created_at.localeCompare(b.created_at))
    .forEach((item) => latest.set(item.activity_id, item));

  const totalWeight = active.reduce((sum, activity) => sum + Number(activityWeights.get(activity.id) ?? 0), 0) || 100;
  const planned = active.reduce((sum, activity) => sum + plannedProgress(activity, selectedDate) * Number(activityWeights.get(activity.id) ?? 0), 0) / totalWeight;
  const actual = active.reduce((sum, activity) => sum + Number(latest.get(activity.id)?.progress_percent ?? 0) * Number(activityWeights.get(activity.id) ?? 0), 0) / totalWeight;
  const delayed = active.filter((activity) => Number(latest.get(activity.id)?.progress_percent ?? 0) + 0.5 < plannedProgress(activity, selectedDate)).length;
  const forecastIso = active.reduce<string | null>((value, activity) => {
    const finish = latest.get(activity.id)?.current_finish ?? activity.planned_finish;
    return !value || finish > value ? finish : value;
  }, null);

  return { planned, actual, delayed, forecastIso, baseline: `${baseline.code} · ${baseline.version}` };
}

function buildPhysicalMonths(
  activities: ScheduleActivity[],
  measurements: ScheduleMeasurement[],
  activityWeights: Map<string, number>,
  baseline: Baseline | null,
  today: string,
): PhysicalMonth[] {
  const active = activities.filter((activity) => activity.record_status === "active");
  if (!baseline || !active.length) return [];
  const first = active.map((item) => item.planned_start).sort()[0];
  const last = active.map((item) => item.planned_finish).sort().at(-1);
  if (!first || !last) return [];
  const rows: PhysicalMonth[] = [];
  let cursor = `${first.slice(0, 7)}-01`;
  const limit = `${last.slice(0, 7)}-01`;
  let guard = 0;
  while (cursor <= limit && guard < 48) {
    const selectedDate = monthEnd(cursor);
    const snapshot = calculatePhysicalSnapshot(active, measurements, activityWeights, selectedDate, baseline);
    const current = monthKey(cursor) === monthKey(today);
    rows.push({
      key: monthKey(cursor),
      label: monthLabel(cursor),
      planned: snapshot.planned,
      actual: selectedDate <= today || current ? snapshot.actual : null,
      current,
    });
    cursor = addMonths(cursor, 1);
    guard += 1;
  }
  return rows;
}

function buildCashFlowMonths(payables: PayableRow[], receivables: ReceivableRow[], today: string): CashFlowMonth[] {
  const start = addMonths(`${today.slice(0, 7)}-01`, -3);
  let cumulative = 0;
  return Array.from({ length: 9 }, (_, index) => {
    const key = monthKey(addMonths(start, index));
    const received = receivables
      .filter((item) => item.status === "paid" && item.paid_at && monthKey(item.paid_at) === key)
      .reduce((sum, item) => sum + Number(item.paid_amount ?? item.adjusted_amount ?? item.amount), 0);
    const receivable = receivables
      .filter((item) => item.status === "open" && monthKey(item.due_date) === key)
      .reduce((sum, item) => sum + Number(item.adjusted_amount ?? item.amount), 0);
    const paid = payables
      .filter((item) => item.status === "paid" && item.paid_at && monthKey(item.paid_at) === key)
      .reduce((sum, item) => sum + Number(item.paid_amount ?? item.amount), 0);
    const payable = payables
      .filter((item) => item.status === "open" && monthKey(item.due_date) === key)
      .reduce((sum, item) => sum + Number(item.amount), 0);
    cumulative += received + receivable - paid - payable;
    return { key, label: monthLabel(`${key}-01`), received, receivable, paid, payable, cumulative };
  });
}

function buildStageRows(
  activities: ScheduleActivity[],
  measurements: ScheduleMeasurement[],
  activityWeights: Map<string, number>,
  services: EngineeringService[],
  today: string,
  baseline: Baseline | null,
): StageProgressRow[] {
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const grouped = new Map<string, ScheduleActivity[]>();
  activities.filter((activity) => activity.record_status === "active").forEach((activity) => {
    const service = activity.service_id ? serviceMap.get(activity.service_id) : null;
    const key = service?.group_code || service?.code || "Outras atividades";
    grouped.set(key, [...(grouped.get(key) ?? []), activity]);
  });

  return [...grouped.entries()]
    .map(([key, rows]) => {
      const snapshot = calculatePhysicalSnapshot(rows, measurements, activityWeights, today, baseline);
      return { key, label: key.replace(/\s*•\s*/g, " · "), planned: snapshot.planned, actual: snapshot.actual };
    })
    .sort((a, b) => b.planned - a.planned || b.actual - a.actual)
    .slice(0, 7);
}

export default async function ModelDashboardPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();
  if (authError || !authData?.claims) redirect("/login");
  const userId = typeof authData.claims.sub === "string" ? authData.claims.sub : "";

  const membershipResult = await supabase.from("company_memberships")
    .select("company_id, role_id, companies(id, name, slug), roles(id, key, name)")
    .eq("user_id", userId).eq("status", "active").order("created_at");
  const schemaMissing = Boolean(membershipResult.error && (membershipResult.error.code === "42P01" || membershipResult.error.message.includes("company_memberships")));
  const memberships = (membershipResult.data ?? []) as unknown as Membership[];
  const companyIds = memberships.map((membership) => membership.company_id);
  const projectResult = companyIds.length
    ? await supabase.from("projects").select("id, company_id, name, code, status, construction_start_date, delivery_date, total_units")
      .in("company_id", companyIds).neq("status", "archived").order("name")
    : { data: [], error: null };
  const projects = (projectResult.data ?? []) as Project[];
  const cookieStore = await cookies();
  const requestedCompanyId = cookieStore.get("elos_company_id")?.value;
  const requestedProjectId = cookieStore.get("elos_project_id")?.value;
  const activeMembership = memberships.find((membership) => membership.company_id === requestedCompanyId) ?? memberships[0] ?? null;
  const activeCompany = activeMembership ? relatedOne(activeMembership.companies) : null;
  const activeRole = activeMembership ? relatedOne(activeMembership.roles) : null;
  const companyProjects = activeCompany ? projects.filter((project) => project.company_id === activeCompany.id) : [];
  const activeProject = companyProjects.find((project) => project.id === requestedProjectId) ?? companyProjects[0] ?? null;

  if (schemaMissing || memberships.length === 0 || !activeCompany) {
    return <main className="auth-page">
      <section className="auth-brand"><div className="auth-logo">E</div><div><span className="auth-kicker">Elos OS</span><h1>Construção conectada</h1><p>Configure o primeiro ambiente para iniciar a operação multiempresa.</p></div></section>
      {schemaMissing
        ? <section className="auth-card"><div className="auth-card-header"><span>Banco de dados</span><h2>Instalar estrutura inicial</h2></div><p>Execute no Supabase o arquivo <code>supabase/migrations/20260722_0001_multitenancy.sql</code>.</p></section>
        : <form className="auth-card workspace-form" action={bootstrapWorkspace}><div className="auth-card-header"><span>Cadastro inicial</span><h2>Empresa e obra</h2></div><label>Nome da empresa<input name="company_name" defaultValue="Bossa Empreendimentos" required /></label><label>Identificador<input name="company_slug" defaultValue="bossa" /></label><label>Primeira obra<input name="project_name" defaultValue="Flow Aptos" /></label><label>Código da obra<input name="project_code" defaultValue="FLOW" /></label><button className="auth-primary" type="submit">Criar ambiente da Bossa</button></form>}
    </main>;
  }

  const privileged = activeRole?.key === "owner" || activeRole?.key === "admin";
  const permissionResult = privileged
    ? await supabase.from("permissions").select("key")
    : activeRole
      ? await supabase.from("role_permissions").select("permission_key").eq("role_id", activeRole.id).eq("allowed", true)
      : { data: [], error: null };
  const permissions = new Set(privileged
    ? ((permissionResult.data ?? []) as { key: string }[]).map((item) => item.key)
    : ((permissionResult.data ?? []) as { permission_key: string }[]).map((item) => item.permission_key));
  const can = (permission: string) => privileged || permissions.has(permission);
  const projectId = activeProject?.id ?? null;
  const today = localDateIso();
  const cashStart = addMonths(`${today.slice(0, 7)}-01`, -4);
  const cashEnd = monthEnd(addMonths(`${today.slice(0, 7)}-01`, 9));

  let unitsPromise = can("projects.view") || can("sales.view")
    ? supabase.from("units").select("id,project_id,code,status,list_price").eq("company_id", activeCompany.id).limit(5000)
    : null;
  if (unitsPromise && projectId) unitsPromise = unitsPromise.eq("project_id", projectId);

  const proposalSummaryPromise = can("commercial.proposals.view")
    ? supabase.rpc("commercial_proposals_summary", { p_company_id: activeCompany.id, p_project_id: projectId })
    : Promise.resolve({ data: null, error: null });
  const salesSummaryPromise = can("sales.view")
    ? supabase.rpc("sales_summary", { p_company_id: activeCompany.id, p_project_id: projectId })
    : Promise.resolve({ data: null, error: null });
  const payablesSummaryPromise = can("payables.view")
    ? supabase.rpc("payables_summary", { p_company_id: activeCompany.id, p_project_id: projectId })
    : Promise.resolve({ data: null, error: null });
  const receivablesSummaryPromise = can("receivables.view")
    ? supabase.rpc("receivables_summary", { p_company_id: activeCompany.id, p_project_id: projectId, p_sale_id: null })
    : Promise.resolve({ data: null, error: null });
  const assistanceSummaryPromise = can("postwork.assistance.view")
    ? supabase.rpc("postwork_assistance_summary", { p_company_id: activeCompany.id, p_project_id: projectId })
    : Promise.resolve({ data: null, error: null });

  let payablesPromise = can("payables.view")
    ? supabase.from("payables").select("id,project_id,due_date,amount,status,paid_at,paid_amount")
      .eq("company_id", activeCompany.id).neq("status", "cancelled").gte("due_date", cashStart).lte("due_date", cashEnd).order("due_date").limit(10000)
    : null;
  if (payablesPromise && projectId) payablesPromise = payablesPromise.eq("project_id", projectId);

  let receivablesPromise = can("receivables.view")
    ? supabase.from("receivables").select("id,project_id,due_date,amount,adjusted_amount,status,paid_at,paid_amount")
      .eq("company_id", activeCompany.id).neq("status", "cancelled").gte("due_date", cashStart).lte("due_date", cashEnd).order("due_date").limit(10000)
    : null;
  if (receivablesPromise && projectId) receivablesPromise = receivablesPromise.eq("project_id", projectId);

  const ordersPromise = can("procurement.orders.view") ? fetchAllRows<PurchaseOrderRow>(async (from, to) => {
    let query = supabase.from("procurement_purchase_orders").select("id,project_id,status,total_amount,received_amount,expected_delivery_date")
      .eq("company_id", activeCompany.id).range(from, to);
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query;
    return { data: (data ?? []) as PurchaseOrderRow[], error };
  }) : emptyResult<PurchaseOrderRow>();

  let budgetsPromise = can("budgets.view")
    ? supabase.from("engineering_budgets").select("id,code,name,version,status,updated_at").eq("company_id", activeCompany.id).order("updated_at", { ascending: false }).limit(100)
    : null;
  if (budgetsPromise && projectId) budgetsPromise = budgetsPromise.eq("project_id", projectId);
  const baselinesPromise = can("schedule.view") && projectId
    ? supabase.from("engineering_schedule_baselines").select("id,budget_id,code,name,version,status,updated_at")
      .eq("company_id", activeCompany.id).eq("project_id", projectId).neq("status", "archived").order("updated_at", { ascending: false }).limit(100)
    : null;
  const servicesPromise = can("schedule.view")
    ? supabase.from("engineering_services").select("id,code,description,group_code").eq("company_id", activeCompany.id).eq("status", "active").limit(5000)
    : null;

  const [
    unitsResult,
    proposalSummaryResult,
    salesSummaryResult,
    payablesSummaryResult,
    receivablesSummaryResult,
    assistanceSummaryResult,
    payablesResult,
    receivablesResult,
    ordersResult,
    budgetsResult,
    baselinesResult,
    servicesResult,
  ] = await Promise.all([
    unitsPromise ?? emptyResult<UnitRow>(),
    proposalSummaryPromise,
    salesSummaryPromise,
    payablesSummaryPromise,
    receivablesSummaryPromise,
    assistanceSummaryPromise,
    payablesPromise ?? emptyResult<PayableRow>(),
    receivablesPromise ?? emptyResult<ReceivableRow>(),
    ordersPromise,
    budgetsPromise ?? emptyResult<Budget>(),
    baselinesPromise ?? emptyResult<Baseline>(),
    servicesPromise ?? emptyResult<EngineeringService>(),
  ]);

  const units = (unitsResult.data ?? []) as UnitRow[];
  const payables = (payablesResult.data ?? []) as PayableRow[];
  const receivables = (receivablesResult.data ?? []) as ReceivableRow[];
  const orders = ordersResult.data;
  const budgets = (budgetsResult.data ?? []) as Budget[];
  const baselines = (baselinesResult.data ?? []) as Baseline[];
  const services = (servicesResult.data ?? []) as EngineeringService[];
  const proposalSummary = (proposalSummaryResult.data ?? {}) as Partial<ProposalSummary>;
  const salesSummary = (salesSummaryResult.data ?? {}) as Partial<SalesSummary>;
  const payablesSummary = (payablesSummaryResult.data ?? {}) as Partial<PayablesSummary>;
  const receivablesSummary = (receivablesSummaryResult.data ?? {}) as Partial<ReceivablesSummary>;
  const assistanceSummary = (assistanceSummaryResult.data ?? {}) as Partial<AssistanceSummary>;

  const selectedBaseline = baselines.find((item) => item.status === "approved") ?? baselines[0] ?? null;
  const selectedBudget = selectedBaseline
    ? budgets.find((item) => item.id === selectedBaseline.budget_id) ?? null
    : budgets.find((item) => item.status === "approved") ?? budgets[0] ?? null;

  const [activitiesResult, measurementsResult, weightsResult, budgetItemsResult] = selectedBaseline && projectId
    ? await Promise.all([
      fetchAllRows<ScheduleActivity>(async (from, to) => {
        const { data, error } = await supabase.from("engineering_schedule_activities")
          .select("id,baseline_id,service_id,quantity_snapshot,duration_days,planned_start,planned_finish,planned_cost,record_status")
          .eq("company_id", activeCompany.id).eq("project_id", projectId).eq("baseline_id", selectedBaseline.id).eq("record_status", "active").range(from, to);
        return { data: (data ?? []) as ScheduleActivity[], error };
      }),
      fetchAllRows<ScheduleMeasurement>(async (from, to) => {
        const { data, error } = await supabase.from("engineering_schedule_progress_measurements")
          .select("id,activity_id,measurement_date,progress_percent,current_finish,created_at")
          .eq("company_id", activeCompany.id).eq("project_id", projectId).order("measurement_date").order("created_at").range(from, to);
        return { data: (data ?? []) as ScheduleMeasurement[], error };
      }),
      fetchAllRows<ScheduleWeight>(async (from, to) => {
        const { data, error } = await supabase.from("engineering_schedule_service_weights")
          .select("service_id,physical_weight_percent,distribution_method")
          .eq("company_id", activeCompany.id).eq("project_id", projectId).eq("baseline_id", selectedBaseline.id).range(from, to);
        return { data: (data ?? []) as ScheduleWeight[], error };
      }),
      selectedBudget
        ? fetchAllRows<BudgetItem>(async (from, to) => {
          const { data, error } = await supabase.from("engineering_budget_items")
            .select("id,budget_id,total_direct_cost,status")
            .eq("company_id", activeCompany.id).eq("budget_id", selectedBudget.id).eq("status", "active").range(from, to);
          return { data: (data ?? []) as BudgetItem[], error };
        })
        : emptyResult<BudgetItem>(),
    ])
    : [
      await emptyResult<ScheduleActivity>(),
      await emptyResult<ScheduleMeasurement>(),
      await emptyResult<ScheduleWeight>(),
      selectedBudget
        ? await fetchAllRows<BudgetItem>(async (from, to) => {
          const { data, error } = await supabase.from("engineering_budget_items")
            .select("id,budget_id,total_direct_cost,status")
            .eq("company_id", activeCompany.id).eq("budget_id", selectedBudget.id).eq("status", "active").range(from, to);
          return { data: (data ?? []) as BudgetItem[], error };
        })
        : await emptyResult<BudgetItem>(),
    ];

  const activities = activitiesResult.data;
  const measurements = measurementsResult.data;
  const activityWeights = calculateActivityWeights(activities, weightsResult.data);
  const physical = calculatePhysicalSnapshot(activities, measurements, activityWeights, today, selectedBaseline);
  const physicalMonths = buildPhysicalMonths(activities, measurements, activityWeights, selectedBaseline, today);
  const stageRows = buildStageRows(activities, measurements, activityWeights, services, today, selectedBaseline);
  const cashMonths = buildCashFlowMonths(payables, receivables, today);

  const budgetTotal = budgetItemsResult.data.reduce((sum, item) => sum + Number(item.total_direct_cost ?? 0), 0);
  const paidAmount = Number(payablesSummary.paid_amount ?? 0);
  const committedAmount = Number(payablesSummary.open_amount ?? 0);
  const budgetRemaining = Math.max(0, budgetTotal - paidAmount - committedAmount);
  const earnedValue = budgetTotal * physical.actual / 100;
  const cpi = paidAmount > 0 && earnedValue > 0 ? earnedValue / paidAmount : null;
  const spi = physical.planned > 0 ? physical.actual / physical.planned : null;
  const physicalVariance = physical.actual - physical.planned;
  const deliverySlack = activeProject?.delivery_date && physical.forecastIso ? daysBetween(physical.forecastIso, activeProject.delivery_date) : null;

  const activeUnits = units.filter((item) => item.status !== "inactive");
  const soldUnits = units.filter((item) => item.status === "sold");
  const availableUnits = units.filter((item) => item.status === "available");
  const vgvAvailable = availableUnits.reduce((sum, item) => sum + Number(item.list_price ?? 0), 0);
  const salesRatio = activeUnits.length ? soldUnits.length / activeUnits.length * 100 : 0;

  const currentMonthStart = `${today.slice(0, 7)}-01`;
  const nineMonthEnd = monthEnd(addMonths(currentMonthStart, 8));
  const futureReceivables = receivables
    .filter((item) => item.status === "open" && item.due_date >= today && item.due_date <= nineMonthEnd)
    .reduce((sum, item) => sum + Number(item.adjusted_amount ?? item.amount), 0);
  const futurePayables = payables
    .filter((item) => item.status === "open" && item.due_date >= today && item.due_date <= nineMonthEnd)
    .reduce((sum, item) => sum + Number(item.amount), 0);
  const nextNineBalance = futureReceivables - futurePayables;

  const overduePayables = payables.filter((item) => item.status === "open" && item.due_date < today);
  const overdueReceivables = receivables.filter((item) => item.status === "open" && item.due_date < today);
  const delayedOrders = orders.filter((item) => !["received", "closed", "cancelled"].includes(item.status) && item.expected_delivery_date && item.expected_delivery_date < today);
  const risks: DashboardRisk[] = [];
  if (physicalVariance < -2) risks.push({
    id: "physical-delay",
    severity: physicalVariance < -8 ? "high" : "medium",
    title: "Avanço físico abaixo do previsto",
    description: `Desvio de ${Math.abs(physicalVariance).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p. e ${physical.delayed} atividade(s) atrasada(s).`,
    href: "/execucao/cronograma",
  });
  if (overduePayables.length) risks.push({
    id: "overdue-payables",
    severity: "high",
    title: `${overduePayables.length} conta(s) a pagar vencida(s)`,
    description: `Valor em atraso: ${money(overduePayables.reduce((sum, item) => sum + Number(item.amount), 0))}.`,
    href: "/financeiro/contas-a-pagar?status=open",
  });
  if (overdueReceivables.length) risks.push({
    id: "overdue-receivables",
    severity: "medium",
    title: `${overdueReceivables.length} recebível(is) vencido(s)`,
    description: `Inadimplência acumulada: ${money(overdueReceivables.reduce((sum, item) => sum + Number(item.adjusted_amount ?? item.amount), 0))}.`,
    href: "/financeiro/contas-a-receber?status=open",
  });
  if (Number(assistanceSummary.overdue_count ?? 0) > 0) risks.push({
    id: "assistance-overdue",
    severity: "high",
    title: `${assistanceSummary.overdue_count} assistência(s) fora do SLA`,
    description: `${assistanceSummary.urgent_count ?? 0} chamado(s) urgente(s) aguardam atendimento.`,
    href: "/pos-obra/assistencias",
  });
  if (delayedOrders.length) risks.push({
    id: "orders-delayed",
    severity: "medium",
    title: `${delayedOrders.length} entrega(s) de compra atrasada(s)`,
    description: "Pedidos emitidos ainda possuem saldo de material pendente de recebimento.",
    href: "/suprimentos/pedidos-compras",
  });
  if (budgetTotal > 0 && paidAmount + committedAmount > budgetTotal) risks.push({
    id: "budget-overrun",
    severity: "high",
    title: "Compromissos acima do orçamento",
    description: `Pago e comprometido superam o orçamento em ${money(paidAmount + committedAmount - budgetTotal)}.`,
    href: "/engenharia/orcamento-analitico",
  });
  if (Number(proposalSummary.expiring_count ?? 0) > 0) risks.push({
    id: "proposals-expiring",
    severity: "medium",
    title: `${proposalSummary.expiring_count} proposta(s) próxima(s) do vencimento`,
    description: `Pipeline atual: ${money(Number(proposalSummary.pipeline_amount ?? 0))}.`,
    href: "/comercial/propostas",
  });

  const criticalCount = risks.filter((risk) => risk.severity === "high").length;
  const overallStatus = criticalCount > 0 ? "critical" : risks.length || physicalVariance < -2 ? "attention" : "ok";
  const statusLabel = overallStatus === "critical" ? "Situação: crítica" : overallStatus === "attention" ? "Situação: atenção" : "Situação: dentro do plano";
  const projectMeta = activeProject
    ? [activeProject.name, activeProject.total_units ? `${activeProject.total_units} unidades` : "", activeProject.delivery_date ? `entrega ${dateBR(activeProject.delivery_date)}` : ""].filter(Boolean).join(" · ")
    : `${activeCompany.name} · visão consolidada da empresa`;

  return <AppShell
    activeGroup="home"
    eyebrow="Início · Gestão executiva"
    title="Dashboard Geral"
    description={`${activeCompany.name} · ${activeProject?.code ? `${activeProject.code} · ` : ""}${activeProject?.name ?? "Todos os empreendimentos"}.`}
    actions={<Link className="elos-button" href="/dashboard">Atualizar indicadores</Link>}
  >
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

    <div className="v20-dashboard">
      <header className="v20-head">
        <div><h2>Visão geral da obra</h2><p>{projectMeta}</p></div>
        <div className="v20-head-actions"><span className={`v20-status ${overallStatus}`}>{statusLabel}</span><DashboardPrintButton /></div>
      </header>

      {!activeProject ? <div className="v20-project-missing"><b>Nenhum empreendimento selecionado</b>Use o seletor no topo ou acesse Empreendimentos para iniciar.</div> : <div className="v20-grid">
        {can("schedule.view") ? <ModelKpi
          icon="↗"
          tone="green"
          label="Avanço físico"
          value={`${physical.actual.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
          detail={<><span className={physicalVariance >= 0 ? "v20-up" : physicalVariance < -2 ? "v20-down" : "v20-flat"}>{physicalVariance >= 0 ? "▲" : "▼"} {Math.abs(physicalVariance).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.</span> vs previsto {physical.planned.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</>}
          href="/execucao/cronograma"
        /> : null}
        {can("schedule.view") ? <ModelKpi
          icon="◷"
          tone="amber"
          label="Prazo · SPI"
          value={spi === null ? "—" : spi.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          detail={spi === null ? "Cronograma sem linha de base" : <span className={spi >= 1 ? "v20-up" : "v20-down"}>{spi >= 1 ? "Ritmo no plano ou acima" : "Ritmo abaixo do previsto"}</span>}
          href="/execucao/cronograma"
        /> : null}
        {can("budgets.view") || can("payables.view") ? <ModelKpi
          icon="R$"
          tone="green"
          label="Custo · CPI"
          value={cpi === null ? "—" : cpi.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          detail={cpi === null ? "Consolide orçamento e custos" : <span className={cpi >= 1 ? "v20-up" : "v20-down"}>{cpi >= 1 ? "Custo favorável ao avanço" : "Custo acima do valor agregado"}</span>}
          href="/engenharia/orcamento-analitico"
        /> : null}
        {can("sales.view") || can("projects.view") ? <ModelKpi
          icon="◇"
          tone="blue"
          label="Vendas · VGV"
          value={activeUnits.length ? `${salesRatio.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%` : "—"}
          detail={activeUnits.length ? `${soldUnits.length} de ${activeUnits.length} unidades · ${compactDashboardMoney(Number(salesSummary.total_amount ?? 0))}` : "Cadastre as unidades privativas"}
          href="/comercial/vendas"
        /> : null}
        {can("payables.view") || can("receivables.view") ? <ModelKpi
          icon="▤"
          tone="purple"
          label="Saldo · próximos 9m"
          value={`${nextNineBalance >= 0 ? "+" : ""}${compactDashboardMoney(nextNineBalance)}`}
          detail={<span className={nextNineBalance >= 0 ? "v20-up" : "v20-down"}>{nextNineBalance >= 0 ? "Caixa projetado positivo" : "Necessidade de caixa projetada"}</span>}
          href="/financeiro/fluxo-de-caixa"
        /> : null}
        {can("schedule.view") ? <ModelKpi
          icon="▣"
          tone="red"
          label="Folga de prazo"
          value={deliverySlack === null ? "—" : <>{Math.abs(deliverySlack)} <small>dias</small></>}
          detail={<span className={deliverySlack === null ? "v20-flat" : deliverySlack >= 0 ? "v20-up" : "v20-down"}>{deliverySlack === null ? "Informe a entrega da obra" : deliverySlack >= 0 ? "Folga até a entrega" : "Atraso projetado"}</span>}
          href="/engenharia/cronograma"
        /> : null}

        {can("schedule.view") ? <ModelCard title="Avanço físico — curva S e planilha mensal" subtitle="% acumulado · previsto versus realizado" href="/execucao/cronograma" linkLabel="Abrir controle do cronograma" span={12}><PhysicalCurve rows={physicalMonths} /></ModelCard> : null}
        {can("payables.view") || can("receivables.view") ? <ModelCard title="Fluxo de caixa" subtitle="3 meses anteriores + 6 meses projetados" href="/financeiro/fluxo-de-caixa" linkLabel="Abrir fluxo completo" span={8}><CashFlowChart rows={cashMonths} money={money} /></ModelCard> : null}
        {can("sales.view") || can("projects.view") ? <ModelCard title="Comercial" subtitle="Unidades e VGV" href="/comercial/vendas" linkLabel="Abrir vendas" span={4}><CommercialSummary sold={soldUnits.length} total={activeUnits.length} vgvSold={Number(salesSummary.total_amount ?? 0)} vgvAvailable={vgvAvailable} money={money} /></ModelCard> : null}
        {can("schedule.view") ? <ModelCard title="Avanço por etapa" subtitle="Realizado versus meta prevista" href="/execucao/cronograma" linkLabel="Ver cronograma" span={5}><StageProgress rows={stageRows} /></ModelCard> : null}
        {can("budgets.view") || can("payables.view") ? <ModelCard title="Orçamento" subtitle="Controle gerencial de custos" href="/engenharia/orcamento-analitico" linkLabel="Abrir controle" span={3}><BudgetSummary total={budgetTotal} paid={paidAmount} committed={committedAmount} remaining={budgetRemaining} money={money} /></ModelCard> : null}
        <ModelCard title="Pontos críticos" subtitle={`${risks.length || 1} indicador(es) automático(s)`} span={4}><CriticalPoints risks={risks} /></ModelCard>
      </div>}

      {(unitsResult.error || payablesResult.error || receivablesResult.error || ordersResult.error || activitiesResult.error || measurementsResult.error || weightsResult.error || budgetItemsResult.error)
        ? <div className="dashboard-data-note">Alguns indicadores não puderam ser carregados. Os demais dados continuam disponíveis normalmente.</div>
        : null}
      <span className="dashboard-context-note">Contexto atual: {activeProject ? `${activeProject.code ? `${activeProject.code} · ` : ""}${activeProject.name}` : activeCompany.name}</span>
      <span className="v20-version-stamp">Dashboard do modelo original · V0.64.0</span>
    </div>
  </AppShell>;
}
