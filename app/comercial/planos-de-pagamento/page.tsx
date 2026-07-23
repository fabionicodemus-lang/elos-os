import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { cancelReceivable, createReceivableSeries, markReceivablePaid } from "./actions";

type Client = {
  id: string;
  name: string;
  tax_id: string | null;
};

type Unit = {
  id: string;
  code: string;
};

type SaleOption = {
  id: string;
  number: string;
  total_amount: number;
  payment_plan_available: boolean;
  clients: Client | Client[] | null;
  units: Unit | Unit[] | null;
};

type Receivable = {
  id: string;
  sale_id: string;
  category: string;
  description: string;
  sequence_number: number;
  sequence_total: number;
  due_date: string;
  amount: number;
  adjustment_index: string | null;
  interest_rate_monthly: number | null;
  status: "open" | "paid" | "cancelled";
  paid_at: string | null;
  paid_amount: number | null;
  paid_account_name: string | null;
  clients: Client | Client[] | null;
  units: Unit | Unit[] | null;
  sales: { id: string; number: string; total_amount: number } | { id: string; number: string; total_amount: number }[] | null;
};

type Summary = {
  contracted_amount: number;
  active_sales: number;
  total_count: number;
  open_count: number;
  paid_count: number;
  overdue_count: number;
  planned_amount: number;
  open_amount: number;
  paid_amount: number;
  unplanned_amount: number;
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

function dateBR(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export default async function PaymentPlansPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    category?: string;
    sale?: string;
    from?: string;
    to?: string;
    page?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("receivables.view");
  const queryText = (params.q ?? "").trim();
  const status = ["open", "paid", "cancelled"].includes(params.status ?? "") ? params.status! : "";
  const category = categoryLabels[params.category ?? ""] ? params.category! : "";
  const saleId = params.sale ?? "";
  const dateFrom = params.from ?? "";
  const dateTo = params.to ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const fromRow = (page - 1) * PAGE_SIZE;
  const toRow = fromRow + PAGE_SIZE - 1;
  const today = new Date().toISOString().slice(0, 10);

  const projectQuery = projectId
    ? supabase.from("projects").select("id, name, code").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  let salesQuery = supabase
    .from("sales")
    .select("id, number, total_amount, payment_plan_available, clients(id, name, tax_id), units(id, code)")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("sale_date", { ascending: false })
    .limit(500);

  if (projectId) salesQuery = salesQuery.eq("project_id", projectId);

  let listQuery = supabase
    .from("receivables")
    .select(
      "id, sale_id, category, description, sequence_number, sequence_total, due_date, amount, adjustment_index, interest_rate_monthly, status, paid_at, paid_amount, paid_account_name, clients(id, name, tax_id), units(id, code), sales(id, number, total_amount)",
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

  const [projectResult, salesResult, listResult, summaryResult, manageResult] = await Promise.all([
    projectQuery,
    salesQuery,
    listQuery,
    supabase.rpc("receivables_summary", {
      p_company_id: companyId,
      p_project_id: projectId,
      p_sale_id: saleId || null,
    }),
    supabase.rpc("has_company_permission", {
      target_company_id: companyId,
      target_permission: "receivables.manage",
    }),
  ]);

  const schemaMissing =
    listResult.error?.code === "42P01" ||
    listResult.error?.message.includes("receivables") ||
    summaryResult.error?.message.includes("receivables_summary");

  const sales = (salesResult.data ?? []) as unknown as SaleOption[];
  const receivables = (listResult.data ?? []) as unknown as Receivable[];
  const selectedSale = sales.find((sale) => sale.id === saleId) ?? null;
  const summary = (summaryResult.data ?? {
    contracted_amount: 0,
    active_sales: 0,
    total_count: 0,
    open_count: 0,
    paid_count: 0,
    overdue_count: 0,
    planned_amount: 0,
    open_amount: 0,
    paid_amount: 0,
    unplanned_amount: 0,
  }) as Summary;
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const totalPages = Math.max(1, Math.ceil((listResult.count ?? 0) / PAGE_SIZE));
  const project = projectResult.data;

  return (
    <AppShell
      activeGroup="commercial"
      activeItem="payment-plans"
      eyebrow="Comercial · Financeiro do contrato"
      title="Planos de Pagamento"
      description={`${company.name}${project ? ` · ${project.code ? `${project.code} · ` : ""}${project.name}` : " · todas as obras"}`}
      actions={
        <>
          <Link className="elos-button" href="/comercial/vendas">Vendas</Link>
          <Link className="elos-button" href="/cadastros/clientes">Clientes</Link>
        </>
      }
    >
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

      {schemaMissing ? (
        <section className="setup-panel">
          <span>Banco de dados pendente</span>
          <h2>Instale a estrutura de contas a receber</h2>
          <p>Execute no SQL Editor do Supabase o arquivo <code>supabase/migrations/20260723_0005_receivables.sql</code>.</p>
        </section>
      ) : (
        <>
          <section className="finance-summary-grid">
            <article><span>Valor contratado</span><strong>{money(summary.contracted_amount)}</strong><small>{summary.active_sales} venda(s) ativa(s)</small></article>
            <article><span>Plano cadastrado</span><strong>{money(summary.planned_amount)}</strong><small>{summary.total_count} parcela(s)</small></article>
            <article><span>Em aberto</span><strong>{money(summary.open_amount)}</strong><small>{summary.open_count} parcela(s) · {summary.overdue_count} vencida(s)</small></article>
            <article><span>Recebido</span><strong>{money(summary.paid_amount)}</strong><small>{summary.paid_count} parcela(s) baixada(s)</small></article>
          </section>

          {selectedSale ? (
            <section className="receivable-sale-card">
              <div>
                <span>Plano selecionado</span>
                <h2>{relatedOne(selectedSale.units)?.code} · {relatedOne(selectedSale.clients)?.name}</h2>
                <p>Venda {selectedSale.number} · contrato de {money(selectedSale.total_amount)}</p>
              </div>
              <div className="receivable-sale-values">
                <div><span>Planejado</span><strong>{money(summary.planned_amount)}</strong></div>
                <div><span>A detalhar</span><strong>{money(summary.unplanned_amount)}</strong></div>
              </div>
            </section>
          ) : null}

          <section className="registry-toolbar">
            <form className="receivable-filter" method="get">
              <input name="q" defaultValue={queryText} placeholder="Descrição ou índice de correção" />
              <select name="sale" defaultValue={saleId}>
                <option value="">Todas as vendas</option>
                {sales.map((sale) => {
                  const client = relatedOne(sale.clients);
                  const unit = relatedOne(sale.units);
                  return <option key={sale.id} value={sale.id}>{unit?.code} · {client?.name}</option>;
                })}
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
              <input name="from" type="date" defaultValue={dateFrom} />
              <input name="to" type="date" defaultValue={dateTo} />
              <button type="submit">Filtrar</button>
              <Link href="/comercial/planos-de-pagamento">Limpar</Link>
            </form>

            {canManage && projectId ? (
              <details className="registry-create" open={Boolean(selectedSale && summary.total_count === 0)}>
                <summary>+ Adicionar parcela ou série</summary>
                <form action={createReceivableSeries}>
                  <div className="registry-form-grid receivable-plan-grid">
                    <label className="registry-wide">Venda
                      <select name="sale_id" required defaultValue={saleId}>
                        <option value="" disabled>Selecione a venda</option>
                        {sales.map((sale) => {
                          const client = relatedOne(sale.clients);
                          const unit = relatedOne(sale.units);
                          return <option key={sale.id} value={sale.id}>{unit?.code} · {client?.name} · {money(sale.total_amount)}</option>;
                        })}
                      </select>
                    </label>
                    <label>Tipo
                      <select name="category" defaultValue="monthly" required>
                        {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label>Descrição<input name="description" placeholder="Ex.: Mensais até as chaves" /></label>
                    <label>Primeiro vencimento<input name="first_due_date" type="date" required /></label>
                    <label>Valor de cada parcela<input name="amount" inputMode="decimal" placeholder="0,00" required /></label>
                    <label>Quantidade<input name="quantity" type="number" min={1} max={240} defaultValue={1} required /></label>
                    <label>Periodicidade
                      <select name="frequency" defaultValue="monthly">
                        <option value="once">Única</option>
                        <option value="monthly">Mensal</option>
                        <option value="bimonthly">Bimestral</option>
                        <option value="quarterly">Trimestral</option>
                        <option value="semiannual">Semestral</option>
                        <option value="annual">Anual</option>
                      </select>
                    </label>
                    <label>Índice de correção<input name="adjustment_index" placeholder="Ex.: CUB, INCC, IPCA" /></label>
                    <label>Juros ao mês (%)<input name="interest_rate_monthly" inputMode="decimal" placeholder="0,00" /></label>
                    <label className="registry-wide">Observações<textarea name="notes" rows={3} /></label>
                  </div>
                  <button className="auth-primary" type="submit">Adicionar ao plano</button>
                </form>
              </details>
            ) : null}
          </section>

          <section className="registry-table-panel">
            <div className="section-heading">
              <div><span>Contas a receber</span><h2>Parcelas do plano</h2></div>
              <p>{listResult.count ?? 0} parcela(s) no filtro atual.</p>
            </div>

            <div className="registry-table-wrap">
              <table className="registry-table finance-table">
                <thead><tr><th>Unidade / cliente</th><th>Tipo / parcela</th><th>Vencimento</th><th>Valor</th><th>Correção</th><th>Status</th><th>Recebimento</th><th>Ação</th></tr></thead>
                <tbody>
                  {receivables.map((receivable) => {
                    const client = relatedOne(receivable.clients);
                    const unit = relatedOne(receivable.units);
                    const sale = relatedOne(receivable.sales);
                    const overdue = receivable.status === "open" && receivable.due_date < today;
                    return (
                      <tr key={receivable.id}>
                        <td><strong>{unit?.code || "—"}</strong><span>{client?.name || "Cliente"}</span><small>Venda {sale?.number}</small></td>
                        <td><strong>{categoryLabels[receivable.category] || receivable.category}</strong><span>{receivable.description}</span><small>{receivable.sequence_number} / {receivable.sequence_total}</small></td>
                        <td>{dateBR(receivable.due_date)}</td>
                        <td><strong>{money(receivable.amount)}</strong></td>
                        <td><span>{receivable.adjustment_index || "—"}</span><small>{receivable.interest_rate_monthly ? `${receivable.interest_rate_monthly}% a.m.` : ""}</small></td>
                        <td><span className={`status-badge ${overdue ? "overdue" : receivable.status}`}>{overdue ? "Vencida" : receivable.status === "open" ? "Em aberto" : receivable.status === "paid" ? "Recebida" : "Cancelada"}</span></td>
                        <td><span>{receivable.paid_at ? dateBR(receivable.paid_at) : "—"}</span><small>{receivable.paid_at ? `${money(receivable.paid_amount ?? receivable.amount)}${receivable.paid_account_name ? ` · ${receivable.paid_account_name}` : ""}` : ""}</small></td>
                        <td>
                          {canManage && receivable.status === "open" ? (
                            <div className="payable-actions">
                              <details>
                                <summary>Baixar</summary>
                                <form action={markReceivablePaid}>
                                  <input type="hidden" name="receivable_id" value={receivable.id} />
                                  <input type="hidden" name="sale_id" value={receivable.sale_id} />
                                  <label>Data<input name="paid_at" type="date" defaultValue={today} required /></label>
                                  <label>Valor<input name="paid_amount" defaultValue={receivable.amount.toFixed(2)} required /></label>
                                  <label>Conta<input name="paid_account_name" /></label>
                                  <button type="submit">Confirmar</button>
                                </form>
                              </details>
                              <form action={cancelReceivable}>
                                <input type="hidden" name="receivable_id" value={receivable.id} />
                                <input type="hidden" name="sale_id" value={receivable.sale_id} />
                                <button className="table-action" type="submit">Cancelar</button>
                              </form>
                            </div>
                          ) : <span>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {receivables.length === 0 ? <tr><td className="empty-table" colSpan={8}>Nenhuma parcela cadastrada.</td></tr> : null}
                </tbody>
              </table>
            </div>

            <div className="registry-pagination">
              <span>Página {page} de {totalPages}</span>
              <div>
                {page > 1 ? <Link href={`?q=${encodeURIComponent(queryText)}&status=${status}&category=${category}&sale=${saleId}&from=${dateFrom}&to=${dateTo}&page=${page - 1}`}>Anterior</Link> : null}
                {page < totalPages ? <Link href={`?q=${encodeURIComponent(queryText)}&status=${status}&category=${category}&sale=${saleId}&from=${dateFrom}&to=${dateTo}&page=${page + 1}`}>Próxima</Link> : null}
              </div>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
