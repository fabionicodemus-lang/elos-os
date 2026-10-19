import { AppShell } from "@/components/app-shell";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import { updateScheduleBaselineStatus } from "./actions";
import {
  SchedulePrevisionWorkbench,
  type ScheduleWorkbenchActivity,
  type ScheduleWorkbenchBaseline,
  type ScheduleWorkbenchDependency,
} from "./schedule-workbench";
import type { ScheduleBudgetOption, ScheduleLocationOption, ScheduleServiceOption } from "./schedule-dialogs";

type Project = { id: string; code: string | null; name: string };
function parseDate(value: string) { return new Date(`${value.slice(0, 10)}T12:00:00Z`); }
function dateBR(value?: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(parseDate(value)) : "—"; }
function moneyCompact(value: number) { return Math.abs(value) >= 1_000_000 ? `R$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 1_000_000)} mi` : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value); }
function peakTeams(activities: ScheduleWorkbenchActivity[]) {
  if (!activities.length) return 0;
  const starts = activities.map((item) => parseDate(item.planned_start).getTime());
  const finishes = activities.map((item) => parseDate(item.planned_finish).getTime());
  const start = Math.min(...starts); const finish = Math.max(...finishes);
  let peak = 0;
  for (let time = start; time <= finish; time += 86_400_000) {
    const total = activities.filter((item) => parseDate(item.planned_start).getTime() <= time && parseDate(item.planned_finish).getTime() >= time).reduce((sum, item) => sum + Number(item.team_count || 1), 0);
    peak = Math.max(peak, total);
  }
  return peak;
}

export default async function EngineeringSchedulePage({ searchParams }: {
  searchParams: Promise<{ baseline?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, companyId, projectId, roleKey } = await requireCompanyPermission("schedule.view");
  const projectPromise = projectId ? supabase.from("projects").select("id, code, name, construction_start_date").eq("id", projectId).maybeSingle() : Promise.resolve({ data: null, error: null });
  const managePromise = roleKey === "owner" || roleKey === "admin" ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "schedule.manage" });

  const [projectResult, budgetsResult, baselinesResult, activitiesResult, dependenciesResult, servicesResult, locationsResult, manageResult] = await Promise.all([
    projectPromise,
    projectId ? fetchAllRows<ScheduleBudgetOption>(async (from, to) => { const { data, error } = await supabase.from("engineering_budgets").select("id, code, name, version, is_base").eq("company_id", companyId).eq("project_id", projectId).eq("status", "approved").eq("is_base", true).order("updated_at", { ascending: false }).range(from, to); return { data: (data ?? []) as ScheduleBudgetOption[], error }; }) : Promise.resolve({ data: [] as ScheduleBudgetOption[], error: null }),
    projectId ? fetchAllRows<ScheduleWorkbenchBaseline>(async (from, to) => { const { data, error } = await supabase.from("engineering_schedule_baselines").select("id, budget_id, code, name, version, start_date, work_on_saturday, status, notes, updated_at").eq("company_id", companyId).eq("project_id", projectId).order("updated_at", { ascending: false }).range(from, to); return { data: (data ?? []) as ScheduleWorkbenchBaseline[], error }; }) : Promise.resolve({ data: [] as ScheduleWorkbenchBaseline[], error: null }),
    projectId ? fetchAllRows<ScheduleWorkbenchActivity>(async (from, to) => { const { data, error } = await supabase.from("engineering_schedule_activities").select("id, baseline_id, service_id, location_id, code, name, unit_snapshot, quantity_snapshot, productivity_per_team_day, team_count, duration_days, planned_start, planned_finish, planned_cost, sort_order, planning_status, source, notes, record_status").eq("company_id", companyId).eq("project_id", projectId).order("planned_start").order("sort_order").range(from, to); return { data: (data ?? []) as ScheduleWorkbenchActivity[], error }; }) : Promise.resolve({ data: [] as ScheduleWorkbenchActivity[], error: null }),
    projectId ? fetchAllRows<ScheduleWorkbenchDependency>(async (from, to) => { const { data, error } = await supabase.from("engineering_schedule_dependencies").select("baseline_id, predecessor_id, successor_id, relation_type, lag_days").eq("company_id", companyId).eq("project_id", projectId).range(from, to); return { data: (data ?? []) as ScheduleWorkbenchDependency[], error }; }) : Promise.resolve({ data: [] as ScheduleWorkbenchDependency[], error: null }),
    fetchAllRows<ScheduleServiceOption>(async (from, to) => { const { data, error } = await supabase.from("engineering_services").select("id, code, description, unit").eq("company_id", companyId).eq("status", "active").order("code").range(from, to); return { data: (data ?? []) as ScheduleServiceOption[], error }; }),
    projectId ? fetchAllRows<ScheduleLocationOption>(async (from, to) => { const { data, error } = await supabase.from("engineering_takeoff_locations").select("id, code, name").eq("company_id", companyId).eq("project_id", projectId).eq("status", "active").order("sort_order").order("code").range(from, to); return { data: (data ?? []) as ScheduleLocationOption[], error }; }) : Promise.resolve({ data: [] as ScheduleLocationOption[], error: null }),
    managePromise,
  ]);

  const project = projectResult.data as Project | null;
  const baselines = baselinesResult.data;
  const selectedBaseline = baselines.find((item) => item.id === params.baseline) ?? baselines.find((item) => item.status === "approved") ?? baselines.find((item) => item.status !== "archived") ?? baselines[0] ?? null;
  const activities = selectedBaseline ? activitiesResult.data.filter((item) => item.baseline_id === selectedBaseline.id && item.record_status === "active") : [];
  const dependencies = selectedBaseline ? dependenciesResult.data.filter((item) => item.baseline_id === selectedBaseline.id) : [];
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";
  const selectedBudget = selectedBaseline ? budgetsResult.data.find((item) => item.id === selectedBaseline.budget_id) : null;
  const latestFinish = activities.reduce((latest, item) => !latest || item.planned_finish > latest ? item.planned_finish : latest, "");
  const plannedCost = activities.reduce((sum, item) => sum + Number(item.planned_cost || 0), 0);
  const reviewCount = activities.filter((item) => item.planning_status !== "approved").length;
  const structureError = baselinesResult.error || activitiesResult.error || dependenciesResult.error;
  const meta = selectedBaseline
    ? `${selectedBaseline.code} ${selectedBaseline.status === "approved" ? "aprovada" : "em revisão"} · ${selectedBudget ? `gerado do ${selectedBudget.code} ${selectedBudget.version}` : context} · início ${dateBR(selectedBaseline.start_date)}`
    : `${context} · crie uma linha de base para iniciar o planejamento`;

  return (
    <AppShell activeGroup="engineering" activeItem="schedule" eyebrow="Pré-Obra · Planejamento da obra" title="Cronograma"
      description={meta}
      actions={canManage && selectedBaseline && selectedBaseline.status !== "approved" ? <form action={updateScheduleBaselineStatus}><input type="hidden" name="baseline_id" value={selectedBaseline.id} /><input type="hidden" name="status" value="approved" /><ConfirmSubmitButton label="Aprovar linha de base" confirmLabel="Confirmar aprovação" title="Clique novamente para aprovar a linha de base." /></form> : undefined}>
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {structureError ? <div className="auth-message error workspace-message">A estrutura do cronograma ainda não está instalada. Execute a migration <strong>20260726_0023_engineering_schedule_baseline.sql</strong> no Supabase.</div> : null}
      {!projectId ? <div className="schedule-empty">Selecione uma obra no topo para acessar o cronograma.</div> : null}

      {projectId ? <section className="preobra-schedule-kpis">
        <article><span>Atividades</span><strong>{activities.length}</strong><small>{locationsResult.data.length} locais · {servicesResult.data.length} serviços cadastrados</small></article>
        <article><span>Início</span><strong>{dateBR(selectedBaseline?.start_date)}</strong><small>data-base</small></article>
        <article className={reviewCount ? "preobra-kpi-warn" : ""}><span>Fim atual</span><strong>{dateBR(latestFinish)}</strong><small>{reviewCount} atividades a revisar</small></article>
        <article><span>Pico de equipes</span><strong>{peakTeams(activities)} equipes</strong><small>simultâneas no planejamento</small></article>
        <article><span>Custo planejado</span><strong>{moneyCompact(plannedCost)}</strong><small>{selectedBudget ? `${selectedBudget.code} · ${selectedBudget.version}` : "linha de base atual"}</small></article>
      </section> : null}

      {projectId ? <SchedulePrevisionWorkbench projectName={project?.name ?? "Obra selecionada"} baselines={baselines} selectedBaseline={selectedBaseline} budgets={budgetsResult.data} activities={activities} dependencies={dependencies} services={servicesResult.data} locations={locationsResult.data} canManage={canManage} defaultStartDate={(project as { construction_start_date?: string | null } | null)?.construction_start_date ?? null} /> : null}
    </AppShell>
  );
}
