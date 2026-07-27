import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  SchedulePrevisionWorkbench,
  type ScheduleWorkbenchActivity,
  type ScheduleWorkbenchBaseline,
  type ScheduleWorkbenchDependency,
} from "./schedule-workbench";
import type {
  ScheduleBudgetOption,
  ScheduleLocationOption,
  ScheduleServiceOption,
} from "./schedule-dialogs";

type Project = { id: string; code: string | null; name: string };

export default async function EngineeringSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    baseline?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("schedule.view");

  const projectPromise = projectId
    ? supabase.from("projects").select("id, code, name").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const managePromise = roleKey === "owner" || roleKey === "admin"
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", {
        target_company_id: companyId,
        target_permission: "schedule.manage",
      });

  const [projectResult, budgetsResult, baselinesResult, activitiesResult, dependenciesResult, servicesResult, locationsResult, manageResult] = await Promise.all([
    projectPromise,
    projectId
      ? fetchAllRows<ScheduleBudgetOption>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_budgets")
            .select("id, code, name, version")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .neq("status", "archived")
            .order("updated_at", { ascending: false })
            .range(from, to);
          return { data: (data ?? []) as ScheduleBudgetOption[], error };
        })
      : Promise.resolve({ data: [] as ScheduleBudgetOption[], error: null }),
    projectId
      ? fetchAllRows<ScheduleWorkbenchBaseline>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_schedule_baselines")
            .select("id, budget_id, code, name, version, start_date, work_on_saturday, status, notes, updated_at")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("updated_at", { ascending: false })
            .range(from, to);
          return { data: (data ?? []) as ScheduleWorkbenchBaseline[], error };
        })
      : Promise.resolve({ data: [] as ScheduleWorkbenchBaseline[], error: null }),
    projectId
      ? fetchAllRows<ScheduleWorkbenchActivity>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_schedule_activities")
            .select("id, baseline_id, service_id, location_id, code, name, unit_snapshot, quantity_snapshot, productivity_per_team_day, team_count, duration_days, planned_start, planned_finish, planned_cost, sort_order, planning_status, source, notes, record_status")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("planned_start")
            .order("sort_order")
            .range(from, to);
          return { data: (data ?? []) as ScheduleWorkbenchActivity[], error };
        })
      : Promise.resolve({ data: [] as ScheduleWorkbenchActivity[], error: null }),
    projectId
      ? fetchAllRows<ScheduleWorkbenchDependency>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_schedule_dependencies")
            .select("baseline_id, predecessor_id, successor_id, relation_type, lag_days")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .range(from, to);
          return { data: (data ?? []) as ScheduleWorkbenchDependency[], error };
        })
      : Promise.resolve({ data: [] as ScheduleWorkbenchDependency[], error: null }),
    fetchAllRows<ScheduleServiceOption>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_services")
        .select("id, code, description, unit")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as ScheduleServiceOption[], error };
    }),
    projectId
      ? fetchAllRows<ScheduleLocationOption>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_takeoff_locations")
            .select("id, code, name")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .eq("status", "active")
            .order("sort_order")
            .order("code")
            .range(from, to);
          return { data: (data ?? []) as ScheduleLocationOption[], error };
        })
      : Promise.resolve({ data: [] as ScheduleLocationOption[], error: null }),
    managePromise,
  ]);

  const project = projectResult.data as Project | null;
  const baselines = baselinesResult.data;
  const selectedBaseline = baselines.find((baseline) => baseline.id === params.baseline)
    ?? baselines.find((baseline) => baseline.status === "approved")
    ?? baselines.find((baseline) => baseline.status !== "archived")
    ?? baselines[0]
    ?? null;
  const activities = selectedBaseline
    ? activitiesResult.data.filter((activity) => activity.baseline_id === selectedBaseline.id)
    : [];
  const dependencies = selectedBaseline
    ? dependenciesResult.data.filter((dependency) => dependency.baseline_id === selectedBaseline.id)
    : [];
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";
  const structureError = baselinesResult.error || activitiesResult.error || dependenciesResult.error;

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="schedule"
      eyebrow="Engenharia · Planejamento da Obra"
      title="Cronograma Físico"
      description={`${company.name} · ${context} · linha de balanço, equipes e planejamento físico da obra.`}
      actions={
        <Link className="elos-button elos-button-primary" href={selectedBaseline ? `/engenharia/curvas?baseline=${selectedBaseline.id}` : "/engenharia/curvas"}>
          Curvas física e financeira
        </Link>
      }
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {structureError ? (
        <div className="auth-message error workspace-message">
          A estrutura do cronograma ainda não está instalada. Execute a migration <strong>20260726_0023_engineering_schedule_baseline.sql</strong> no Supabase.
        </div>
      ) : null}
      {!projectId ? <div className="schedule-empty">Selecione uma obra no topo para acessar o cronograma.</div> : null}
      {projectId ? (
        <SchedulePrevisionWorkbench
          projectName={project?.name ?? "Obra selecionada"}
          baselines={baselines}
          selectedBaseline={selectedBaseline}
          budgets={budgetsResult.data}
          activities={activities}
          dependencies={dependencies}
          services={servicesResult.data}
          locations={locationsResult.data}
          canManage={canManage}
        />
      ) : null}
    </AppShell>
  );
}
