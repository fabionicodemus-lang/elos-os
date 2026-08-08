import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { DateRangeFilter } from "@/components/date-range-filter";
import { dateRangePresetLabels, resolveDateRange } from "@/lib/date-range";
import { requireCompanyPermission } from "@/lib/workspace";

type Supplier = {
  id: string;
  legal_name: string;
  trade_name: string | null;
};

type Client = {
  id: string;
  name: string;
};

type Unit = {
  id: string;
  code: string;
};

type Payable = {
  id: string;
  due_date: string;
  amount: number;
  status: "open" | "paid" | "cancelled";
  paid_at: string | null;
  paid_amount: number | null;
  suppliers: Supplier | Supplier[] | null;
};

type Receivable = {
  id: string;
  due_date: string;
  amount: number;
  adjusted_amount: number | null;
  status: "open" | "paid" | "cancelled";
  category: string;
  paid_at: string | null;
  paid_amount: number | null;
  clients: Client | Client[] | null;
  units: Unit | Unit[] | null;
};

type ReportEntry = {
  id: string;
  direction: "in" | "out";
  situation: "realized" | "forecast";
  effectiveDate: string;
  dueDate: string;
  amount: number;
  partyId: string;
  partyName: string;
  category: string;
  unitCode: string;
};

type PeriodBucket = {
  key: string;
  label: string;
  revenueRealized: number;
  revenueForecast: number;
  expenseRealized: number;
  expenseForecast: number;
  balance: number;
  accumulated: number;
};

const categoryLabels: Record<string, string> = {
  entry: "Entrada",
  monthly: "Mensal",
  reinforcement: "Reforço",
  keys: "Chaves",
  post_keys: "Pós-chaves",
  other: "Outra",
};

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function cleanDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function dateBR(value: string | null | undefined) {
  const clean = cleanDate(value);
  if (!clean) return "—";
  const [year, month, day] = clean.split("-");
  return `${day}/${month}/${year}`;
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value ?? 0));
}

function compactMoney(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${value < 0 ? "-" : ""}R$ ${(absolute / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (absolute >= 1_000) return `${value < 0 ? "-" : ""}R$ ${(absolute / 1_000).toFixed(0)} mil`;
  return money(value);
}

function percent(value: number) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}%`;
}

function periodKey(date: string, grouping: "month" | "quarter" | "year") {
  const [year, month] = date.split("-").map(Number);
  if (grouping === "year") return String(year);
  if (grouping === "quarter") return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function periodLabel(key: string, grouping: "month" | "quarter" | "year") {
  if (grouping === "year") return key;
  if (grouping === "quarter") {
    const [year, quarter] = key.split("-Q");
    return `${quarter}º tri/${year.slice(2)}`;
  }
  const [year, month] = key.split("-");
  return `${month}/${year.slice(2)}`;
}

function daysBetween(from: string, to: string) {
  const start = new Date(`${from}T12:00:00Z`).getTime();
  const end = new Date(`${to}T12:00:00Z`).getTime();
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function topEntries(map: Map<string, { name: string; amount: number }>, limit = 8) {
  return [...map.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export default async function FinancialReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    grouping?: string;
    period?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("reports.view");
  const grouping = (["month", "quarter", "year"].includes(params.grouping ?? "") ? params.grouping : "month") as "month" | "quarter" | "year";
  const dateRange = resolveDateRange(params.period, params.from, params.to);
  const dateFrom = dateRange.from;
  const dateTo = dateRange.to;
  const today = resolveDateRange("today").from;

  const projectQuery = projectId
    ? supabase.from("projects").select("id, name, code").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  let payablesQuery = supabase
    .from("payables")
    .select("id, due_date, amount, status, paid_at, paid_amount, suppliers(id, legal_name, trade_name)")
    .eq("company_id", companyId)
    .neq("status", "cancelled")
    .order("due_date", { ascending: true })
    .limit(10000);

  let receivablesQuery = supabase
    .from("receivables")
    .select("id, due_date, amount, adjusted_amount, status, category, paid_at, paid_amount, clients(id, name), units(id, code)")
    .eq("company_id", companyId)
    .neq("status", "cancelled")
    .order("due_date", { ascending: true })
    .limit(10000);

  if (projectId) {
    payablesQuery = payablesQuery.eq("project_id", projectId);
    receivablesQuery = receivablesQuery.eq("project_id", projectId);
  }

  const [projectResult, payablesResult, receivablesResult] = await Promise.all([
    projectQuery,
    payablesQuery,
    receivablesQuery,
  ]);

  const project = projectResult.data;
  const payables = (payablesResult.data ?? []) as unknown as Payable[];
  const receivables = (receivablesResult.data ?? []) as unknown as Receivable[];

  const payableEntries: ReportEntry[] = payables.map((payable) => {
    const supplier = relatedOne(payable.suppliers);
    const paid = payable.status === "paid";
    return {
      id: `out-${payable.id}`,
      direction: "out",
      situation: paid ? "realized" : "forecast",
      effectiveDate: cleanDate(paid ? payable.paid_at : payable.due_date),
      dueDate: cleanDate(payable.due_date),
      amount: Number(paid ? payable.paid_amount ?? payable.amount : payable.amount),
      partyId: supplier?.id ?? "supplier-unknown",
      partyName: supplier?.trade_name || supplier?.legal_name || "Fornecedor não identificado",
      category: "payable",
      unitCode: "",
    };
  });

  const receivableEntries: ReportEntry[] = receivables.map((receivable) => {
    const client = relatedOne(receivable.clients);
    const unit = relatedOne(receivable.units);
    const paid = receivable.status === "paid";
    return {
      id: `in-${receivable.id}`,
      direction: "in",
      situation: paid ? "realized" : "forecast",
      effectiveDate: cleanDate(paid ? receivable.paid_at : receivable.due_date),
      dueDate: cleanDate(receivable.due_date),
      amount: Number(paid ? receivable.paid_amount ?? receivable.adjusted_amount ?? receivable.amount : receivable.adjusted_amount ?? receivable.amount),
      partyId: client?.id ?? "client-unknown",
      partyName: client?.name || "Cliente não identificado",
      category: receivable.category,
      unitCode: unit?.code ?? "",
    };
  });

  const allEntries = [...receivableEntries, ...payableEntries].filter((entry) => Boolean(entry.effectiveDate));
  const entries = allEntries.filter((entry) => {
    if (dateFrom && entry.effectiveDate < dateFrom) return false;
    if (dateTo && entry.effectiveDate > dateTo) return false;
    return true;
  });

  const revenueRealized = entries.filter((entry) => entry.direction === "in" && entry.situation === "realized").reduce((sum, entry) => sum + entry.amount, 0);
  const revenueForecast = entries.filter((entry) => entry.direction === "in" && entry.situation === "forecast").reduce((sum, entry) => sum + entry.amount, 0);
  const expenseRealized = entries.filter((entry) => entry.direction === "out" && entry.situation === "realized").reduce((sum, entry) => sum + entry.amount, 0);
  const expenseForecast = entries.filter((entry) => entry.direction === "out" && entry.situation === "forecast").reduce((sum, entry) => sum + entry.amount, 0);
  const realizedResult = revenueRealized - expenseRealized;
  const projectedResult = revenueRealized + revenueForecast - expenseRealized - expenseForecast;

  const openReceivables = receivableEntries.filter((entry) => entry.situation === "forecast");
  const overdueReceivables = openReceivables.filter((entry) => entry.dueDate && entry.dueDate < today);
  const overdueInPeriod = overdueReceivables.filter((entry) => {
    if (dateFrom && entry.dueDate < dateFrom) return false;
    if (dateTo && entry.dueDate > dateTo) return false;
    return true;
  });
  const overdueTotal = overdueInPeriod.reduce((sum, entry) => sum + entry.amount, 0);
  const openTotal = openReceivables.reduce((sum, entry) => sum + entry.amount, 0);
  const delinquencyRate = openTotal > 0 ? (overdueReceivables.reduce((sum, entry) => sum + entry.amount, 0) / openTotal) * 100 : 0;

  const bucketMap = new Map<string, Omit<PeriodBucket, "balance" | "accumulated">>();
  entries.forEach((entry) => {
    const key = periodKey(entry.effectiveDate, grouping);
    const bucket = bucketMap.get(key) ?? {
      key,
      label: periodLabel(key, grouping),
      revenueRealized: 0,
      revenueForecast: 0,
      expenseRealized: 0,
      expenseForecast: 0,
    };
    if (entry.direction === "in" && entry.situation === "realized") bucket.revenueRealized += entry.amount;
    if (entry.direction === "in" && entry.situation === "forecast") bucket.revenueForecast += entry.amount;
    if (entry.direction === "out" && entry.situation === "realized") bucket.expenseRealized += entry.amount;
    if (entry.direction === "out" && entry.situation === "forecast") bucket.expenseForecast += entry.amount;
    bucketMap.set(key, bucket);
  });

  const sortedBuckets = [...bucketMap.values()].sort((a, b) => a.key.localeCompare(b.key));
  const buckets: PeriodBucket[] = [];
  let accumulated = 0;
  for (const bucket of sortedBuckets) {
    const balance = bucket.revenueRealized + bucket.revenueForecast - bucket.expenseRealized - bucket.expenseForecast;
    accumulated += balance;
    buckets.push({ ...bucket, balance, accumulated });
  }

  const aging = [
    { label: "1 a 30 dias", from: 1, to: 30, amount: 0, count: 0 },
    { label: "31 a 60 dias", from: 31, to: 60, amount: 0, count: 0 },
    { label: "61 a 90 dias", from: 61, to: 90, amount: 0, count: 0 },
    { label: "Mais de 90 dias", from: 91, to: Number.POSITIVE_INFINITY, amount: 0, count: 0 },
  ];

  overdueReceivables.forEach((entry) => {
    const days = daysBetween(entry.dueDate, today);
    const range = aging.find((item) => days >= item.from && days <= item.to);
    if (range) {
      range.amount += entry.amount;
      range.count += 1;
    }
  });

  const clientBalanceMap = new Map<string, { name: string; amount: number }>();
  openReceivables.forEach((entry) => {
    const current = clientBalanceMap.get(entry.partyId) ?? { name: entry.partyName, amount: 0 };
    current.amount += entry.amount;
    clientBalanceMap.set(entry.partyId, current);
  });

  const supplierPaidMap = new Map<string, { name: string; amount: number }>();
  payableEntries.filter((entry) => entry.situation === "realized").forEach((entry) => {
    const current = supplierPaidMap.get(entry.partyId) ?? { name: entry.partyName, amount: 0 };
    current.amount += entry.amount;
    supplierPaidMap.set(entry.partyId, current);
  });

  const categoryMap = new Map<string, { base: number; adjusted: number; paid: number; open: number; count: number }>();
  receivables.forEach((receivable) => {
    const current = categoryMap.get(receivable.category) ?? { base: 0, adjusted: 0, paid: 0, open: 0, count: 0 };
    const adjusted = Number(receivable.adjusted_amount ?? receivable.amount);
    current.base += Number(receivable.amount);
    current.adjusted += adjusted;
    current.count += 1;
    if (receivable.status === "paid") current.paid += Number(receivable.paid_amount ?? adjusted);
    if (receivable.status === "open") current.open += adjusted;
    categoryMap.set(receivable.category, current);
  });

  const topClients = topEntries(clientBalanceMap);
  const topSuppliers = topEntries(supplierPaidMap);
  const categoryRows = [...categoryMap.entries()]
    .map(([category, values]) => ({ category, label: categoryLabels[category] ?? category, ...values }))
    .sort((a, b) => b.adjusted - a.adjusted);

  const maxAging = Math.max(1, ...aging.map((item) => item.amount));
  const availableDates = allEntries.map((entry) => entry.effectiveDate).filter(Boolean).sort();
  const availableFrom = availableDates[0] ?? "";
  const availableTo = availableDates[availableDates.length - 1] ?? "";
  const displayedFrom = dateRange.preset === "all" ? availableFrom : dateFrom;
  const displayedTo = dateRange.preset === "all" ? availableTo : dateTo;
  const periodDescription = displayedFrom && displayedTo
    ? `${dateBR(displayedFrom)} a ${dateBR(displayedTo)}`
    : displayedFrom
      ? `a partir de ${dateBR(displayedFrom)}`
      : displayedTo
        ? `até ${dateBR(displayedTo)}`
        : "sem lançamentos";
  const periodHeading = dateRange.preset === "all" ? "Todo o período" : dateRangePresetLabels[dateRange.preset];
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Todas as obras";

  return (
    <AppShell
      activeGroup="finance"
      activeItem="reports"
      eyebrow="Financeiro · Inteligência"
      title="Relatórios Financeiros"
      description={`${company.name} · ${context} · ${periodDescription}.`}
      actions={
        <>
          <Link className="elos-button" href="/financeiro/fluxo-de-caixa">Fluxo de Caixa</Link>
          <Link className="elos-button" href="/financeiro/contas-a-receber">Contas a Receber</Link>
        </>
      }
    >
      {payablesResult.error || receivablesResult.error ? (
        <div className="auth-message error workspace-message">Não foi possível consolidar todos os dados financeiros do relatório.</div>
      ) : null}

      <section className="registry-toolbar reports-toolbar">
        <form method="get" className="reports-filter">
          <select name="grouping" defaultValue={grouping}>
            <option value="month">Agrupar por mês</option>
            <option value="quarter">Agrupar por trimestre</option>
            <option value="year">Agrupar por ano</option>
          </select>
          <DateRangeFilter defaultPreset={dateRange.preset} defaultFrom={dateFrom} defaultTo={dateTo} />
          <button type="submit">Atualizar relatório</button>
          <Link href="/financeiro/relatorios">Limpar</Link>
        </form>
      </section>

      <section className="finance-summary-grid reports-summary-grid">
        <article><span>Receita realizada</span><strong>{money(revenueRealized)}</strong><small>valores efetivamente recebidos</small></article>
        <article><span>Receita prevista</span><strong>{money(revenueForecast)}</strong><small>carteira atualizada em aberto</small></article>
        <article><span>Despesa realizada</span><strong>{money(expenseRealized)}</strong><small>valores efetivamente pagos</small></article>
        <article><span>Despesa prevista</span><strong>{money(expenseForecast)}</strong><small>compromissos ainda em aberto</small></article>
        <article><span>Resultado realizado</span><strong className={realizedResult < 0 ? "reports-negative" : ""}>{money(realizedResult)}</strong><small>recebido menos pago</small></article>
        <article><span>Resultado projetado</span><strong className={projectedResult < 0 ? "reports-negative" : ""}>{money(projectedResult)}</strong><small>receitas totais menos despesas totais</small></article>
        <article><span>Títulos vencidos</span><strong className={overdueTotal > 0 ? "reports-alert" : ""}>{money(overdueTotal)}</strong><small>{overdueInPeriod.length} título(s) no período</small></article>
        <article><span>Inadimplência da carteira</span><strong className={delinquencyRate > 0 ? "reports-alert" : ""}>{percent(delinquencyRate)}</strong><small>vencido sobre toda a carteira aberta</small></article>
      </section>

      <section className="reports-panel reports-period-panel">
        <div className="section-heading">
          <div><span>{periodHeading}</span><h2>Evolução financeira consolidada</h2></div>
          <p>{buckets.length} período(s) analisado(s).</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table reports-period-table">
            <thead>
              <tr><th>Período</th><th>Receita realizada</th><th>Receita prevista</th><th>Despesa realizada</th><th>Despesa prevista</th><th>Resultado do período</th><th>Acumulado</th></tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.key}>
                  <td><strong>{bucket.label}</strong></td>
                  <td>{money(bucket.revenueRealized)}</td>
                  <td>{money(bucket.revenueForecast)}</td>
                  <td>{money(bucket.expenseRealized)}</td>
                  <td>{money(bucket.expenseForecast)}</td>
                  <td><strong className={bucket.balance < 0 ? "reports-negative" : ""}>{money(bucket.balance)}</strong></td>
                  <td><strong className={bucket.accumulated < 0 ? "reports-negative" : ""}>{money(bucket.accumulated)}</strong></td>
                </tr>
              ))}
              {buckets.length === 0 ? <tr><td className="empty-table" colSpan={7}>Nenhum lançamento encontrado no período.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="reports-two-columns">
        <article className="reports-panel">
          <div className="section-heading">
            <div><span>Contas a Receber</span><h2>Envelhecimento da carteira vencida</h2></div>
            <p>{money(overdueReceivables.reduce((sum, entry) => sum + entry.amount, 0))} vencido.</p>
          </div>
          <div className="reports-aging-list">
            {aging.map((item) => (
              <div key={item.label}>
                <header><strong>{item.label}</strong><span>{item.count} título(s) · {money(item.amount)}</span></header>
                <div><i style={{ width: `${(item.amount / maxAging) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </article>

        <article className="reports-panel">
          <div className="section-heading">
            <div><span>Carteira comercial</span><h2>Maiores saldos por cliente</h2></div>
            <p>{topClients.length} cliente(s) destacados.</p>
          </div>
          <div className="reports-ranking">
            {topClients.map((client, index) => (
              <div key={client.id}><span>{index + 1}</span><strong>{client.name}</strong><b>{money(client.amount)}</b></div>
            ))}
            {topClients.length === 0 ? <p className="reports-empty">Não há carteira em aberto.</p> : null}
          </div>
        </article>
      </section>

      <section className="reports-two-columns">
        <article className="reports-panel">
          <div className="section-heading">
            <div><span>Contas a Pagar</span><h2>Maiores pagamentos por fornecedor</h2></div>
            <p>Acumulado do projeto.</p>
          </div>
          <div className="reports-ranking">
            {topSuppliers.map((supplier, index) => (
              <div key={supplier.id}><span>{index + 1}</span><strong>{supplier.name}</strong><b>{money(supplier.amount)}</b></div>
            ))}
            {topSuppliers.length === 0 ? <p className="reports-empty">Nenhum pagamento realizado.</p> : null}
          </div>
        </article>

        <article className="reports-panel">
          <div className="section-heading">
            <div><span>Planos de pagamento</span><h2>Composição das receitas por tipo</h2></div>
            <p>{categoryRows.reduce((sum, item) => sum + item.count, 0)} título(s).</p>
          </div>
          <div className="registry-table-wrap">
            <table className="registry-table reports-category-table">
              <thead><tr><th>Tipo</th><th>Valor atualizado</th><th>Recebido</th><th>Em aberto</th></tr></thead>
              <tbody>
                {categoryRows.map((item) => (
                  <tr key={item.category}><td><strong>{item.label}</strong></td><td>{compactMoney(item.adjusted)}</td><td>{compactMoney(item.paid)}</td><td>{compactMoney(item.open)}</td></tr>
                ))}
                {categoryRows.length === 0 ? <tr><td className="empty-table" colSpan={4}>Sem planos cadastrados.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </AppShell>
  );
}
