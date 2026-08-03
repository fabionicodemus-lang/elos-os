import Link from "next/link";
import "../../forecast.css";
import { AppShell } from "@/components/app-shell";
import { loadProjectForecast } from "@/lib/forecast/server";
import { requireCompanyPermission } from "@/lib/workspace";
import { buildLiveCurves, calculateCurveDeviations, type CurveRow } from "./curve-calculations.mjs";
import { buildSafeMonthWindow } from "./month-window.mjs";

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
  return `${month}/${year?.slice(2)}`;
}

function dateBR(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(date);
}

function deviationLabel(value: number | null) {
  if (value === null) return "Sem marco calculável";
  if (value === 0) return "No mesmo mês da linha de base";
  if (value > 0) return `${value} ${value === 1 ? "mês" : "meses"} de atraso`;
  const advance = Math.abs(value);
  return `${advance} ${advance === 1 ? "mês" : "meses"} de avanço`;
}

export default async function EngineeringCurvesPage({
  searchParams,
}: {
  searchParams: Promise<{ baseline?: string }>;
}) {
  const params = await searchParams;
  const asOfDate = todayIso();
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("schedule.view");
  const context = await loadProjectForecast({
    supabase,
    companyId,
    projectId,
    baselineId: params.baseline,
    asOfDate,
  });

  const {
    project,
    baseline,
    baselines,
    activities,
    progressMeasurements,
    assignedCosts,
    forecast,
  } = context;

  const budgetTotal = Number(forecast?.totals.budget ?? 0);
  const scheduledValue = activities.reduce(
    (sum, activity) => sum + Number(assignedCosts.get(activity.id) ?? 0),
    0,
  );
  const live = buildLiveCurves(
    activities,
    assignedCosts,
    budgetTotal,
    baseline?.work_on_saturday ?? false,
    progressMeasurements,
    asOfDate,
  );

  const liveByKey = new Map(live.rows.map((row) => [row.key, row]));
  const forecastByKey = new Map(forecast?.months.map((row) => [row.key, row]) ?? []);
  const monthWindow = buildSafeMonthWindow(
    [...liveByKey.keys(), ...forecastByKey.keys()],
    asOfDate.slice(0, 7),
  );

  const rows: CurveRow[] = [];
  let currentFinancialAccumulated = 0;
  let actualFinancialAccumulated = 0;

  for (const key of monthWindow.keys) {
    const liveRow = liveByKey.get(key);
    const forecastRow = forecastByKey.get(key);
    const currentFinancialMonth = Number(forecastRow?.projected ?? 0);
    const actualFinancialMonth = Number(forecastRow?.actual ?? 0);
    currentFinancialAccumulated += currentFinancialMonth;
    actualFinancialAccumulated += actualFinancialMonth;

    rows.push({
      key,
      label: liveRow?.label ?? monthLabel(key),
      physicalMonth: Number(liveRow?.physicalMonth ?? 0),
      physicalAccumulated: Number(liveRow?.physicalAccumulated ?? 0),
      financialMonth: Number(liveRow?.financialMonth ?? 0),
      financialAccumulated: Number(liveRow?.financialAccumulated ?? 0),
      financialPercent: budgetTotal > 0
        ? Number(liveRow?.financialAccumulated ?? 0) / budgetTotal * 100
        : 0,
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
    });
  }

  const deviations = calculateCurveDeviations(rows, asOfDate.slice(0, 7));
  const coverage = budgetTotal > 0 ? scheduledValue / budgetTotal * 100 : 0;
  const finalCurrentForecast = Number(forecast?.totals.projectedCost ?? scheduledValue);
  const forecastDeviation = Number(forecast?.totals.deviation ?? finalCurrentForecast - budgetTotal);
  const validStarts = activities.map((item) => item.planned_start).filter(Boolean).sort();
  const validFinishes = activities.map((item) => item.planned_finish).filter(Boolean).sort();
  const startDate = validStarts[0] ?? null;
  const finishDate = validFinishes.at(-1) ?? null;
  const maxMonthlyValue = rows.reduce((maximum, row) => {
    const month = forecastByKey.get(row.key);
    return Math.max(maximum, Number(month?.projected ?? 0), Number(row.financialMonth ?? 0));
  }, 1);
  const contextLabel = project
    ? `${project.code ? `${project.code} · ` : ""}${project.name}`
    : "Selecione uma obra";

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="schedule"
      eyebrow="Engenharia · Planejamento da Obra"
      title="Curvas Física e Financeira"
      description={`${company.name} · ${contextLabel} · previsão financeira unificada.`}
      actions={
        <>
          <Link className="elos-button" href={baseline ? `/engenharia/cronograma?baseline=${baseline.id}` : "/engenharia/cronograma"}>Voltar ao cronograma</Link>
          <Link className="elos-button" href="/engenharia/previsao-financeira">Previsão por serviço</Link>
          <Link className="elos-button elos-button-primary" href="/engenharia/contratos">Contratos</Link>
        </>
      }
    >
      {context.errors.length ? (
        <div className="auth-message error workspace-message">
          Não foi possível carregar toda a base: {context.errors.join(" · ")}
        </div>
      ) : null}

      {!projectId ? <div className="curves-empty">Selecione uma obra no topo para acessar as curvas.</div> : null}
      {projectId && !baseline ? (
        <div className="curves-empty curves-empty-large">
          <strong>Nenhuma linha de base encontrada.</strong>
          <span>Crie uma linha de base vinculada ao orçamento base aprovado.</span>
        </div>
      ) : null}

      {projectId && baseline ? (
        <>
          <section className="curves-baseline-card">
            <div>
              <span>Linha de base</span>
              <strong>{baseline.code} · {baseline.version} · {baseline.name}</strong>
              <small>Motor unificado · corte em {dateBR(asOfDate)}</small>
            </div>
            {baselines.length ? (
              <form method="get">
                <select name="baseline" defaultValue={baseline.id}>
                  {baselines.map((item) => (
                    <option key={item.id} value={item.id}>{item.code} · {item.version} · {item.name}</option>
                  ))}
                </select>
                <button type="submit">Abrir</button>
              </form>
            ) : null}
          </section>

          {!activities.length ? (
            <div className="curves-empty curves-empty-large">
              <strong>O cronograma ainda não possui atividades.</strong>
              <span>Cadastre atividades para distribuir as previsões no tempo.</span>
            </div>
          ) : (
            <>
              {monthWindow.truncated ? (
                <div className="auth-message warning workspace-message">
                  O cronograma contém datas muito distantes entre si. Para proteger o sistema, esta tela exibe no máximo 240 competências ao redor da data atual.
                </div>
              ) : null}

              <section className="curves-kpis">
                <article>
                  <span>Período da linha de base</span>
                  <strong>{dateBR(startDate)} — {dateBR(finishDate)}</strong>
                  <small>{rows.length} competência(s) exibidas</small>
                </article>
                <article>
                  <span>Orçamento</span>
                  <strong>{money(budgetTotal)}</strong>
                  <small>{decimal(coverage)}% distribuído no cronograma</small>
                </article>
                <article>
                  <span>Custo final projetado</span>
                  <strong>{money(finalCurrentForecast)}</strong>
                  <small className={forecastDeviation > 0 ? "negative" : ""}>
                    {forecastDeviation > 0 ? `${money(forecastDeviation)} de estouro projetado` : "sem estouro projetado"}
                  </small>
                </article>
                <article>
                  <span>Comprometido</span>
                  <strong>{money(forecast?.totals.committed)}</strong>
                  <small>{money(forecast?.totals.committedPayable)} em contas abertas</small>
                </article>
              </section>

              <section className="curves-deviation-cards">
                <article className={Number(deviations.delayAt50Months ?? 0) > 0 ? "danger" : "ok"}>
                  <span>Desvio no marco de 50%</span>
                  <strong>{deviationLabel(deviations.delayAt50Months)}</strong>
                  <small>linha de base versus previsão atual</small>
                </article>
                <article className={Number(deviations.finishDelayMonths ?? 0) > 0 ? "danger" : "ok"}>
                  <span>Desvio no término</span>
                  <strong>{deviationLabel(deviations.finishDelayMonths)}</strong>
                  <small>comparação entre as curvas físicas</small>
                </article>
                <article className={forecastDeviation > 0 ? "danger" : "ok"}>
                  <span>Desvio financeiro projetado</span>
                  <strong>{forecastDeviation >= 0 ? "+" : ""}{money(forecastDeviation)}</strong>
                  <small>custo final contra orçamento</small>
                </article>
              </section>

              <section className="curves-chart-card">
                <div className="curves-section-head">
                  <div><span>Curva S física</span><h2>Evolução acumulada por competência</h2></div>
                </div>
                <div className="forecast-composition-bars">
                  {rows.map((row) => (
                    <div className="forecast-composition-row" key={`physical-${row.key}`}>
                      <span>{monthLabel(row.key)}</span>
                      <div className="forecast-composition-track" title={`${row.label} · ${decimal(row.currentPhysicalAccumulated)}%`}>
                        <i className="to-commit" style={{ width: `${Math.min(100, Math.max(0, Number(row.physicalAccumulated ?? 0)))}%` }} />
                        <i className="committed" style={{ width: `${Math.min(100, Math.max(0, Number(row.currentPhysicalAccumulated ?? 0)))}%` }} />
                        <i className="actual" style={{ width: `${Math.min(100, Math.max(0, Number(row.actualPhysicalAccumulated ?? 0)))}%` }} />
                      </div>
                      <strong>{decimal(row.currentPhysicalAccumulated)}%</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="curves-chart-card">
                <div className="curves-section-head">
                  <div><span>Composição financeira</span><h2>Realizado, comprometido e a comprometer</h2></div>
                  <Link className="elos-button" href="/engenharia/previsao-financeira">Abrir por serviço</Link>
                </div>
                <div className="forecast-composition-bars">
                  {rows.map((row) => {
                    const month = forecastByKey.get(row.key);
                    return (
                      <div className="forecast-composition-row" key={`financial-${row.key}`}>
                        <span>{monthLabel(row.key)}</span>
                        <div className="forecast-composition-track" title={`${monthLabel(row.key)} · ${money(month?.projected)}`}>
                          <i className="actual" style={{ width: `${Number(month?.actual ?? 0) / maxMonthlyValue * 100}%` }} />
                          <i className="committed" style={{ width: `${Number(month?.committed ?? 0) / maxMonthlyValue * 100}%` }} />
                          <i className="to-commit" style={{ width: `${Number(month?.toCommit ?? 0) / maxMonthlyValue * 100}%` }} />
                        </div>
                        <strong>{money(month?.projected)}</strong>
                      </div>
                    );
                  })}
                </div>
                <div className="forecast-legend">
                  <span><i className="actual" />Realizado</span>
                  <span><i className="committed" />Comprometido</span>
                  <span><i className="to-commit" />A comprometer</span>
                </div>
              </section>

              <section className="registry-table-panel curves-memory-panel">
                <div className="section-heading">
                  <div><span>Memória mensal</span><h2>Linha de base e previsão atual</h2></div>
                  <p>Valores em regime de caixa.</p>
                </div>
                <div className="registry-table-wrap">
                  <table className="registry-table">
                    <thead>
                      <tr>
                        <th>Competência</th>
                        <th>Linha de base</th>
                        <th>Realizado</th>
                        <th>Contas abertas</th>
                        <th>Comprometido futuro</th>
                        <th>A comprometer</th>
                        <th>Previsão atual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const month = forecastByKey.get(row.key);
                        return (
                          <tr key={row.key}>
                            <td><strong>{monthLabel(row.key)}</strong></td>
                            <td>{money(row.financialMonth)}</td>
                            <td>{money(month?.actual)}</td>
                            <td>{money(month?.committedPayable)}</td>
                            <td>{money(month?.committedFuture)}</td>
                            <td>{money(month?.toCommit)}</td>
                            <td><strong>{money(month?.projected)}</strong></td>
                          </tr>
                        );
                      })}
                    </tbody>
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
