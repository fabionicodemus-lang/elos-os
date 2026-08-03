import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { loadProjectForecast } from "@/lib/forecast/server";
import { requireCompanyPermission } from "@/lib/workspace";
import { updateForecastSettings } from "./actions";

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

function percent(value: number | null | undefined) {
  return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(value ?? 0))}%`;
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return `${month}/${year.slice(2)}`;
}

function compactMoney(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${value < 0 ? "-" : ""}R$ ${(absolute / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (absolute >= 1_000) return `${value < 0 ? "-" : ""}R$ ${(absolute / 1_000).toFixed(0)} mil`;
  return money(value);
}

export default async function ForecastByServicePage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string; baseline?: string }>;
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
  const forecast = context.forecast;
  const projectLabel = context.project
    ? `${context.project.code ? `${context.project.code} · ` : ""}${context.project.name}`
    : "Selecione uma obra";
  const maxMonthly = Math.max(1, ...(forecast?.months.map((month) => month.projected) ?? [1]));

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="financial-forecast"
      eyebrow="Engenharia · Gestão de Custos"
      title="Previsão Financeira por Serviço"
      description={`${company.name} · ${projectLabel} · realizado, comprometido e a comprometer sem dupla contagem.`}
      actions={
        <>
          <Link className="elos-button" href="/engenharia/curvas">Curvas</Link>
          <Link className="elos-button" href="/financeiro/fluxo-de-caixa">Fluxo de Caixa</Link>
          <Link className="elos-button elos-button-primary" href="/engenharia/contratos">Contratos</Link>
        </>
      }
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {context.errors.length ? <div className="auth-message error workspace-message">Não foi possível carregar toda a base da previsão: {context.errors.join(" · ")}</div> : null}
      {!projectId ? <div className="forecast-empty">Selecione uma obra no topo para abrir a previsão financeira unificada.</div> : null}

      {projectId && !context.baseline ? (
        <div className="forecast-empty"><strong>Não existe linha de base para esta obra.</strong><span>Crie ou aprove uma linha de base antes de montar a previsão.</span></div>
      ) : null}

      {projectId && context.baseline && forecast ? (
        <>
          <section className="forecast-reference-card">
            <div>
              <span>Base da previsão</span>
              <strong>{context.baseline.code} · {context.baseline.version} · {context.baseline.name}</strong>
              <small>{context.budget ? `Orçamento ${context.budget.code} · ${context.budget.version} · ${context.budget.name}` : "Sem orçamento vinculado"}</small>
            </div>
            {context.baselines.length > 1 ? (
              <form method="get">
                <select name="baseline" defaultValue={context.baseline.id}>
                  {context.baselines.map((baseline) => <option key={baseline.id} value={baseline.id}>{baseline.code} · {baseline.version} · {baseline.name}</option>)}
                </select>
                <button type="submit">Abrir</button>
              </form>
            ) : null}
            <form action={updateForecastSettings} className="forecast-settings-form">
              <label>Prazo padrão da obra<input name="forecast_default_payment_days" type="number" min="0" max="365" defaultValue={forecast.defaultPaymentDays} /></label>
              <span>dias corridos após a execução</span>
              <button type="submit">Salvar</button>
            </form>
          </section>

          <section className="forecast-kpis">
            <article><span>Orçamento</span><strong>{money(forecast.totals.budget)}</strong><small>revisão vinculada à linha de base</small></article>
            <article className="actual"><span>Realizado</span><strong>{money(forecast.totals.actual)}</strong><small>pagamentos efetuados</small></article>
            <article className="committed"><span>Comprometido</span><strong>{money(forecast.totals.committed)}</strong><small>{money(forecast.totals.committedPayable)} já em payables · {money(forecast.totals.committedFuture)} ainda não faturado</small></article>
            <article className="to-commit"><span>A comprometer</span><strong>{money(forecast.totals.toCommit)}</strong><small>orçamento menos realizado e comprometido</small></article>
            <article><span>Custo final projetado</span><strong>{money(forecast.totals.projectedCost)}</strong><small>soma das três camadas</small></article>
            <article className={forecast.totals.deviation > 0 ? "danger" : "ok"}><span>Desvio projetado</span><strong>{forecast.totals.deviation >= 0 ? "+" : ""}{money(forecast.totals.deviation)}</strong><small>{percent(forecast.totals.deviationPercent)} contra o orçamento</small></article>
          </section>

          <section className="forecast-formula-panel">
            <div><span>Regra anti-dupla-contagem</span><h2>O valor migra entre camadas; nunca é somado duas vezes</h2></div>
            <div className="forecast-formula">
              <span>Realizado</span><b>+</b><span>Comprometido</span><b>+</b><span>A comprometer</span><b>=</b><strong>Custo final projetado</strong>
            </div>
            <p>A camada “a comprometer” é sempre calculada por subtração e nunca fica negativa. Payables em aberto pertencem ao comprometido, mas são excluídas da série “Projetado Engenharia” no Fluxo de Caixa porque já aparecem em “A realizar”.</p>
          </section>

          {forecast.warnings.length ? (
            <section className="forecast-warnings">
              <div><span>Integridade da previsão</span><h2>Avisos</h2></div>
              <ul>{forecast.warnings.map((warning, index) => <li key={`${warning.code}-${warning.serviceId}-${index}`}>{warning.message}</li>)}</ul>
            </section>
          ) : null}

          <section className="forecast-monthly-panel">
            <div className="section-heading"><div><span>Composição mensal</span><h2>Realizado, comprometido e a comprometer</h2></div><p>{forecast.months.length} competência(s)</p></div>
            <div className="forecast-monthly-scroll">
              <div className="forecast-monthly-chart" style={{ minWidth: `${Math.max(900, forecast.months.length * 88)}px` }}>
                {forecast.months.map((month) => (
                  <article key={month.key}>
                    <div className="forecast-stack" title={`${monthLabel(month.key)} · ${money(month.projected)}`}>
                      <span className="actual" style={{ height: `${month.actual / maxMonthly * 100}%` }} />
                      <span className="committed" style={{ height: `${month.committed / maxMonthly * 100}%` }} />
                      <span className="to-commit" style={{ height: `${month.toCommit / maxMonthly * 100}%` }} />
                    </div>
                    <strong>{monthLabel(month.key)}</strong>
                    <small>{compactMoney(month.projected)}</small>
                  </article>
                ))}
              </div>
            </div>
            <div className="forecast-legend"><span><i className="actual" />Realizado</span><span><i className="committed" />Comprometido</span><span><i className="to-commit" />A comprometer</span></div>
          </section>

          <section className="registry-table-panel forecast-service-panel">
            <div className="section-heading"><div><span>Gestão por serviço</span><h2>Orçamento e custo final projetado</h2></div><p>{forecast.services.length} linha(s)</p></div>
            <div className="registry-table-wrap">
              <table className="registry-table forecast-service-table">
                <thead><tr><th>Serviço</th><th>Orçamento</th><th>Realizado</th><th>Comprometido</th><th>A comprometer</th><th>Custo final</th><th>Desvio</th></tr></thead>
                <tbody>
                  {forecast.services.map((service) => (
                    <tr key={service.id} className={service.deviation > 0 ? "danger" : ""}>
                      <td><strong>{service.code ? `${service.code} · ` : ""}{service.name}</strong>{service.committedPayable > 0 ? <small>{money(service.committedPayable)} em payables abertas</small> : null}</td>
                      <td>{money(service.budgetAmount)}</td>
                      <td>{money(service.actual)}</td>
                      <td>{money(service.committed)}</td>
                      <td>{money(service.toCommit)}</td>
                      <td><strong>{money(service.projectedCost)}</strong></td>
                      <td><strong className={service.deviation > 0 ? "forecast-danger" : service.deviation < 0 ? "forecast-positive" : ""}>{service.deviation >= 0 ? "+" : ""}{money(service.deviation)}</strong><small>{percent(service.deviationPercent)}</small></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><th>Total da obra</th><th>{money(forecast.totals.budget)}</th><th>{money(forecast.totals.actual)}</th><th>{money(forecast.totals.committed)}</th><th>{money(forecast.totals.toCommit)}</th><th>{money(forecast.totals.projectedCost)}</th><th className={forecast.totals.deviation > 0 ? "forecast-danger" : ""}>{forecast.totals.deviation >= 0 ? "+" : ""}{money(forecast.totals.deviation)}</th></tr></tfoot>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
