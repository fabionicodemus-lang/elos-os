import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  ExecutionScheduleWorkbench,
  type ExecutionScheduleBaseline,
  type ExecutionScheduleLocation,
  type ExecutionScheduleService,
} from "./execution-schedule-workbench";
import type { ExecutionScheduleActivity, ExecutionScheduleMeasurement } from "./progress-dialog";

type Project = { id: string; code: string | null; name: string };

function todayIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function validDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

export default async function ExecutionSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ baseline?: string; date?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const selectedDate = validDate(params.date) ?? todayIso();
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("schedule.view");
  const projectPromise = projectId
    ? supabase.from("projects").select("id, code, name").eq("id", projectId).eq("company_id", companyId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const managePromise = roleKey === "owner" || roleKey === "admin"
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", {
        target_company_id: companyId,
        target_permission: "execution.schedule.manage",
      });

  const [projectResult, baselinesResult, activitiesResult, measurementsResult, servicesResult, locationsResult, manageResult] = await Promise.all([
    projectPromise,
    projectId ? fetchAllRows<ExecutionScheduleBaseline>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_schedule_baselines")
        .select("id, code, name, version, start_date, status")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .range(from, to);
      return { data: (data ?? []) as ExecutionScheduleBaseline[], error };
    }) : Promise.resolve({ data: [] as ExecutionScheduleBaseline[], error: null }),
    projectId ? fetchAllRows<ExecutionScheduleActivity>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_schedule_activities")
        .select("id, baseline_id, service_id, location_id, code, name, unit_snapshot, quantity_snapshot, team_count, duration_days, planned_start, planned_finish, planned_cost, sort_order, record_status")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("record_status", "active")
        .order("sort_order")
        .order("planned_start")
        .range(from, to);
      return { data: (data ?? []) as ExecutionScheduleActivity[], error };
    }) : Promise.resolve({ data: [] as ExecutionScheduleActivity[], error: null }),
    projectId ? fetchAllRows<ExecutionScheduleMeasurement>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_schedule_progress_measurements")
        .select("id, activity_id, measurement_date, progress_percent, actual_quantity, actual_cost, team_count, current_start, current_finish, actual_start, actual_finish, notes, created_at")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .order("measurement_date")
        .order("created_at")
        .range(from, to);
      return { data: (data ?? []) as ExecutionScheduleMeasurement[], error };
    }) : Promise.resolve({ data: [] as ExecutionScheduleMeasurement[], error: null }),
    fetchAllRows<ExecutionScheduleService>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_services")
        .select("id, code, description")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as ExecutionScheduleService[], error };
    }),
    projectId ? fetchAllRows<ExecutionScheduleLocation>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_takeoff_locations")
        .select("id, code, name")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("status", "active")
        .order("sort_order")
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as ExecutionScheduleLocation[], error };
    }) : Promise.resolve({ data: [] as ExecutionScheduleLocation[], error: null }),
    managePromise,
  ]);

  const project = projectResult.data as Project | null;
  const baselines = baselinesResult.data;
  const selectedBaseline = baselines.find((baseline) => baseline.id === params.baseline)
    ?? baselines.find((baseline) => baseline.status === "approved")
    ?? baselines[0]
    ?? null;
  const activities = selectedBaseline ? activitiesResult.data.filter((activity) => activity.baseline_id === selectedBaseline.id) : [];
  const activityIds = new Set(activities.map((activity) => activity.id));
  const measurements = measurementsResult.data.filter((measurement) => activityIds.has(measurement.activity_id));
  const canManage = (manageResult.data === true || roleKey === "owner" || roleKey === "admin") && !measurementsResult.error;
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";
  const structureError = baselinesResult.error || activitiesResult.error || measurementsResult.error;

  return (
    <AppShell
      activeGroup="execution"
      activeItem="execution-schedule"
      eyebrow="Execução · Controle da Obra"
      title="Controle do Cronograma"
      description={`${company.name} · ${context} · avanço físico, desvios e reprogramação do cronograma atual.`}
      actions={<><Link className="elos-button secondary" href={selectedBaseline ? `/engenharia/cronograma?baseline=${selectedBaseline.id}` : "/engenharia/cronograma"}>Linha de base</Link><Link className="elos-button" href="/execucao/diario-de-obras">Diário de Obras</Link></>}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {structureError ? (
        <div className="auth-message error workspace-message">
          Execute no Supabase a migration <strong>20260727_0031_execution_schedule_tracking.sql</strong> para liberar medições e reprogramações.
        </div>
      ) : null}
      {!projectId ? <div className="schedule-empty">Selecione uma obra no topo para acompanhar o cronograma.</div> : null}
      {projectId && !selectedBaseline ? <div className="schedule-empty">Esta obra ainda não possui cronograma. Crie e aprove a linha de base em Engenharia.</div> : null}
      {projectId && selectedBaseline ? (
        <ExecutionScheduleWorkbench
          projectName={project?.name ?? "Obra selecionada"}
          baselines={baselines}
          selectedBaseline={selectedBaseline}
          activities={activities}
          measurements={measurements}
          services={servicesResult.data}
          locations={locationsResult.data}
          selectedDate={selectedDate}
          canManage={canManage}
        />
      ) : null}
    </AppShell>
  );
}
