import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { DateRangeFilter } from "@/components/date-range-filter";
import { resolveDateRange } from "@/lib/date-range";
import { requireCompanyPermission } from "@/lib/workspace";

type Client = { id: string; name: string; tax_id: string | null };
type Unit = { id: string; code: string };
type Sale = { id: string; number: string; sale_date: string; clients: Client | Client[] | null; units: Unit | Unit[] | null };
type Receivable = {
  id: string;
  sale_id: string;
  category: string;
  description: string;
  sequence_number: number;
  sequence_total: number;
  due_date: string;
  amount: number;
  adjusted_amount: number;
  correction_amount: number;
  adjustment_index: string | null;
  correction_base_month: string | null;
  correction_base_value: number | null;
  correction_reference_month: string | null;
  correction_reference_value: number | null;
  correction_locked: boolean;
  status: "open" | "paid" | "cancelled";
  paid_at: string | null;
  paid_amount: number | null;
  paid_account_name: string | null;
  clients: Client | Client[] | null;
  units: Unit | Unit[] | null;
  sales: { id: string; number: string } | { id: string; number: string }[] | null;
};
type Summary = {
  base_amount: number;
  updated_amount: number;
  correction_amount: number;
  active_sales: number;
  total_count: number;
  open_count: number;
  paid_count: number;
  overdue_count: number;
  open_amount: number;
  paid_amount: number;
};

const PAGE_SIZE = 50;
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

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

function decimal(value: number | null | undefined, maximumFractionDigits = 4) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits }).format(Number(value));
}

function dateBR(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function monthBR(value: string | null) {
  if (!value) return "";
  const [year, month] = value.split("-");
  return `${month}/${year}`;
}

export default async function AccountsReceivablePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    category?: string;
    sale?: string;
    period?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId } = await requireCompanyPermission("receivables.view");
  const queryText = (params.q ?? "").trim();
  const status = ["open", "paid", "cancelled"].includes(params.status ?? "") ? params.status! : "";
  const category = categoryLabels[params.category ?? ""] ? params.category! : "";
  const saleId = params.sale ?? "";
  const dateRange = resolveDateRange(params.period, params.from, params.to);
  const dateFrom = dateRange.from;
  const dateTo = dateRange.to;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const fromRow = (page - 1) * PAGE_SIZE;
  const toRow = fromRow + PAGE_SIZE - 1;
  const today = new Date().toISOString().slice(0, 10);

  const projectQuery = projectId
    ? supabase.from("projects").select("id, name, code").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  let salesQuery = supabase
    .from("sales")
    .select("id, number, sale_date, clients(id, name, tax_id), units(id, code)")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("sale_date", { ascending: false })
    .limit(500);
  if (projectId) salesQuery = salesQuery.eq("project_id", projectId);

  let listQuery = supabase
    .from("receivables")
    .select(
      "id, sale_id, category, description, sequence_number, sequence_total, due_date, amount, adjusted_amount, correction_amount, adjustment_index, correction_base_month, correction_base_value, correction_reference_month, correction_reference_value, correction_locked, status, paid_at, paid_amount, paid_account_name, clients(id, name, tax_id), units(id, code), sales(id, number)",
      { count: "exact" },
    )
    .eq("company_id", companyId)
    .order("due_date", { ascending: true })
    .range(fromRow, toRow);
  if (projectId) listQuery = listQuery.eq("project_id", projectId);
  if (saleId) listQuery = listQuery.eq("sale_id", saleId);
  if (status) listQuery = listQuery.eq("status", status);
  if (category) listQuery = listQuery.eq("category", category);
  if (dateFrom) listQuery = listQuery.gte("due_date", dateFrom);
  if (dateTo) listQuery = listQuery.lte("due_date", dateTo);
  if (queryText) {
    const safe = queryText.replace(/[,%()]/g, " ").trim();
    listQuery = listQuery.or(`description.ilike.%${safe}%,adjustment_index.ilike.%${safe}%`);
  }

  const [projectResult, salesResult, listResult, summaryResult] = await Promise.all([
    projectQuery,
    salesQuery,
    listQuery,
    supabase.rpc("receivables_summary", {
      p_company_id: companyId,
      p_project_id: projectId,
      p_sale_id: saleId || null,
    }),
  ]);

  const sales = (salesResult.data ?? []) as unknown as Sale[];
  const receivables = (listResult.data ?? []) as unknown as Receivable[];
  const summary = (summaryResult.data ?? {
    base_amount: 0,
    updated_amount: 0,
    correction_amount: 0,
    active_sales: 0,
    total_count: 0,
    open_count: 0,
    paid_count: 0,
    overdue_count: 0,
    open_amount: 0,
    paid_amount: 0,
  }) as Summary;
  const totalPages = Math.max(1, Math.ceil((listResult.count ?? 0) / PAGE_SIZE));
  const project = projectResult.data;
  const paginationQuery = `q=${encodeURIComponent(queryText)}&status=${status}&category=${category}&sale=${saleId}&period=${dateRange.preset}&from=${dateFrom}&to=${dateTo}`;

  return (
    <AppShell
      activeGroup="finance"
      activeItem="receivables"
      eyebrow="Financeiro · Contas a Receber"
      title="Contas a Receber"
      description={`${company.name}${project ? ` · ${project.code ? `${project.code} · ` : ""}${project.name}` : " · todas as obras"}`}
      actions={
        <>
          <Link className="elos-button" href="/comercial/planos-de-pagamento">Planos de Pagamento</Link>
          <Link className="elos-button" href="/comercial/vendas">Vendas</Link>
          <Link className="elos-button" href="/financeiro/indices-de-correcao">Índices de correção</Link>
        </>
      }
    >
      {listResult.error || summaryResult.error ? (
        <div className="auth-message error workspace-message">Não foi possível carregar as contas a receber. Confirme a instalação da atualização financeira no Supabase.</div>
      ) : null}

      <section className="finance-summary-grid">
        <article><span>Valor contrato</span><strong>{money(summary.base_amount)}</strong><small>soma dos valores base</small></article>
        <article><span>Valor atualizado</span><strong>{money(summary.updated_amount)}</strong><small>{money(summary.correction_amount)} de correção acumulada</small></article>
        <article><span>Em aberto</span><strong>{money(summary.open_amount)}</strong><small>{summary.open_count} parcela(s) pelo valor atualizado · {summary.overdue_count} vencida(s)</small></article>
        <article><span>Recebido</span><strong>{money(summary.paid_amount)}</strong><small>{summary.paid_count} parcela(s) baixada(s)</small></article>
      </section>

      <section className="registry-toolbar">
        <form className="receivable-filter" method="get">
          <input name="q" defaultValue={queryText} placeholder="Descrição ou índice de correção" />
          <select name="sale" defaultValue={saleId}>
            <option value="">Todas as vendas</option>
            {sales.map((sale) => <option key={sale.id} value={sale.id}>{relatedOne(sale.units)?.code} · {relatedOne(sale.clients)?.name}</option>)}
          </select>
          <select name="status" defaultValue={status}>
            <option value="">Todos os status</option>
            <option value="open">Em aberto</option>
            <option value="paid">Recebidas</option>
            <option value="cancelled">Canceladas</option>
          </select>
          <select name="category" defaultValue={category}>
            <option value="">Todos os tipos</option>
            {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <DateRangeFilter defaultPreset={dateRange.preset} defaultFrom={dateFrom} defaultTo={dateTo} />
          <button type="submit">Filtrar</button>
          <Link href="/financeiro/contas-a-receber">Limpar</Link>
        </form>
      </section>

      <section className="registry-table-panel">
        <div className="section-heading">
          <div><span>Financeiro</span><h2>Títulos a receber</h2></div>
          <p>{listResult.count ?? 0} título(s) no filtro atual.</p>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table finance-table">
            <thead>
              <tr><th>Unidade / cliente</th><th>Tipo / parcela</th><th>Vencimento</th><th>Valor base</th><th>Valor</th><th>Correção</th><th>Status</th><th>Recebimento</th><th>Ação</th></tr>
            </thead>
            <tbody>
              {receivables.map((receivable) => {
                const client = relatedOne(receivable.clients);
                const unit = relatedOne(receivable.units);
                const sale = relatedOne(receivable.sales);
                const updatedValue = Number(receivable.adjusted_amount ?? receivable.amount);
                const overdue = receivable.status === "open" && receivable.due_date < today;
                const correctionDetails = [
                  receivable.correction_base_month ? `base ${monthBR(receivable.correction_base_month)}` : "",
                  receivable.correction_base_value ? `CUB ${decimal(receivable.correction_base_value, 6)}` : "",
                  receivable.correction_reference_month ? `aplicado ${monthBR(receivable.correction_reference_month)}` : "",
                  receivable.correction_reference_value ? `CUB ${decimal(receivable.correction_reference_value, 6)}` : "",
                  receivable.correction_locked ? "histórico" : "automático",
                ].filter(Boolean).join(" · ");
                return (
                  <tr key={receivable.id}>
                    <td><strong>{unit?.code || "—"}</strong><span>{client?.name || "Cliente"}</span><small>Venda {sale?.number}</small></td>
                    <td><strong>{categoryLabels[receivable.category] || receivable.category}</strong><span>{receivable.description}</span><small>{receivable.sequence_number} / {receivable.sequence_total}</small></td>
                    <td>{dateBR(receivable.due_date)}</td>
                    <td><strong>{money(receivable.amount)}</strong><small>lançamento original</small></td>
                    <td><strong>{money(updatedValue)}</strong><small>{receivable.correction_amount ? `Correção: ${money(receivable.correction_amount)}` : "Sem correção no período"}</small></td>
                    <td><span>{receivable.adjustment_index || "Sem correção"}</span><small>{correctionDetails}</small></td>
                    <td><span className={`status-badge ${overdue ? "overdue" : receivable.status}`}>{overdue ? "Vencida" : receivable.status === "open" ? "Em aberto" : receivable.status === "paid" ? "Recebida" : "Cancelada"}</span></td>
                    <td><span>{receivable.paid_at ? dateBR(receivable.paid_at) : "—"}</span><small>{receivable.paid_at ? `${money(receivable.paid_amount ?? updatedValue)}${receivable.paid_account_name ? ` · ${receivable.paid_account_name}` : ""}` : ""}</small></td>
                    <td><Link className="table-action" href={`/comercial/vendas/${receivable.sale_id}`}>Abrir venda</Link></td>
                  </tr>
                );
              })}
              {receivables.length === 0 ? <tr><td className="empty-table" colSpan={9}>Nenhum título encontrado.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="registry-pagination">
          <span>Página {page} de {totalPages}</span>
          <div>
            {page > 1 ? <Link href={`?${paginationQuery}&page=${page - 1}`}>Anterior</Link> : null}
            {page < totalPages ? <Link href={`?${paginationQuery}&page=${page + 1}`}>Próxima</Link> : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
