import Link from "next/link";
import "../../forecast.css";
import { AppShell } from "@/components/app-shell";
import { DateRangeFilter } from "@/components/date-range-filter";
import { dateRangePresetLabels, resolveDateRange } from "@/lib/date-range";
import { loadProjectForecast } from "@/lib/forecast/server";
import { requireCompanyPermission } from "@/lib/workspace";

type Supplier = { id: string; legal_name: string; trade_name: string | null };
type Client = { id: string; name: string };
type Unit = { id: string; code: string };
type Sale = { id: string; number: string };
type Payable = {
  id: string; due_date: string; amount: number; status: "open" | "paid" | "cancelled";
  document: string | null; installment_label: string | null; paid_at: string | null; paid_amount: number | null;
  paid_account_name: string | null; source_system: string | null; notes: string | null;
  suppliers: Supplier | Supplier[] | null;
};
type Receivable = {
  id: string; sale_id: string; due_date: string; amount: number; adjusted_amount: number | null;
  status: "open" | "paid" | "cancelled"; category: string; description: string;
  sequence_number: number; sequence_total: number; paid_at: string | null; paid_amount: number | null;
  paid_account_name: string | null; source_system: string | null;
  clients: Client | Client[] | null; units: Unit | Unit[] | null; sales: Sale | Sale[] | null;
};
type CashEntry = {
  id: string; direction: "in" | "out"; situation: "realized" | "forecast";
  effectiveDate: string; dueDate: string; paidAt: string | null; amount: number;
  party: string; reference: string; installment: string; account: string; origin: string; link: string;
};
type Bucket = {
  key: string; label: string; received: number; receivable: number; realized: number; payable: number;
  engineeringProjected: number; periodBalance: number; accumulatedBalance: number; accumulatedCompleteBalance: number;
};

const PAGE_SIZE = 50;
const categoryLabels: Record<string, string> = { entry: "Entrada", monthly: "Mensal", reinforcement: "Reforço", keys: "Chaves", post_keys: "Pós-chaves", other: "Outra" };

function todayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function relatedOne<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function cleanDate(value: string | null | undefined) { return value ? value.slice(0, 10) : ""; }
function dateBR(value: string | null | undefined) { const clean = cleanDate(value); if (!clean) return "—"; const [year, month, day] = clean.split("-"); return `${day}/${month}/${year}`; }
function money(value: number | null | undefined) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0)); }
function compactMoney(value: number) { const absolute = Math.abs(value); if (absolute >= 1_000_000) return `${value < 0 ? "-" : ""}R$ ${(absolute / 1_000_000).toFixed(1).replace(".", ",")} mi`; if (absolute >= 1_000) return `${value < 0 ? "-" : ""}R$ ${(absolute / 1_000).toFixed(0)} mil`; return money(value); }
function periodKey(date: string, grouping: "month" | "quarter" | "year") { const [year, month] = date.split("-").map(Number); if (grouping === "year") return String(year); if (grouping === "quarter") return `${year}-Q${Math.floor((month - 1) / 3) + 1}`; return `${year}-${String(month).padStart(2, "0")}`; }
function periodLabel(key: string, grouping: "month" | "quarter" | "year") { if (grouping === "year") return key; if (grouping === "quarter") { const [year, quarter] = key.split("-Q"); return `${quarter}º tri/${year.slice(2)}`; } const [year, month] = key.split("-"); return `${month}/${year.slice(2)}`; }
function originLabel(value: string | null, fallback: string) { if (!value || value === "elos_os") return fallback; if (value.includes("koper")) return "Koper"; return value; }
function buildQuery(params: Record<string, string>, page?: number) { const query = new URLSearchParams(params); if (page) query.set("page", String(page)); return `?${query.toString()}`; }

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; grouping?: string; direction?: string; situation?: string; period?: string; from?: string; to?: string; page?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("cashflow.view");
  const queryText = (params.q ?? "").trim().toLowerCase();
  const grouping = (["month", "quarter", "year"].includes(params.grouping ?? "") ? params.grouping : "month") as "month" | "quarter" | "year";
  const direction = ["in", "out"].includes(params.direction ?? "") ? params.direction! : "";
  const situation = ["realized", "forecast"].includes(params.situation ?? "") ? params.situation! : "";
  const dateRange = resolveDateRange(params.period, params.from, params.to);
  const dateFrom = dateRange.from;
  const dateTo = dateRange.to;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const projectQuery = projectId
    ? supabase.from("projects").select("id, name, code").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  let payablesQuery = supabase
    .from("payables")
    .select("id, due_date, amount, status, document, installment_label, paid_at, paid_amount, paid_account_name, source_system, notes, suppliers(id, legal_name, trade_name)")
    .eq("company_id", companyId).neq("status", "cancelled").order("due_date", { ascending: true }).limit(10000);
  let receivablesQuery = supabase
    .from("receivables")
    .select("id, sale_id, due_date, amount, adjusted_amount, status, category, description, sequence_number, sequence_total, paid_at, paid_amount, paid_account_name, source_system, clients(id, name), units(id, code), sales(id, number)")
    .eq("company_id", companyId).neq("status", "cancelled").order("due_date", { ascending: true }).limit(10000);
  if (projectId) { payablesQuery = payablesQuery.eq("project_id", projectId); receivablesQuery = receivablesQuery.eq("project_id", projectId); }

  const [projectResult, payablesResult, receivablesResult, forecastContext] = await Promise.all([
    projectQuery,
    payablesQuery,
    receivablesQuery,
    projectId
      ? loadProjectForecast({ supabase, companyId, projectId, asOfDate: todayIso() })
      : Promise.resolve(null),
  ]);
  const payables = (payablesResult.data ?? []) as unknown as Payable[];
  const receivables = (receivablesResult.data ?? []) as unknown as Receivable[];
  const project = projectResult.data;
  const forecast = forecastContext?.forecast ?? null;

  const payableEntries: CashEntry[] = payables.map((payable) => {
    const supplier = relatedOne(payable.suppliers);
    const paid = payable.status === "paid";
    return {
      id: `out-${payable.id}`, direction: "out", situation: paid ? "realized" : "forecast",
      effectiveDate: cleanDate(paid ? payable.paid_at : payable.due_date), dueDate: cleanDate(payable.due_date), paidAt: cleanDate(payable.paid_at) || null,
      amount: Number(paid ? payable.paid_amount ?? payable.amount : payable.amount), party: supplier?.trade_name || supplier?.legal_name || "Fornecedor",
      reference: payable.document || payable.notes || "Conta a pagar", installment: payable.installment_label || "—", account: payable.paid_account_name || "—",
      origin: originLabel(payable.source_system, "Contas a Pagar"), link: "/financeiro/contas-a-pagar",
    };
  });
  const receivableEntries: CashEntry[] = receivables.map((receivable) => {
    const client = relatedOne(receivable.clients); const unit = relatedOne(receivable.units); const sale = relatedOne(receivable.sales); const paid = receivable.status === "paid";
    return {
      id: `in-${receivable.id}`, direction: "in", situation: paid ? "realized" : "forecast",
      effectiveDate: cleanDate(paid ? receivable.paid_at : receivable.due_date), dueDate: cleanDate(receivable.due_date), paidAt: cleanDate(receivable.paid_at) || null,
      amount: Number(paid ? receivable.paid_amount ?? receivable.adjusted_amount ?? receivable.amount : receivable.adjusted_amount ?? receivable.amount),
      party: client?.name || "Cliente", reference: `${unit?.code ? `Unidade ${unit.code}` : "Unidade"}${sale?.number ? ` · Venda ${sale.number}` : ""}`,
      installment: `${categoryLabels[receivable.category] || receivable.description} · ${receivable.sequence_number}/${receivable.sequence_total}`,
      account: receivable.paid_account_name || "—", origin: originLabel(receivable.source_system, "Contas a Receber"), link: `/comercial/vendas/${receivable.sale_id}`,
    };
  });

  const allEntries = [...receivableEntries, ...payableEntries].filter((entry) => Boolean(entry.effectiveDate)).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.direction.localeCompare(b.direction));
  const entries = allEntries
    .filter((entry) => !direction || entry.direction === direction)
    .filter((entry) => !situation || entry.situation === situation)
    .filter((entry) => !dateFrom || entry.effectiveDate >= dateFrom)
    .filter((entry) => !dateTo || entry.effectiveDate <= dateTo)
    .filter((entry) => !queryText || [entry.party, entry.reference, entry.installment, entry.account, entry.origin].join(" ").toLowerCase().includes(queryText));

  const received = entries.filter((entry) => entry.direction === "in" && entry.situation === "realized").reduce((sum, entry) => sum + entry.amount, 0);
  const toReceive = entries.filter((entry) => entry.direction === "in" && entry.situation === "forecast").reduce((sum, entry) => sum + entry.amount, 0);
  const realizedOut = entries.filter((entry) => entry.direction === "out" && entry.situation === "realized").reduce((sum, entry) => sum + entry.amount, 0);
  const toPay = entries.filter((entry) => entry.direction === "out" && entry.situation === "forecast").reduce((sum, entry) => sum + entry.amount, 0);
  const includeEngineering = Boolean(forecast && (!direction || direction === "out") && (!situation || situation === "forecast") && !queryText);
  const engineeringMonths = includeEngineering
    ? forecast!.months.filter((month) => (!dateFrom || `${month.key}-01` >= dateFrom.slice(0, 7) + "-01") && (!dateTo || `${month.key}-01` <= dateTo.slice(0, 7) + "-01"))
    : [];
  const engineeringProjected = engineeringMonths.reduce((sum, month) => sum + month.engineeringProjected, 0);
  const currentBalance = received - realizedOut;
  const projectedBalance = received + toReceive - realizedOut - toPay;
  const completeProjectedBalance = projectedBalance - engineeringProjected;

  const bucketMap = new Map<string, Omit<Bucket, "periodBalance" | "accumulatedBalance" | "accumulatedCompleteBalance">>();
  entries.forEach((entry) => {
    const key = periodKey(entry.effectiveDate, grouping);
    const bucket = bucketMap.get(key) ?? { key, label: periodLabel(key, grouping), received: 0, receivable: 0, realized: 0, payable: 0, engineeringProjected: 0 };
    if (entry.direction === "in" && entry.situation === "realized") bucket.received += entry.amount;
    if (entry.direction === "in" && entry.situation === "forecast") bucket.receivable += entry.amount;
    if (entry.direction === "out" && entry.situation === "realized") bucket.realized += entry.amount;
    if (entry.direction === "out" && entry.situation === "forecast") bucket.payable += entry.amount;
    bucketMap.set(key, bucket);
  });
  engineeringMonths.forEach((month) => {
    const key = periodKey(`${month.key}-01`, grouping);
    const bucket = bucketMap.get(key) ?? { key, label: periodLabel(key, grouping), received: 0, receivable: 0, realized: 0, payable: 0, engineeringProjected: 0 };
    bucket.engineeringProjected += month.engineeringProjected;
    bucketMap.set(key, bucket);
  });

  let accumulatedBalance = 0;
  let accumulatedCompleteBalance = 0;
  const buckets: Bucket[] = [...bucketMap.values()].sort((a, b) => a.key.localeCompare(b.key)).map((bucket) => {
    const periodBalance = bucket.received + bucket.receivable - bucket.realized - bucket.payable;
    accumulatedBalance += periodBalance;
    accumulatedCompleteBalance += periodBalance - bucket.engineeringProjected;
    return { ...bucket, periodBalance, accumulatedBalance, accumulatedCompleteBalance };
  });
  const maxBarValue = Math.max(1, ...buckets.flatMap((bucket) => [bucket.received, bucket.receivable, bucket.realized, bucket.payable, bucket.engineeringProjected]));

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageEntries = entries.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const filterParams = { q: params.q ?? "", grouping, direction, situation, period: dateRange.preset, from: dateFrom, to: dateTo };
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Todas as obras";
  const availableFrom = allEntries[0]?.effectiveDate ?? "";
  const availableTo = allEntries[allEntries.length - 1]?.effectiveDate ?? "";
  const displayedFrom = dateRange.preset === "all" ? availableFrom : dateFrom;
  const displayedTo = dateRange.preset === "all" ? availableTo : dateTo;
  const periodDescription = displayedFrom || displayedTo ? displayedFrom && displayedTo ? `${dateBR(displayedFrom)} a ${dateBR(displayedTo)}` : displayedFrom ? `a partir de ${dateBR(displayedFrom)}` : `até ${dateBR(displayedTo)}` : "sem lançamentos";
  const periodHeading = dateRange.preset === "all" ? "Todo o período da obra" : dateRangePresetLabels[dateRange.preset];

  return (
    <AppShell
      activeGroup="finance"
      activeItem="cashflow"
      eyebrow="Financeiro · Gestão"
      title="Fluxo de Caixa"
      description={`${company.name} · ${context} · previsto, realizado e projeção completa de ${periodDescription}.`}
      actions={<><Link className="elos-button" href="/financeiro/contas-a-pagar">Contas a Pagar</Link><Link className="elos-button" href="/financeiro/contas-a-receber">Contas a Receber</Link><Link className="elos-button elos-button-primary" href="/engenharia/previsao-financeira">Previsão por serviço</Link></>}
    >
      {payablesResult.error || receivablesResult.error ? <div className="auth-message error workspace-message">Não foi possível consolidar o fluxo de caixa.</div> : null}
      {forecastContext?.errors.length ? <div className="auth-message error workspace-message">A projeção da Engenharia está incompleta: {forecastContext.errors.join(" · ")}</div> : null}

      <section className="finance-summary-grid cashflow-summary-grid">
        <article><span>Recebido</span><strong>{money(received)}</strong><small>entradas realizadas</small></article>
        <article><span>A receber</span><strong>{money(toReceive)}</strong><small>carteira em aberto</small></article>
        <article><span>Realizado</span><strong>{money(realizedOut)}</strong><small>saídas efetivamente pagas</small></article>
        <article><span>A realizar</span><strong>{money(toPay)}</strong><small>payables já cadastradas</small></article>
        <article><span>Projetado Engenharia</span><strong>{money(engineeringProjected)}</strong><small>contratos não faturados + a comprometer</small></article>
        <article><span>Saldo atual</span><strong className={currentBalance < 0 ? "cashflow-negative" : ""}>{money(currentBalance)}</strong><small>recebido menos realizado</small></article>
        <article><span>Saldo projetado</span><strong className={projectedBalance < 0 ? "cashflow-negative" : ""}>{money(projectedBalance)}</strong><small>sem projeção adicional da Engenharia</small></article>
        <article><span>Saldo projetado completo</span><strong className={completeProjectedBalance < 0 ? "cashflow-negative" : ""}>{money(completeProjectedBalance)}</strong><small>inclui todas as camadas futuras</small></article>
      </section>

      <section className="forecast-engineering-projection">
        <header><div><span>Fronteira anti-dupla-contagem</span><h2>Projetado Engenharia</h2></div><strong>{money(engineeringProjected)}</strong></header>
        <p>Esta série contém somente o comprometido futuro ainda não transformado em conta a pagar e o saldo a comprometer. Payables abertas permanecem exclusivamente em “A realizar”.</p>
        {!projectId ? <p><strong>Selecione uma obra</strong> para incluir a projeção da Engenharia.</p> : null}
        {forecast ? <div className="forecast-engineering-projection-grid">{engineeringMonths.map((month) => <article key={month.key}><div className="forecast-engineering-projection-bar"><span style={{ height: `${month.engineeringProjected / Math.max(1, ...engineeringMonths.map((item) => item.engineeringProjected)) * 100}%` }} /></div><strong>{periodLabel(periodKey(`${month.key}-01`, "month"), "month")}</strong><small>{compactMoney(month.engineeringProjected)}</small></article>)}</div> : null}
      </section>

      <section className="registry-toolbar cashflow-toolbar"><form className="cashflow-filter" method="get"><input name="q" defaultValue={params.q ?? ""} placeholder="Cliente, fornecedor, unidade, documento ou conta" /><select name="grouping" defaultValue={grouping}><option value="month">Visão mensal</option><option value="quarter">Visão trimestral</option><option value="year">Visão anual</option></select><select name="direction" defaultValue={direction}><option value="">Entradas e saídas</option><option value="in">Somente entradas</option><option value="out">Somente saídas</option></select><select name="situation" defaultValue={situation}><option value="">Realizado e previsto</option><option value="realized">Somente realizado</option><option value="forecast">Somente previsto</option></select><DateRangeFilter defaultPreset={dateRange.preset} defaultFrom={dateFrom} defaultTo={dateTo} /><button type="submit">Filtrar</button><Link href="/financeiro/fluxo-de-caixa">Limpar</Link></form></section>

      <section className="cashflow-chart-panel">
        <div className="section-heading"><div><span>{periodHeading}</span><h2>Entradas, saídas e saldo acumulado</h2></div><p>{buckets.length} período(s) · {entries.length} lançamento(s)</p></div>
        <div className="cashflow-legend"><span><i className="received" />Recebido</span><span><i className="receivable" />A receber</span><span><i className="realized" />Realizado</span><span><i className="payable" />A realizar</span><span><i className="engineering-projected" />Projetado Engenharia</span></div>
        <div className="cashflow-chart-scroll"><div className="cashflow-chart" style={{ minWidth: `${Math.max(920, buckets.length * 104)}px` }}>{buckets.map((bucket) => <article className="cashflow-period" key={bucket.key}><div className="cashflow-bars" title={`${bucket.label} · saldo completo ${money(bucket.accumulatedCompleteBalance)}`}><span className="cashflow-bar received" style={{ height: `${Math.max(bucket.received > 0 ? 3 : 0, bucket.received / maxBarValue * 100)}%` }} /><span className="cashflow-bar receivable" style={{ height: `${Math.max(bucket.receivable > 0 ? 3 : 0, bucket.receivable / maxBarValue * 100)}%` }} /><span className="cashflow-bar realized" style={{ height: `${Math.max(bucket.realized > 0 ? 3 : 0, bucket.realized / maxBarValue * 100)}%` }} /><span className="cashflow-bar payable" style={{ height: `${Math.max(bucket.payable > 0 ? 3 : 0, bucket.payable / maxBarValue * 100)}%` }} /><span className="cashflow-bar engineering-projected" style={{ height: `${Math.max(bucket.engineeringProjected > 0 ? 3 : 0, bucket.engineeringProjected / maxBarValue * 100)}%` }} /></div><strong>{bucket.label}</strong><small className={bucket.accumulatedCompleteBalance < 0 ? "negative" : ""}>{compactMoney(bucket.accumulatedCompleteBalance)}</small></article>)}{!buckets.length ? <div className="cashflow-empty">Nenhum lançamento encontrado.</div> : null}</div></div>
        <p className="cashflow-chart-caption">O valor abaixo de cada período é o saldo acumulado completo, já descontando a projeção da Engenharia.</p>
      </section>

      <section className="registry-table-panel cashflow-table-panel">
        <div className="section-heading"><div><span>Planilha financeira</span><h2>Lançamentos consolidados</h2></div><p>{entries.length} lançamento(s)</p></div>
        <div className="registry-table-wrap"><table className="registry-table cashflow-table"><thead><tr><th>Data</th><th>Movimento</th><th>Situação</th><th>Cliente / fornecedor</th><th>Documento / referência</th><th>Parcela</th><th>Vencimento</th><th>Baixa</th><th>Conta</th><th>Origem</th><th>Valor</th><th>Ação</th></tr></thead><tbody>{pageEntries.map((entry) => <tr key={entry.id}><td>{dateBR(entry.effectiveDate)}</td><td><span className={`cashflow-direction ${entry.direction}`}>{entry.direction === "in" ? "Entrada" : "Saída"}</span></td><td><span className={`status-badge ${entry.situation === "realized" ? "paid" : "open"}`}>{entry.situation === "realized" ? "Realizado" : "Previsto"}</span></td><td><strong>{entry.party}</strong></td><td>{entry.reference}</td><td>{entry.installment}</td><td>{dateBR(entry.dueDate)}</td><td>{dateBR(entry.paidAt)}</td><td>{entry.account}</td><td>{entry.origin}</td><td><strong>{money(entry.amount)}</strong></td><td><Link href={entry.link}>Abrir</Link></td></tr>)}{!pageEntries.length ? <tr><td colSpan={12}>Nenhum lançamento encontrado.</td></tr> : null}</tbody></table></div>
        {totalPages > 1 ? <div className="registry-pagination"><span>Página {safePage} de {totalPages}</span><div>{safePage > 1 ? <Link href={buildQuery(filterParams, safePage - 1)}>Anterior</Link> : <span>Anterior</span>}{safePage < totalPages ? <Link href={buildQuery(filterParams, safePage + 1)}>Próxima</Link> : <span>Próxima</span>}</div></div> : null}
      </section>
    </AppShell>
  );
}
