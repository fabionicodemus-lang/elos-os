import Link from "next/link";
import { importFlowStandaloneHistory } from "./actions";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  ExecutionScheduleWorkbench,
  type ExecutionScheduleBaseline,
  type ExecutionScheduleLocation,
  type ExecutionScheduleService,
} from "./execution-schedule-workbench";
import { PhysicalProgressPanel, type PhysicalWeightRecord } from "./physical-progress-panel";
import type { ExecutionScheduleActivity, ExecutionScheduleMeasurement } from "./progress-dialog";

type Project = { id: string; code: string | null; name: string };

function todayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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
        .select("id, activity_id, measurement_date, progress_percent, actual_quantity, actual_cost, team_count, current_start, current_finish, actual_start, actual_finish, notes, created_at, voided_at, void_reason")
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

  const weightsResult = selectedBaseline && projectId
    ? await fetchAllRows<PhysicalWeightRecord>(async (from, to) => {
        const { data, error } = await supabase
          .from("engineering_schedule_service_weights")
          .select("service_id, physical_weight_percent, distribution_method, source, notes")
          .eq("company_id", companyId)
          .eq("project_id", projectId)
          .eq("baseline_id", selectedBaseline.id)
          .order("created_at")
          .range(from, to);
        return { data: (data ?? []) as PhysicalWeightRecord[], error };
      })
    : { data: [] as PhysicalWeightRecord[], error: null };

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
      actions={<Link prefetch={false} className="elos-button secondary" href={selectedBaseline ? `/engenharia/cronograma?baseline=${selectedBaseline.id}` : "/engenharia/cronograma"}>Abrir linha de base</Link>}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {structureError ? (
        <div className="auth-message error workspace-message">
          Execute no Supabase a migration <strong>20260727_0031_execution_schedule_tracking.sql</strong> para liberar medições e reprogramações.
        </div>
      ) : null}
      {weightsResult.error ? (
        <div className="auth-message error workspace-message">
          Execute no Supabase a migration <strong>20260727_0032_schedule_physical_weights.sql</strong> para salvar os pesos físicos por serviço. Até lá, a tela usa apenas a sugestão automática.
        </div>
      ) : null}
      {!projectId ? <div className="schedule-empty">Selecione uma obra no topo para acompanhar o cronograma.</div> : null}
      {projectId && !selectedBaseline ? <div className="schedule-empty">Esta obra ainda não possui cronograma. Crie e aprove a linha de base em Engenharia.</div> : null}
      {projectId && selectedBaseline ? (
        <>

          {canManage && project?.name === "Flow Aptos" ? (
            <details className="prevision-card" style={{ padding: 18, marginBottom: 18 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                Conciliar histórico e replanejamento do Flow (arquivo 12/10/2026)
              </summary>
              <p style={{ color: "#475569", fontSize: 13, lineHeight: 1.6 }}>
                Preserva integralmente as medições do Elos até agosto/2026 e concilia as medições
                de setembro/outubro do arquivo com o replanejamento a partir de outubro.
                Confere posição, serviço e datas de linha de base das 395 atividades originais, sem incluir
                itens extras de mão de obra ou custos. A linha de base, orçamento Rev03 e dependências ficam intocados.
                Não cria lançamentos de agosto inexistentes na fonte.
              </p>
              {selectedBaseline.status !== "approved" ? (
                <p className="auth-message error">
                  A linha de base está em {selectedBaseline.status}. Antes de registrar execução, aprove-a em
                  <Link href={`/engenharia/cronograma?baseline=${selectedBaseline.id}`}> Engenharia › Cronograma</Link>.
                </p>
              ) : null}
              <form action={importFlowStandaloneHistory} style={{ display: "grid", gap: 12, maxWidth: 780 }}>
                <input type="hidden" name="baseline_id" value={selectedBaseline.id} />
                <label style={{ display: "grid", gap: 6 }}>
                  <strong>HTML standalone do Flow, versão de 12/10/2026</strong>
                  <input type="file" name="file" accept=".html,text/html" required />
                </label>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <input type="checkbox" name="confirm_history" required />
                  <span>Conferi a obra e a linha de base. Quero incorporar o histórico documentado e
                    o replanejamento de 06/10, preservando medições existentes.</span>
                </label>
                <button className="elos-button" type="submit" disabled={selectedBaseline.status !== "approved"}>
                  Importar histórico e reprogramação do Flow
                </button>
              </form>
            </details>
          ) : null}
          <PhysicalProgressPanel
            baselineId={selectedBaseline.id}
            selectedDate={selectedDate}
            activities={activities}
            measurements={measurements.filter((measurement) => !measurement.voided_at)}
            services={servicesResult.data}
            weights={weightsResult.data}
            canManage={canManage && !weightsResult.error}
          />
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
        </>
      ) : null}
    </AppShell>
  );
}
