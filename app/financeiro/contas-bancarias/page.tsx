import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { DateRangeFilter } from "@/components/date-range-filter";
import { resolveDateRange } from "@/lib/date-range";
import { requireCompanyPermission } from "@/lib/workspace";
import { cancelBankTransaction, reconcileBankTransaction } from "./actions";
import { BankAccountDialog, BankTransactionDialog, BankTransferDialog, type BankAccountOption, type BankLegalEntityOption, type BankProjectOption } from "./bank-account-dialogs";

const PAGE_SIZE = 60;

type LegalEntityRelation = { id: string; legal_name: string; trade_name: string | null; cnpj: string | null };
type ProjectRelation = { id: string; name: string; code: string | null };
type AccountRecord = Omit<BankAccountOption, "balance"> & { legal_entities: LegalEntityRelation | LegalEntityRelation[] | null };
type TransactionRecord = {
  id: string;
  project_id: string | null;
  bank_account_id: string;
  transaction_date: string;
  competence_date: string | null;
  direction: "credit" | "debit";
  transaction_type: string;
  description: string;
  document: string | null;
  counterparty: string | null;
  amount: number;
  status: "posted" | "reconciled" | "cancelled";
  reconciliation_date: string | null;
  reconciliation_reference: string | null;
  payable_id: string | null;
  receivable_id: string | null;
  transfer_id: string | null;
  notes: string | null;
  finance_bank_accounts: { id: string; label: string } | { id: string; label: string }[] | null;
  projects: ProjectRelation | ProjectRelation[] | null;
};
type Summary = { account_count: number; active_count: number; total_balance: number; default_account_count: number; unreconciled_count: number };

const accountTypeLabels: Record<string, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  payment: "Conta de pagamento",
  investment: "Aplicação",
  cash: "Caixa físico",
};
const transactionTypeLabels: Record<string, string> = {
  opening: "Saldo inicial",
  receipt: "Recebimento",
  payment: "Pagamento",
  transfer: "Transferência",
  fee: "Tarifa",
  tax: "Tributo",
  interest: "Rendimento",
  adjustment: "Ajuste",
  refund: "Estorno / devolução",
  other: "Outro",
};

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}
function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}
function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}
function accountNumber(account: AccountRecord | BankAccountOption) {
  const number = `${account.account_number}${account.account_digit ? `-${account.account_digit}` : ""}`;
  return `${account.agency ? `Ag. ${account.agency} · ` : ""}Conta ${number}`;
}

export default async function BankAccountsPage({ searchParams }: {
  searchParams: Promise<{ q?: string; account?: string; project?: string; direction?: string; status?: string; period?: string; from?: string; to?: string; page?: string; error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("finance.bank_accounts.view");
  const queryText = (params.q ?? "").trim();
  const accountId = params.account ?? "";
  const direction = ["credit", "debit"].includes(params.direction ?? "") ? params.direction! : "";
  const status = ["posted", "reconciled", "cancelled"].includes(params.status ?? "") ? params.status! : "";
  const transactionProjectId = params.project === "all" ? "" : (params.project ?? projectId ?? "");
  const dateRange = resolveDateRange(params.period, params.from, params.to);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const fromRow = (page - 1) * PAGE_SIZE;
  const toRow = fromRow + PAGE_SIZE - 1;

  const [accountsResult, legalEntitiesResult, projectsResult, summaryResult, manageResult, transferResult, reconcileResult] = await Promise.all([
    supabase.from("finance_bank_accounts").select("id,legal_entity_id,label,bank_code,bank_name,agency,account_number,account_digit,account_type,pix_key,opening_balance,opening_balance_date,allow_negative,is_default,status,notes,legal_entities(id,legal_name,trade_name,cnpj)").eq("company_id", companyId).order("status").order("is_default", { ascending: false }).order("label"),
    supabase.from("legal_entities").select("id,legal_name,trade_name,cnpj").eq("company_id", companyId).eq("status", "active").order("legal_name"),
    supabase.from("projects").select("id,name,code,legal_entity_id").eq("company_id", companyId).neq("status", "archived").order("name"),
    supabase.rpc("finance_bank_accounts_summary", { p_company_id: companyId, p_project_id: transactionProjectId || null }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "finance.bank_accounts.manage" }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "finance.bank_accounts.transfer" }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "finance.bank_accounts.reconcile" }),
  ]);

  const schemaMissing = accountsResult.error?.code === "42P01" || accountsResult.error?.message.includes("finance_bank_accounts");
  const accountRows = (accountsResult.data ?? []) as unknown as AccountRecord[];
  const legalEntities = (legalEntitiesResult.data ?? []) as BankLegalEntityOption[];
  const projects = (projectsResult.data ?? []) as BankProjectOption[];
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const canTransfer = transferResult.data === true || roleKey === "owner" || roleKey === "admin";
  const canReconcile = reconcileResult.data === true || roleKey === "owner" || roleKey === "admin";

  const balances = schemaMissing ? [] : await Promise.all(accountRows.map(async (account) => {
    const result = await supabase.rpc("finance_bank_account_balance", { p_account_id: account.id, p_until_date: null });
    return [account.id, Number(result.data ?? account.opening_balance)] as const;
  }));
  const balanceMap = new Map(balances);
  const accounts: BankAccountOption[] = accountRows.map((account) => ({ ...account, balance: balanceMap.get(account.id) ?? Number(account.opening_balance) }));
  const summary = (summaryResult.data ?? { account_count: accounts.length, active_count: accounts.filter((account) => account.status === "active").length, total_balance: accounts.reduce((sum, account) => sum + account.balance, 0), default_account_count: 0, unreconciled_count: 0 }) as Summary;

  let transactionsQuery = supabase
    .from("finance_bank_transactions")
    .select("id,project_id,bank_account_id,transaction_date,competence_date,direction,transaction_type,description,document,counterparty,amount,status,reconciliation_date,reconciliation_reference,payable_id,receivable_id,transfer_id,notes,finance_bank_accounts(id,label),projects(id,name,code)", { count: "exact" })
    .eq("company_id", companyId)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(fromRow, toRow);
  if (accountId) transactionsQuery = transactionsQuery.eq("bank_account_id", accountId);
  if (transactionProjectId) transactionsQuery = transactionsQuery.eq("project_id", transactionProjectId);
  if (direction) transactionsQuery = transactionsQuery.eq("direction", direction);
  if (status) transactionsQuery = transactionsQuery.eq("status", status);
  if (dateRange.from) transactionsQuery = transactionsQuery.gte("transaction_date", dateRange.from);
  if (dateRange.to) transactionsQuery = transactionsQuery.lte("transaction_date", dateRange.to);
  if (queryText) {
    const safe = queryText.replace(/[,%()]/g, " ").trim();
    transactionsQuery = transactionsQuery.or(`description.ilike.%${safe}%,document.ilike.%${safe}%,counterparty.ilike.%${safe}%,notes.ilike.%${safe}%`);
  }

  let totalsQuery = supabase.from("finance_bank_transactions").select("direction,amount,status").eq("company_id", companyId).neq("status", "cancelled").limit(10000);
  if (accountId) totalsQuery = totalsQuery.eq("bank_account_id", accountId);
  if (transactionProjectId) totalsQuery = totalsQuery.eq("project_id", transactionProjectId);
  if (direction) totalsQuery = totalsQuery.eq("direction", direction);
  if (dateRange.from) totalsQuery = totalsQuery.gte("transaction_date", dateRange.from);
  if (dateRange.to) totalsQuery = totalsQuery.lte("transaction_date", dateRange.to);

  const [transactionsResult, totalsResult] = schemaMissing ? [{ data: [], count: 0, error: null }, { data: [], error: null }] : await Promise.all([transactionsQuery, totalsQuery]);
  const transactions = (transactionsResult.data ?? []) as unknown as TransactionRecord[];
  const periodRows = (totalsResult.data ?? []) as { direction: "credit" | "debit"; amount: number; status: string }[];
  const periodCredits = periodRows.filter((row) => row.direction === "credit").reduce((sum, row) => sum + Number(row.amount), 0);
  const periodDebits = periodRows.filter((row) => row.direction === "debit").reduce((sum, row) => sum + Number(row.amount), 0);
  const totalPages = Math.max(1, Math.ceil((transactionsResult.count ?? 0) / PAGE_SIZE));
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const paginationQuery = `q=${encodeURIComponent(queryText)}&account=${accountId}&project=${params.project ?? ""}&direction=${direction}&status=${status}&period=${dateRange.preset}&from=${dateRange.from}&to=${dateRange.to}`;

  return <AppShell
    activeGroup="finance"
    activeItem="bank-accounts"
    eyebrow="Financeiro"
    title="Contas Bancárias"
    description={`${company.name} · carteira de contas, saldos, movimentações, transferências e conciliações.`}
    actions={<>
      {canManage ? <BankAccountDialog legalEntities={legalEntities} /> : null}
      <BankTransactionDialog accounts={accounts} projects={projects} activeProjectId={projectId} canManage={canManage} />
      <BankTransferDialog accounts={accounts} projects={projects} activeProjectId={projectId} canTransfer={canTransfer} />
    </>}
  >
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

    {schemaMissing ? <section className="setup-panel"><span>Banco de dados pendente</span><h2>Instale a estrutura de contas bancárias</h2><p>Execute a migration <code>20260729_0048_finance_bank_accounts.sql</code>.</p></section> : <>
      <section className="bank-summary-grid">
        <article><span>Saldo total</span><strong className={Number(summary.total_balance) < 0 ? "negative" : ""}>{money(summary.total_balance)}</strong><small>{summary.active_count} conta(s) ativa(s)</small></article>
        <article><span>Entradas no período</span><strong>{money(periodCredits)}</strong><small>movimentações do filtro</small></article>
        <article><span>Saídas no período</span><strong>{money(periodDebits)}</strong><small>movimentações do filtro</small></article>
        <article><span>A conciliar</span><strong>{summary.unreconciled_count}</strong><small>lançamentos ainda conferidos apenas no sistema</small></article>
      </section>

      <section className="bank-account-grid">
        {accounts.map((account) => {
          const entity = relatedOne(accountRows.find((row) => row.id === account.id)?.legal_entities ?? null);
          return <article key={account.id} className={`bank-account-card ${account.status} ${accountId === account.id ? "selected" : ""}`}>
            <div className="bank-account-card-head"><div><span>{account.bank_code ? `${account.bank_code} · ` : ""}{account.bank_name}</span><h2>{account.label}</h2></div><div className="bank-account-flags">{account.is_default ? <b>Padrão</b> : null}<em>{account.status === "active" ? "Ativa" : "Inativa"}</em></div></div>
            <p>{accountNumber(account)} · {accountTypeLabels[account.account_type] || account.account_type}</p>
            <small>{entity ? entity.trade_name || entity.legal_name : "Conta corporativa"}{account.pix_key ? ` · PIX ${account.pix_key}` : ""}</small>
            <div className="bank-account-balance"><span>Saldo atual</span><strong className={account.balance < 0 ? "negative" : ""}>{money(account.balance)}</strong></div>
            <div className="bank-account-card-actions"><Link href={`?account=${account.id}&project=${params.project ?? ""}&period=${dateRange.preset}&from=${dateRange.from}&to=${dateRange.to}`}>Ver extrato</Link>{canManage ? <BankAccountDialog legalEntities={legalEntities} initial={account} /> : null}</div>
          </article>;
        })}
        {!accounts.length ? <article className="bank-empty-account"><span>Primeira conta</span><h2>Cadastre a conta bancária da empresa ou SPE</h2><p>Depois do cadastro, pagamentos e recebimentos passam a atualizar o extrato automaticamente.</p>{canManage ? <BankAccountDialog legalEntities={legalEntities} label="Cadastrar primeira conta" /> : null}</article> : null}
      </section>

      <section className="registry-toolbar bank-toolbar">
        <form method="get" className="bank-filter">
          <input name="q" defaultValue={queryText} placeholder="Descrição, documento, favorecido ou observação" />
          <select name="account" defaultValue={accountId}><option value="">Todas as contas</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}</select>
          <select name="project" defaultValue={transactionProjectId || "all"}><option value="all">Todos os empreendimentos</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ""}{project.name}</option>)}</select>
          <select name="direction" defaultValue={direction}><option value="">Entradas e saídas</option><option value="credit">Entradas</option><option value="debit">Saídas</option></select>
          <select name="status" defaultValue={status}><option value="">Todos os status</option><option value="posted">A conciliar</option><option value="reconciled">Conciliadas</option><option value="cancelled">Canceladas</option></select>
          <DateRangeFilter defaultPreset={dateRange.preset} defaultFrom={dateRange.from} defaultTo={dateRange.to} />
          <button type="submit">Filtrar</button><Link href="/financeiro/contas-bancarias">Limpar</Link>
        </form>
      </section>

      <section className="registry-table-panel bank-statement-panel">
        <div className="section-heading"><div><span>Extrato financeiro</span><h2>{selectedAccount ? selectedAccount.label : "Movimentações bancárias"}</h2></div><p>{transactionsResult.count ?? 0} lançamento(s) no filtro atual.</p></div>
        <div className="registry-table-wrap"><table className="registry-table bank-statement-table"><thead><tr><th>Data</th><th>Conta</th><th>Descrição</th><th>Empreendimento</th><th>Tipo</th><th>Status</th><th>Entrada</th><th>Saída</th><th>Ações</th></tr></thead><tbody>
          {transactions.map((transaction) => {
            const account = relatedOne(transaction.finance_bank_accounts);
            const project = relatedOne(transaction.projects);
            return <tr key={transaction.id} className={transaction.status === "cancelled" ? "cancelled" : ""}>
              <td><strong>{dateBR(transaction.transaction_date)}</strong><small>{transaction.competence_date ? `Comp. ${dateBR(transaction.competence_date)}` : ""}</small></td>
              <td><strong>{account?.label || "Conta"}</strong></td>
              <td><strong>{transaction.description}</strong><span>{transaction.counterparty || ""}</span><small>{[transaction.document, transaction.notes].filter(Boolean).join(" · ")}</small></td>
              <td>{project ? <><strong>{project.code || "Obra"}</strong><small>{project.name}</small></> : <span>Corporativo</span>}</td>
              <td><span>{transactionTypeLabels[transaction.transaction_type] || transaction.transaction_type}</span>{transaction.payable_id ? <small>Contas a Pagar</small> : transaction.receivable_id ? <small>Contas a Receber</small> : transaction.transfer_id ? <small>Transferência vinculada</small> : null}</td>
              <td><span className={`bank-status ${transaction.status}`}>{transaction.status === "posted" ? "A conciliar" : transaction.status === "reconciled" ? "Conciliada" : "Cancelada"}</span><small>{transaction.reconciliation_date ? `${dateBR(transaction.reconciliation_date)}${transaction.reconciliation_reference ? ` · ${transaction.reconciliation_reference}` : ""}` : ""}</small></td>
              <td className="money credit">{transaction.direction === "credit" ? money(transaction.amount) : "—"}</td>
              <td className="money debit">{transaction.direction === "debit" ? money(transaction.amount) : "—"}</td>
              <td>{canReconcile && transaction.status === "posted" ? <div className="bank-row-actions"><details><summary>Conciliar</summary><form action={reconcileBankTransaction}><input type="hidden" name="transaction_id" value={transaction.id} /><input type="hidden" name="account_id" value={transaction.bank_account_id} /><label>Data<input name="reconciliation_date" type="date" defaultValue={today} required /></label><label>Referência<input name="reference" placeholder="Ex.: linha do extrato" /></label><button type="submit">Confirmar</button></form></details>{!transaction.payable_id && !transaction.receivable_id ? <details><summary>Cancelar</summary><form action={cancelBankTransaction}><input type="hidden" name="transaction_id" value={transaction.id} /><input type="hidden" name="account_id" value={transaction.bank_account_id} /><label>Motivo<textarea name="reason" rows={2} required /></label><button className="danger" type="submit">Cancelar lançamento</button></form></details> : null}</div> : <span>—</span>}</td>
            </tr>;
          })}
          {!transactions.length ? <tr><td colSpan={9} className="empty-table">Nenhuma movimentação encontrada.</td></tr> : null}
        </tbody></table></div>
        <div className="registry-pagination"><span>Página {page} de {totalPages}</span><div>{page > 1 ? <Link href={`?${paginationQuery}&page=${page - 1}`}>Anterior</Link> : null}{page < totalPages ? <Link href={`?${paginationQuery}&page=${page + 1}`}>Próxima</Link> : null}</div></div>
      </section>
    </>}
  </AppShell>;
}
