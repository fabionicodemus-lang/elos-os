import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { loadProjectForecast } from "@/lib/forecast/server";
import { requireCompanyPermission } from "@/lib/workspace";
import { removeFixedTermService, saveFixedTermService } from "../actions";

function todayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return `${month}/${year.slice(2)}`;
}

function monthsBetween(start: string | null, end: string | null) {
  if (!start || !end) return 0;
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
}

export default async function FixedTermForecastPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const asOfDate = todayIso();
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("schedule.view");
  const [context, manageResult] = await Promise.all([
    loadProjectForecast({ supabase, companyId, projectId, asOfDate }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "schedule.manage" }),
  ]);
  const canManage = manageResult.data === true;
  const forecast = context.forecast;
  const fixed = forecast?.services.filter((service) => service.financialMode === "fixed_term") ?? [];
  const candidates = forecast?.services.filter((service) => service.financialMode !== "fixed_term" && !service.id.startsWith("__")) ?? [];
  const currentMonth = asOfDate.slice(0, 7);
  const monthKeys = [...new Set(fixed.flatMap((service) => service.monthly
    .filter((month) => month.key >= currentMonth && month.committedFuture + month.toCommit + month.committedPayable > 0.5)
    .map((month) => month.key)))].sort();
  const projectLabel = context.project ? `${context.project.code ? `${context.project.code} · ` : ""}${context.project.name}` : "Selecione uma obra";

  const totals = fixed.reduce((sum, service) => ({
    budget: sum.budget + service.budgetAmount,
    actual: sum.actual + service.actual,
    payable: sum.payable + service.committedPayable,
    balance: sum.balance + service.committedFuture + service.toCommit,
    projected: sum.projected + service.projectedCost,
  }), { budget: 0, actual: 0, payable: 0, balance: 0, projected: 0 });

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="financial-forecast"
      eyebrow="Engenharia · Previsão Financeira"
      title="Previsão por prazo fixo"
      description={`${company.name} · ${projectLabel} · serviços fora do cronograma, com o saldo dividido igualmente por mês.`}
      actions={<Link prefetch={false} className="elos-button" href="/engenharia/previsao-financeira">Previsão por serviço</Link>}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {context.errors.length ? <div className="auth-message error workspace-message">Parte da base não pôde ser lida: {context.errors.join(" · ")}</div> : null}
      {!projectId ? <div className="forecast-empty">Selecione uma obra no topo.</div> : null}

      {forecast ? (
        <>
          <section className="forecast-formula-panel">
            <div><span>Como funciona</span><h2>Saldo ÷ meses do prazo</h2></div>
            <p>
              Para contratos fixos (empreiteiros por mês, equipe, administração), o saldo do serviço não segue o cronograma.
              Saldo = valor contratado ainda não faturado + o que falta contratar até o orçado. Ele é dividido em parcelas iguais
              do mês de início ao mês de fim (nunca antes do mês atual). Títulos já lançados no contas a pagar continuam no vencimento.
              O prazo de execução das atividades continua no cronograma, se houver.
            </p>
          </section>

          <section className="forecast-kpis">
            <article><span>Orçado</span><strong>{money(totals.budget)}</strong><small>{fixed.length} serviço(s) em prazo fixo</small></article>
            <article className="actual"><span>Realizado</span><strong>{money(totals.actual)}</strong><small>pagamentos efetuados</small></article>
            <article className="committed"><span>Títulos em aberto</span><strong>{money(totals.payable)}</strong><small>no vencimento de cada título</small></article>
            <article className="to-commit"><span>Saldo distribuído</span><strong>{money(totals.balance)}</strong><small>parcelas mensais iguais</small></article>
            <article className={totals.projected > totals.budget ? "danger" : "ok"}><span>Custo final</span><strong>{money(totals.projected)}</strong><small>{totals.projected >= totals.budget ? "+" : ""}{money(totals.projected - totals.budget)} contra o orçado</small></article>
          </section>

          <section className="registry-table-panel forecast-service-panel">
            <div className="section-heading"><div><span>Serviços em prazo fixo</span><h2>Prazo e valor mensal</h2></div><p>{fixed.length} linha(s)</p></div>
            <div className="registry-table-wrap">
              <table className="registry-table forecast-service-table">
                <thead><tr><th>Serviço</th><th>Prazo da distribuição</th><th>Orçado</th><th>Realizado</th><th>Títulos abertos</th><th>Saldo</th><th>Por mês</th><th>Custo final</th><th>Desvio</th></tr></thead>
                <tbody>
                  {fixed.length === 0 ? <tr><td colSpan={9}>Nenhum serviço em prazo fixo. Inclua abaixo.</td></tr> : null}
                  {fixed.map((service) => {
                    const balance = service.committedFuture + service.toCommit;
                    const effectiveStart = service.distributionStart && service.distributionStart.slice(0, 7) > currentMonth ? service.distributionStart.slice(0, 7) : currentMonth;
                    const months = monthsBetween(effectiveStart, service.distributionEnd?.slice(0, 7) ?? null);
                    return (
                      <tr key={service.id} className={service.deviation > 0 ? "danger" : ""}>
                        <td><strong>{service.code} · {service.name}</strong></td>
                        <td>
                          {canManage ? (
                            <form action={saveFixedTermService} className="fixed-term-form">
                              <input type="hidden" name="service_id" value={service.id} />
                              <input type="month" name="distribution_start" defaultValue={service.distributionStart?.slice(0, 7) ?? currentMonth} aria-label="Mês de início" />
                              <span>a</span>
                              <input type="month" name="distribution_end" defaultValue={service.distributionEnd?.slice(0, 7) ?? ""} aria-label="Mês de fim" />
                              <button type="submit">Salvar</button>
                            </form>
                          ) : `${service.distributionStart ? monthLabel(service.distributionStart.slice(0, 7)) : "—"} a ${service.distributionEnd ? monthLabel(service.distributionEnd.slice(0, 7)) : "—"}`}
                        </td>
                        <td>{money(service.budgetAmount)}</td>
                        <td>{money(service.actual)}</td>
                        <td>{money(service.committedPayable)}</td>
                        <td><strong>{money(balance)}</strong></td>
                        <td>{months > 0 ? <>{money(balance / months)}<small>{months} mês(es)</small></> : "—"}</td>
                        <td><strong>{money(service.projectedCost)}</strong></td>
                        <td>
                          <strong className={service.deviation > 0 ? "forecast-danger" : service.deviation < 0 ? "forecast-positive" : ""}>{service.deviation >= 0 ? "+" : ""}{money(service.deviation)}</strong>
                          {canManage ? (
                            <form action={removeFixedTermService} className="fixed-term-form">
                              <input type="hidden" name="service_id" value={service.id} />
                              <button type="submit" className="remove" title="Voltar a distribuir pelo cronograma">Usar cronograma</button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {canManage ? (
            <section className="registry-table-panel forecast-service-panel">
              <div className="section-heading"><div><span>Incluir serviço</span><h2>Marcar como prazo fixo</h2></div></div>
              <form action={saveFixedTermService} className="fixed-term-form">
                <select name="service_id" required defaultValue="">
                  <option value="" disabled>Escolha o serviço…</option>
                  {candidates.map((service) => <option key={service.id} value={service.id}>{service.code} · {service.name} ({money(service.budgetAmount)})</option>)}
                </select>
                <label>de <input type="month" name="distribution_start" defaultValue={currentMonth} required /></label>
                <label>até <input type="month" name="distribution_end" required /></label>
                <button type="submit">Incluir</button>
              </form>
            </section>
          ) : null}

          {fixed.length && monthKeys.length ? (
            <section className="registry-table-panel forecast-service-panel">
              <div className="section-heading"><div><span>Distribuição no tempo</span><h2>Saída prevista por mês</h2></div><p>títulos em aberto + parcelas do saldo</p></div>
              <div className="registry-table-wrap">
                <table className="registry-table fixed-term-months">
                  <thead><tr><th>Serviço</th>{monthKeys.map((key) => <th key={key}>{monthLabel(key)}</th>)}<th>Total</th></tr></thead>
                  <tbody>
                    {fixed.map((service) => {
                      const byKey = new Map(service.monthly.map((month) => [month.key, month.committedPayable + month.committedFuture + month.toCommit]));
                      const total = monthKeys.reduce((sum, key) => sum + Number(byKey.get(key) ?? 0), 0);
                      return <tr key={service.id}><td><strong>{service.code}</strong> · {service.name}</td>{monthKeys.map((key) => <td key={key}>{byKey.get(key) ? money(byKey.get(key)) : "—"}</td>)}<td><strong>{money(total)}</strong></td></tr>;
                    })}
                  </tbody>
                  <tfoot><tr><th>Total</th>{monthKeys.map((key) => <th key={key}>{money(fixed.reduce((sum, service) => {
                    const month = service.monthly.find((row) => row.key === key);
                    return sum + (month ? month.committedPayable + month.committedFuture + month.toCommit : 0);
                  }, 0))}</th>)}<th /></tr></tfoot>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </AppShell>
  );
}
