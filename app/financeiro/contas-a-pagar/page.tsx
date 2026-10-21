import { FINANCE_TITLE_COLUMNS, openTitleAmount, openPrincipalTitleAmount, titleStatusLabel, type FinancialTitleFields } from "@/lib/finance-core/titles.mjs";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { DateRangeFilter } from "@/components/date-range-filter";
import {fetchAllRows} from "@/lib/supabase-pagination";
import { cancelPayable, markPayablePaid, reversePayableSettlement } from "./actions";
import { PayableCreateForm } from "./payable-create-form";
import { resolveDateRange } from "@/lib/date-range";
import { requireCompanyPermission } from "@/lib/workspace";

type Supplier = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string | null;
};

type Payable = FinancialTitleFields & {
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
  source_category: string | null;
  beneficiary_name: string | null;
  beneficiary_tax_id: string | null;
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

function sourceLabel(payable: Payable) {
  if (payable.source_system === "koper_flow") return "KOPER";
  if (payable.source_system === "elos_hr") {
    if (payable.source_category === "salary") return "RH · Salário";
    if (payable.source_category === "benefit") return "RH · Benefício";
    if (payable.source_category === "withholding") return "RH · Retenção";
    return "RH · Encargo";
  }
  return "";
}

export default async function PayablesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    supplier?: string;
    period?: string;
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
  const dateRange = resolveDateRange(params.period, params.from, params.to);
  const dateFrom = dateRange.from;
  const dateTo = dateRange.to;

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
    .select(`id, document, due_date, amount, status, installment_label, notes, paid_at, paid_amount, paid_account_name, source_system, source_category, beneficiary_name, beneficiary_tax_id, suppliers(id, legal_name, trade_name, tax_id),${FINANCE_TITLE_COLUMNS}`, { count: "exact" })
    .eq("company_id", companyId)
    .order("due_date", { ascending: false })
    .range(fromRow, toRow);

  if (projectId) listQuery = listQuery.eq("project_id", projectId);
  if (status) listQuery = listQuery.eq("status", status);
  if (supplierId) listQuery = listQuery.eq("supplier_id", supplierId);
  if (dateFrom) listQuery = listQuery.gte("due_date", dateFrom);
  if (dateTo) listQuery = listQuery.lte("due_date", dateTo);
  // Atalho "Contas a Pagar da Folha" (?q=RH): o texto "RH" não fica gravado em
  // nenhuma coluna pesquisável, então filtramos pela origem da folha.
  if (queryText.toUpperCase() === "RH") {
    listQuery = listQuery.eq("origin", "hr_payroll");
  } else if (queryText) {
    const safe = queryText.replace(/[,%()]/g, " ").trim();
    listQuery = listQuery.or(`document.ilike.%${safe}%,notes.ilike.%${safe}%,installment_label.ilike.%${safe}%,beneficiary_name.ilike.%${safe}%,beneficiary_tax_id.ilike.%${safe}%`);
  }

  const [projectResult, suppliersResult, listResult, summaryResult, manageResult, bankResult] = await Promise.all([
    projectQuery,
    suppliersQuery,
    listQuery,
    supabase.rpc("payables_summary", { p_company_id: companyId, p_project_id: projectId }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "payables.manage" }),
    supabase.from("finance_bank_accounts").select("id,label").eq("company_id",companyId).eq("status","active").order("label"),
  ]);

  const bankAccounts = bankResult.data ?? [];
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
  type SettlementHistory={id:string;title_id:string;principal:number;interest:number;discount:number;noncash:number;excess_credit:number;credit_class:string|null;finance_settlement_events:{id:string;kind:string;reversal_of:string|null;effective_date:string;reason:string;created_by:string;created_at:string}|{id:string;kind:string;reversal_of:string|null;effective_date:string;reason:string;created_by:string;created_at:string}[]};
  const historyResult=payables.length?await fetchAllRows<SettlementHistory>(async(from,to)=>{
    const {data,error}=await supabase.from("finance_settlement_lines").select("id,title_id,principal,interest,discount,noncash,excess_credit,credit_class,finance_settlement_events!inner(id,kind,reversal_of,effective_date,reason,created_by,created_at)").eq("company_id",companyId).eq("title_type","AP").in("title_id",payables.map(x=>x.id)).order("created_at").order("id").range(from,to);
    return {data:(data??[]) as unknown as SettlementHistory[],error};
  }):{data:[],error:null};
  if(historyResult.error)throw new Error(historyResult.error.message);
  const today = new Date().toISOString().slice(0, 10);
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Todas as obras";
  const paginationQuery = `q=${encodeURIComponent(queryText)}&status=${status}&supplier=${supplierId}&period=${dateRange.preset}&from=${dateFrom}&to=${dateTo}`;

  return (
    <AppShell
      activeGroup="finance"
      activeItem="payables"
      eyebrow="Financeiro"
      title="Contas a Pagar"
      description={`${company.name} · ${context} · compromissos, pagamentos, fornecedores e folha de pagamento.`}
      actions={<>
        <Link prefetch={false} className="elos-button" href="/rh/folha">Abrir RH</Link>
        <Link prefetch={false} className="elos-button" href="/cadastros/fornecedores">Abrir fornecedores</Link>
      </>}
    >
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

      {schemaMissing ? (
        <section className="setup-panel">
          <span>Banco de dados pendente</span>
          <h2>Instale a estrutura de contas a pagar</h2>
          <p>Execute as migrations financeiras e a migration <code>20260801_0069_hr_payroll.sql</code>.</p>
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
              <input name="q" defaultValue={queryText} placeholder="Documento, favorecido, parcela ou observação" />
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
              <DateRangeFilter defaultPreset={dateRange.preset} defaultFrom={dateFrom} defaultTo={dateTo} />
              <button type="submit">Filtrar</button>
              <Link prefetch={false} href="/financeiro/contas-a-pagar">Limpar</Link>
            </form>

            {canManage && projectId ? (
              <details className="registry-create">
                <summary>+ Nova conta a pagar</summary>
                <PayableCreateForm suppliers={suppliers} />
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
                <thead><tr><th>Favorecido</th><th>Documento</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Pagamento</th><th>Ação</th></tr></thead>
                <tbody>
                  {payables.map((payable) => {
                    const supplier = relatedOne(payable.suppliers);
                    const beneficiaryName = payable.beneficiary_name || supplier?.trade_name || supplier?.legal_name || "Favorecido";
                    const beneficiaryTaxId = payable.beneficiary_tax_id || supplier?.tax_id;
                    const origin = sourceLabel(payable);
                    return (
                      <tr key={payable.id}>
                        <td><strong>{beneficiaryName}</strong><small>{beneficiaryTaxId}</small></td>
                        <td><span>{payable.document || "—"}</span><small>{[payable.installment_label, origin].filter(Boolean).join(" · ")}</small></td>
                        <td>{dateBR(payable.due_date)}</td>
                        <td><strong>{money(payable.amount)}</strong><small>Saldo: {money(openTitleAmount(payable))}</small>{Number(payable.finance_cash_pending)>0?<small>Caixa aguardando reapropriação: {money(payable.finance_cash_pending)}</small>:null}</td>
                        <td><span className={`status-badge ${payable.status}`}>{titleStatusLabel(payable)}</span></td>
                        <td><span>{payable.paid_at ? dateBR(payable.paid_at) : "—"}</span><small>{payable.paid_at ? `${money(payable.paid_amount ?? payable.amount)}${payable.paid_account_name ? ` · ${payable.paid_account_name}` : ""}` : ""}</small></td>
                        <td>
                          <details><summary>Histórico de liquidações</summary>{historyResult.data.filter(h=>h.title_id===payable.id).map(h=>{
                            const event=relatedOne(h.finance_settlement_events);if(!event)return null;
                            const reversed=historyResult.data.some(other=>relatedOne(other.finance_settlement_events)?.reversal_of===event.id);
                            return <div key={h.id}><strong>{event.kind==='reversal'?'Estorno':'Liquidação'} · {dateBR(event.effective_date)}</strong><small>Principal {money(h.principal)} · Juros {money(h.interest)} · Desconto {money(h.discount)} · Sem caixa {money(h.noncash)}</small>{Number(h.excess_credit)>0?<small>Crédito identificado: {money(h.excess_credit)} · {h.credit_class}</small>:null}<small>{event.reason} · Autor: {event.created_by} · Registro: {new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Sao_Paulo"}).format(new Date(event.created_at))}</small>
                            {canManage&&event.kind!=='reversal'&&!reversed?<details><summary>Estornar evento (inclui títulos agrupados)</summary><form action={reversePayableSettlement}>
                            <input type="hidden" name="event_id" value={event.id}/><input type="hidden" name="command_id" value={crypto.randomUUID()}/>
                            <label>Data<input name="effective_date" type="date" defaultValue={today} required/></label><label>Motivo<input name="reason" minLength={5} required/></label>
                            <label>Condição do desconto<select name="discount_decision" required><option value="">Selecione conforme o documento</option><option value="keep">Manter desconto</option><option value="revoke">Revogar desconto</option></select></label>
                            <label>Devolução bancária comprovada (zero se não houve)<input name="refund_amount" defaultValue="0.00" required/></label><label>Evidência da devolução<input name="evidence"/></label><button type="submit">Registrar estorno</button>
                            </form></details>:null}</div>;
                          })}</details>
                          {canManage && payable.status === "open" ? (
                            <div className="payable-actions">
                              <details>
                                <summary>Baixar</summary>
                                <form action={markPayablePaid}>
                                  <input type="hidden" name="payable_id" value={payable.id} /><input type="hidden" name="command_id" value={crypto.randomUUID()} />
                                  <label>Data<input name="paid_at" type="date" defaultValue={today} required /></label>
                                  <label>Valor<input name="paid_amount" defaultValue={openPrincipalTitleAmount(payable).toFixed(2)} required /></label>
                                  <label>Conta<select name="bank_account_id" required><option value="">Selecione</option>{bankAccounts.map(account=><option key={account.id} value={account.id}>{account.label}</option>)}</select></label>
                                  <label>Juros liquidados<input name="interest_amount" defaultValue="0.00" /></label><label>Desconto<input name="discount_amount" defaultValue="0.00" /></label><label>Documento do desconto<input name="evidence" /></label><label>Motivo<input name="reason" minLength={5} defaultValue="Pagamento de título" required /></label>
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
                {page > 1 ? <Link prefetch={false} href={`?${paginationQuery}&page=${page - 1}`}>Anterior</Link> : null}
                {page < totalPages ? <Link prefetch={false} href={`?${paginationQuery}&page=${page + 1}`}>Próxima</Link> : null}
              </div>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
