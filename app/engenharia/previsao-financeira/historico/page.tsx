import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { loadProjectForecast } from "@/lib/forecast/server";
import {
  buildProjectionEvolution,
  compareSnapshots,
  compareSnapshotToActual,
} from "@/lib/forecast/snapshot-comparison.mjs";
import { requireCompanyPermission } from "@/lib/workspace";
import { archiveForecastSnapshot } from "../actions";

type Snapshot = {
  id: string;
  company_id: string;
  project_id: string;
  baseline_id: string | null;
  budget_id: string | null;
  reference_month: string;
  forecast_as_of_date: string;
  captured_at: string;
  source: "manual" | "automatic";
  created_by: string | null;
  budget_total: number;
  actual_total: number;
  committed_total: number;
  to_commit_total: number;
  projected_cost_total: number;
  deviation_total: number;
  default_payment_days: number;
  engine_version: string;
  baseline_label: string | null;
  budget_label: string | null;
  warnings: Array<{ code?: string; message?: string }>;
  archived_at: string | null;
  archived_by: string | null;
};

type SnapshotRow = {
  id: string;
  snapshot_id: string;
  service_id: string | null;
  service_key: string;
  service_code: string | null;
  service_name: string;
  service_budget_amount: number;
  month: string;
  layer: "actual" | "committed" | "to_commit";
  amount: number;
};

type Profile = { id: string; full_name: string | null };

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

function signedMoney(value: number) {
  return `${value > 0 ? "+" : ""}${money(value)}`;
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "n/a";
  return `${Number(value) > 0 ? "+" : ""}${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(value))}%`;
}

function monthLabel(value: string) {
  const key = value.slice(0, 7);
  const [year, month] = key.split("-");
  return `${month}/${year}`;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function snapshotLabel(snapshot: Snapshot) {
  return `${dateTime(snapshot.captured_at)} · ${money(snapshot.projected_cost_total)}`;
}

export default async function ForecastHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    success?: string;
    error?: string;
    a?: string;
    b?: string;
    source?: string;
    reference?: string;
    archived?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("schedule.view");
  const asOfDate = todayIso();
  const showArchived = params.archived === "1";

  const currentContext = await loadProjectForecast({
    supabase,
    companyId,
    projectId,
    asOfDate,
  });

  let snapshots: Snapshot[] = [];
  let snapshotError: string | null = null;
  if (projectId) {
    const result = await fetchAllRows<Snapshot>(async (from, to) => {
      let query = supabase
        .from("forecast_snapshots")
        .select("id,company_id,project_id,baseline_id,budget_id,reference_month,forecast_as_of_date,captured_at,source,created_by,budget_total,actual_total,committed_total,to_commit_total,projected_cost_total,deviation_total,default_payment_days,engine_version,baseline_label,budget_label,warnings,archived_at,archived_by")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .order("captured_at", { ascending: false });
      if (!showArchived) query = query.is("archived_at", null);
      if (params.source === "manual" || params.source === "automatic") query = query.eq("source", params.source);
      if (/^\d{4}-\d{2}$/.test(params.reference ?? "")) query = query.eq("reference_month", `${params.reference}-01`);
      const { data, error } = await query.range(from, to);
      return { data: (data ?? []) as Snapshot[], error };
    });
    snapshots = result.data;
    snapshotError = result.error?.message ?? null;
  }

  const selectedA = snapshots.find((snapshot) => snapshot.id === params.a) ?? snapshots[0] ?? null;
  const selectedB = snapshots.find((snapshot) => snapshot.id === params.b)
    ?? snapshots.find((snapshot) => snapshot.id !== selectedA?.id)
    ?? null;
  const selectedIds = [...new Set([selectedA?.id, selectedB?.id].filter((value): value is string => Boolean(value)))];

  let selectedRows: SnapshotRow[] = [];
  if (selectedIds.length) {
    const rowsResult = await fetchAllRows<SnapshotRow>(async (from, to) => {
      const { data, error } = await supabase
        .from("forecast_snapshot_rows")
        .select("id,snapshot_id,service_id,service_key,service_code,service_name,service_budget_amount,month,layer,amount")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .in("snapshot_id", selectedIds)
        .order("service_code")
        .order("month")
        .range(from, to);
      return { data: (data ?? []) as SnapshotRow[], error };
    });
    selectedRows = rowsResult.data;
    snapshotError = snapshotError ?? rowsResult.error?.message ?? null;
  }

  const creatorIds = [...new Set(snapshots.map((snapshot) => snapshot.created_by).filter((value): value is string => Boolean(value)))];
  let profiles: Profile[] = [];
  if (creatorIds.length) {
    const { data } = await supabase.from("profiles").select("id,full_name").in("id", creatorIds);
    profiles = (data ?? []) as Profile[];
  }
  const creatorNames = new Map(profiles.map((profile) => [profile.id, profile.full_name?.trim() || "Usuário"]));

  const rowsA = selectedA ? selectedRows.filter((row) => row.snapshot_id === selectedA.id) : [];
  const rowsB = selectedB ? selectedRows.filter((row) => row.snapshot_id === selectedB.id) : [];
  const comparison = selectedA && selectedB ? compareSnapshots(rowsA, rowsB) : [];
  const precision = selectedA
    ? compareSnapshotToActual(rowsA, currentContext.forecast?.months ?? [], asOfDate.slice(0, 7))
    : [];
  const closedPrecision = precision.filter((row) => row.closed);
  const precisionTotals = closedPrecision.reduce((accumulator, row) => ({
    predicted: accumulator.predicted + row.predicted,
    actual: accumulator.actual + row.actual,
  }), { predicted: 0, actual: 0 });
  const precisionDeviation = precisionTotals.actual - precisionTotals.predicted;
  const precisionPercent = precisionTotals.predicted === 0 ? null : precisionDeviation / precisionTotals.predicted * 100;

  const evolution = buildProjectionEvolution(snapshots);
  const chartWidth = 920;
  const chartHeight = 260;
  const chartPadding = 34;
  const chartValues = evolution.flatMap((item) => [item.budget, item.projected]);
  const chartMin = chartValues.length ? Math.min(...chartValues) * 0.97 : 0;
  const chartMaxCandidate = chartValues.length ? Math.max(...chartValues) * 1.03 : 1;
  const chartMax = chartMaxCandidate <= chartMin ? chartMin + 1 : chartMaxCandidate;
  const xFor = (index: number) => evolution.length <= 1
    ? chartWidth / 2
    : chartPadding + index / (evolution.length - 1) * (chartWidth - chartPadding * 2);
  const yFor = (value: number) => chartHeight - chartPadding - (value - chartMin) / (chartMax - chartMin) * (chartHeight - chartPadding * 2);
  const projectedPoints = evolution.map((item, index) => `${xFor(index)},${yFor(item.projected)}`).join(" ");
  const budgetPoints = evolution.map((item, index) => `${xFor(index)},${yFor(item.budget)}`).join(" ");

  const projectLabel = currentContext.project
    ? `${currentContext.project.code ? `${currentContext.project.code} · ` : ""}${currentContext.project.name}`
    : "Selecione uma obra";

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="financial-forecast"
      eyebrow="Engenharia · Memória da Previsão"
      title="Histórico de Previsões"
      description={`${company.name} · ${projectLabel} · compare o que era previsto com o que aconteceu.`}
      actions={
        <>
          <Link className="elos-button elos-button-primary" href="/engenharia/previsao-financeira">Previsão atual</Link>
          <Link className="elos-button" href="/engenharia/curvas">Curvas</Link>
        </>
      }
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {snapshotError ? <div className="auth-message error workspace-message">Não foi possível carregar todo o histórico: {snapshotError}</div> : null}
      {!projectId ? <div className="snapshot-empty">Selecione uma obra para consultar a memória da previsão.</div> : null}

      {projectId ? (
        <>
          <section className="snapshot-filter-panel">
            <form method="get">
              <label>Competência<input type="month" name="reference" defaultValue={params.reference ?? ""} /></label>
              <label>Origem<select name="source" defaultValue={params.source ?? "all"}><option value="all">Todas</option><option value="manual">Manual</option><option value="automatic">Automática</option></select></label>
              <label className="snapshot-check"><input type="checkbox" name="archived" value="1" defaultChecked={showArchived} /> Mostrar arquivados</label>
              <button type="submit">Filtrar</button>
            </form>
            <div><strong>{snapshots.length}</strong><span>snapshot(s) na seleção</span></div>
          </section>

          {!snapshots.length ? (
            <div className="snapshot-empty"><strong>A obra ainda não possui snapshots.</strong><span>Use “Congelar previsão do mês” na tela de previsão financeira.</span></div>
          ) : (
            <>
              <section className="snapshot-evolution-panel">
                <div className="section-heading"><div><span>História da projeção</span><h2>Evolução do custo final projetado</h2></div><p>{evolution.length} registro(s)</p></div>
                <div className="snapshot-chart-scroll">
                  <svg className="snapshot-evolution-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Evolução do custo final projetado e do orçamento">
                    <line x1={chartPadding} y1={chartHeight - chartPadding} x2={chartWidth - chartPadding} y2={chartHeight - chartPadding} className="axis" />
                    {budgetPoints ? <polyline points={budgetPoints} className="budget-line" /> : null}
                    {projectedPoints ? <polyline points={projectedPoints} className="projected-line" /> : null}
                    {evolution.map((item, index) => (
                      <g key={item.id}>
                        <circle cx={xFor(index)} cy={yFor(item.projected)} r="5" className="projected-point" />
                        <text x={xFor(index)} y={chartHeight - 10} textAnchor="middle">{monthLabel(item.referenceMonth)}</text>
                      </g>
                    ))}
                  </svg>
                </div>
                <div className="snapshot-legend"><span><i className="projected" />Custo final projetado</span><span><i className="budget" />Orçamento congelado</span></div>
              </section>

              <section className="snapshot-list-panel">
                <div className="section-heading"><div><span>Registros imutáveis</span><h2>Snapshots da obra</h2></div><p>Sem edição ou exclusão</p></div>
                <div className="registry-table-wrap">
                  <table className="registry-table snapshot-list-table">
                    <thead><tr><th>Congelamento</th><th>Competência</th><th>Origem e usuário</th><th>Base</th><th>Orçamento</th><th>Custo final</th><th>Desvio</th><th>Status</th></tr></thead>
                    <tbody>{snapshots.map((snapshot) => (
                      <tr key={snapshot.id} className={snapshot.archived_at ? "archived" : ""}>
                        <td><strong>{dateTime(snapshot.captured_at)}</strong><small>Corte em {new Intl.DateTimeFormat("pt-BR").format(new Date(`${snapshot.forecast_as_of_date}T12:00:00Z`))}</small></td>
                        <td>{monthLabel(snapshot.reference_month)}</td>
                        <td><strong>{snapshot.source === "manual" ? "Manual" : "Automática"}</strong><small>{snapshot.created_by ? creatorNames.get(snapshot.created_by) ?? snapshot.created_by.slice(0, 8) : "Sistema"}</small></td>
                        <td><small>{snapshot.baseline_label ?? "—"}</small></td>
                        <td>{money(snapshot.budget_total)}</td>
                        <td><strong>{money(snapshot.projected_cost_total)}</strong></td>
                        <td className={snapshot.deviation_total > 0 ? "snapshot-danger" : ""}>{signedMoney(snapshot.deviation_total)}</td>
                        <td>{snapshot.archived_at ? <span className="snapshot-badge archived">Arquivado</span> : (
                          <form action={archiveForecastSnapshot}>
                            <input type="hidden" name="snapshot_id" value={snapshot.id} />
                            <button className="snapshot-archive-button" type="submit">Arquivar</button>
                          </form>
                        )}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>

              <section className="snapshot-compare-panel">
                <div className="section-heading"><div><span>Comparação lado a lado</span><h2>O que mudou entre duas previsões</h2></div></div>
                <form method="get" className="snapshot-compare-form">
                  <label>Snapshot A<select name="a" defaultValue={selectedA?.id}>{snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshotLabel(snapshot)}</option>)}</select></label>
                  <label>Snapshot B<select name="b" defaultValue={selectedB?.id ?? ""}><option value="">Selecione</option>{snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshotLabel(snapshot)}</option>)}</select></label>
                  <button type="submit">Comparar</button>
                </form>

                {selectedA && selectedB ? (
                  <div className="registry-table-wrap">
                    <table className="registry-table snapshot-comparison-table">
                      <thead><tr><th>Serviço</th><th>Snapshot A</th><th>Snapshot B</th><th>Variação do custo final</th><th>Variação do desvio</th></tr></thead>
                      <tbody>{comparison.map((row) => (
                        <tr key={row.serviceKey}>
                          <td><strong>{row.code ? `${row.code} · ` : ""}{row.name}</strong></td>
                          <td><strong>{money(row.a.projected)}</strong><small>Orç. {money(row.a.budget)} · Real. {money(row.a.actual)} · Comp. {money(row.a.committed)} · A comp. {money(row.a.toCommit)}</small></td>
                          <td><strong>{money(row.b.projected)}</strong><small>Orç. {money(row.b.budget)} · Real. {money(row.b.actual)} · Comp. {money(row.b.committed)} · A comp. {money(row.b.toCommit)}</small></td>
                          <td className={row.delta.projected > 0 ? "snapshot-danger" : row.delta.projected < 0 ? "snapshot-positive" : ""}><strong>{signedMoney(row.delta.projected)}</strong></td>
                          <td className={row.delta.deviation > 0 ? "snapshot-danger" : row.delta.deviation < 0 ? "snapshot-positive" : ""}>{signedMoney(row.delta.deviation)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                ) : <p className="snapshot-hint">Selecione dois snapshots para comparar por serviço.</p>}
              </section>

              {selectedA ? (
                <section className="snapshot-accuracy-panel">
                  <div className="section-heading"><div><span>Precisão da previsão</span><h2>Snapshot A versus realizado até hoje</h2></div><p>Meses encerrados</p></div>
                  <div className="snapshot-accuracy-kpis">
                    <article><span>Previsto nos meses encerrados</span><strong>{money(precisionTotals.predicted)}</strong></article>
                    <article><span>Realizado atual</span><strong>{money(precisionTotals.actual)}</strong></article>
                    <article className={precisionDeviation > 0 ? "danger" : "ok"}><span>Desvio acumulado</span><strong>{signedMoney(precisionDeviation)}</strong><small>{percent(precisionPercent)}</small></article>
                  </div>
                  <div className="registry-table-wrap">
                    <table className="registry-table snapshot-accuracy-table">
                      <thead><tr><th>Mês</th><th>Previsto no snapshot</th><th>Realizado hoje</th><th>Desvio</th><th>Desvio %</th><th>Situação</th></tr></thead>
                      <tbody>{precision.map((row) => (
                        <tr key={row.month} className={!row.closed ? "open-month" : ""}>
                          <td>{monthLabel(row.month)}</td><td>{money(row.predicted)}</td><td>{money(row.actual)}</td>
                          <td className={row.deviation > 0 ? "snapshot-danger" : row.deviation < 0 ? "snapshot-positive" : ""}>{signedMoney(row.deviation)}</td>
                          <td>{percent(row.deviationPercent)}</td>
                          <td>{row.closed ? "Encerrado" : row.current ? "Mês em andamento" : "Futuro"}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </section>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </AppShell>
  );
}
