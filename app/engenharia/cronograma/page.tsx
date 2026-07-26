import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  generateScheduleFromTakeoffs,
  updateScheduleBaselineStatus,
} from "./actions";
import {
  ScheduleActivityCreateDialog,
  ScheduleActivityEditDialog,
  ScheduleBaselineCreateDialog,
  type ScheduleActivityData,
  type ScheduleBudgetOption,
  type ScheduleDependencyData,
  type ScheduleLocationOption,
  type ScheduleServiceOption,
} from "./schedule-dialogs";

type Project = { id: string; code: string | null; name: string };
type Baseline = {
  id: string;
  budget_id: string;
  code: string;
  name: string;
  version: string;
  start_date: string;
  work_on_saturday: boolean;
  status: "draft" | "review" | "approved" | "archived";
  notes: string | null;
  updated_at: string;
};

const baselineStatusLabels: Record<Baseline["status"], string> = {
  draft: "Em elaboração",
  review: "Em revisão",
  approved: "Linha de base oficial",
  archived: "Arquivada",
};

const activityStatusLabels: Record<ScheduleActivityData["planning_status"], string> = {
  draft: "Premissa a revisar",
  reviewed: "Revisada",
  approved: "Aprovada",
};

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

function decimal(value: number | null | undefined, digits = 2) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(Number(value ?? 0));
}

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function dayDifference(start: string, finish: string) {
  const startDate = new Date(`${start}T12:00:00Z`);
  const finishDate = new Date(`${finish}T12:00:00Z`);
  return Math.max(0, Math.round((finishDate.getTime() - startDate.getTime()) / 86_400_000));
}

function buildQuery(params: Record<string, string>) {
  const query = new URLSearchParams(params);
  return `?${query.toString()}`;
}

export default async function EngineeringSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    baseline?: string;
    q?: string;
    status?: string;
    service?: string;
    location?: string;
    success?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("schedule.view");
  const queryText = (params.q ?? "").trim().toLowerCase();
  const statusFilter = ["draft", "reviewed", "approved", "inactive"].includes(params.status ?? "") ? params.status! : "";

  const projectPromise = projectId
    ? supabase.from("projects").select("id, code, name").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const budgetsPromise = projectId
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
    : Promise.resolve({ data: [] as ScheduleBudgetOption[], error: null });

  const managePromise = roleKey === "owner" || roleKey === "admin"
    ? Promise.resolve({ data: true, error: null })
    : supabase.rpc("has_company_permission", {
        target_company_id: companyId,
        target_permission: "schedule.manage",
      });

  const [projectResult, budgetsResult, baselinesResult, activitiesResult, dependenciesResult, servicesResult, locationsResult, manageResult] = await Promise.all([
    projectPromise,
    budgetsPromise,
    projectId
      ? fetchAllRows<Baseline>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_schedule_baselines")
            .select("id, budget_id, code, name, version, start_date, work_on_saturday, status, notes, updated_at")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("updated_at", { ascending: false })
            .range(from, to);
          return { data: (data ?? []) as Baseline[], error };
        })
      : Promise.resolve({ data: [] as Baseline[], error: null }),
    projectId
      ? fetchAllRows<ScheduleActivityData>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_schedule_activities")
            .select("id, baseline_id, service_id, location_id, code, name, unit_snapshot, quantity_snapshot, productivity_per_team_day, team_count, duration_days, planned_start, planned_finish, planned_cost, sort_order, planning_status, notes, record_status")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("planned_start")
            .order("sort_order")
            .range(from, to);
          return { data: (data ?? []) as (ScheduleActivityData & { baseline_id: string })[], error };
        })
      : Promise.resolve({ data: [] as ScheduleActivityData[], error: null }),
    projectId
      ? fetchAllRows<ScheduleDependencyData>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_schedule_dependencies")
            .select("baseline_id, predecessor_id, successor_id, relation_type, lag_days")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .range(from, to);
          return { data: (data ?? []) as (ScheduleDependencyData & { baseline_id: string })[], error };
        })
      : Promise.resolve({ data: [] as ScheduleDependencyData[], error: null }),
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
  const budgets = budgetsResult.data;
  const baselines = baselinesResult.data;
  const selectedBaseline = baselines.find((baseline) => baseline.id === params.baseline)
    ?? baselines.find((baseline) => baseline.status !== "archived")
    ?? baselines[0]
    ?? null;
  const allActivities = activitiesResult.data as (ScheduleActivityData & { baseline_id?: string })[];
  const activities = selectedBaseline
    ? allActivities.filter((activity) => activity.baseline_id === selectedBaseline.id)
    : [];
  const dependencies = selectedBaseline
    ? (dependenciesResult.data as (ScheduleDependencyData & { baseline_id?: string })[]).filter((dependency) => dependency.baseline_id === selectedBaseline.id)
    : [];
  const services = servicesResult.data;
  const locations = locationsResult.data;
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";

  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const locationMap = new Map(locations.map((location) => [location.id, location]));
  const activityMap = new Map(activities.map((activity) => [activity.id, activity]));
  const incomingDependency = new Map(dependencies.map((dependency) => [dependency.successor_id, dependency]));

  const validServiceId = services.some((service) => service.id === params.service) ? params.service! : "";
  const validLocationId = locations.some((location) => location.id === params.location) ? params.location! : "";
  const filteredActivities = activities.filter((activity) => {
    if (statusFilter === "inactive" && activity.record_status !== "inactive") return false;
    if (statusFilter && statusFilter !== "inactive" && (activity.planning_status !== statusFilter || activity.record_status !== "active")) return false;
    if (!statusFilter && activity.record_status !== "active") return false;
    if (validServiceId && activity.service_id !== validServiceId) return false;
    if (validLocationId && activity.location_id !== validLocationId) return false;
    if (!queryText) return true;
    const service = activity.service_id ? serviceMap.get(activity.service_id) : null;
    const location = activity.location_id ? locationMap.get(activity.location_id) : null;
    return [activity.code, activity.name, service?.description ?? "", location?.name ?? "", activity.notes ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(queryText);
  });

  const activeActivities = activities.filter((activity) => activity.record_status === "active");
  const approvedCount = activeActivities.filter((activity) => activity.planning_status === "approved").length;
  const reviewedCount = activeActivities.filter((activity) => activity.planning_status === "reviewed").length;
  const draftCount = activeActivities.filter((activity) => activity.planning_status === "draft").length;
  const totalCost = activeActivities.reduce((sum, activity) => sum + Number(activity.planned_cost), 0);
  const totalTeams = activeActivities.reduce((sum, activity) => sum + Number(activity.team_count), 0);
  const earliestStart = activeActivities.reduce((earliest, activity) => !earliest || activity.planned_start < earliest ? activity.planned_start : earliest, selectedBaseline?.start_date ?? "");
  const latestFinish = activeActivities.reduce((latest, activity) => !latest || activity.planned_finish > latest ? activity.planned_finish : latest, selectedBaseline?.start_date ?? "");
  const totalCalendarDays = selectedBaseline && latestFinish ? Math.max(1, dayDifference(earliestStart, latestFinish) + 1) : 1;
  const budget = selectedBaseline ? budgets.find((item) => item.id === selectedBaseline.budget_id) : null;
  const structureError = baselinesResult.error || activitiesResult.error || dependenciesResult.error;
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";
  const currentQuery = {
    baseline: selectedBaseline?.id ?? "",
    q: params.q ?? "",
    status: statusFilter,
    service: validServiceId,
    location: validLocationId,
  };

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="schedule"
      eyebrow="Engenharia · Planejamento da Obra"
      title="Cronograma Físico · Linha Base"
      description={`${company.name} · ${context} · sequência por serviços, equipes e pavimentos.`}
      actions={canManage ? (
        <>
          <ScheduleBaselineCreateDialog budgets={budgets} />
          {selectedBaseline ? <ScheduleActivityCreateDialog baselineId={selectedBaseline.id} services={services} locations={locations} activities={activities} /> : null}
        </>
      ) : undefined}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {structureError ? (
        <div className="auth-message error workspace-message">
          A estrutura do cronograma ainda não está instalada. Execute a migration <strong>20260726_0023_engineering_schedule_baseline.sql</strong> no Supabase.
        </div>
      ) : null}
      {!projectId ? <div className="schedule-empty">Selecione uma obra no topo para acessar o cronograma.</div> : null}

      <nav className="budget-module-nav" aria-label="Planejamento da obra">
        <span className="active">▤ Cronograma físico · Linha base</span>
        <span>◒ Curvas física e financeira</span>
        <span>⌁ Plano de contratações</span>
        <span>▧ Planejamento de suprimentos</span>
      </nav>

      <section className="schedule-baseline-card">
        <div className="schedule-baseline-select">
          <div><span>Linha de base selecionada</span><strong>{selectedBaseline ? `${selectedBaseline.code} · ${selectedBaseline.version}` : "Nenhuma linha criada"}</strong></div>
          {baselines.length > 0 ? (
            <form method="get">
              <select name="baseline" defaultValue={selectedBaseline?.id ?? ""}>
                {baselines.map((baseline) => <option key={baseline.id} value={baseline.id}>{baseline.code} · {baseline.version} · {baseline.name}</option>)}
              </select>
              <button type="submit">Abrir</button>
            </form>
          ) : null}
        </div>
        {selectedBaseline ? (
          <div className="schedule-baseline-meta">
            <span className={`schedule-status baseline-${selectedBaseline.status}`}>{baselineStatusLabels[selectedBaseline.status]}</span>
            <span>Início: <strong>{dateBR(selectedBaseline.start_date)}</strong></span>
            <span>Calendário: <strong>{selectedBaseline.work_on_saturday ? "segunda a sábado" : "segunda a sexta"}</strong></span>
            <span>Orçamento: <strong>{budget ? `${budget.code} · ${budget.version}` : "—"}</strong></span>
          </div>
        ) : null}
      </section>

      {selectedBaseline ? (
        <>
          <section className="schedule-kpis">
            <article><span>Prazo da linha de base</span><strong>{activeActivities.length ? `${totalCalendarDays} dias corridos` : "—"}</strong><small>{dateBR(earliestStart)} → {dateBR(latestFinish)}</small></article>
            <article><span>Atividades ativas</span><strong>{activeActivities.length}</strong><small>{draftCount} a revisar · {reviewedCount} revisadas</small></article>
            <article><span>Atividades aprovadas</span><strong>{approvedCount}</strong><small>{activeActivities.length ? decimal(approvedCount / activeActivities.length * 100) : "0"}% da linha de base</small></article>
            <article><span>Custo planejado vinculado</span><strong>{money(totalCost)}</strong><small>{decimal(totalTeams)} equipe(s) distribuídas</small></article>
          </section>

          {canManage ? (
            <section className="schedule-actions-card">
              <div>
                <span>Geração integrada</span>
                <strong>Transformar levantamento aprovado em atividades</strong>
                <small>Cria o fluxo dos pavimentos com premissa inicial de 5 dias por atividade. Depois revise produtividade, equipes e predecessoras.</small>
              </div>
              <form action={generateScheduleFromTakeoffs}>
                <input type="hidden" name="baseline_id" value={selectedBaseline.id} />
                <button className="budget-primary-button" type="submit" disabled={activeActivities.length > 0}>Gerar do levantamento</button>
              </form>
              <form action={updateScheduleBaselineStatus}>
                <input type="hidden" name="baseline_id" value={selectedBaseline.id} />
                <input type="hidden" name="status" value={selectedBaseline.status === "draft" ? "review" : selectedBaseline.status === "review" ? "approved" : "review"} />
                <button className="budget-secondary-button" type="submit">
                  {selectedBaseline.status === "draft" ? "Enviar para revisão" : selectedBaseline.status === "review" ? "Aprovar linha de base" : "Reabrir revisão"}
                </button>
              </form>
            </section>
          ) : null}

          <section className="schedule-toolbar-card">
            <form method="get" className="schedule-filter">
              <input type="hidden" name="baseline" value={selectedBaseline.id} />
              <input name="q" defaultValue={params.q ?? ""} placeholder="Buscar atividade, serviço ou pavimento" />
              <select name="status" defaultValue={statusFilter}>
                <option value="">Atividades ativas</option>
                <option value="draft">Premissas a revisar</option>
                <option value="reviewed">Revisadas</option>
                <option value="approved">Aprovadas</option>
                <option value="inactive">Retiradas</option>
              </select>
              <select name="service" defaultValue={validServiceId}>
                <option value="">Todos os serviços</option>
                {services.map((service) => <option key={service.id} value={service.id}>{service.code} · {service.description}</option>)}
              </select>
              <select name="location" defaultValue={validLocationId}>
                <option value="">Todos os locais</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}
              </select>
              <button type="submit">Filtrar</button>
              <Link href={buildQuery({ baseline: selectedBaseline.id })}>Limpar</Link>
            </form>
          </section>

          <section className="schedule-gantt-card">
            <div className="budget-section-head">
              <div><span>Visão de prazo</span><h2>Linha do tempo das atividades</h2></div>
              <p>{filteredActivities.length} atividade(s) no filtro · {dateBR(earliestStart)} a {dateBR(latestFinish)}</p>
            </div>
            {filteredActivities.length > 0 ? (
              <div className="schedule-gantt-list">
                <div className="schedule-gantt-axis"><span>{dateBR(earliestStart)}</span><span>50% do período</span><span>{dateBR(latestFinish)}</span></div>
                {filteredActivities.slice(0, 80).map((activity) => {
                  const left = dayDifference(earliestStart, activity.planned_start) / totalCalendarDays * 100;
                  const width = Math.max(1.5, (dayDifference(activity.planned_start, activity.planned_finish) + 1) / totalCalendarDays * 100);
                  return (
                    <div className="schedule-gantt-row" key={activity.id}>
                      <div className="schedule-gantt-label"><strong>{activity.code}</strong><span>{activity.name}</span></div>
                      <div className="schedule-gantt-track">
                        <i className={`schedule-gantt-bar activity-${activity.planning_status}`} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} title={`${dateBR(activity.planned_start)} a ${dateBR(activity.planned_finish)}`} />
                      </div>
                    </div>
                  );
                })}
                {filteredActivities.length > 80 ? <p className="schedule-limit-note">A linha do tempo mostra as primeiras 80 atividades do filtro. A tabela abaixo mantém todos os registros.</p> : null}
              </div>
            ) : <div className="schedule-empty">Nenhuma atividade encontrada. Gere o cronograma a partir do levantamento ou cadastre uma atividade manualmente.</div>}
          </section>

          <section className="schedule-table-card">
            <div className="budget-section-head">
              <div><span>Planejamento detalhado</span><h2>Atividades, equipes e predecessoras</h2></div>
              <p>A duração é calculada automaticamente pela produtividade.</p>
            </div>
            <div className="registry-table-wrap">
              <table className="registry-table schedule-table">
                <thead><tr><th>Atividade</th><th>Local</th><th>Quantidade</th><th>Produtividade</th><th>Equipes</th><th>Duração</th><th>Início / término</th><th>Predecessora</th><th>Custo</th><th>Situação</th><th>Ação</th></tr></thead>
                <tbody>
                  {filteredActivities.map((activity) => {
                    const location = activity.location_id ? locationMap.get(activity.location_id) : null;
                    const dependency = incomingDependency.get(activity.id) ?? null;
                    const predecessor = dependency ? activityMap.get(dependency.predecessor_id) : null;
                    return (
                      <tr key={activity.id} className={activity.record_status === "inactive" ? "schedule-inactive-row" : ""}>
                        <td><strong>{activity.code}</strong><span>{activity.name}</span>{activity.source === "takeoff" ? <small>gerada do levantamento</small> : null}</td>
                        <td>{location ? <><strong>{location.code}</strong><span>{location.name}</span></> : "Geral"}</td>
                        <td><strong>{decimal(activity.quantity_snapshot, 4)}</strong><span>{activity.unit_snapshot}</span></td>
                        <td>{decimal(activity.productivity_per_team_day, 4)}<span>{activity.unit_snapshot}/equipe/dia</span></td>
                        <td>{decimal(activity.team_count, 2)}</td>
                        <td><strong>{activity.duration_days} d.u.</strong></td>
                        <td><strong>{dateBR(activity.planned_start)}</strong><span>{dateBR(activity.planned_finish)}</span></td>
                        <td>{predecessor ? <><strong>{predecessor.code}</strong><span>{dependency?.relation_type} {dependency?.lag_days ? `${dependency.lag_days > 0 ? "+" : ""}${dependency.lag_days}d` : ""}</span></> : "—"}</td>
                        <td>{money(activity.planned_cost)}</td>
                        <td><span className={`schedule-status activity-${activity.planning_status}`}>{activityStatusLabels[activity.planning_status]}</span></td>
                        <td>{canManage ? <ScheduleActivityEditDialog baselineId={selectedBaseline.id} activity={activity} services={services} locations={locations} activities={activities} dependency={dependency} /> : "—"}</td>
                      </tr>
                    );
                  })}
                  {filteredActivities.length === 0 ? <tr><td colSpan={11}>Nenhuma atividade no filtro atual.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="schedule-empty schedule-empty-large">
          <strong>Crie a primeira linha de base da obra.</strong>
          <span>Ela ficará vinculada a uma revisão do orçamento e receberá as atividades geradas do levantamento aprovado.</span>
        </section>
      )}
    </AppShell>
  );
}
