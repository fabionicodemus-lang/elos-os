import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  assignActivityCosts,
  buildCurves,
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

export default async function EngineeringCurvesPage({
  searchParams,
}: {
  searchParams: Promise<{ baseline?: string }>;
}) {
  const params = await searchParams;
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

  const [budgetResult, budgetItemsResult, servicesResult] = selectedBaseline
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
      ])
    : [
        { data: null, error: null },
        { data: [] as BudgetItem[], error: null },
        { data: [] as Service[], error: null },
      ];

  const budget = budgetResult.data as Budget | null;
  const budgetItems = budgetItemsResult.data as BudgetItem[];
  const services = servicesResult.data as Service[];
  const budgetTotal = budgetItems
    .filter((item) => item.status === "active")
    .reduce((sum, item) => sum + Number(item.total_direct_cost ?? 0), 0);
  const assignedCosts = assignActivityCosts(activities, budgetItems);
  const scheduledValue = activities.reduce((sum, activity) => sum + (assignedCosts.get(activity.id) ?? 0), 0);
  const curveResult = buildCurves(
    activities,
    assignedCosts,
    budgetTotal,
    selectedBaseline?.work_on_saturday ?? false,
  );
  const rows = curveResult.rows as CurveRow[];
  const integrityAlerts = detectIntegrityAlerts(activities, budgetItems, services);
  const integrityAlertCount = integrityAlerts.servicesWithoutActivities.length
    + integrityAlerts.overprogrammedServices.length
    + integrityAlerts.activitiesWithoutBudgetService.length
    + integrityAlerts.budgetItemsWithoutService.length;
  const zeroWorkdayActivities = curveResult.zeroWorkdayActivityIds
    .map((activityId) => activities.find((activity) => activity.id === activityId))
    .filter((activity): activity is Activity => Boolean(activity));
  const coverage = budgetTotal > 0 ? scheduledValue / budgetTotal * 100 : 0;
  const missingCostCount = activities.filter((activity) => (assignedCosts.get(activity.id) ?? 0) <= 0).length;
  const directCostCount = activities.filter((activity) => Number(activity.planned_cost) > 0).length;
  const inferredCostCount = activities.filter((activity) => Number(activity.planned_cost) <= 0 && (assignedCosts.get(activity.id) ?? 0) > 0).length;
  const peakRow = rows.reduce<CurveRow | null>((current, row) => !current || row.financialMonth > current.financialMonth ? row : current, null);
  const startDate = activities.length ? activities.reduce((value, activity) => activity.planned_start < value ? activity.planned_start : value, activities[0].planned_start) : null;
  const finishDate = activities.length ? activities.reduce((value, activity) => activity.planned_finish > value ? activity.planned_finish : value, activities[0].planned_finish) : null;
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";
  const structureError = baselinesResult.error || activitiesResult.error || budgetItemsResult.error || servicesResult.error;

  const chartWidth = 1100;
  const chartHeight = 390;
  const left = 62;
  const right = 24;
  const top = 28;
  const bottom = 54;
  const plotWidth = chartWidth - left - right;
  const plotHeight = chartHeight - top - bottom;
  const maxPercent = Math.max(100, Math.ceil(Math.max(0, ...rows.map((row) => Math.max(row.physicalAccumulated, row.financialPercent))) / 10) * 10);
  const x = (index: number) => left + index / Math.max(1, rows.length - 1) * plotWidth;
  const y = (value: number) => top + plotHeight - Math.min(maxPercent, Math.max(0, value)) / maxPercent * plotHeight;
  const physicalPoints = rows.map((row, index) => `${x(index)},${y(row.physicalAccumulated)}`).join(" ");
  const financialPoints = rows.map((row, index) => `${x(index)},${y(row.financialPercent)}`).join(" ");
  const peakValue = Math.max(0, ...rows.map((row) => row.financialMonth));

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="schedule"
      eyebrow="Engenharia · Planejamento da Obra"
      title="Curvas Física e Financeira"
      description={`${company.name} · ${context} · curva S da linha de base e distribuição mensal do orçamento.`}
      actions={
        <>
          <Link className="elos-button" href={selectedBaseline ? `/engenharia/cronograma?baseline=${selectedBaseline.id}` : "/engenharia/cronograma"}>Voltar ao cronograma</Link>
          <Link className="elos-button elos-button-primary" href="/engenharia/orcamento-analitico">Abrir orçamento</Link>
        </>
      }
    >
      {structureError ? <div className="auth-message error workspace-message">Não foi possível carregar toda a base do planejamento.</div> : null}
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
              <section className="curves-kpis">
                <article><span>Período planejado</span><strong>{dateBR(startDate)} — {dateBR(finishDate)}</strong><small>{rows.length} competência(s) mensal(is)</small></article>
                <article><span>Custo do orçamento</span><strong>{money(budgetTotal)}</strong><small>{budget?.area_m2 ? `${money(budgetTotal / Number(budget.area_m2))}/m²` : "revisão vinculada"}</small></article>
                <article><span>Valor distribuído</span><strong>{money(scheduledValue)}</strong><small>{decimal(coverage)}% do orçamento</small></article>
                <article><span>Pico de desembolso</span><strong>{money(peakRow?.financialMonth ?? 0)}</strong><small>{peakRow?.label ?? "—"}</small></article>
              </section>

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
                      <article className="warning">
                        <h3>Serviços sem atividade</h3>
                        <p>Custos ativos do orçamento que ainda não foram distribuídos no cronograma.</p>
                        <ul>{integrityAlerts.servicesWithoutActivities.map((alert) => (
                          <li key={alert.serviceId}><strong>{alert.serviceLabel}</strong><span>{money(alert.budgetValue)} não distribuído</span></li>
                        ))}</ul>
                      </article>
                    ) : null}

                    {integrityAlerts.overprogrammedServices.length ? (
                      <article className="danger">
                        <h3>Programado acima do orçamento</h3>
                        <p>A soma dos custos explícitos das atividades supera o valor do serviço.</p>
                        <ul>{integrityAlerts.overprogrammedServices.map((alert) => (
                          <li key={alert.serviceId}>
                            <strong>{alert.serviceLabel}</strong>
                            <span>Orçado {money(alert.budgetValue)} · programado {money(alert.programmedValue)} · excedente {money(alert.excessValue)}</span>
                          </li>
                        ))}</ul>
                      </article>
                    ) : null}

                    {integrityAlerts.activitiesWithoutBudgetService.length ? (
                      <article className="danger">
                        <h3>Atividades fora da revisão</h3>
                        <p>Atividades vinculadas a serviços que não existem entre os itens ativos do orçamento.</p>
                        <ul>{integrityAlerts.activitiesWithoutBudgetService.map((alert) => (
                          <li key={alert.activityId}><strong>{alert.activityLabel}</strong><span>{alert.serviceLabel}</span></li>
                        ))}</ul>
                      </article>
                    ) : null}

                    {integrityAlerts.budgetItemsWithoutService.length ? (
                      <article className="warning">
                        <h3>Itens sem serviço vinculado</h3>
                        <p>Itens ativos que não podem ser distribuídos automaticamente no cronograma.</p>
                        <ul>{integrityAlerts.budgetItemsWithoutService.map((alert) => (
                          <li key={alert.itemId}><strong>{alert.itemLabel}</strong><span>{money(alert.budgetValue)}</span></li>
                        ))}</ul>
                      </article>
                    ) : null}
                  </div>
                )}

                {curveResult.usesEqualPhysicalWeights || zeroWorkdayActivities.length ? (
                  <div className="curves-calculation-notices">
                    {curveResult.usesEqualPhysicalWeights ? (
                      <p><strong>Curva física sem ponderação por custo.</strong> Todas as atividades estão com custo atribuído igual a zero; por segurança, a tela manteve peso igual entre elas.</p>
                    ) : null}
                    {zeroWorkdayActivities.length ? (
                      <p><strong>Atividades sem dia útil no intervalo:</strong> {zeroWorkdayActivities.map((activity) => `${activity.code} · ${activity.name}`).join("; ")}. O custo foi alocado integralmente no mês de início.</p>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="curves-chart-card">
                <div className="curves-section-head">
                  <div><span>Curva S da linha de base</span><h2>Avanço físico e financeiro acumulado</h2></div>
                  <div className="curves-legend"><span><i className="physical" />Físico ponderado por custo</span><span><i className="financial" />Financeiro sobre o orçamento</span></div>
                </div>
                <div className="curves-svg-wrap">
                  <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Curvas física e financeira acumuladas">
                    {[0, 20, 40, 60, 80, 100].filter((value) => value <= maxPercent).map((value) => (
                      <g key={value}>
                        <line x1={left} x2={chartWidth - right} y1={y(value)} y2={y(value)} className="curves-grid-line" />
                        <text x={left - 12} y={y(value) + 4} textAnchor="end" className="curves-axis-text">{value}%</text>
                      </g>
                    ))}
                    {rows.map((row, index) => index % Math.max(1, Math.ceil(rows.length / 12)) === 0 || index === rows.length - 1 ? (
                      <text key={row.key} x={x(index)} y={chartHeight - 18} textAnchor="middle" className="curves-axis-text">{row.label}</text>
                    ) : null)}
                    <polyline points={physicalPoints} className="curves-line physical" />
                    <polyline points={financialPoints} className="curves-line financial" />
                    {rows.map((row, index) => (
                      <g key={row.key}>
                        <circle cx={x(index)} cy={y(row.physicalAccumulated)} r="3.5" className="curves-point physical"><title>{row.label}: físico {decimal(row.physicalAccumulated)}%</title></circle>
                        <circle cx={x(index)} cy={y(row.financialPercent)} r="3.5" className="curves-point financial"><title>{row.label}: financeiro {decimal(row.financialPercent)}%</title></circle>
                      </g>
                    ))}
                  </svg>
                </div>
                <p className="curves-note">O avanço físico é ponderado pelo custo atribuído a cada atividade. O físico e o financeiro são distribuídos pelos dias úteis do intervalo, respeitando a configuração de trabalho aos sábados da linha de base.</p>
              </section>

              <section className="curves-grid">
                <article className="curves-chart-card">
                  <div className="curves-section-head"><div><span>Desembolso mensal</span><h2>Necessidade de caixa por competência</h2></div></div>
                  <div className="curves-bars">
                    {rows.map((row) => <div key={row.key}><span style={{ height: `${peakValue ? Math.max(2, row.financialMonth / peakValue * 100) : 0}%` }} title={`${row.label}: ${money(row.financialMonth)}`} /><small>{row.label}</small></div>)}
                  </div>
                </article>

                <article className="curves-summary-card">
                  <span>Leitura executiva</span>
                  <h2>Conferência da linha de base</h2>
                  <dl>
                    <div><dt>Orçamento ainda não distribuído</dt><dd>{money(Math.max(0, budgetTotal - scheduledValue))}</dd></div>
                    <div><dt>Valor acima do orçamento</dt><dd>{money(Math.max(0, scheduledValue - budgetTotal))}</dd></div>
                    <div><dt>Mês de maior desembolso</dt><dd>{peakRow?.label ?? "—"}</dd></div>
                    <div><dt>Atividades sem custo</dt><dd>{missingCostCount}</dd></div>
                  </dl>
                  {coverage < 95 ? <p className="warning">A curva financeira ainda não cobre todo o orçamento. Verifique os alertas de integridade acima.</p> : <p className="ok">A linha de base possui boa cobertura do orçamento vinculado.</p>}
                </article>
              </section>

              <section className="curves-table-card">
                <div className="curves-section-head"><div><span>Memória mensal</span><h2>Previsto físico e financeiro</h2></div></div>
                <div className="registry-table-wrap">
                  <table className="registry-table curves-table">
                    <thead><tr><th>Competência</th><th>Físico mensal</th><th>Físico acumulado</th><th>Financeiro mensal</th><th>Financeiro acumulado</th><th>% do orçamento</th></tr></thead>
                    <tbody>{rows.map((row) => (
                      <tr key={row.key}><td><strong>{row.label}</strong><span>{row.key}</span></td><td>{decimal(row.physicalMonth)}%</td><td><strong>{decimal(row.physicalAccumulated)}%</strong></td><td>{money(row.financialMonth)}</td><td><strong>{money(row.financialAccumulated)}</strong></td><td>{decimal(row.financialPercent)}%</td></tr>
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
