import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { DateRangeFilter } from "@/components/date-range-filter";
import { resolveDateRange } from "@/lib/date-range";
import { requireCompanyPermission } from "@/lib/workspace";
import { cancelTaxObligation, generateTaxPayable } from "./actions";
import {
  TaxObligationDialog,
  TaxTypeDialog,
  type TaxObligationData,
  type TaxProjectOption,
  type TaxSupplierOption,
  type TaxTypeOption,
} from "./tax-dialogs";

const PAGE_SIZE = 60;

const categoryLabels: Record<string, string> = {
  federal: "Federal",
  state: "Estadual",
  municipal: "Municipal",
  labor: "Trabalhista",
  social: "Previdenciário / social",
  property: "Patrimonial",
  other: "Outro",
};

const statusLabels: Record<string, string> = {
  scheduled: "Na agenda",
  payable_generated: "Conta gerada",
  paid: "Pago",
  cancelled: "Cancelado",
};

type SupplierRelation = { id: string; legal_name: string; trade_name: string | null; tax_id: string | null };
type ProjectRelation = { id: string; name: string; code: string | null };
type PayableRelation = { id: string; document: string | null; status: "open" | "paid" | "cancelled"; due_date: string; amount: number; paid_at: string | null; paid_amount: number | null };

type TaxTypeRecord = TaxTypeOption & {
  suppliers: SupplierRelation | SupplierRelation[] | null;
};

type TaxObligationRecord = TaxObligationData & {
  total_amount: number;
  status: "scheduled" | "payable_generated" | "paid" | "cancelled";
  payable_id: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  finance_tax_types: Pick<TaxTypeOption, "id" | "code" | "name" | "category"> | Pick<TaxTypeOption, "id" | "code" | "name" | "category">[] | null;
  projects: ProjectRelation | ProjectRelation[] | null;
  payables: PayableRelation | PayableRelation[] | null;
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

function competenceBR(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month] = value.slice(0, 7).split("-");
  return `${month}/${year}`;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function TaxesPage({ searchParams }: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    tax?: string;
    project?: string;
    period?: string;
    from?: string;
    to?: string;
    page?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("finance.taxes.view");
  const queryText = (params.q ?? "").trim();
  const status = ["scheduled", "payable_generated", "paid", "cancelled"].includes(params.status ?? "") ? params.status! : "";
  const taxTypeId = params.tax ?? "";
  const selectedProjectId = params.project === "all" ? "" : (params.project ?? projectId ?? "");
  const dateRange = resolveDateRange(params.period, params.from, params.to);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const fromRow = (page - 1) * PAGE_SIZE;
  const toRow = fromRow + PAGE_SIZE - 1;
  const today = new Date().toISOString().slice(0, 10);
  const next30 = addDays(today, 30);

  const [taxTypesResult, suppliersResult, projectsResult, manageResult] = await Promise.all([
    supabase
      .from("finance_tax_types")
      .select("id,code,name,category,authority_supplier_id,fiscal_class,payment_method,document_prefix,notes,status,suppliers(id,legal_name,trade_name,tax_id)")
      .eq("company_id", companyId)
      .order("status")
      .order("category")
      .order("code"),
    supabase.from("suppliers").select("id,legal_name,trade_name,tax_id").eq("company_id", companyId).eq("status", "active").order("legal_name").limit(2000),
    supabase.from("projects").select("id,name,code").eq("company_id", companyId).neq("status", "archived").order("name"),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "finance.taxes.manage" }),
  ]);

  const schemaMissing = taxTypesResult.error?.code === "42P01" || taxTypesResult.error?.message.includes("finance_tax_types");
  const taxTypeRecords = (taxTypesResult.data ?? []) as unknown as TaxTypeRecord[];
  const taxTypes: TaxTypeOption[] = taxTypeRecords.map(({ suppliers: _suppliers, ...item }) => item);
  const suppliers = (suppliersResult.data ?? []) as TaxSupplierOption[];
  const projects = (projectsResult.data ?? []) as TaxProjectOption[];
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";

  let obligationsQuery = supabase
    .from("finance_tax_obligations")
    .select("id,project_id,tax_type_id,competence_date,reference,due_date,principal_amount,interest_amount,penalty_amount,other_amount,discount_amount,total_amount,document_number,payment_code,barcode,notes,status,payable_id,paid_at,paid_amount,finance_tax_types(id,code,name,category),projects(id,name,code),payables(id,document,status,due_date,amount,paid_at,paid_amount)", { count: "exact" })
    .eq("company_id", companyId)
    .order("due_date")
    .order("created_at")
    .range(fromRow, toRow);

  if (selectedProjectId) obligationsQuery = obligationsQuery.eq("project_id", selectedProjectId);
  if (status) obligationsQuery = obligationsQuery.eq("status", status);
  if (taxTypeId) obligationsQuery = obligationsQuery.eq("tax_type_id", taxTypeId);
  if (dateRange.from) obligationsQuery = obligationsQuery.gte("due_date", dateRange.from);
  if (dateRange.to) obligationsQuery = obligationsQuery.lte("due_date", dateRange.to);
  if (queryText) {
    const safe = queryText.replace(/[,%()]/g, " ").trim();
    obligationsQuery = obligationsQuery.or(`reference.ilike.%${safe}%,document_number.ilike.%${safe}%,payment_code.ilike.%${safe}%,notes.ilike.%${safe}%`);
  }

  let summaryQuery = supabase
    .from("finance_tax_obligations")
    .select("status,due_date,total_amount,paid_amount")
    .eq("company_id", companyId)
    .limit(20000);
  if (selectedProjectId) summaryQuery = summaryQuery.eq("project_id", selectedProjectId);

  const [obligationsResult, summaryResult] = schemaMissing
    ? [{ data: [], count: 0, error: null }, { data: [], error: null }]
    : await Promise.all([obligationsQuery, summaryQuery]);

  const obligations = (obligationsResult.data ?? []) as unknown as TaxObligationRecord[];
  const summaryRows = (summaryResult.data ?? []) as { status: string; due_date: string; total_amount: number; paid_amount: number | null }[];
  const activeRows = summaryRows.filter((row) => row.status !== "cancelled");
  const scheduledAmount = summaryRows.filter((row) => row.status === "scheduled").reduce((sum, row) => sum + Number(row.total_amount), 0);
  const generatedAmount = summaryRows.filter((row) => row.status === "payable_generated").reduce((sum, row) => sum + Number(row.total_amount), 0);
  const paidAmount = summaryRows.filter((row) => row.status === "paid").reduce((sum, row) => sum + Number(row.paid_amount ?? row.total_amount), 0);
  const overdueRows = activeRows.filter((row) => ["scheduled", "payable_generated"].includes(row.status) && row.due_date < today);
  const nextRows = activeRows.filter((row) => ["scheduled", "payable_generated"].includes(row.status) && row.due_date >= today && row.due_date <= next30);
  const totalPages = Math.max(1, Math.ceil((obligationsResult.count ?? 0) / PAGE_SIZE));
  const contextProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const context = contextProject ? `${contextProject.code ? `${contextProject.code} · ` : ""}${contextProject.name}` : "Todos os empreendimentos";
  const paginationQuery = `q=${encodeURIComponent(queryText)}&status=${status}&tax=${taxTypeId}&project=${params.project ?? ""}&period=${dateRange.preset}&from=${dateRange.from}&to=${dateRange.to}`;

  return <AppShell
    activeGroup="finance"
    activeItem="taxes"
    eyebrow="Financeiro"
    title="Impostos"
    description={`${company.name} · ${context} · cadastro de tributos, agenda fiscal e integração com Contas a Pagar.`}
    actions={canManage ? <>
      <TaxTypeDialog suppliers={suppliers} />
      <TaxObligationDialog projects={projects} taxTypes={taxTypes} activeProjectId={projectId} />
    </> : undefined}
  >
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

    {schemaMissing ? <section className="setup-panel"><span>Banco de dados pendente</span><h2>Instale a estrutura de impostos</h2><p>Execute a migration <code>20260729_0050_finance_taxes.sql</code>.</p></section> : <>
      <section className="tax-summary-grid">
        <article><span>Na agenda</span><strong>{money(scheduledAmount)}</strong><small>obrigações ainda sem conta a pagar</small></article>
        <article><span>Contas geradas</span><strong>{money(generatedAmount)}</strong><small>aguardando baixa no Financeiro</small></article>
        <article><span>Pago</span><strong>{money(paidAmount)}</strong><small>histórico das obrigações baixadas</small></article>
        <article className={overdueRows.length ? "alert" : ""}><span>Vencidos</span><strong>{money(overdueRows.reduce((sum, row) => sum + Number(row.total_amount), 0))}</strong><small>{overdueRows.length} obrigação(ões)</small></article>
        <article><span>Próximos 30 dias</span><strong>{money(nextRows.reduce((sum, row) => sum + Number(row.total_amount), 0))}</strong><small>{nextRows.length} vencimento(s)</small></article>
      </section>

      <section className="tax-guidance-card">
        <div><span>Fluxo fiscal integrado</span><h2>A agenda controla a obrigação; o Contas a Pagar e o banco controlam o pagamento</h2><p>Cadastre cada tributo uma vez, informe a competência e o vencimento efetivo de cada guia e gere a conta a pagar quando estiver conferida. Após a baixa bancária, o status fiscal muda automaticamente para pago.</p></div>
        <div className="tax-guidance-flow">
          <article><b>1</b><span><strong>Tributo</strong><small>órgão, classe e forma</small></span></article>
          <article><b>2</b><span><strong>Obrigação</strong><small>competência e vencimento</small></span></article>
          <article><b>3</b><span><strong>Conta a pagar</strong><small>guia conferida e gerada</small></span></article>
          <article><b>4</b><span><strong>Baixa bancária</strong><small>status fiscal sincronizado</small></span></article>
        </div>
      </section>

      <section className="registry-toolbar tax-toolbar">
        <form method="get" className="tax-filter">
          <input name="q" defaultValue={queryText} placeholder="Documento, referência, código ou observação" />
          <select name="project" defaultValue={selectedProjectId || "all"}><option value="all">Todos os empreendimentos</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ""}{project.name}</option>)}</select>
          <select name="tax" defaultValue={taxTypeId}><option value="">Todos os tributos</option>{taxTypes.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select>
          <select name="status" defaultValue={status}><option value="">Todos os status</option>{Object.entries(statusLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
          <DateRangeFilter defaultPreset={dateRange.preset} defaultFrom={dateRange.from} defaultTo={dateRange.to} />
          <button type="submit">Filtrar</button>
          <Link href="/financeiro/impostos">Limpar</Link>
        </form>
      </section>

      <section className="tax-agenda-card">
        <div className="section-heading"><div><span>Agenda fiscal</span><h2>Obrigações e vencimentos</h2></div><p>{obligationsResult.count ?? 0} obrigação(ões) no filtro atual.</p></div>
        <div className="registry-table-wrap">
          <table className="registry-table tax-agenda-table">
            <thead><tr><th>Vencimento</th><th>Tributo</th><th>Empreendimento</th><th>Competência</th><th>Valores</th><th>Total</th><th>Status</th><th>Conta a pagar</th><th>Ações</th></tr></thead>
            <tbody>
              {obligations.map((obligation) => {
                const type = relatedOne(obligation.finance_tax_types);
                const project = relatedOne(obligation.projects);
                const payable = relatedOne(obligation.payables);
                const overdue = ["scheduled", "payable_generated"].includes(obligation.status) && obligation.due_date < today;
                return <tr key={obligation.id} className={overdue ? "tax-overdue-row" : obligation.status === "cancelled" ? "tax-cancelled-row" : ""}>
                  <td><strong>{dateBR(obligation.due_date)}</strong>{overdue ? <small className="tax-overdue-label">Vencido</small> : null}</td>
                  <td><strong>{type?.code ?? "—"}</strong><span>{type?.name ?? "Tributo indisponível"}</span><small>{type ? categoryLabels[type.category] ?? type.category : ""}</small></td>
                  <td><strong>{project?.code ?? "—"}</strong><span>{project?.name ?? "Empreendimento"}</span></td>
                  <td><strong>{competenceBR(obligation.competence_date)}</strong><span>{obligation.reference || "Sem referência complementar"}</span>{obligation.document_number ? <small>{obligation.document_number}</small> : null}</td>
                  <td><span>Principal {money(obligation.principal_amount)}</span><small>Juros {money(obligation.interest_amount)} · Multa {money(obligation.penalty_amount)}{Number(obligation.discount_amount) > 0 ? ` · Desc. ${money(obligation.discount_amount)}` : ""}</small></td>
                  <td><strong className="tax-total-value">{money(obligation.total_amount)}</strong></td>
                  <td><span className={`tax-status ${obligation.status}`}>{statusLabels[obligation.status]}</span>{obligation.status === "paid" ? <small>{dateBR(obligation.paid_at)} · {money(obligation.paid_amount ?? obligation.total_amount)}</small> : null}</td>
                  <td>{payable ? <><strong>{payable.document || "Título fiscal"}</strong><span>{payable.status === "open" ? "Em aberto" : payable.status === "paid" ? "Pago" : "Cancelado"}</span><small>{money(payable.amount)}</small></> : <span>—</span>}</td>
                  <td>
                    {canManage ? <div className="tax-row-actions">
                      {obligation.status === "scheduled" ? <TaxObligationDialog projects={projects} taxTypes={taxTypes} activeProjectId={projectId} initial={obligation} /> : null}
                      {obligation.status === "scheduled" ? <form action={generateTaxPayable}><input type="hidden" name="obligation_id" value={obligation.id} /><button className="table-action primary-action" type="submit" disabled={Number(obligation.total_amount) <= 0}>Gerar conta</button></form> : null}
                      {obligation.status === "scheduled" ? <form action={cancelTaxObligation}><input type="hidden" name="obligation_id" value={obligation.id} /><button className="table-action danger" type="submit">Cancelar</button></form> : null}
                      {obligation.status === "cancelled" ? <TaxObligationDialog projects={projects} taxTypes={taxTypes} activeProjectId={projectId} initial={obligation} label="Reativar" /> : null}
                      {obligation.status === "payable_generated" ? <Link className="table-action" href={`/financeiro/contas-a-pagar?q=${encodeURIComponent(payable?.document || type?.code || "")}`}>Abrir conta</Link> : null}
                    </div> : "—"}
                  </td>
                </tr>;
              })}
              {!obligations.length ? <tr><td className="empty-table" colSpan={9}>Nenhuma obrigação fiscal encontrada.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="registry-pagination"><span>Página {page} de {totalPages}</span><div>{page > 1 ? <Link href={`?${paginationQuery}&page=${page - 1}`}>Anterior</Link> : null}{page < totalPages ? <Link href={`?${paginationQuery}&page=${page + 1}`}>Próxima</Link> : null}</div></div>
      </section>

      <section className="tax-catalog-card">
        <div className="section-heading"><div><span>Cadastro fiscal</span><h2>Tributos disponíveis</h2></div><p>{taxTypes.filter((item) => item.status === "active").length} ativo(s) de {taxTypes.length} cadastrado(s).</p></div>
        <div className="tax-type-grid">
          {taxTypeRecords.map((item) => {
            const supplier = relatedOne(item.suppliers);
            return <article key={item.id} className={item.status}>
              <div className="tax-type-head"><span>{categoryLabels[item.category] ?? item.category}</span><b>{item.status === "active" ? "Ativo" : "Inativo"}</b></div>
              <h3>{item.code} · {item.name}</h3>
              <p>{supplier?.trade_name || supplier?.legal_name || "Órgão favorecido indisponível"}</p>
              <small>{item.fiscal_class || "Sem classe fiscal"}{item.payment_method ? ` · ${item.payment_method}` : ""}</small>
              <div>{canManage ? <TaxTypeDialog suppliers={suppliers} initial={item} /> : null}</div>
            </article>;
          })}
          {!taxTypes.length ? <article className="tax-empty-type"><span>Primeiro cadastro</span><h3>Cadastre os tributos utilizados pela empresa</h3><p>O cadastro define o órgão favorecido e os dados usados na geração das contas a pagar.</p>{canManage ? <TaxTypeDialog suppliers={suppliers} label="Cadastrar primeiro tributo" /> : null}</article> : null}
        </div>
      </section>
    </>}
  </AppShell>;
}
