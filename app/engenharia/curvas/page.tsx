import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  assignActivityCosts,
  buildLiveCurves,
  calculateCurveDeviations,
  detectIntegrityAlerts,
  type CurveRow,
} from "./curve-calculations.mjs";

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
};
type Activity = {
  id: string;
  baseline_id: string;
  service_id: string | null;
  code: string;
  name: string;
  quantity_snapshot: number;
  planned_start: string;
  planned_finish: string;
  planned_cost: number;
  record_status: "active" | "inactive";
};
type Budget = {
  id: string;
  code: string;
  name: string;
  version: string;
  area_m2: number;
  status: "draft" | "in_progress" | "review" | "approved" | "archived";
  is_base: boolean;
};
type BudgetItem = {
  id: string;
  budget_id: string;
  service_id: string | null;
  code: string | null;
  description: string;
  total_direct_cost: number;
  status: "active" | "inactive";
};
type Service = { id: string; code: string; description: string };
type Measurement = {
  id: string;
  activity_id: string;
  measurement_date: string;
  progress_percent: number;
  actual_cost: number;
  current_start: string;
  current_finish: string;
  actual_start: string | null;
  actual_finish: string | null;
  created_at: string;
};

type CurveNumericField = Exclude<keyof CurveRow, "key" | "label">;
type CurveSeries = { label: string; field: CurveNumericField; className: "baseline" | "current" | "actual" };

function parseDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`);
}

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

function dateBR(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? parseDate(value) : value;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function decimal(value: number | null | undefined, digits = 1) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value ?? 0));
}

function monthDeviation(value: number | null) {
  if (value === null) return "Sem marco calculável";
  if (value === 0) return "No mesmo mês da baseline";
  if (value > 0) return `${value} ${value === 1 ? "mês" : "meses"} de atraso`;
  const advance = Math.abs(value);
  return `${advance} ${advance === 1 ? "mês" : "meses"} de avanço`;
}

function valueAt(row: CurveRow, field: CurveNumericField) {
  return Number(row[field] ?? 0);
}

function CurveChart({
  rows,
  series,
  ariaLabel,
  maxFloor = 100,
}: {
  rows: CurveRow[];
  series: CurveSeries[];
  ariaLabel: string;
  maxFloor?: number;
}) {
  const chartWidth = 1100;
  const chartHeight = 390;
  const left = 62;
  const right = 24;
  const top = 28;
  const bottom = 54;
  const plotWidth = chartWidth - left - right;
  const plotHeight = chartHeight - top - bottom;
  const maximum = Math.max(0, ...rows.flatMap((row) => series.map((item) => valueAt(row, item.field))));
  const maxPercent = Math.max(maxFloor, Math.ceil(maximum / 10) * 10 || maxFloor);
  const x = (index: number) => left + index / Math.max(1, rows.length - 1) * plotWidth;
  const y = (value: number) => top + plotHeight - Math.min(maxPercent, Math.max(0, value)) / maxPercent * plotHeight;
  const ticks = Array.from({ length: Math.floor(maxPercent / 20) + 1 }, (_, index) => index * 20);

  return (
    <div className="curves-svg-wrap">
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={ariaLabel}>
        {ticks.map((value) => (
          <g key={value}>
            <line x1={left} x2={chartWidth - right} y1={y(value)} y2={y(value)} className="curves-grid-line" />
            <text x={left - 12} y={y(value) + 4} textAnchor="end" className="curves-axis-text">{value}%</text>
          </g>
        ))}
        {rows.map((row, index) => index % Math.max(1, Math.ceil(rows.length / 12)) === 0 || index === rows.length - 1 ? (
          <text key={row.key} x={x(index)} y={chartHeight - 18} textAnchor="middle" className="curves-axis-text">{row.label}</text>
        ) : null)}
        {series.map((item) => {
          const points = rows.map((row, index) => `${x(index)},${y(valueAt(row, item.field))}`).join(" ");
          return (
            <g key={item.field}>
              <polyline points={points} className={`curves-line ${item.className}`} />
              {rows.map((row, index) => (
                <circle key={row.key} cx={x(index)} cy={y(valueAt(row, item.field))} r="3.2" className={`curves-point ${item.className}`}>
                  <title>{row.label}: {item.label} {decimal(valueAt(row, item.field))}%</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default async function EngineeringCurvesPage({
  searchParams,
}: {
  searchParams: Promise<{ baseline?: string }>;
}) {
  const params = await searchParams;
  const asOfDate = todayIso();
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("schedule.view");

  const [projectResult, baselinesResult, activitiesResult] = await Promise.all([
    projectId
      ? supabase.from("projects").select("id, code, name").eq("id", projectId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    projectId
      ? fetchAllRows<Baseline>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_schedule_baselines")
            .select("id, budget_id, code, name, version, start_date, work_on_saturday, status")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("updated_at", { ascending: false })
            .range(from, to);
          return { data: (data ?? []) as Baseline[], error };
        })
      : Promise.resolve({ data: [] as Baseline[], error: null }),
    projectId
      ? fetchAllRows<Activity>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_schedule_activities")
            .select("id, baseline_id, service_id, code, name, quantity_snapshot, planned_start, planned_finish, planned_cost, record_status")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .order("planned_start")
            .range(from, to);
          return { data: (data ?? []) as Activity[], error };
        })
      : Promise.resolve({ data: [] as Activity[], error: null }),
  ]);

  const project = projectResult.data as Project | null;
  const baselines = baselinesResult.data;
  const selectedBaseline = baselines.find((baseline) => baseline.id === params.baseline)
    ?? baselines.find((baseline) => baseline.status === "approved")
    ?? baselines.find((baseline) => baseline.status !== "archived")
    ?? baselines[0]
    ?? null;
  const activities = selectedBaseline
    ? activitiesResult.data.filter((activity) => activity.baseline_id === selectedBaseline.id && activity.record_status === "active")
    : [];

  const [budgetResult, budgetItemsResult, servicesResult, measurementsResult] = selectedBaseline && projectId
    ? await Promise.all([
        supabase
          .from("engineering_budgets")
          .select("id, code, name, version, area_m2, status, is_base")
          .eq("id", selectedBaseline.budget_id)
          .eq("company_id", companyId)
          .maybeSingle(),
        fetchAllRows<BudgetItem>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_budget_items")
            .select("id, budget_id, service_id, code, description, total_direct_cost, status")
            .eq("company_id", companyId)
            .eq("budget_id", selectedBaseline.budget_id)
            .range(from, to);
          return { data: (data ?? []) as BudgetItem[], error };
        }),
        fetchAllRows<Service>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_services")
            .select("id, code, description")
            .eq("company_id", companyId)
            .order("code")
            .range(from, to);
          return { data: (data ?? []) as Service[], error };
        }),
        fetchAllRows<Measurement>(async (from, to) => {
          const { data, error } = await supabase
            .from("engineering_schedule_progress_measurements")
            .select("id, activity_id, measurement_date, progress_percent, actual_cost, current_start, current_finish, actual_start, actual_finish, created_at")
            .eq("company_id", companyId)
            .eq("project_id", projectId)
            .eq("baseline_id", selectedBaseline.id)
            .order("measurement_date")
            .order("created_at")
            .range(from, to);
          return { data: (data ?? []) as Measurement[], error };
        }),
      ])
    : [
        { data: null, error: null },
        { data: [] as BudgetItem[], error: null },
        { data: [] as Service[], error: null },
        { data: [] as Measurement[], error: null },
      ];

  const budget = budgetResult.data as Budget | null;
  const budgetItems = budgetItemsResult.data as BudgetItem[];
  const services = servicesResult.data as Service[];
  const measurements = measurementsResult.data as Measurement[];
  const budgetTotal = budgetItems
    .filter((item) => item.status === "active")
    .reduce((sum, item) => sum + Number(item.total_direct_cost ?? 0), 0);
  const assignedCosts = assignActivityCosts(activities, budgetItems);
  const scheduledValue = activities.reduce((sum, activity) => sum + (assignedCosts.get(activity.id) ?? 0), 0);
  const curveResult = buildLiveCurves(
    activities,
    assignedCosts,
    budgetTotal,
    selectedBaseline?.work_on_saturday ?? false,
    measurements,
    asOfDate,
  );
  const rows = curveResult.rows as CurveRow[];
  const deviations = calculateCurveDeviations(rows, asOfDate.slice(0, 7));
  const integrityAlerts = detectIntegrityAlerts(activities, budgetItems, services);
  const integrityAlertCount = integrityAlerts.servicesWithoutActivities.length
    + integrityAlerts.overprogrammedServices.length
    + integrityAlerts.activitiesWithoutBudgetService.length
    + integrityAlerts.budgetItemsWithoutService.length;
  const zeroWorkdayActivities = curveResult.zeroWorkdayActivityIds
    .map((activityId) => activities.find((activity) => activity.id === activityId))
    .filter((activity): activity is Activity => Boolean(activity));
  const lateActualCostActivities = curveResult.lateActualCostWarnings
    .map((warning) => ({
      ...warning,
      activity: activities.find((activity) => activity.id === warning.activityId) ?? null,
    }));
  const coverage = budgetTotal > 0 ? scheduledValue / budgetTotal * 100 : 0;
  const missingCostCount = activities.filter((activity) => (assignedCosts.get(activity.id) ?? 0) <= 0).length;
  const directCostCount = activities.filter((activity) => Number(activity.planned_cost) > 0).length;
  const inferredCostCount = activities.filter((activity) => Number(activity.planned_cost) <= 0 && (assignedCosts.get(activity.id) ?? 0) > 0).length;
  const baselinePeak = rows.reduce<CurveRow | null>((current, row) => !current || row.financialMonth > current.financialMonth ? row : current, null);
  const currentPeak = rows.reduce<CurveRow | null>((current, row) => !current || Number(row.currentFinancialMonth ?? 0) > Number(current.currentFinancialMonth ?? 0) ? row : current, null);
  const startDate = activities.length ? activities.reduce((value, activity) => activity.planned_start < value ? activity.planned_start : value, activities[0].planned_start) : null;
  const finishDate = activities.length ? activities.reduce((value, activity) => activity.planned_finish > value ? activity.planned_finish : value, activities[0].planned_finish) : null;
  const currentFinishRow = curveResult.hasExecutionData ? rows.find((row) => Number(row.currentPhysicalAccumulated ?? 0) >= 99.999) ?? null : null;
  const finalCurrentForecast = curveResult.hasExecutionData ? Number(rows.at(-1)?.currentFinancialAccumulated ?? 0) : scheduledValue;
  const forecastDeviation = finalCurrentForecast - scheduledValue;
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";
  const structureError = baselinesResult.error || activitiesResult.error || budgetItemsResult.error || servicesResult.error || measurementsResult.error;
  const peakValue = Math.max(0, ...rows.flatMap((row) => [
    row.financialMonth,
    Number(row.currentFinancialMonth ?? 0),
    Number(row.actualFinancialMonth ?? 0),
  ]));
  const physicalSeries: CurveSeries[] = curveResult.hasExecutionData
    ? [
        { label: "Baseline", field: "physicalAccumulated", className: "baseline" },
        { label: "Previsão atual", field: "currentPhysicalAccumulated", className: "current" },
        { label: "Realizado", field: "actualPhysicalAccumulated", className: "actual" },
      ]
    : [{ label: "Baseline", field: "physicalAccumulated", className: "baseline" }];
  const financialSeries: CurveSeries[] = curveResult.hasExecutionData
    ? [
        { label: "Baseline", field: "financialPercent", className: "baseline" },
        { label: "Previsão atual", field: "currentFinancialPercent", className: "current" },
        { label: "Realizado / estimado", field: "actualFinancialPercent", className: "actual" },
      ]
    : [{ label: "Baseline", field: "financialPercent", className: "baseline" }];

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="schedule"
      eyebrow="Engenharia · Planejamento da Obra"
      title="Curvas Física e Financeira"
      description={`${company.name} · ${context} · baseline, previsão atual e realizado da obra.`}
      actions={
        <>
          <Link className="elos-button" href={selectedBaseline ? `/engenharia/cronograma?baseline=${selectedBaseline.id}` : "/engenharia/cronograma"}>Voltar ao cronograma</Link>
          <Link className="elos-button elos-button-primary" href="/engenharia/orcamento-analitico">Abrir orçamento</Link>
        </>
      }
    >
      {structureError ? <div className="auth-message error workspace-message">Não foi possível carregar toda a base do planejamento e da execução.</div> : null}
      {!projectId ? <div className="curves-empty">Selecione uma obra no topo para acessar as curvas.</div> : null}

      {projectId ? (
        <>
          <section className="curves-baseline-card">
            <div>
              <span>Linha de base</span>
              <strong>{selectedBaseline ? `${selectedBaseline.code} · ${selectedBaseline.version} · ${selectedBaseline.name}` : "Nenhuma linha criada"}</strong>
              <div className="curves-budget-reference">
                <small>{budget ? `Orçamento ${budget.code} · ${budget.version} · ${budget.name}` : "Sem revisão de orçamento vinculada"}</small>
                {budget && budget.status !== "approved" ? <span className="curves-status-badge warning">Orçamento não aprovado</span> : null}
                {curveResult.hasExecutionData ? <span className="curves-status-badge live">Curva viva até {dateBR(asOfDate)}</span> : null}
              </div>
            </div>
            {baselines.length ? (
              <form method="get">
                <select name="baseline" defaultValue={selectedBaseline?.id ?? ""}>
                  {baselines.map((baseline) => <option key={baseline.id} value={baseline.id}>{baseline.code} · {baseline.version} · {baseline.name}</option>)}
                </select>
                <button type="submit">Abrir</button>
              </form>
            ) : null}
          </section>

          {!selectedBaseline || activities.length === 0 ? (
            <div className="curves-empty curves-empty-large">
              <strong>O cronograma ainda não possui atividades nesta linha de base.</strong>
              <span>Importe ou cadastre as atividades para formar as curvas.</span>
            </div>
          ) : (
            <>
              {!curveResult.hasExecutionData ? (
                <div className="curves-execution-empty"><strong>Sem dados de execução — mostrando apenas o plano.</strong><span>Registre medições em Execução → Controle do Cronograma para ativar a previsão atual e o realizado.</span></div>
              ) : null}

              <section className="curves-kpis">
                <article><span>Período da baseline</span><strong>{dateBR(startDate)} — {dateBR(finishDate)}</strong><small>{rows.length} competência(s) na memória consolidada</small></article>
                <article><span>Custo do orçamento</span><strong>{money(budgetTotal)}</strong><small>{budget?.area_m2 ? `${money(budgetTotal / Number(budget.area_m2))}/m²` : "revisão vinculada"}</small></article>
                <article><span>Previsão atual total</span><strong>{money(finalCurrentForecast)}</strong><small className={forecastDeviation > 0 ? "negative" : ""}>{forecastDeviation > 0 ? `${money(forecastDeviation)} acima do programado` : "saldo físico valorizado pelo orçamento"}</small></article>
                <article><span>Pico mensal</span><strong>{money(curveResult.hasExecutionData ? Number(currentPeak?.currentFinancialMonth ?? 0) : baselinePeak?.financialMonth ?? 0)}</strong><small>{curveResult.hasExecutionData ? currentPeak?.label ?? "—" : baselinePeak?.label ?? "—"}</small></article>
              </section>

              {curveResult.hasExecutionData ? (
                <section className="curves-deviation-cards">
                  <article className={Number(deviations.delayAt50Months ?? 0) > 0 ? "danger" : "ok"}><span>Desvio no marco de 50%</span><strong>{monthDeviation(deviations.delayAt50Months)}</strong><small>baseline versus previsão atual</small></article>
                  <article className={Number(deviations.finishDelayMonths ?? 0) > 0 ? "danger" : "ok"}><span>Desvio no término</span><strong>{monthDeviation(deviations.finishDelayMonths)}</strong><small>{currentFinishRow ? `conclusão atual em ${currentFinishRow.label}` : "sem conclusão calculável"}</small></article>
                  <article className={deviations.financialDeviationToDate > 0 ? "danger" : "ok"}><span>Desvio financeiro até hoje</span><strong>{deviations.financialDeviationToDate >= 0 ? "+" : ""}{money(deviations.financialDeviationToDate)}</strong><small>baseline {money(deviations.baselineFinancialToDate)} · realizado/estimado {money(deviations.actualFinancialToDate)}</small></article>
                </section>
              ) : null}

              <section className="curves-quality-strip">
                <div><span>Atividades</span><strong>{activities.length}</strong></div>
                <div><span>Custo informado na atividade</span><strong>{directCostCount}</strong></div>
                <div><span>Custo distribuído do orçamento</span><strong>{inferredCostCount}</strong></div>
                <div className={missingCostCount ? "warning" : "ok"}><span>Sem custo vinculado</span><strong>{missingCostCount}</strong></div>
                <div className={coverage >= 99 ? "ok" : "warning"}><span>Cobertura financeira</span><strong>{decimal(coverage)}%</strong></div>
              </section>

              <section className={`curves-integrity-panel ${integrityAlertCount === 0 ? "ok" : ""}`}>
                <div className="curves-section-head">
                  <div><span>Validação da curva</span><h2>Alertas de integridade</h2></div>
                  {integrityAlertCount === 0
                    ? <strong className="curves-integrity-badge ok">Cobertura íntegra</strong>
                    : <strong className="curves-integrity-badge warning">{integrityAlertCount} alerta(s)</strong>}
                </div>

                {integrityAlertCount === 0 ? (
                  <div className="curves-integrity-ok">Os serviços e atividades possuem cobertura consistente com a revisão do orçamento.</div>
                ) : (
                  <div className="curves-integrity-grid">
                    {integrityAlerts.servicesWithoutActivities.length ? (
                      <article className="warning"><h3>Serviços sem atividade</h3><p>Custos ativos do orçamento que ainda não foram distribuídos no cronograma.</p><ul>{integrityAlerts.servicesWithoutActivities.map((alert) => <li key={alert.serviceId}><strong>{alert.serviceLabel}</strong><span>{money(alert.budgetValue)} não distribuído</span></li>)}</ul></article>
                    ) : null}
                    {integrityAlerts.overprogrammedServices.length ? (
                      <article className="danger"><h3>Programado acima do orçamento</h3><p>A soma dos custos explícitos das atividades supera o valor do serviço.</p><ul>{integrityAlerts.overprogrammedServices.map((alert) => <li key={alert.serviceId}><strong>{alert.serviceLabel}</strong><span>Orçado {money(alert.budgetValue)} · programado {money(alert.programmedValue)} · excedente {money(alert.excessValue)}</span></li>)}</ul></article>
                    ) : null}
                    {integrityAlerts.activitiesWithoutBudgetService.length ? (
                      <article className="danger"><h3>Atividades fora da revisão</h3><p>Atividades vinculadas a serviços que não existem entre os itens ativos do orçamento.</p><ul>{integrityAlerts.activitiesWithoutBudgetService.map((alert) => <li key={alert.activityId}><strong>{alert.activityLabel}</strong><span>{alert.serviceLabel}</span></li>)}</ul></article>
                    ) : null}
                    {integrityAlerts.budgetItemsWithoutService.length ? (
                      <article className="warning"><h3>Itens sem serviço vinculado</h3><p>Itens ativos que não podem ser distribuídos automaticamente no cronograma.</p><ul>{integrityAlerts.budgetItemsWithoutService.map((alert) => <li key={alert.itemId}><strong>{alert.itemLabel}</strong><span>{money(alert.budgetValue)}</span></li>)}</ul></article>
                    ) : null}
                  </div>
                )}

                {curveResult.usesEqualPhysicalWeights || zeroWorkdayActivities.length || lateActualCostActivities.length ? (
                  <div className="curves-calculation-notices">
                    {curveResult.usesEqualPhysicalWeights ? <p><strong>Curva física sem ponderação por custo.</strong> Todas as atividades estão com custo atribuído igual a zero; por segurança, a tela manteve peso igual entre elas.</p> : null}
                    {zeroWorkdayActivities.length ? <p><strong>Atividades sem dia útil no intervalo:</strong> {zeroWorkdayActivities.map((activity) => `${activity.code} · ${activity.name}`).join("; ")}. O valor foi alocado integralmente no mês de início.</p> : null}
                    {lateActualCostActivities.length ? <p><strong>Custo real informado tardiamente:</strong> {lateActualCostActivities.map((warning) => `${warning.activity ? `${warning.activity.code} · ${warning.activity.name}` : warning.activityId} em ${dateBR(warning.measurementDate)}`).join("; ")}. O mês da primeira informação contém a conciliação acumulada e pode parecer inflado.</p> : null}
                  </div>
                ) : null}
              </section>

              <section className="curves-live-chart-grid">
                <article className="curves-chart-card">
                  <div className="curves-section-head"><div><span>Curva S física</span><h2>Baseline, previsão atual e realizado</h2></div><div className="curves-legend"><span><i className="baseline" />Baseline</span>{curveResult.hasExecutionData ? <><span><i className="current" />Previsão atual</span><span><i className="actual" />Realizado</span></> : null}</div></div>
                  <CurveChart rows={rows} series={physicalSeries} ariaLabel="Curva física acumulada da baseline, previsão atual e realizado" />
                  <p className="curves-note">A baseline permanece congelada. A previsão atual preserva o progresso medido no passado e distribui somente o físico restante a partir de hoje.</p>
                </article>

                <article className="curves-chart-card">
                  <div className="curves-section-head"><div><span>Curva S financeira</span><h2>Baseline, previsão atual e realizado</h2></div><div className="curves-legend"><span><i className="baseline" />Baseline</span>{curveResult.hasExecutionData ? <><span><i className="current" />Previsão atual</span><span><i className="actual" />Realizado / estimado</span></> : null}</div></div>
                  <CurveChart rows={rows} series={financialSeries} ariaLabel="Curva financeira acumulada da baseline, previsão atual e realizado" />
                  <p className="curves-note">Previsão atual = realizado acumulado + custo orçado do físico restante. Um estouro já ocorrido não reduz o saldo necessário para concluir a atividade.</p>
                </article>
              </section>

              <section className="curves-grid">
                <article className="curves-chart-card">
                  <div className="curves-section-head"><div><span>Desembolso mensal</span><h2>Baseline, previsão atual e realizado</h2></div></div>
                  <div className="curves-bars curves-bars-live">
                    {rows.map((row) => <div key={row.key} className="curves-bar-group"><div className="curves-bar-columns"><span className="baseline" style={{ height: `${peakValue ? Math.max(2, Math.max(0, row.financialMonth) / peakValue * 100) : 0}%` }} title={`Baseline ${row.label}: ${money(row.financialMonth)}`} />{curveResult.hasExecutionData ? <><span className="current" style={{ height: `${peakValue ? Math.max(2, Math.max(0, Number(row.currentFinancialMonth ?? 0)) / peakValue * 100) : 0}%` }} title={`Previsão atual ${row.label}: ${money(row.currentFinancialMonth)}`} /><span className="actual" style={{ height: `${peakValue ? Math.max(2, Math.max(0, Number(row.actualFinancialMonth ?? 0)) / peakValue * 100) : 0}%` }} title={`Realizado ${row.label}: ${money(row.actualFinancialMonth)}`} /></> : null}</div><small>{row.label}</small></div>)}
                  </div>
                </article>

                <article className="curves-summary-card">
                  <span>Leitura executiva</span>
                  <h2>Conferência da curva viva</h2>
                  <dl>
                    <div><dt>Orçamento ainda não distribuído</dt><dd>{money(Math.max(0, budgetTotal - scheduledValue))}</dd></div>
                    <div><dt>Valor programado acima do orçamento</dt><dd>{money(Math.max(0, scheduledValue - budgetTotal))}</dd></div>
                    <div><dt>Previsão atual acima do programado</dt><dd className={forecastDeviation > 0 ? "negative" : ""}>{money(Math.max(0, forecastDeviation))}</dd></div>
                    <div><dt>Atividades sem custo</dt><dd>{missingCostCount}</dd></div>
                  </dl>
                  {curveResult.hasExecutionData ? <p className={forecastDeviation > 0 ? "warning" : "ok"}>{forecastDeviation > 0 ? "A execução real indica custo final acima do valor programado. O desvio está preservado na previsão." : "A previsão atual mantém o realizado e valoriza o saldo físico pelo orçamento."}</p> : <p className="warning">Sem medições, a tela apresenta somente a linha de base.</p>}
                </article>
              </section>

              <section className="curves-table-card">
                <div className="curves-section-head"><div><span>Memória mensal</span><h2>Baseline, previsão atual e realizado</h2></div></div>
                <div className="registry-table-wrap">
                  <table className="registry-table curves-table curves-live-table">
                    <thead>
                      <tr><th rowSpan={2}>Competência</th><th colSpan={3}>Físico acumulado</th><th colSpan={3}>Financeiro mensal</th><th colSpan={3}>Financeiro acumulado</th></tr>
                      <tr><th>Baseline</th><th>Atual</th><th>Realizado</th><th>Baseline</th><th>Atual</th><th>Realizado</th><th>Baseline</th><th>Atual</th><th>Realizado</th></tr>
                    </thead>
                    <tbody>{rows.map((row) => (
                      <tr key={row.key}>
                        <td><strong>{row.label}</strong><span>{row.key}</span></td>
                        <td>{decimal(row.physicalAccumulated)}%</td>
                        <td>{curveResult.hasExecutionData ? `${decimal(row.currentPhysicalAccumulated)}%` : "—"}</td>
                        <td>{curveResult.hasExecutionData ? `${decimal(row.actualPhysicalAccumulated)}%` : "—"}</td>
                        <td>{money(row.financialMonth)}</td>
                        <td className={Number(row.currentFinancialMonth ?? 0) < 0 ? "negative" : ""}>{curveResult.hasExecutionData ? money(row.currentFinancialMonth) : "—"}</td>
                        <td className={Number(row.actualFinancialMonth ?? 0) < 0 ? "negative" : ""}>{curveResult.hasExecutionData ? money(row.actualFinancialMonth) : "—"}</td>
                        <td><strong>{money(row.financialAccumulated)}</strong></td>
                        <td><strong>{curveResult.hasExecutionData ? money(row.currentFinancialAccumulated) : "—"}</strong></td>
                        <td><strong>{curveResult.hasExecutionData ? money(row.actualFinancialAccumulated) : "—"}</strong></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      ) : null}
    </AppShell>
  );
}
