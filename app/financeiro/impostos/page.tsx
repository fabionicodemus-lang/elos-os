import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { cancelTaxObligation, generateTaxPayable, saveTaxObligation, saveTaxType } from "./actions";

const PAGE_SIZE = 50;

type SimpleRelation = { id: string; name?: string; code?: string | null; legal_name?: string; trade_name?: string | null };
type SupplierOption = { id: string; legal_name: string; trade_name: string | null };
type ProjectOption = { id: string; name: string; code: string | null; legal_entity_id: string | null };
type LegalEntityOption = { id: string; legal_name: string; trade_name: string | null };
type TaxType = {
  id: string;
  code: string;
  name: string;
  jurisdiction: string;
  calculation_method: string;
  default_rate: number;
  due_day: number | null;
  supplier_id: string | null;
  status: "active" | "inactive";
  notes: string | null;
  suppliers: SupplierOption | SupplierOption[] | null;
};
type TaxObligation = {
  id: string;
  project_id: string | null;
  legal_entity_id: string | null;
  tax_type_id: string;
  supplier_id: string;
  competence: string;
  due_date: string;
  principal_amount: number;
  penalty_amount: number;
  interest_amount: number;
  other_amount: number;
  total_amount: number;
  document_number: string | null;
  barcode: string | null;
  source_type: string;
  source_id: string | null;
  status: "draft" | "open" | "paid" | "cancelled";
  payable_id: string | null;
  paid_at: string | null;
  notes: string | null;
  cancellation_reason: string | null;
  finance_tax_types: { id: string; code: string; name: string; jurisdiction: string } | { id: string; code: string; name: string; jurisdiction: string }[] | null;
  suppliers: SupplierOption | SupplierOption[] | null;
  projects: SimpleRelation | SimpleRelation[] | null;
  legal_entities: SimpleRelation | SimpleRelation[] | null;
  payables: { id: string; status: string; paid_at: string | null } | { id: string; status: string; paid_at: string | null }[] | null;
};

const jurisdictionLabels: Record<string, string> = {
  federal: "Federal",
  state: "Estadual",
  municipal: "Municipal",
  labor: "Trabalhista / previdenciário",
  other: "Outros",
};

const methodLabels: Record<string, string> = {
  manual: "Valor informado",
  percentage: "Percentual",
  withholding: "Retenção",
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

function supplierName(supplier: SupplierOption | null) {
  return supplier?.trade_name || supplier?.legal_name || "—";
}

function statusInfo(row: TaxObligation, today: string) {
  if (row.status === "cancelled") return { key: "cancelled", label: "Cancelada" };
  if (row.status === "paid") return { key: "paid", label: "Paga" };
  if (row.status === "open" && row.due_date < today) return { key: "overdue", label: "Vencida" };
  if (row.status === "open") return { key: "open", label: "No Contas a Pagar" };
  return { key: "draft", label: "Em preparação" };
}

export default async function TaxesPage({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string; jurisdiction?: string; project?: string; page?: string; error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("finance.taxes.view");
  const queryText = (params.q ?? "").trim();
  const status = ["draft", "open", "paid", "overdue", "cancelled"].includes(params.status ?? "") ? params.status! : "";
  const jurisdiction = Object.keys(jurisdictionLabels).includes(params.jurisdiction ?? "") ? params.jurisdiction! : "";
  const selectedProjectId = params.project === "all" ? "" : (params.project ?? projectId ?? "");
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const today = new Date().toISOString().slice(0, 10);

  const [taxTypesResult, projectsResult, legalEntitiesResult, suppliersResult, manageResult, approveResult, cancelResult] = await Promise.all([
    supabase.from("finance_tax_types").select("id,code,name,jurisdiction,calculation_method,default_rate,due_day,supplier_id,status,notes,suppliers(id,legal_name,trade_name)").eq("company_id", companyId).order("status").order("jurisdiction").order("name"),
    supabase.from("projects").select("id,name,code,legal_entity_id").eq("company_id", companyId).neq("status", "archived").order("name"),
    supabase.from("legal_entities").select("id,legal_name,trade_name").eq("company_id", companyId).eq("status", "active").order("legal_name"),
    supabase.from("suppliers").select("id,legal_name,trade_name").eq("company_id", companyId).eq("status", "active").order("legal_name"),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "finance.taxes.manage" }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "finance.taxes.approve" }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "finance.taxes.cancel" }),
  ]);

  const schemaMissing = taxTypesResult.error?.code === "42P01" || Boolean(taxTypesResult.error?.message.includes("finance_tax_types"));
  const taxTypes = (taxTypesResult.data ?? []) as unknown as TaxType[];
  const projects = (projectsResult.data ?? []) as ProjectOption[];
  const legalEntities = (legalEntitiesResult.data ?? []) as LegalEntityOption[];
  const suppliers = (suppliersResult.data ?? []) as SupplierOption[];
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const canApprove = approveResult.data === true || roleKey === "owner" || roleKey === "admin";
  const canCancel = cancelResult.data === true || roleKey === "owner" || roleKey === "admin";

  let obligationsQuery = supabase
    .from("finance_tax_obligations")
    .select("id,project_id,legal_entity_id,tax_type_id,supplier_id,competence,due_date,principal_amount,penalty_amount,interest_amount,other_amount,total_amount,document_number,barcode,source_type,source_id,status,payable_id,paid_at,notes,cancellation_reason,finance_tax_types(id,code,name,jurisdiction),suppliers(id,legal_name,trade_name),projects(id,name,code),legal_entities(id,legal_name,trade_name),payables(id,status,paid_at)", { count: "exact" })
    .eq("company_id", companyId)
    .order("due_date", { ascending: true })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (selectedProjectId) obligationsQuery = obligationsQuery.eq("project_id", selectedProjectId);
  if (status && status !== "overdue") obligationsQuery = obligationsQuery.eq("status", status);
  if (status === "overdue") obligationsQuery = obligationsQuery.eq("status", "open").lt("due_date", today);
  if (jurisdiction) obligationsQuery = obligationsQuery.eq("finance_tax_types.jurisdiction", jurisdiction);
  if (queryText) {
    const safe = queryText.replace(/[,%()]/g, " ").trim();
    obligationsQuery = obligationsQuery.or(`document_number.ilike.%${safe}%,barcode.ilike.%${safe}%,notes.ilike.%${safe}%`);
  }

  const summaryQuery = supabase.from("finance_tax_obligations").select("status,due_date,total_amount").eq("company_id", companyId).limit(10000);
  const [obligationsResult, summaryResult] = schemaMissing
    ? [{ data: [], count: 0, error: null }, { data: [], error: null }]
    : await Promise.all([obligationsQuery, summaryQuery]);

  const obligations = (obligationsResult.data ?? []) as unknown as TaxObligation[];
  const summaryRows = (summaryResult.data ?? []) as { status: string; due_date: string; total_amount: number }[];
  const openRows = summaryRows.filter((row) => row.status === "open");
  const dueSoonLimit = new Date();
  dueSoonLimit.setDate(dueSoonLimit.getDate() + 7);
  const dueSoonDate = dueSoonLimit.toISOString().slice(0, 10);
  const openAmount = openRows.reduce((sum, row) => sum + Number(row.total_amount), 0);
  const overdueAmount = openRows.filter((row) => row.due_date < today).reduce((sum, row) => sum + Number(row.total_amount), 0);
  const dueSoonAmount = openRows.filter((row) => row.due_date >= today && row.due_date <= dueSoonDate).reduce((sum, row) => sum + Number(row.total_amount), 0);
  const draftAmount = summaryRows.filter((row) => row.status === "draft").reduce((sum, row) => sum + Number(row.total_amount), 0);
  const totalPages = Math.max(1, Math.ceil((obligationsResult.count ?? 0) / PAGE_SIZE));
  const paginationQuery = `q=${encodeURIComponent(queryText)}&status=${status}&jurisdiction=${jurisdiction}&project=${params.project ?? ""}`;
  const defaultProject = projects.find((project) => project.id === selectedProjectId) ?? projects.find((project) => project.id === projectId) ?? projects[0] ?? null;
  const defaultEntityId = defaultProject?.legal_entity_id ?? legalEntities[0]?.id ?? "";
  const activeTaxTypes = taxTypes.filter((item) => item.status === "active");

  return <AppShell
    activeGroup="finance"
    activeItem="taxes"
    eyebrow="Financeiro"
    title="Impostos"
    description={`${company.name} · cadastro fiscal, agenda de obrigações e integração com o Contas a Pagar.`}
    actions={canManage && !schemaMissing ? <details className="tax-action-menu"><summary className="elos-button">+ Nova obrigação</summary><div className="tax-action-popover"><TaxObligationForm taxTypes={activeTaxTypes} suppliers={suppliers} projects={projects} legalEntities={legalEntities} defaultProjectId={defaultProject?.id ?? ""} defaultEntityId={defaultEntityId} /></div></details> : null}
  >
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

    {schemaMissing ? <section className="setup-panel"><span>Banco de dados pendente</span><h2>Instale a estrutura de impostos</h2><p>Execute a migration <code>20260729_0050_finance_taxes.sql</code>. O menu e a tela já estão preparados.</p></section> : <>
      <section className="tax-summary-grid">
        <article><span>Em aberto</span><strong>{money(openAmount)}</strong><small>{openRows.length} obrigação(ões) no Contas a Pagar</small></article>
        <article className={overdueAmount > 0 ? "attention" : ""}><span>Vencido</span><strong>{money(overdueAmount)}</strong><small>exige regularização imediata</small></article>
        <article><span>Próximos 7 dias</span><strong>{money(dueSoonAmount)}</strong><small>guias com vencimento próximo</small></article>
        <article><span>Em preparação</span><strong>{money(draftAmount)}</strong><small>ainda não enviado ao Contas a Pagar</small></article>
      </section>

      <section className="registry-toolbar tax-toolbar">
        <form method="get" className="tax-filter">
          <input name="q" defaultValue={queryText} placeholder="Documento, código de barras ou observação" />
          <select name="project" defaultValue={selectedProjectId || "all"}><option value="all">Todos os empreendimentos</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ""}{project.name}</option>)}</select>
          <select name="jurisdiction" defaultValue={jurisdiction}><option value="">Todas as esferas</option>{Object.entries(jurisdictionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          <select name="status" defaultValue={status}><option value="">Todos os status</option><option value="draft">Em preparação</option><option value="open">No Contas a Pagar</option><option value="overdue">Vencidas</option><option value="paid">Pagas</option><option value="cancelled">Canceladas</option></select>
          <button type="submit">Filtrar</button><Link href="/financeiro/impostos">Limpar</Link>
        </form>
      </section>

      <section className="registry-table-panel tax-obligations-panel">
        <div className="section-heading"><div><span>Agenda fiscal</span><h2>Obrigações e guias</h2></div><p>{obligationsResult.count ?? 0} registro(s) no filtro atual.</p></div>
        <div className="registry-table-wrap"><table className="registry-table tax-table"><thead><tr><th>Tributo</th><th>Competência</th><th>Vencimento</th><th>Empresa / obra</th><th>Beneficiário</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead><tbody>
          {obligations.map((row) => {
            const taxType = relatedOne(row.finance_tax_types);
            const supplier = relatedOne(row.suppliers);
            const project = relatedOne(row.projects);
            const entity = relatedOne(row.legal_entities);
            const payable = relatedOne(row.payables);
            const statusData = statusInfo(row, today);
            return <tr key={row.id} className={statusData.key === "cancelled" ? "cancelled" : statusData.key === "overdue" ? "overdue" : ""}>
              <td><strong>{taxType?.code || "Tributo"}</strong><span>{taxType?.name || "—"}</span><small>{jurisdictionLabels[taxType?.jurisdiction || ""] || taxType?.jurisdiction || ""}</small></td>
              <td><strong>{competenceBR(row.competence)}</strong><small>{row.document_number || row.source_type}</small></td>
              <td><strong>{dateBR(row.due_date)}</strong>{statusData.key === "overdue" ? <small className="danger-text">Vencimento ultrapassado</small> : null}</td>
              <td><strong>{entity ? entity.trade_name || entity.legal_name : "Empresa"}</strong><small>{project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Corporativo"}</small></td>
              <td><strong>{supplierName(supplier)}</strong><small>{row.barcode ? "Guia com código cadastrado" : "Sem código de barras"}</small></td>
              <td className="money"><strong>{money(row.total_amount)}</strong><small>{row.penalty_amount + row.interest_amount > 0 ? `Multa/juros: ${money(row.penalty_amount + row.interest_amount)}` : "Sem acréscimos"}</small></td>
              <td><span className={`tax-status ${statusData.key}`}>{statusData.label}</span><small>{row.paid_at ? `Pago em ${dateBR(row.paid_at)}` : payable ? `Título ${payable.status}` : ""}</small></td>
              <td><div className="tax-row-actions">
                {canApprove && row.status === "draft" ? <form action={generateTaxPayable}><input type="hidden" name="obligation_id" value={row.id} /><button type="submit">Enviar para pagar</button></form> : null}
                {row.payable_id ? <Link href="/financeiro/contas-a-pagar">Abrir contas</Link> : null}
                {canCancel && row.status !== "paid" && row.status !== "cancelled" ? <details><summary>Cancelar</summary><form action={cancelTaxObligation}><input type="hidden" name="obligation_id" value={row.id} /><textarea name="reason" rows={2} placeholder="Motivo obrigatório" required /><button className="danger" type="submit">Confirmar cancelamento</button></form></details> : null}
              </div></td>
            </tr>;
          })}
          {!obligations.length ? <tr><td colSpan={8} className="empty-table">Nenhuma obrigação fiscal encontrada.</td></tr> : null}
        </tbody></table></div>
        <div className="registry-pagination"><span>Página {page} de {totalPages}</span><div>{page > 1 ? <Link href={`?${paginationQuery}&page=${page - 1}`}>Anterior</Link> : null}{page < totalPages ? <Link href={`?${paginationQuery}&page=${page + 1}`}>Próxima</Link> : null}</div></div>
      </section>

      <section className="tax-catalog-panel">
        <div className="section-heading"><div><span>Cadastro fiscal</span><h2>Tributos e regras internas</h2></div><p>O vencimento final permanece editável em cada obrigação.</p></div>
        <div className="tax-catalog-grid">
          {taxTypes.map((taxType) => <article key={taxType.id} className={taxType.status}>
            <div><span>{jurisdictionLabels[taxType.jurisdiction] || taxType.jurisdiction}</span><h3>{taxType.code} · {taxType.name}</h3></div>
            <p>{methodLabels[taxType.calculation_method] || taxType.calculation_method}{taxType.default_rate > 0 ? ` · ${Number(taxType.default_rate).toLocaleString("pt-BR")}%` : ""}</p>
            <small>{taxType.due_day ? `Referência interna: dia ${taxType.due_day}` : "Sem dia padrão definido"} · {supplierName(relatedOne(taxType.suppliers))}</small>
          </article>)}
          {!taxTypes.length ? <article className="tax-empty-card"><span>Cadastro inicial</span><h3>Crie os tributos usados pela empresa</h3><p>Ex.: ISS, INSS, IRRF, PIS, COFINS, CSLL, FGTS e tributos estaduais.</p></article> : null}
        </div>
        {canManage ? <details className="tax-catalog-form"><summary>{taxTypes.length ? "+ Cadastrar outro tributo" : "+ Cadastrar primeiro tributo"}</summary><TaxTypeForm suppliers={suppliers} /></details> : null}
      </section>
    </>}
  </AppShell>;
}

function TaxObligationForm({ taxTypes, suppliers, projects, legalEntities, defaultProjectId, defaultEntityId }: {
  taxTypes: TaxType[]; suppliers: SupplierOption[]; projects: ProjectOption[]; legalEntities: LegalEntityOption[]; defaultProjectId: string; defaultEntityId: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const competence = today.slice(0, 7);
  return <form action={saveTaxObligation} className="tax-form">
    <div className="tax-form-grid">
      <label>Tributo<select name="tax_type_id" required><option value="">Selecione</option>{taxTypes.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
      <label>Órgão / favorecido<select name="supplier_id" required><option value="">Selecione</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{supplierName(item)}</option>)}</select></label>
      <label>Empresa / SPE<select name="legal_entity_id" defaultValue={defaultEntityId} required><option value="">Selecione</option>{legalEntities.map((item) => <option key={item.id} value={item.id}>{item.trade_name || item.legal_name}</option>)}</select></label>
      <label>Empreendimento<select name="project_id" defaultValue={defaultProjectId}><option value="">Corporativo</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.code ? `${item.code} · ` : ""}{item.name}</option>)}</select></label>
      <label>Competência<input name="competence" type="month" defaultValue={competence} required /></label>
      <label>Vencimento<input name="due_date" type="date" defaultValue={today} required /></label>
      <label>Valor principal<input name="principal_amount" inputMode="decimal" placeholder="0,00" required /></label>
      <label>Multa<input name="penalty_amount" inputMode="decimal" defaultValue="0,00" /></label>
      <label>Juros<input name="interest_amount" inputMode="decimal" defaultValue="0,00" /></label>
      <label>Outros acréscimos<input name="other_amount" inputMode="decimal" defaultValue="0,00" /></label>
      <label>Nº da guia / documento<input name="document_number" /></label>
      <label>Código de barras<input name="barcode" /></label>
    </div>
    <label>Observações<textarea name="notes" rows={3} /></label>
    <div className="tax-form-footer"><small>A obrigação será criada em preparação. O envio ao Contas a Pagar exige aprovação.</small><button type="submit">Salvar obrigação</button></div>
  </form>;
}

function TaxTypeForm({ suppliers }: { suppliers: SupplierOption[] }) {
  return <form action={saveTaxType} className="tax-form tax-type-form">
    <div className="tax-form-grid">
      <label>Código<input name="code" placeholder="Ex.: ISS" required /></label>
      <label>Nome<input name="name" placeholder="Imposto Sobre Serviços" required /></label>
      <label>Esfera<select name="jurisdiction" defaultValue="federal" required>{Object.entries(jurisdictionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Forma de cálculo<select name="calculation_method" defaultValue="manual"><option value="manual">Valor informado</option><option value="percentage">Percentual</option><option value="withholding">Retenção</option></select></label>
      <label>Alíquota padrão (%)<input name="default_rate" inputMode="decimal" defaultValue="0" /></label>
      <label>Dia de referência<input name="due_day" type="number" min="1" max="31" placeholder="Opcional" /></label>
      <label>Órgão / favorecido<select name="supplier_id"><option value="">Definir por obrigação</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{supplierName(item)}</option>)}</select></label>
      <label>Status<select name="status" defaultValue="active"><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
    </div>
    <label>Observações<textarea name="notes" rows={2} /></label>
    <div className="tax-form-footer"><small>O dia informado é apenas uma referência interna e pode ser alterado na obrigação.</small><button type="submit">Salvar tributo</button></div>
  </form>;
}
