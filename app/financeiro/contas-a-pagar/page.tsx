import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { cancelPayable, createPayable, markPayablePaid } from "./actions";
import { requireCompanyPermission } from "@/lib/workspace";

type Supplier = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string | null;
};

type Payable = {
  id: string;
  document: string | null;
  due_date: string;
  amount: number;
  status: "open" | "paid" | "cancelled";
  installment_label: string | null;
  notes: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  paid_account_name: string | null;
  source_system: string | null;
  suppliers: Supplier | Supplier[] | null;
};

type Summary = {
  total_count: number;
  open_count: number;
  paid_count: number;
  cancelled_count: number;
  total_amount: number;
  open_amount: number;
  paid_amount: number;
};

const PAGE_SIZE = 50;

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

export default async function PayablesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    supplier?: string;
    from?: string;
    to?: string;
    page?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("payables.view");
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const fromRow = (page - 1) * PAGE_SIZE;
  const toRow = fromRow + PAGE_SIZE - 1;
  const queryText = (params.q ?? "").trim();
  const status = ["open", "paid", "cancelled"].includes(params.status ?? "") ? params.status! : "";
  const supplierId = params.supplier ?? "";
  const dateFrom = params.from ?? "";
  const dateTo = params.to ?? "";

  const projectQuery = projectId
    ? supabase.from("projects").select("id, name, code").eq("id", projectId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const suppliersQuery = supabase
    .from("suppliers")
    .select("id, legal_name, trade_name, tax_id")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("legal_name")
    .limit(1200);

  let listQuery = supabase
    .from("payables")
    .select("id, document, due_date, amount, status, installment_label, notes, paid_at, paid_amount, paid_account_name, source_system, suppliers(id, legal_name, trade_name, tax_id)", { count: "exact" })
    .eq("company_id", companyId)
    .order("due_date", { ascending: false })
    .range(fromRow, toRow);

  if (projectId) listQuery = listQuery.eq("project_id", projectId);
  if (status) listQuery = listQuery.eq("status", status);
  if (supplierId) listQuery = listQuery.eq("supplier_id", supplierId);
  if (dateFrom) listQuery = listQuery.gte("due_date", dateFrom);
  if (dateTo) listQuery = listQuery.lte("due_date", dateTo);
  if (queryText) {
    const safe = queryText.replace(/[,%()]/g, " ").trim();
    listQuery = listQuery.or(`document.ilike.%${safe}%,notes.ilike.%${safe}%,installment_label.ilike.%${safe}%`);
  }

  const [projectResult, suppliersResult, listResult, summaryResult, manageResult] = await Promise.all([
    projectQuery,
    suppliersQuery,
    listQuery,
    supabase.rpc("payables_summary", { p_company_id: companyId, p_project_id: projectId }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "payables.manage" }),
  ]);

  const schemaMissing = listResult.error?.code === "42P01" || listResult.error?.message.includes("payables");
  const payables = (listResult.data ?? []) as unknown as Payable[];
  const suppliers = (suppliersResult.data ?? []) as Supplier[];
  const summary = (summaryResult.data ?? {
    total_count: 0,
    open_count: 0,
    paid_count: 0,
    cancelled_count: 0,
    total_amount: 0,
    open_amount: 0,
    paid_amount: 0,
  }) as Summary;
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const totalPages = Math.max(1, Math.ceil((listResult.count ?? 0) / PAGE_SIZE));
  const project = projectResult.data;
  const today = new Date().toISOString().slice(0, 10);
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Todas as obras";

  return (
    <AppShell
      activeGroup="finance"
      activeItem="payables"
      eyebrow="Financeiro"
      title="Contas a Pagar"
      description={`${company.name} · ${context} · compromissos, pagamentos e fornecedores da obra.`}
      actions={<Link className="elos-button" href="/cadastros/fornecedores">Abrir fornecedores</Link>}
    >
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

      {schemaMissing ? (
        <section className="setup-panel">
          <span>Banco de dados pendente</span>
          <h2>Instale a estrutura de contas a pagar</h2>
          <p>Execute no SQL Editor do Supabase o arquivo <code>supabase/migrations/20260722_0003_flow_payables.sql</code>.</p>
        </section>
      ) : (
        <>
          <section className="finance-summary-grid">
            <article><span>Total lançado</span><strong>{money(summary.total_amount)}</strong><small>{summary.total_count} títulos</small></article>
            <article><span>Em aberto</span><strong>{money(summary.open_amount)}</strong><small>{summary.open_count} títulos</small></article>
            <article><span>Pago</span><strong>{money(summary.paid_amount)}</strong><small>{summary.paid_count} títulos</small></article>
            <article><span>Cancelados</span><strong>{summary.cancelled_count}</strong><small>títulos</small></article>
          </section>

          <section className="registry-toolbar">
            <form className="finance-filter" method="get">
              <input name="q" defaultValue={queryText} placeholder="Documento, parcela ou observação" />
              <select name="status" defaultValue={status}>
                <option value="">Todos os status</option>
                <option value="open">Em aberto</option>
                <option value="paid">Pago</option>
                <option value="cancelled">Cancelado</option>
              </select>
              <select name="supplier" defaultValue={supplierId}>
                <option value="">Todos os fornecedores</option>
                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.trade_name || supplier.legal_name}</option>)}
              </select>
              <input name="from" type="date" defaultValue={dateFrom} />
              <input name="to" type="date" defaultValue={dateTo} />
              <button type="submit">Filtrar</button>
              <Link href="/financeiro/contas-a-pagar">Limpar</Link>
            </form>

            {canManage && projectId ? (
              <details className="registry-create">
                <summary>+ Nova conta a pagar</summary>
                <form action={createPayable}>
                  <div className="registry-form-grid">
                    <label className="registry-wide">Fornecedor<select name="supplier_id" required defaultValue=""><option value="" disabled>Selecione</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.trade_name || supplier.legal_name} {supplier.tax_id ? `· ${supplier.tax_id}` : ""}</option>)}</select></label>
                    <label>Documento<input name="document" /></label>
                    <label>Parcela<input name="installment_label" placeholder="1 / 3" /></label>
                    <label>Vencimento<input name="due_date" type="date" required /></label>
                    <label>Valor<input name="amount" inputMode="decimal" placeholder="0,00" required /></label>
                    <label>Classe fiscal<input name="fiscal_class" /></label>
                    <label>Forma de pagamento<input name="payment_method" /></label>
                    <label className="registry-wide">Observações<textarea name="notes" rows={3} /></label>
                  </div>
                  <button className="auth-primary" type="submit">Salvar conta</button>
                </form>
              </details>
            ) : null}
          </section>

          <section className="registry-table-panel">
            <div className="section-heading">
              <div><span>Lançamentos</span><h2>Contas encontradas</h2></div>
              <p>{listResult.count ?? 0} título(s) no filtro atual.</p>
            </div>
            <div className="registry-table-wrap">
              <table className="registry-table finance-table">
                <thead><tr><th>Fornecedor</th><th>Documento</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Pagamento</th><th>Ação</th></tr></thead>
                <tbody>
                  {payables.map((payable) => {
                    const supplier = relatedOne(payable.suppliers);
                    return (
                      <tr key={payable.id}>
                        <td><strong>{supplier?.trade_name || supplier?.legal_name || "Fornecedor"}</strong><small>{supplier?.tax_id}</small></td>
                        <td><span>{payable.document || "—"}</span><small>{payable.installment_label}{payable.source_system === "koper_flow" ? " · KOPER" : ""}</small></td>
                        <td>{dateBR(payable.due_date)}</td>
                        <td><strong>{money(payable.amount)}</strong></td>
                        <td><span className={`status-badge ${payable.status}`}>{payable.status === "open" ? "Em aberto" : payable.status === "paid" ? "Pago" : "Cancelado"}</span></td>
                        <td><span>{payable.paid_at ? dateBR(payable.paid_at) : "—"}</span><small>{payable.paid_at ? `${money(payable.paid_amount ?? payable.amount)}${payable.paid_account_name ? ` · ${payable.paid_account_name}` : ""}` : ""}</small></td>
                        <td>
                          {canManage && payable.status === "open" ? (
                            <div className="payable-actions">
                              <details>
                                <summary>Baixar</summary>
                                <form action={markPayablePaid}>
                                  <input type="hidden" name="payable_id" value={payable.id} />
                                  <label>Data<input name="paid_at" type="date" defaultValue={today} required /></label>
                                  <label>Valor<input name="paid_amount" defaultValue={payable.amount.toFixed(2)} required /></label>
                                  <label>Conta<input name="paid_account_name" /></label>
                                  <button className="auth-primary" type="submit">Confirmar</button>
                                </form>
                              </details>
                              <form action={cancelPayable}><input type="hidden" name="payable_id" value={payable.id} /><button className="table-action" type="submit">Cancelar</button></form>
                            </div>
                          ) : <span>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {payables.length === 0 ? <tr><td className="empty-table" colSpan={7}>Nenhuma conta encontrada.</td></tr> : null}
                </tbody>
              </table>
            </div>

            <div className="registry-pagination">
              <span>Página {page} de {totalPages}</span>
              <div>
                {page > 1 ? <Link href={`?q=${encodeURIComponent(queryText)}&status=${status}&supplier=${supplierId}&from=${dateFrom}&to=${dateTo}&page=${page - 1}`}>Anterior</Link> : null}
                {page < totalPages ? <Link href={`?q=${encodeURIComponent(queryText)}&status=${status}&supplier=${supplierId}&from=${dateFrom}&to=${dateTo}&page=${page + 1}`}>Próxima</Link> : null}
              </div>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
