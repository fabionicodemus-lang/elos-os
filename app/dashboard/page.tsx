import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { createClient } from "@/lib/supabase/server";
import { bootstrapWorkspace, selectWorkspace } from "./actions";
import {
  AttentionList,
  CashForecast,
  CommercialPipeline,
  DashboardSection,
  ExecutiveKpi,
  PhysicalProgress,
  RecentActivity,
  UnitInventory,
  type CashMonth,
  type DashboardActivity,
  type DashboardAlert,
} from "./dashboard-components";

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
type ProposalSummary = {
  total_count: number; draft_count: number; pipeline_count: number; approved_count: number; converted_count: number;
  pipeline_amount: number; approved_amount: number; converted_amount: number; expiring_count: number; expired_open_count: number;
};
type SalesSummary = { total_count: number; active_count: number; cancelled_count: number; total_amount: number; average_ticket: number; payment_plan_missing_count: number };
type PayablesSummary = { total_count: number; open_count: number; paid_count: number; cancelled_count: number; total_amount: number; open_amount: number; paid_amount: number };
type ReceivablesSummary = {
  base_amount: number; updated_amount: number; correction_amount: number; active_sales: number; total_count: number;
  open_count: number; paid_count: number; overdue_count: number; open_amount: number; paid_amount: number;
};
type AssistanceSummary = {
  total_count: number; open_count: number; urgent_count: number; overdue_count: number; scheduled_count: number;
  in_progress_count: number; resolved_count: number; covered_count: number; supplier_cost: number; material_cost: number;
  customer_charge: number; average_rating: number | null;
};
type WarrantySummary = {
  policy_count: number; active_asset_count: number; expiring_count: number; expired_count: number;
  maintenance_due_count: number; maintenance_overdue_count: number; pending_claim_count: number; covered_claim_count: number;
};
type PayableRow = { id: string; project_id: string | null; due_date: string; amount: number; status: string; document: string | null; created_at?: string };
type ReceivableRow = { id: string; project_id: string | null; due_date: string; amount: number; adjusted_amount: number | null; status: string; description: string; created_at?: string };
type ProposalRow = { id: string; project_id: string; number: string; status: string; proposed_amount: number; valid_until: string; created_at: string };
type SaleRow = { id: string; project_id: string; number: string; status: string; total_amount: number; sale_date: string; created_at: string };
type PurchaseOrderRow = {
  id: string; project_id: string; order_number: string; status: string; total_amount: number; received_amount: number;
  expected_delivery_date: string | null; created_at: string;
};
type ContractRow = { id: string; project_id: string; contract_number: string; title: string; status: string; current_value: number; measured_value: number; paid_value: number; created_at: string };
type WorkOrderRow = { id: string; project_id: string; work_order_number: string; title: string; status: string; planned_finish: string | null; created_at: string };
type AssistanceRow = { id: string; project_id: string; number: string; title: string; status: string; priority: string; sla_due_at: string | null; created_at: string };
type MaintenanceRow = { id: string; project_id: string; title: string; due_date: string; status: string };
type TaxRow = { id: string; project_id: string; due_date: string; total_amount: number; status: string; reference: string };
type Budget = { id: string; code: string; name: string; version: string; status: string; updated_at: string };
type BudgetItem = { id: string; budget_id: string; total_direct_cost: number; status: string };
type Baseline = { id: string; budget_id: string; code: string; name: string; version: string; status: string; updated_at: string };
type ScheduleActivity = {
  id: string; baseline_id: string; service_id: string | null; quantity_snapshot: number; duration_days: number;
  planned_start: string; planned_finish: string; planned_cost: number; record_status: string;
};
type ScheduleMeasurement = {
  id: string; activity_id: string; measurement_date: string; progress_percent: number; current_finish: string | null; created_at: string;
};
type ScheduleWeight = { service_id: string; physical_weight_percent: number; distribution_method: "quantity" | "cost" | "duration" | "equal" };

type PhysicalSnapshot = { planned: number; actual: number; delayed: number; forecast: string; baseline: string };

type RecentRecord = { id: string; project_id: string; created_at: string };

function relatedOne<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function localDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function parseDate(value: string) { return new Date(`${value.slice(0, 10)}T12:00:00Z`); }
function addDays(value: string, days: number) { const date = parseDate(value); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function addMonths(value: string, months: number) { const date = parseDate(value); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 12)).toISOString().slice(0, 10); }
function monthKey(value: string) { return value.slice(0, 7); }
function monthLabel(value: string) { return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(parseDate(value)).replace(" de ", "/"); }
function dateBR(value: string | null | undefined) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(parseDate(value)) : "—"; }
function dateTimeBR(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "—";
}
function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value ?? 0));
}
function openRecord(projectId: string | null | undefined, destination: string) {
  return projectId ? `/busca/abrir?project=${encodeURIComponent(projectId)}&to=${encodeURIComponent(destination)}` : destination;
}
function emptyResult<T>() { return Promise.resolve({ data: [] as T[], error: null }); }
function normalized(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!values.length) return [];
  if (total <= 0) return values.map(() => 100 / values.length);
  return values.map((value) => value / total * 100);
}
function plannedProgress(activity: ScheduleActivity, selectedDate: string) {
  const date = parseDate(selectedDate); const start = parseDate(activity.planned_start); const finish = parseDate(activity.planned_finish);
  if (date < start) return 0; if (date >= finish) return 100;
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
function calculatePhysicalSnapshot(
  activities: ScheduleActivity[], measurements: ScheduleMeasurement[], weights: ScheduleWeight[], selectedDate: string, baseline: Baseline | null,
): PhysicalSnapshot {
  const active = activities.filter((activity) => activity.record_status === "active");
  if (!baseline || !active.length) return { planned: 0, actual: 0, delayed: 0, forecast: "Sem cronograma", baseline: "Não definida" };

  const latest = new Map<string, ScheduleMeasurement>();
  measurements.filter((item) => item.measurement_date <= selectedDate)
    .sort((a, b) => a.measurement_date.localeCompare(b.measurement_date) || a.created_at.localeCompare(b.created_at))
    .forEach((item) => latest.set(item.activity_id, item));

  const groups = new Map<string, ScheduleActivity[]>();
  active.forEach((activity) => {
    const key = activity.service_id ?? `activity:${activity.id}`;
    groups.set(key, [...(groups.get(key) ?? []), activity]);
  });
  const groupEntries = [...groups.entries()];
  const allLinked = active.every((activity) => Boolean(activity.service_id));
  const configured = allLinked && weights.length === groupEntries.length && Math.abs(weights.reduce((sum, item) => sum + Number(item.physical_weight_percent), 0) - 100) <= 0.01;
  const configuredMap = new Map(weights.map((item) => [item.service_id, item]));
  const groupCosts = groupEntries.map(([, rows]) => rows.reduce((sum, row) => sum + Math.max(0, Number(row.planned_cost)), 0));
  const groupDurations = groupEntries.map(([, rows]) => rows.reduce((sum, row) => sum + Math.max(1, Number(row.duration_days)), 0));
  const suggestions = normalized(groupCosts.reduce((sum, value) => sum + value, 0) > 0 ? groupCosts : groupDurations);
  const activityWeights = new Map<string, number>();

  groupEntries.forEach(([groupKey, rows], groupIndex) => {
    const current = configured ? configuredMap.get(groupKey) : null;
    const groupWeight = Number(current?.physical_weight_percent ?? suggestions[groupIndex] ?? 0);
    const method = current?.distribution_method ?? "quantity";
    let values = rows.map((activity) => distributionValue(activity, method));
    if (values.reduce((sum, value) => sum + value, 0) <= 0) values = rows.map((activity) => Math.max(1, Number(activity.duration_days)));
    const total = values.reduce((sum, value) => sum + value, 0) || rows.length || 1;
    rows.forEach((activity, index) => activityWeights.set(activity.id, groupWeight * values[index] / total));
  });

  const planned = active.reduce((sum, activity) => sum + plannedProgress(activity, selectedDate) * (activityWeights.get(activity.id) ?? 0), 0) / 100;
  const actual = active.reduce((sum, activity) => sum + Number(latest.get(activity.id)?.progress_percent ?? 0) * (activityWeights.get(activity.id) ?? 0), 0) / 100;
  const delayed = active.filter((activity) => Number(latest.get(activity.id)?.progress_percent ?? 0) + 0.5 < plannedProgress(activity, selectedDate)).length;
  const forecast = active.reduce((value, activity) => {
    const finish = latest.get(activity.id)?.current_finish ?? activity.planned_finish;
    return !value || finish > value ? finish : value;
  }, "");
  return { planned, actual, delayed, forecast: dateBR(forecast), baseline: `${baseline.code} · ${baseline.version}` };
}
function buildCashMonths(receivables: ReceivableRow[], payables: PayableRow[], today: string): CashMonth[] {
  const start = `${today.slice(0, 7)}-01`;
  return Array.from({ length: 6 }, (_, index) => {
    const key = monthKey(addMonths(start, index));
    const receivable = receivables.filter((item) => monthKey(item.due_date) === key).reduce((sum, item) => sum + Number(item.adjusted_amount ?? item.amount), 0);
    const payable = payables.filter((item) => monthKey(item.due_date) === key).reduce((sum, item) => sum + Number(item.amount), 0);
    return { key, label: monthLabel(`${key}-01`), receivable, payable, balance: receivable - payable };
  });
}

const projectStatusLabels: Record<string, string> = { planning: "Planejamento", active: "Em construção", paused: "Pausado", completed: "Concluído", archived: "Arquivado" };
const proposalStatusLabels: Record<string, string> = { draft: "Rascunho", sent: "Enviada", negotiation: "Em negociação", approved: "Aprovada", rejected: "Recusada", expired: "Vencida", cancelled: "Cancelada", converted: "Convertida" };
const orderStatusLabels: Record<string, string> = { draft: "Em elaboração", issued: "Emitido", confirmed: "Confirmado", partially_received: "Recebimento parcial", received: "Recebido", closed: "Encerrado", cancelled: "Cancelado" };
const workOrderStatusLabels: Record<string, string> = { draft: "Em elaboração", released: "Liberada", in_progress: "Em execução", paused: "Pausada", pending_acceptance: "Aguardando aceite", finished: "Concluída", cancelled: "Cancelada" };
const assistanceStatusLabels: Record<string, string> = { open: "Aberto", triage: "Em triagem", inspection_scheduled: "Vistoria agendada", awaiting_supplier: "Aguardando prestador", approved: "Aprovado", in_progress: "Em execução", awaiting_acceptance: "Aguardando aceite", resolved: "Resolvido", rejected: "Rejeitado", cancelled: "Cancelado" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
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
      {schemaMissing ? <section className="auth-card"><div className="auth-card-header"><span>Banco de dados</span><h2>Instalar estrutura inicial</h2></div><p>Execute no Supabase o arquivo <code>supabase/migrations/20260722_0001_multitenancy.sql</code>.</p></section>
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
  const can = (permission: string) => permissions.has(permission);
  const projectId = activeProject?.id ?? null;
  const today = localDateIso();
  const nextSevenDays = addDays(today, 7);
  const horizonEnd = addMonths(`${today.slice(0, 7)}-01`, 6);

  const suppliersPromise = can("suppliers.view") ? supabase.from("suppliers").select("id", { count: "exact", head: true }).eq("company_id", activeCompany.id) : Promise.resolve({ count: 0, data: null, error: null });
  const clientsPromise = can("clients.view") ? supabase.from("clients").select("id", { count: "exact", head: true }).eq("company_id", activeCompany.id) : Promise.resolve({ count: 0, data: null, error: null });
  let unitsPromise = can("projects.view") || can("sales.view") || can("commercial.proposals.view")
    ? supabase.from("units").select("id,project_id,code,status,list_price").eq("company_id", activeCompany.id).limit(5000)
    : null;
  if (unitsPromise && projectId) unitsPromise = unitsPromise.eq("project_id", projectId);

  const proposalSummaryPromise = can("commercial.proposals.view") ? supabase.rpc("commercial_proposals_summary", { p_company_id: activeCompany.id, p_project_id: projectId }) : Promise.resolve({ data: null, error: null });
  let proposalsPromise = can("commercial.proposals.view") ? supabase.from("commercial_proposals").select("id,project_id,number,status,proposed_amount,valid_until,created_at").eq("company_id", activeCompany.id).order("created_at", { ascending: false }).limit(20) : null;
  if (proposalsPromise && projectId) proposalsPromise = proposalsPromise.eq("project_id", projectId);
  const salesSummaryPromise = can("sales.view") ? supabase.rpc("sales_summary", { p_company_id: activeCompany.id, p_project_id: projectId }) : Promise.resolve({ data: null, error: null });
  let salesPromise = can("sales.view") ? supabase.from("sales").select("id,project_id,number,status,total_amount,sale_date,created_at").eq("company_id", activeCompany.id).order("created_at", { ascending: false }).limit(20) : null;
  if (salesPromise && projectId) salesPromise = salesPromise.eq("project_id", projectId);

  const payablesSummaryPromise = can("payables.view") ? supabase.rpc("payables_summary", { p_company_id: activeCompany.id, p_project_id: projectId }) : Promise.resolve({ data: null, error: null });
  let payablesPromise = can("payables.view") ? supabase.from("payables").select("id,project_id,due_date,amount,status,document,created_at").eq("company_id", activeCompany.id).eq("status", "open").lte("due_date", horizonEnd).order("due_date").limit(5000) : null;
  if (payablesPromise && projectId) payablesPromise = payablesPromise.eq("project_id", projectId);
  const receivablesSummaryPromise = can("receivables.view") ? supabase.rpc("receivables_summary", { p_company_id: activeCompany.id, p_project_id: projectId, p_sale_id: null }) : Promise.resolve({ data: null, error: null });
  let receivablesPromise = can("receivables.view") ? supabase.from("receivables").select("id,project_id,due_date,amount,adjusted_amount,status,description,created_at").eq("company_id", activeCompany.id).eq("status", "open").lte("due_date", horizonEnd).order("due_date").limit(5000) : null;
  if (receivablesPromise && projectId) receivablesPromise = receivablesPromise.eq("project_id", projectId);

  let ordersPromise = can("procurement.orders.view") ? fetchAllRows<PurchaseOrderRow>(async (from, to) => {
    let query = supabase.from("procurement_purchase_orders").select("id,project_id,order_number,status,total_amount,received_amount,expected_delivery_date,created_at").eq("company_id", activeCompany.id).order("created_at", { ascending: false }).range(from, to);
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query; return { data: (data ?? []) as PurchaseOrderRow[], error };
  }) : emptyResult<PurchaseOrderRow>();
  let contractsPromise = can("execution.contracts.view") ? fetchAllRows<ContractRow>(async (from, to) => {
    let query = supabase.from("execution_service_contracts").select("id,project_id,contract_number,title,status,current_value,measured_value,paid_value,created_at").eq("company_id", activeCompany.id).order("created_at", { ascending: false }).range(from, to);
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query; return { data: (data ?? []) as ContractRow[], error };
  }) : emptyResult<ContractRow>();
  let workOrdersPromise = can("execution.work_orders.view") ? fetchAllRows<WorkOrderRow>(async (from, to) => {
    let query = supabase.from("execution_work_orders").select("id,project_id,work_order_number,title,status,planned_finish,created_at").eq("company_id", activeCompany.id).order("created_at", { ascending: false }).range(from, to);
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query; return { data: (data ?? []) as WorkOrderRow[], error };
  }) : emptyResult<WorkOrderRow>();

  const assistanceSummaryPromise = can("postwork.assistance.view") ? supabase.rpc("postwork_assistance_summary", { p_company_id: activeCompany.id, p_project_id: projectId }) : Promise.resolve({ data: null, error: null });
  let assistancePromise = can("postwork.assistance.view") ? supabase.from("postwork_assistance_tickets").select("id,project_id,number,title,status,priority,sla_due_at,created_at").eq("company_id", activeCompany.id).order("created_at", { ascending: false }).limit(1000) : null;
  if (assistancePromise && projectId) assistancePromise = assistancePromise.eq("project_id", projectId);
  const warrantySummaryPromise = can("postwork.warranties.view") ? supabase.rpc("postwork_warranties_summary", { p_company_id: activeCompany.id, p_project_id: projectId }) : Promise.resolve({ data: null, error: null });
  let maintenancePromise = can("postwork.warranties.view") ? supabase.from("postwork_warranty_maintenance").select("id,project_id,title,due_date,status").eq("company_id", activeCompany.id).neq("status", "cancelled").order("due_date").limit(2000) : null;
  if (maintenancePromise && projectId) maintenancePromise = maintenancePromise.eq("project_id", projectId);
  let taxesPromise = can("finance.taxes.view") ? supabase.from("finance_tax_obligations").select("id,project_id,due_date,total_amount,status,reference").eq("company_id", activeCompany.id).in("status", ["scheduled", "payable_generated"]).order("due_date").limit(2000) : null;
  if (taxesPromise && projectId) taxesPromise = taxesPromise.eq("project_id", projectId);

  let budgetsPromise = can("budgets.view") ? supabase.from("engineering_budgets").select("id,code,name,version,status,updated_at").eq("company_id", activeCompany.id).order("updated_at", { ascending: false }).limit(100) : null;
  if (budgetsPromise && projectId) budgetsPromise = budgetsPromise.eq("project_id", projectId);
  let baselinesPromise = can("schedule.view") && projectId ? supabase.from("engineering_schedule_baselines").select("id,budget_id,code,name,version,status,updated_at").eq("company_id", activeCompany.id).eq("project_id", projectId).neq("status", "archived").order("updated_at", { ascending: false }).limit(100) : null;

  const [
    supplierCountResult, clientCountResult, unitsResult, proposalSummaryResult, proposalsResult, salesSummaryResult, salesResult,
    payablesSummaryResult, payablesResult, receivablesSummaryResult, receivablesResult, ordersResult, contractsResult, workOrdersResult,
    assistanceSummaryResult, assistanceResult, warrantySummaryResult, maintenanceResult, taxesResult, budgetsResult, baselinesResult,
  ] = await Promise.all([
    suppliersPromise, clientsPromise, unitsPromise ?? emptyResult<UnitRow>(), proposalSummaryPromise, proposalsPromise ?? emptyResult<ProposalRow>(), salesSummaryPromise, salesPromise ?? emptyResult<SaleRow>(),
    payablesSummaryPromise, payablesPromise ?? emptyResult<PayableRow>(), receivablesSummaryPromise, receivablesPromise ?? emptyResult<ReceivableRow>(), ordersPromise, contractsPromise, workOrdersPromise,
    assistanceSummaryPromise, assistancePromise ?? emptyResult<AssistanceRow>(), warrantySummaryPromise, maintenancePromise ?? emptyResult<MaintenanceRow>(), taxesPromise ?? emptyResult<TaxRow>(), budgetsPromise ?? emptyResult<Budget>(), baselinesPromise ?? emptyResult<Baseline>(),
  ]);

  const units = (unitsResult.data ?? []) as UnitRow[];
  const proposals = (proposalsResult.data ?? []) as ProposalRow[];
  const sales = (salesResult.data ?? []) as SaleRow[];
  const payables = (payablesResult.data ?? []) as PayableRow[];
  const receivables = (receivablesResult.data ?? []) as ReceivableRow[];
  const orders = ordersResult.data;
  const contracts = contractsResult.data;
  const workOrders = workOrdersResult.data;
  const assistance = (assistanceResult.data ?? []) as AssistanceRow[];
  const maintenance = (maintenanceResult.data ?? []) as MaintenanceRow[];
  const taxes = (taxesResult.data ?? []) as TaxRow[];
  const budgets = (budgetsResult.data ?? []) as Budget[];
  const baselines = (baselinesResult.data ?? []) as Baseline[];
  const proposalSummary = (proposalSummaryResult.data ?? {}) as Partial<ProposalSummary>;
  const salesSummary = (salesSummaryResult.data ?? {}) as Partial<SalesSummary>;
  const payablesSummary = (payablesSummaryResult.data ?? {}) as Partial<PayablesSummary>;
  const receivablesSummary = (receivablesSummaryResult.data ?? {}) as Partial<ReceivablesSummary>;
  const assistanceSummary = (assistanceSummaryResult.data ?? {}) as Partial<AssistanceSummary>;
  const warrantySummary = (warrantySummaryResult.data ?? {}) as Partial<WarrantySummary>;

  const selectedBaseline = baselines.find((item) => item.status === "approved") ?? baselines[0] ?? null;
  const selectedBudget = selectedBaseline ? budgets.find((item) => item.id === selectedBaseline.budget_id) ?? null : budgets.find((item) => item.status === "approved") ?? budgets[0] ?? null;
  const [activitiesResult, measurementsResult, weightsResult, budgetItemsResult] = selectedBaseline && projectId
    ? await Promise.all([
      fetchAllRows<ScheduleActivity>(async (from, to) => { const { data, error } = await supabase.from("engineering_schedule_activities").select("id,baseline_id,service_id,quantity_snapshot,duration_days,planned_start,planned_finish,planned_cost,record_status").eq("company_id", activeCompany.id).eq("project_id", projectId).eq("baseline_id", selectedBaseline.id).eq("record_status", "active").range(from, to); return { data: (data ?? []) as ScheduleActivity[], error }; }),
      fetchAllRows<ScheduleMeasurement>(async (from, to) => { const { data, error } = await supabase.from("engineering_schedule_progress_measurements").select("id,activity_id,measurement_date,progress_percent,current_finish,created_at").eq("company_id", activeCompany.id).eq("project_id", projectId).order("measurement_date").order("created_at").range(from, to); return { data: (data ?? []) as ScheduleMeasurement[], error }; }),
      fetchAllRows<ScheduleWeight>(async (from, to) => { const { data, error } = await supabase.from("engineering_schedule_service_weights").select("service_id,physical_weight_percent,distribution_method").eq("company_id", activeCompany.id).eq("project_id", projectId).eq("baseline_id", selectedBaseline.id).range(from, to); return { data: (data ?? []) as ScheduleWeight[], error }; }),
      selectedBudget ? fetchAllRows<BudgetItem>(async (from, to) => { const { data, error } = await supabase.from("engineering_budget_items").select("id,budget_id,total_direct_cost,status").eq("company_id", activeCompany.id).eq("budget_id", selectedBudget.id).eq("status", "active").range(from, to); return { data: (data ?? []) as BudgetItem[], error }; }) : emptyResult<BudgetItem>(),
    ])
    : [await emptyResult<ScheduleActivity>(), await emptyResult<ScheduleMeasurement>(), await emptyResult<ScheduleWeight>(), selectedBudget ? await fetchAllRows<BudgetItem>(async (from, to) => { const { data, error } = await supabase.from("engineering_budget_items").select("id,budget_id,total_direct_cost,status").eq("company_id", activeCompany.id).eq("budget_id", selectedBudget.id).eq("status", "active").range(from, to); return { data: (data ?? []) as BudgetItem[], error }; }) : await emptyResult<BudgetItem>()];

  const physical = calculatePhysicalSnapshot(activitiesResult.data, measurementsResult.data, weightsResult.data, today, selectedBaseline);
  const budgetTotal = budgetItemsResult.data.reduce((sum, item) => sum + Number(item.total_direct_cost ?? 0), 0);
  const overduePayables = payables.filter((item) => item.due_date < today);
  const overdueReceivables = receivables.filter((item) => item.due_date < today);
  const overduePayableAmount = overduePayables.reduce((sum, item) => sum + Number(item.amount), 0);
  const overdueReceivableAmount = overdueReceivables.reduce((sum, item) => sum + Number(item.adjusted_amount ?? item.amount), 0);
  const openReceivables = Number(receivablesSummary.open_amount ?? 0);
  const openPayables = Number(payablesSummary.open_amount ?? 0);
  const financialBalance = openReceivables - openPayables;
  const cashMonths = buildCashMonths(receivables, payables, today);

  const availableUnits = units.filter((item) => item.status === "available");
  const reservedUnits = units.filter((item) => item.status === "reserved");
  const soldUnits = units.filter((item) => item.status === "sold");
  const inactiveUnits = units.filter((item) => item.status === "inactive");
  const stockValue = availableUnits.reduce((sum, item) => sum + Number(item.list_price ?? 0), 0);
  const openOrderStatuses = new Set(["draft", "issued", "confirmed", "partially_received"]);
  const openOrders = orders.filter((item) => openOrderStatuses.has(item.status));
  const delayedOrders = openOrders.filter((item) => item.expected_delivery_date && item.expected_delivery_date < today);
  const committedOrders = orders.filter((item) => !["draft", "cancelled"].includes(item.status)).reduce((sum, item) => sum + Number(item.total_amount), 0);
  const receivedOrders = orders.reduce((sum, item) => sum + Number(item.received_amount), 0);
  const activeContracts = contracts.filter((item) => ["active", "suspended"].includes(item.status));
  const contractedValue = activeContracts.reduce((sum, item) => sum + Number(item.current_value), 0);
  const measuredValue = activeContracts.reduce((sum, item) => sum + Number(item.measured_value), 0);
  const openWorkOrders = workOrders.filter((item) => ["released", "in_progress", "paused", "pending_acceptance"].includes(item.status));
  const delayedWorkOrders = openWorkOrders.filter((item) => item.planned_finish && item.planned_finish < today);
  const overdueMaintenance = maintenance.filter((item) => !["completed", "cancelled"].includes(item.status) && item.due_date < today);
  const overdueTaxes = taxes.filter((item) => item.due_date < today);
  const overdueTaxAmount = overdueTaxes.reduce((sum, item) => sum + Number(item.total_amount), 0);
  const expiringProposals = proposals.filter((item) => !["rejected", "expired", "cancelled", "converted"].includes(item.status) && item.valid_until >= today && item.valid_until <= nextSevenDays);

  const alerts: DashboardAlert[] = [];
  if (overdueReceivables.length) alerts.push({ id: "receivables-overdue", severity: "critical", title: "Contas a receber vencidas", description: `${overdueReceivables.length} parcela(s) aguardando recebimento.`, value: money(overdueReceivableAmount), href: `/financeiro/contas-a-receber?status=open&period=custom&to=${today}` });
  if (overduePayables.length) alerts.push({ id: "payables-overdue", severity: "critical", title: "Contas a pagar vencidas", description: `${overduePayables.length} compromisso(s) financeiro(s) fora do prazo.`, value: money(overduePayableAmount), href: `/financeiro/contas-a-pagar?status=open&period=custom&to=${today}` });
  if (Number(assistanceSummary.overdue_count ?? 0) > 0) alerts.push({ id: "assistance-overdue", severity: "critical", title: "Assistências fora do SLA", description: `${assistanceSummary.overdue_count} chamado(s) ultrapassaram o prazo de atendimento.`, value: `${assistanceSummary.urgent_count ?? 0} urgente(s)`, href: "/pos-obra/assistencias" });
  if (overdueTaxes.length) alerts.push({ id: "taxes-overdue", severity: "critical", title: "Obrigações fiscais vencidas", description: `${overdueTaxes.length} obrigação(ões) precisam de regularização.`, value: money(overdueTaxAmount), href: "/financeiro/impostos" });
  if (physical.delayed > 0) alerts.push({ id: "schedule-delayed", severity: "warning", title: "Atividades abaixo do previsto", description: `${physical.delayed} atividade(s) apresentam avanço inferior ao planejado.`, value: `${physical.actual.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% realizado`, href: "/execucao/cronograma" });
  if (delayedOrders.length) alerts.push({ id: "orders-delayed", severity: "warning", title: "Entregas de compras atrasadas", description: `${delayedOrders.length} pedido(s) ainda não foram completamente recebidos.`, value: money(delayedOrders.reduce((sum, item) => sum + Math.max(0, Number(item.total_amount) - Number(item.received_amount)), 0)), href: "/suprimentos/pedidos-compras" });
  if (delayedWorkOrders.length) alerts.push({ id: "work-orders-delayed", severity: "warning", title: "Ordens de serviço com prazo vencido", description: `${delayedWorkOrders.length} O.S. permanecem abertas após a conclusão planejada.`, href: "/execucao/ordens-servico" });
  if (Number(proposalSummary.expiring_count ?? expiringProposals.length) > 0) alerts.push({ id: "proposals-expiring", severity: "warning", title: "Propostas próximas do vencimento", description: `${proposalSummary.expiring_count ?? expiringProposals.length} negociação(ões) vencem nos próximos 7 dias.`, value: money(Number(proposalSummary.pipeline_amount ?? 0)), href: "/comercial/propostas" });
  if (overdueMaintenance.length) alerts.push({ id: "maintenance-overdue", severity: "warning", title: "Manutenções de garantia atrasadas", description: `${overdueMaintenance.length} manutenção(ões) obrigatória(s) aguardam execução.`, href: "/pos-obra/garantias" });
  alerts.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - { critical: 0, warning: 1, info: 2 }[b.severity]);

  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const activities: DashboardActivity[] = [];
  proposals.slice(0, 5).forEach((item) => activities.push({ id: `proposal-${item.id}`, icon: "◇", kind: "Proposta", title: item.number, description: `${proposalStatusLabels[item.status] ?? item.status} · ${money(item.proposed_amount)}`, date: dateTimeBR(item.created_at), href: openRecord(item.project_id, `/comercial/propostas/${item.id}`) }));
  sales.slice(0, 5).forEach((item) => activities.push({ id: `sale-${item.id}`, icon: "$", kind: "Venda", title: item.number, description: `${item.status === "active" ? "Ativa" : "Cancelada"} · ${money(item.total_amount)}`, date: dateTimeBR(item.created_at), href: openRecord(item.project_id, `/comercial/vendas?q=${encodeURIComponent(item.number)}`) }));
  orders.slice(0, 5).forEach((item) => activities.push({ id: `order-${item.id}`, icon: "🛒", kind: "Pedido de compra", title: item.order_number, description: `${orderStatusLabels[item.status] ?? item.status} · ${money(item.total_amount)}`, date: dateTimeBR(item.created_at), href: openRecord(item.project_id, `/suprimentos/pedidos-compras?order=${item.id}`) }));
  workOrders.slice(0, 5).forEach((item) => activities.push({ id: `work-order-${item.id}`, icon: "✓", kind: "Ordem de serviço", title: item.work_order_number, description: `${workOrderStatusLabels[item.status] ?? item.status} · ${item.title}`, date: dateTimeBR(item.created_at), href: openRecord(item.project_id, `/execucao/ordens-servico?work_order=${item.id}`) }));
  assistance.slice(0, 5).forEach((item) => activities.push({ id: `assistance-${item.id}`, icon: "⌁", kind: "Assistência técnica", title: item.number, description: `${assistanceStatusLabels[item.status] ?? item.status} · ${item.title}`, date: dateTimeBR(item.created_at), href: openRecord(item.project_id, `/pos-obra/assistencias?ticket=${item.id}`) }));
  activities.sort((a, b) => b.date.localeCompare(a.date));
  const recentActivities = activities.slice(0, 9);

  const quickActions = [
    can("commercial.proposals.manage") ? { label: "Nova proposta", href: "/comercial/propostas", icon: "◇" } : null,
    can("clients.manage") ? { label: "Novo cliente", href: "/cadastros/clientes", icon: "+" } : null,
    can("payables.manage") ? { label: "Lançar conta", href: "/financeiro/contas-a-pagar", icon: "$" } : null,
    can("execution.work_orders.manage") ? { label: "Emitir O.S.", href: "/execucao/ordens-servico?new=1", icon: "✓" } : null,
    can("procurement.quotations.manage") ? { label: "Nova cotação", href: "/suprimentos/orcamentos-materiais", icon: "🛒" } : null,
    can("postwork.assistance.manage") ? { label: "Abrir chamado", href: "/pos-obra/assistencias?new=1", icon: "⌁" } : null,
  ].filter((item): item is { label: string; href: string; icon: string } => Boolean(item));

  const hasFinance = can("payables.view") || can("receivables.view");
  const hasExecution = can("schedule.view") || can("execution.contracts.view") || can("execution.work_orders.view");
  const projectContext = activeProject ? `${activeProject.code ? `${activeProject.code} · ` : ""}${activeProject.name}` : "Visão geral da empresa";
  const lastUpdate = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date());

  return <AppShell
    activeGroup="home"
    eyebrow="Início · Gestão executiva"
    title="Dashboard Geral"
    description={`${activeCompany.name} · ${projectContext} · indicadores integrados para decisão.`}
    actions={<><Link className="elos-button" href="/dashboard">Atualizar indicadores</Link>{can("admin.users.view") ? <Link className="elos-button" href="/configuracoes/acessos">Usuários e acessos</Link> : null}</>}
  >
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

    <section className="executive-hero">
      <div className="executive-hero-copy">
        <div className="executive-hero-tags"><span>{projectStatusLabels[activeProject?.status ?? ""] ?? "Empresa"}</span><span>{activeRole?.name}</span></div>
        <h2>{activeProject?.name ?? activeCompany.name}</h2>
        <p>{activeProject ? `Acompanhe a obra, o resultado comercial e os compromissos financeiros em um único painel.` : "Acompanhe os principais indicadores consolidados da empresa."}</p>
        <div className="executive-hero-meta"><span>Início <strong>{dateBR(activeProject?.construction_start_date)}</strong></span><span>Entrega <strong>{dateBR(activeProject?.delivery_date)}</strong></span><span>Atualizado <strong>{lastUpdate}</strong></span></div>
      </div>
      <div className="executive-hero-status">
        <div className={alerts.filter((item) => item.severity === "critical").length ? "attention" : "healthy"}><span>Pontos críticos</span><strong>{alerts.filter((item) => item.severity === "critical").length}</strong><small>{alerts.length} alerta(s) monitorado(s)</small></div>
        {can("schedule.view") ? <div><span>Avanço físico</span><strong>{physical.actual.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</strong><small>previsto {physical.planned.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</small></div> : null}
      </div>
    </section>

    <section className="executive-kpi-grid">
      {can("receivables.view") ? <ExecutiveKpi icon="↗" label="A receber em aberto" value={money(openReceivables)} detail={`${receivablesSummary.open_count ?? 0} parcela(s) · ${overdueReceivables.length} vencida(s)`} href="/financeiro/contas-a-receber?status=open" tone={overdueReceivables.length ? "warning" : "positive"} /> : null}
      {can("payables.view") ? <ExecutiveKpi icon="↘" label="A pagar em aberto" value={money(openPayables)} detail={`${payablesSummary.open_count ?? 0} título(s) · ${overduePayables.length} vencido(s)`} href="/financeiro/contas-a-pagar?status=open" tone={overduePayables.length ? "danger" : "neutral"} /> : null}
      {hasFinance ? <ExecutiveKpi icon="≈" label="Saldo financeiro aberto" value={money(financialBalance)} detail="Recebíveis menos compromissos em aberto" tone={financialBalance >= 0 ? "positive" : "danger"} /> : null}
      {can("sales.view") ? <ExecutiveKpi icon="◇" label="Vendas ativas" value={money(Number(salesSummary.total_amount ?? 0))} detail={`${salesSummary.active_count ?? 0} venda(s) · ticket ${money(Number(salesSummary.average_ticket ?? 0))}`} href="/comercial/vendas" tone="brand" /> : null}
      {can("commercial.proposals.view") ? <ExecutiveKpi icon="◎" label="Pipeline comercial" value={money(Number(proposalSummary.pipeline_amount ?? 0))} detail={`${proposalSummary.pipeline_count ?? 0} negociação(ões) em andamento`} href="/comercial/propostas" tone={Number(proposalSummary.expiring_count ?? 0) ? "warning" : "neutral"} /> : null}
      {can("budgets.view") ? <ExecutiveKpi icon="▦" label="Orçamento da obra" value={money(budgetTotal)} detail={selectedBudget ? `${selectedBudget.code} · ${selectedBudget.version} · ${selectedBudget.name}` : "Nenhum orçamento aprovado"} href="/engenharia/orcamento-analitico" tone="neutral" /> : null}
    </section>

    <div className="executive-dashboard-grid primary">
      {hasFinance ? <DashboardSection eyebrow="Financeiro" title="Previsão de caixa · 6 meses" description="Entradas e saídas abertas pelas datas de vencimento." action={<Link href="/financeiro/fluxo-de-caixa">Abrir fluxo de caixa</Link>} className="cash-panel"><CashForecast rows={cashMonths} money={money} /></DashboardSection> : null}
      <DashboardSection eyebrow="Ações necessárias" title="Central de atenção" description="Pendências objetivas encontradas nos módulos que você pode acessar." action={<span className={`attention-count ${alerts.length ? "active" : ""}`}>{alerts.length}</span>} className="attention-panel"><AttentionList alerts={alerts.slice(0, 8)} /></DashboardSection>
    </div>

    <div className="executive-dashboard-grid insights">
      {can("schedule.view") ? <DashboardSection eyebrow="Engenharia e execução" title="Avanço físico da obra" description="Mesmo critério de pesos utilizado no Controle do Cronograma." action={<Link href="/execucao/cronograma">Abrir cronograma</Link>}><PhysicalProgress planned={physical.planned} actual={physical.actual} delayed={physical.delayed} forecast={physical.forecast} baseline={physical.baseline} /></DashboardSection> : null}
      {(can("projects.view") || can("sales.view")) ? <DashboardSection eyebrow="Produto" title="Estoque de unidades" description={`${activeProject?.total_units ?? units.length} unidade(s) previstas no empreendimento.`} action={<Link href="/empreendimentos/unidades">Abrir unidades</Link>}><UnitInventory available={availableUnits.length} reserved={reservedUnits.length} sold={soldUnits.length} inactive={inactiveUnits.length} stockValue={stockValue} money={money} /></DashboardSection> : null}
      {can("commercial.proposals.view") ? <DashboardSection eyebrow="Comercial" title="Funil de propostas" description={`${proposalSummary.total_count ?? 0} proposta(s) registradas no contexto atual.`} action={<Link href="/comercial/propostas">Abrir propostas</Link>}><CommercialPipeline draft={Number(proposalSummary.draft_count ?? 0)} pipeline={Number(proposalSummary.pipeline_count ?? 0)} approved={Number(proposalSummary.approved_count ?? 0)} converted={Number(proposalSummary.converted_count ?? 0)} amount={Number(proposalSummary.pipeline_amount ?? 0)} money={money} /></DashboardSection> : null}
    </div>

    {(hasExecution || can("procurement.orders.view") || can("postwork.assistance.view")) ? <DashboardSection eyebrow="Operação integrada" title="Compromissos e produção" description="Leitura rápida do que já foi contratado, comprado, liberado e atendido." className="operations-panel">
      <div className="operations-grid">
        {can("execution.contracts.view") ? <Link href="/execucao/contratos-servicos"><span>Contratos ativos</span><strong>{activeContracts.length}</strong><small>{money(contractedValue)} contratados</small><div><i style={{ width: `${contractedValue > 0 ? Math.min(100, measuredValue / contractedValue * 100) : 0}%` }} /></div><em>{money(measuredValue)} medidos</em></Link> : null}
        {can("procurement.orders.view") ? <Link href="/suprimentos/pedidos-compras"><span>Pedidos em aberto</span><strong>{openOrders.length}</strong><small>{money(committedOrders)} comprometidos</small><div><i style={{ width: `${committedOrders > 0 ? Math.min(100, receivedOrders / committedOrders * 100) : 0}%` }} /></div><em>{money(receivedOrders)} recebidos</em></Link> : null}
        {can("execution.work_orders.view") ? <Link href="/execucao/ordens-servico"><span>Ordens em execução</span><strong>{openWorkOrders.length}</strong><small>{delayedWorkOrders.length} com prazo vencido</small><div><i className={delayedWorkOrders.length ? "warning" : ""} style={{ width: `${workOrders.length ? Math.min(100, (workOrders.length - openWorkOrders.length) / workOrders.length * 100) : 0}%` }} /></div><em>{workOrders.filter((item) => item.status === "finished").length} concluídas</em></Link> : null}
        {can("postwork.assistance.view") ? <Link href="/pos-obra/assistencias"><span>Chamados abertos</span><strong>{assistanceSummary.open_count ?? 0}</strong><small>{assistanceSummary.overdue_count ?? 0} fora do SLA</small><div><i className={Number(assistanceSummary.overdue_count ?? 0) ? "warning" : ""} style={{ width: `${Number(assistanceSummary.total_count ?? 0) > 0 ? Math.min(100, Number(assistanceSummary.resolved_count ?? 0) / Number(assistanceSummary.total_count ?? 1) * 100) : 0}%` }} /></div><em>{assistanceSummary.resolved_count ?? 0} resolvidos</em></Link> : null}
        {can("postwork.warranties.view") ? <Link href="/pos-obra/garantias"><span>Garantias vigentes</span><strong>{warrantySummary.active_asset_count ?? 0}</strong><small>{warrantySummary.expiring_count ?? 0} próximas do vencimento</small><div><i className={Number(warrantySummary.maintenance_overdue_count ?? 0) ? "warning" : ""} style={{ width: `${Number(warrantySummary.active_asset_count ?? 0) > 0 ? Math.min(100, (Number(warrantySummary.active_asset_count ?? 0) - Number(warrantySummary.expired_count ?? 0)) / Number(warrantySummary.active_asset_count ?? 1) * 100) : 0}%` }} /></div><em>{warrantySummary.maintenance_overdue_count ?? 0} manutenções atrasadas</em></Link> : null}
      </div>
    </DashboardSection> : null}

    <div className="executive-dashboard-grid bottom">
      <DashboardSection eyebrow="Movimentações" title="Atividades recentes" description="Últimos registros dos módulos disponíveis para o seu perfil." action={<button className="global-search-inline" type="button" data-global-search-trigger>Buscar no sistema</button>}><RecentActivity activities={recentActivities} /></DashboardSection>
      <div className="executive-side-stack">
        {quickActions.length ? <DashboardSection eyebrow="Acesso rápido" title="Criar e registrar"><div className="quick-action-grid">{quickActions.map((item) => <Link key={item.label} href={item.href}><i>{item.icon}</i><span>{item.label}</span><b>→</b></Link>)}</div></DashboardSection> : null}
        <DashboardSection eyebrow="Ambiente ativo" title={projectContext} description={`Empresa ${activeCompany.name} · acesso como ${activeRole?.name}.`} className="environment-compact">
          <details><summary>Trocar empresa ou empreendimento</summary><div className="company-list compact">{memberships.map((membership) => {
            const company = relatedOne(membership.companies); const role = relatedOne(membership.roles); if (!company) return null;
            const availableProjects = projects.filter((project) => project.company_id === company.id);
            return <article key={company.id} className={company.id === activeCompany.id ? "selected" : ""}><div className="company-card-header"><div><strong>{company.name}</strong><span>{role?.name}</span></div>{company.id === activeCompany.id ? <em>Ativa</em> : null}</div><div className="project-buttons"><form action={selectWorkspace}><input type="hidden" name="company_id" value={company.id} /><input type="hidden" name="project_id" value="" /><button type="submit">Visão geral</button></form>{availableProjects.map((project) => <form action={selectWorkspace} key={project.id}><input type="hidden" name="company_id" value={company.id} /><input type="hidden" name="project_id" value={project.id} /><button className={project.id === activeProject?.id ? "active" : ""} type="submit">{project.code ? `${project.code} · ` : ""}{project.name}</button></form>)}</div></article>;
          })}</div></details>
        </DashboardSection>
      </div>
    </div>

    {(ordersResult.error || contractsResult.error || workOrdersResult.error || activitiesResult.error || measurementsResult.error) ? <div className="dashboard-data-note">Alguns indicadores não puderam ser carregados. Os demais módulos continuam disponíveis normalmente.</div> : null}
    <span className="dashboard-context-note">Contexto atual: {projectContext}{projectId ? ` · ${projectMap.get(projectId)?.name ?? ""}` : ""}</span>
  </AppShell>;
}
