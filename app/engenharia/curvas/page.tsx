import Link from "next/link";
import "../../forecast.css";
import { AppShell } from "@/components/app-shell";
import { loadProjectForecast } from "@/lib/forecast/server";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  buildLiveCurves,
  calculateCurveDeviations,
  detectIntegrityAlerts,
  type CurveRow,
} from "./curve-calculations.mjs";

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

function parseDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`);
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

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return `${month}/${year.slice(2)}`;
}

function monthDeviation(value: number | null) {
  if (value === null) return "Sem marco calculável";
  if (value === 0) return "No mesmo mês da baseline";
  if (value > 0) return `${value} ${value === 1 ? "mês" : "meses"} de atraso`;
  const advance = Math.abs(value);
  return `${advance} ${advance === 1 ? "mês" : "meses"} de avanço`;
}

type CurveNumericField = Exclude<keyof CurveRow, "key" | "label">;
type CurveSeries = { label: string; field: CurveNumericField; className: "baseline" | "current" | "actual" };

function valueAt(row: CurveRow, field: CurveNumericField) {
  return Number(row[field] ?? 0);
}

function CurveChart({ rows, series, ariaLabel, maxFloor = 100 }: {
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

function contiguousMonthKeys(keys: string[]) {
  const sorted = [...new Set(keys.filter(Boolean))].sort();
  if (!sorted.length) return [];
  const start = parseDate(`${sorted[0]}-01`);
  const finish = parseDate(`${sorted.at(-1)}-01`);
  const result: string[] = [];
  for (let current = start; current <= finish; current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1, 12))) {
    result.push(current.toISOString().slice(0, 7));
  }
  return result;
}

export default async function EngineeringCurvesPage({
  searchParams,
}: {
  searchParams: Promise<{ baseline?: string }>;
}) {
  const params = await searchParams;
  const asOfDate = todayIso();
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("schedule.view");
  const context = await loadProjectForecast({ supabase, companyId, projectId, baselineId: params.baseline, asOfDate });
  const { project, baseline, baselines, budget, budgetItems, services, activities, progressMeasurements, assignedCosts, forecast } = context;
  const budgetTotal = forecast?.totals.budget ?? 0;
  const scheduledValue = activities.reduce((sum, activity) => sum + Number(assignedCosts.get(activity.id) ?? 0), 0);
  const live = buildLiveCurves(
    activities,
    assignedCosts,
    budgetTotal,
    baseline?.work_on_saturday ?? false,
    progressMeasurements,
    asOfDate,
  );
  const integrityAlerts = detectIntegrityAlerts(activities, budgetItems, services);
  const integrityAlertCount = integrityAlerts.servicesWithoutActivities.length
    + integrityAlerts.overprogrammedServices.length
    + integrityAlerts.activitiesWithoutBudgetService.length
    + integrityAlerts.budgetItemsWithoutService.length;

  const zeroWorkdayActivities = live.zeroWorkdayActivityIds
    .map((activityId) => activities.find((activity) => activity.id === activityId))
    .filter((activity): activity is (typeof activities)[number] => Boolean(activity));
  const lateActualCostActivities = live.lateActualCostWarnings
    .map((warning) => ({
      ...warning,
      activity: activities.find((activity) => activity.id === warning.activityId) ?? null,
    }));

  const liveByKey = new Map(live.rows.map((row) => [row.key, row]));
  const forecastByKey = new Map(forecast?.months.map((row) => [row.key, row]) ?? []);
  const keys = contiguousMonthKeys([...liveByKey.keys(), ...forecastByKey.keys()]);
  let currentFinancialAccumulated = 0;
  let actualFinancialAccumulated = 0;
  const rows: CurveRow[] = keys.map((key) => {
    const liveRow = liveByKey.get(key);
    const forecastRow = forecastByKey.get(key);
    const currentFinancialMonth = Number(forecastRow?.projected ?? 0);
    const actualFinancialMonth = Number(forecastRow?.actual ?? 0);
    currentFinancialAccumulated += currentFinancialMonth;
    actualFinancialAccumulated += actualFinancialMonth;
    return {
      key,
      label: liveRow?.label ?? monthLabel(key),
      physicalMonth: Number(liveRow?.physicalMonth ?? 0),
      physicalAccumulated: Number(liveRow?.physicalAccumulated ?? 0),
      financialMonth: Number(liveRow?.financialMonth ?? 0),
      financialAccumulated: Number(liveRow?.financialAccumulated ?? 0),
      financialPercent: number(budgetTotal > 0 ? Number(liveRow?.financialAccumulated ?? 0) / budgetTotal * 100 : 0),
      currentPhysicalMonth: Number(liveRow?.currentPhysicalMonth ?? liveRow?.physicalMonth ?? 0),
      currentPhysicalAccumulated: Number(liveRow?.currentPhysicalAccumulated ?? liveRow?.physicalAccumulated ?? 0),
      actualPhysicalMonth: Number(liveRow?.actualPhysicalMonth ?? 0),
      actualPhysicalAccumulated: Number(liveRow?.actualPhysicalAccumulated ?? 0),
      currentFinancialMonth,
      currentFinancialAccumulated,
      currentFinancialPercent: budgetTotal > 0 ? currentFinancialAccumulated / budgetTotal * 100 : 0,
      actualFinancialMonth,
      actualFinancialAccumulated,
      actualFinancialPercent: budgetTotal > 0 ? actualFinancialAccumulated / budgetTotal * 100 : 0,
    };
  });

  const deviations = calculateCurveDeviations(rows, asOfDate.slice(0, 7));
  const coverage = budgetTotal > 0 ? scheduledValue / budgetTotal * 100 : 0;
  const finalCurrentForecast = forecast?.totals.projectedCost ?? 0;
  const forecastDeviation = forecast?.totals.deviation ?? 0;
  const maxComposition = Math.max(1, ...(forecast?.months.map((month) => month.projected) ?? [1]));
  const physicalSeries: CurveSeries[] = live.hasExecutionData
    ? [
        { label: "Baseline", field: "physicalAccumulated", className: "baseline" },
        { label: "Previsão atual", field: "currentPhysicalAccumulated", className: "current" },
        { label: "Realizado", field: "actualPhysicalAccumulated", className: "actual" },
      ]
    : [{ label: "Baseline", field: "physicalAccumulated", className: "baseline" }];
  const financialSeries: CurveSeries[] = [
    { label: "Baseline", field: "financialPercent", className: "baseline" },
    { label: "Previsão atual", field: "currentFinancialPercent", className: "current" },
    { label: "Realizado pago", field: "actualFinancialPercent", className: "actual" },
  ];

  const integrityAlerts = detectIntegrityAlerts(activities, budgetItems, services);
  const integrityAlertCount = integrityAlerts.servicesWithoutActivities.length
    + integrityAlerts.overprogrammedServices.length
    + integrityAlerts.activitiesWithoutBudgetService.length
    + integrityAlerts.budgetItemsWithoutService.length;
  const structureError = context.errors.length > 0;
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="curves"
      eyebrow="Engenharia · Planejamento da Obra"
      title="Curvas Física e Financeira"
      description={`${company.name} · ${context} · baseline física e previsão financeira unificada.`}
      actions={
        <>
          <Link className="elos-button" href="/engenharia/previsao-financeira">Previsão por serviço</Link>
          <Link className="elos-button" href={baseline ? `/engenharia/cronograma?baseline=${baseline.id}` : "/engenharia/cronograma"}>Voltar ao cronograma</Link>
          <Link className="elos-button elos-button-primary" href="/engenharia/orcamento-analitico">Abrir orçamento</Link>
        </>
      }
    >
      {structureError ? <div className="auth-message error workspace-message">Não foi possível carregar toda a base da previsão financeira.</div> : null}
      {!projectId ? <div className="curves-empty">Selecione uma obra no topo para acessar as curvas.</div> : null}

      {projectId ? (
        <>
          <section className="curves-baseline-card">
            <div><span>Linha de base</span><strong>{baseline ? `${baseline.code} · ${baseline.version} · ${baseline.name}` : "Nenhuma linha criada"}</strong><small>{budget ? `Orçamento ${budget.code} · ${budget.version} · ${budget.name}` : "Sem revisão vinculada"}</small></div>
            {baselines.length ? <form method="get"><select name="baseline" defaultValue={baseline?.id ?? ""}>{baselines.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.version} · {item.name}</option>)}</select><button type="submit">Abrir</button></form> : null}
          </section>

          {!baseline || activities.length === 0 ? <div className="curves-empty curves-empty-large"><strong>O cronograma ainda nao possui atividades.</strong><span>Importe ou cadastre as atividades para formar as curvas.</span></div> : (
            <>
              <section className="curves-kpis">
                <article><span>Cobertura da baseline</span><strong>{decimal(coverage)}%</strong><small>{money(scheduledValue)} distribuído no cronograma</small></article>
                <article><span>Custo do orçamento</span><strong>{money(budgetTotal)}</strong><small>{budget?.area_m2 ? `${money(budgetTotal / Number(budget.area_m2))}/m̲` : "revisão vinculada"}</small></article>
                <article><span>Previsão atual total</span><strong>{money(finalCurrentForecast)}</strong><small className={forecastDeviation > 0 ? "negative" : ""}>{forecastDeviation > 0 ? `${money(forecastDeviation)} acima do orçamento` : "sem desvio projetado"}</small></article>
                <article><span>Realizado pago</span><strong>{money(forecast?.totals.actual)}</strong><small>baixas de contas a pagar</small></article>
                <article className={forecastDeviation > 0 ? "danger" : "ok"}><span>Desvio financeiro projetado</span><strong>{forecastDeviation >= 0 ? "+" : ""}{money(forecastDeviation)}</strong><small>custo final contra orçamento</small></article>
                </section>
              ) : <div className="curves-execution-empty"><strong>Sem medições físicas — cronograma atualizado igual à baseline.</strong><span>A previsão financeira já considera contratos, payables e o saldo a comprometer.</span></div>}

              <section className={`curves-integrity-panel ${integrityAlertCount === 0 ? "ok" : ""}`}>
                <div className="curves-section-head"><div><span>Validação</span><h2>Alertas de integridade</h2></div>{integrityAlertCount === 0 ? <strong className="curves-integrity-badge ok">Cobertura íntegra</strong> : <strong className="curves-integrity-badge warning">{integrityAlertCount} alerta(s)</strong>}</div>
                {integrityAlertCount === 0 ? <div className="curves-integrity-ok">Serviços, orçamento e cronograma possuem vínculos consistentes.</div> : (
                  <div className="curves-integrity-grid">
                    {integrityAlerts.servicesWithoutActivities.length ? <article className="warning"><h3>Serviços sem atividade</h3><ul>{integrityAlerts.servicesWithoutActivities.map((alert) => <li key={alert.serviceId}><strong>{alert.serviceLabel}</strong><span>{money(alert.budgetValue)}</span></li>)}</ul></article> : null}
                    {integrityAlerts.overprogrammedServices.length ? <article className="danger"><h3>Programado acima do orçamento</h3><ul>{integrityAlerts.overprogrammedServices.map((alert) => <li key={alert.serviceId}><strong>{alert.serviceLabel}</strong><span>Excedente {money(alert.excessValue)}</span></li>)}</ul></article> : null}
                    {integrityAlerts.activitiesWithoutBudgetService.length ? <article className="danger"><h3>Atividades fora da revisão</h3><ul>{integrityAlerts.activitiesWithoutBudgetService.map((alert) => <li key={alert.activityId}><strong>{alert.activityLabel}</strong><span>{alert.serviceLabel}</span></li>)}</ul></article> : null}
                    {integrityAlerts.budgetItemsWithoutService.length ? <article className="warning"><h3>Itens sem serviço</h3><ul>{integrityAlerts.budgetItemsWithoutService.map((alert) => <li key={alert.itemId}><strong>{alert.itemLabel}</strong><span>{money(alert.budgetValue)}</span></li>)}</ul></article> : null}
                  </div>
                )}
                {forecast?.warnings.length || live.usesEqualPhysicalWeights || zeroWorkdayActivities.length || lateActualCostActivities.length ? (
                  <div className="curves-calculation-notices">
                    {live.usesEqualPhysicalWeights ? <p><strong>Curva física sem ponderação por custo.</strong> Todas as atividades estão com custo atribuído igual a zero; por segurança, a tela manteve peso igual entre elas.</p> : null}
                    {zeroWorkdayActivities.length ? <p><strong>Atividades sem dia útil no intervalo:</strong> {zeroWorkdayActivities.map((activity) => `${activity.code} · ${activity.name}`).join("; ")}. O valor foi alocado integralmente no mês de início.</p> : null}
                    {lateActualCostActivities.length ? <p><strong>Custo real informado tardiamente:</strong> {lateActualCostActivities.map((warning) => `${warning.activity ? `${warning.activity.code} · ${warning.activity.name}` : warning.activityId} em ${dateBR(warning.measurementDate)}`).join("; ")}. O mês da primeira informação contém a conciliação acumulada e pode parecer inflado.</p> : null}
                    {forecast?.warnings.map((warning, index) => <p key={`${warning.code}-${index}`}>{warning.message}</p>)}
                  </div>
                ) : null}
              </section>

              <section className="curves-live-chart-grid">
                <article className="curves-chart-card"><div className="curves-section-head"><div><span>Curva S física</span><h2>Baseline, previsão atual e realizado</h2></div><div className="curves-legend"><span><i className="baseline" />Baseline</span>{live.hasExecutionData ? <><span><i className="current" />Previsão atual</span><span><i className="actual" />Realizado</span></> : null}</div></div><CurveChart rows={rows} series={physicalSeries} ariaLabel="Curva física" /></article>
                <article className="curves-chart-card"><div className="curves-section-head"><div><span>Curva S financeira</span><h2>Baseline, previsão unificada e realizado pago</h2></div><div className="curves-legend"><span><i className="baseline" />Baseline</span><span><i className="current" />Previsão atual</span><span><i className="actual" />Realizado pago</span></div></div><CurveChart rows={rows} series={financialSeries} ariaLabel="Curva financeira unificada" maxFloor={Math.max(100, Math.ceil((forecast?.totals.projectedCost ?? budgetTotal) / Math.max(1, budgetTotal) * 100 / 10) * 10)} /><p className="curves-note">A previsão atual é a soma de realizado, comprometido e a comprometer. O realizado financeiro passa a usar pagamentos efetivos.</p></article>
              </section>

              {forecast ? (
                <section className="curves-chart-card">
                  <div className="curves-section-head"><div><span>Composição da previsão</span><h2>Três camadas por competência</h2></div><Link className="elos-button" href="/engenharia/previsao-financeira">Abrir por serviço</Link></div>
                  <div className="forecast-composition-bars">{forecast.months.map((month) => (
                    <div className="forecast-composition-row" key={month.key}><span>{monthLabel(month.key)}</span><div className="forecast-composition-track" title={`${monthLabel(month.key)} · ${money(month.projected)}`}><i className="actual" style={{ width: `${month.actual / maxComposition * 100}%` }} /><i className="committed" style={{ width: `${month.committed / maxComposition * 100}%` }} /><i className="to-commit" style={{ width: `${month.toCommit / maxComposition * 100}%` }} /></div><strong>{money(month.projected)}</strong></div>
                  ))}</div>
                  <div className="forecast-legend"><span><i className="actual" />Realizado</span><span><i className="committed" />Comprometido</span><span><i className="to-commit" />A comprometer</span></div>
                </section>
              ) : null}

              <section className="registry-table-panel curves-memory-panel">
                <div className="section-heading"><div><span>Memória mensal</span><h2>Baseline e três camadas</h2></div><p>Valores em regime de caixa para a previsão atual.</p></div>
                <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Competência</th><th>Baseline</th><th>Realizado</th><th>Payables abertas</th><d�>Comprometido futuro</th><th>A comprometer</th><th>Previsão atual</th></tr></thead><tbody>{rows.map((row) => { const month = forecastByKey.get(row.key); return <tr key={row.key}><td><strong>{row.label}</strong></td><td>{money(row.financialMonth)}</td><td>{money(month?.actual)}</td><td>{money(month?.committedPayable)}</td><td>{money(month?.committedFuture)}</td><td>{money(month?.toCommit)}</td><td><strong>{money(month?.projected)}</strong></td></tr>; })}</tbody></table></div>
              </section>
            </>
          )}
        </>
      ) : null}
    </AppShell>
  );
}
