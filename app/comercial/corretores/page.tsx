import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { DateRangeFilter } from "@/components/date-range-filter";
import { resolveDateRange } from "@/lib/date-range";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  generateCommissionPayable,
  saveBroker,
  saveCommission,
  setCommissionStatus,
} from "./actions";

const kindLabels: Record<string, string> = {
  broker: "Corretor",
  agency: "Imobiliária",
  manager: "Gestor comercial",
  partner: "Parceiro",
};

const roleLabels: Record<string, string> = {
  broker: "Corretor",
  agency: "Imobiliária",
  manager: "Gestor",
  referral: "Indicação",
  other: "Outro",
};

const commissionStatusLabels: Record<string, string> = {
  planned: "Planejada",
  approved: "Aprovada",
  payable_generated: "Conta gerada",
  paid: "Paga",
  cancelled: "Cancelada",
};

type Broker = {
  id: string;
  kind: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  creci_number: string | null;
  creci_state: string | null;
  agency_name: string | null;
  phone: string | null;
  email: string | null;
  pix_key: string | null;
  bank_name: string | null;
  bank_agency: string | null;
  bank_account: string | null;
  supplier_id: string | null;
  default_commission_pct: number;
  payment_due_days: number;
  status: "active" | "inactive";
  notes: string | null;
};

type Client = { name: string };
type Unit = { code: string };
type Sale = {
  id: string;
  number: string;
  sale_date: string;
  total_amount: number;
  broker_id: string | null;
  clients: Client | Client[] | null;
  units: Unit | Unit[] | null;
};
type Commission = {
  id: string;
  sale_id: string;
  broker_id: string;
  role: string;
  calculation_base: number;
  commission_pct: number;
  commission_amount: number;
  due_date: string;
  status: string;
  payable_id: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  notes: string | null;
  source_system: string;
  commercial_brokers: Pick<Broker, "id" | "name" | "kind" | "creci_number"> | Pick<Broker, "id" | "name" | "kind" | "creci_number">[] | null;
  sales: Sale | Sale[] | null;
};
type Summary = {
  broker_count: number;
  active_broker_count: number;
  planned_count: number;
  approved_count: number;
  generated_count: number;
  paid_count: number;
  pending_amount: number;
  approved_amount: number;
  payable_amount: number;
  paid_amount: number;
};

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

function decimal(value: number | null | undefined, digits = 2) {
  return Number(value ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function inputMoney(value: number | null | undefined) {
  return Number(value ?? 0).toFixed(2).replace(".", ",");
}

function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function BrokerFields({ broker }: { broker?: Broker }) {
  return <>
    <input type="hidden" name="broker_id" value={broker?.id ?? ""} />
    <div className="registry-form-grid broker-form-grid">
      <label>Tipo<select name="kind" defaultValue={broker?.kind ?? "broker"}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Nome comercial<input name="name" defaultValue={broker?.name ?? ""} required /></label>
      <label>Razão social / nome completo<input name="legal_name" defaultValue={broker?.legal_name ?? ""} /></label>
      <label>CPF / CNPJ<input name="tax_id" defaultValue={broker?.tax_id ?? ""} /></label>
      <label>CRECI<input name="creci_number" defaultValue={broker?.creci_number ?? ""} /></label>
      <label>UF do CRECI<input name="creci_state" maxLength={2} defaultValue={broker?.creci_state ?? "SC"} /></label>
      <label>Imobiliária vinculada<input name="agency_name" defaultValue={broker?.agency_name ?? ""} /></label>
      <label>Telefone<input name="phone" defaultValue={broker?.phone ?? ""} /></label>
      <label>E-mail<input name="email" type="email" defaultValue={broker?.email ?? ""} /></label>
      <label>Comissão padrão (%)<input name="default_commission_pct" inputMode="decimal" defaultValue={inputMoney(broker?.default_commission_pct)} /></label>
      <label>Prazo padrão após venda<input name="payment_due_days" type="number" min="0" max="3650" defaultValue={broker?.payment_due_days ?? 0} /></label>
      <label>Situação<select name="status" defaultValue={broker?.status ?? "active"}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
      <label>Chave PIX<input name="pix_key" defaultValue={broker?.pix_key ?? ""} /></label>
      <label>Banco<input name="bank_name" defaultValue={broker?.bank_name ?? ""} /></label>
      <label>Agência<input name="bank_agency" defaultValue={broker?.bank_agency ?? ""} /></label>
      <label>Conta<input name="bank_account" defaultValue={broker?.bank_account ?? ""} /></label>
      <label className="registry-wide">Observações<textarea name="notes" rows={3} defaultValue={broker?.notes ?? ""} /></label>
    </div>
  </>;
}

export default async function BrokersPage({ searchParams }: {
  searchParams: Promise<{
    q?: string;
    kind?: string;
    broker_status?: string;
    commission_status?: string;
    period?: string;
    from?: string;
    to?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("commercial.brokers.view");
  const queryText = (params.q ?? "").trim();
  const kind = Object.keys(kindLabels).includes(params.kind ?? "") ? params.kind! : "";
  const brokerStatus = ["active", "inactive"].includes(params.broker_status ?? "") ? params.broker_status! : "";
  const commissionStatus = Object.keys(commissionStatusLabels).includes(params.commission_status ?? "") ? params.commission_status! : "";
  const dateRange = resolveDateRange(params.period, params.from, params.to);

  const projectQuery = projectId
    ? supabase.from("projects").select("id,name,code").eq("id", projectId).eq("company_id", companyId).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  let brokersQuery = supabase
    .from("commercial_brokers")
    .select("id,kind,name,legal_name,tax_id,creci_number,creci_state,agency_name,phone,email,pix_key,bank_name,bank_agency,bank_account,supplier_id,default_commission_pct,payment_due_days,status,notes", { count: "exact" })
    .eq("company_id", companyId)
    .order("status")
    .order("name")
    .limit(1000);
  if (kind) brokersQuery = brokersQuery.eq("kind", kind);
  if (brokerStatus) brokersQuery = brokersQuery.eq("status", brokerStatus);
  if (queryText) {
    const safe = queryText.replace(/[,%()]/g, " ").trim();
    brokersQuery = brokersQuery.or(`name.ilike.%${safe}%,legal_name.ilike.%${safe}%,tax_id.ilike.%${safe}%,creci_number.ilike.%${safe}%,agency_name.ilike.%${safe}%`);
  }

  let commissionsQuery = supabase
    .from("commercial_sale_commissions")
    .select("id,sale_id,broker_id,role,calculation_base,commission_pct,commission_amount,due_date,status,payable_id,paid_at,paid_amount,notes,source_system,commercial_brokers(id,name,kind,creci_number),sales(id,number,sale_date,total_amount,broker_id,clients(name),units(code))", { count: "exact" })
    .eq("company_id", companyId)
    .order("due_date", { ascending: false })
    .limit(1000);
  if (projectId) commissionsQuery = commissionsQuery.eq("project_id", projectId);
  if (commissionStatus) commissionsQuery = commissionsQuery.eq("status", commissionStatus);
  if (dateRange.from) commissionsQuery = commissionsQuery.gte("due_date", dateRange.from);
  if (dateRange.to) commissionsQuery = commissionsQuery.lte("due_date", dateRange.to);

  let salesQuery = supabase
    .from("sales")
    .select("id,number,sale_date,total_amount,broker_id,clients(name),units(code)")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("sale_date", { ascending: false })
    .limit(1500);
  if (projectId) salesQuery = salesQuery.eq("project_id", projectId);

  const [projectResult, brokersResult, commissionsResult, salesResult, summaryResult, manageResult, approveResult, financeResult] = await Promise.all([
    projectQuery,
    brokersQuery,
    commissionsQuery,
    salesQuery,
    supabase.rpc("commercial_brokers_summary", { p_company_id: companyId, p_project_id: projectId }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "commercial.brokers.manage" }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "commercial.brokers.approve" }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "commercial.brokers.finance" }),
  ]);

  const schemaMissing = brokersResult.error?.code === "42P01" || commissionsResult.error?.message.includes("commercial_sale_commissions");
  const brokers = (brokersResult.data ?? []) as Broker[];
  const activeBrokers = brokers.filter((broker) => broker.status === "active");
  const commissions = (commissionsResult.data ?? []) as unknown as Commission[];
  const sales = (salesResult.data ?? []) as unknown as Sale[];
  const summary = (summaryResult.data ?? {
    broker_count: 0, active_broker_count: 0, planned_count: 0, approved_count: 0,
    generated_count: 0, paid_count: 0, pending_amount: 0, approved_amount: 0,
    payable_amount: 0, paid_amount: 0,
  }) as Summary;
  const privileged = roleKey === "owner" || roleKey === "admin";
  const canManage = manageResult.data === true || privileged;
  const canApprove = approveResult.data === true || privileged;
  const canFinance = financeResult.data === true || privileged;
  const project = projectResult.data;
  const today = new Date().toISOString().slice(0, 10);

  return <AppShell
    activeGroup="commercial"
    activeItem="brokers"
    eyebrow="Comercial"
    title="Corretores"
    description={`${company.name}${project ? ` · ${project.code ? `${project.code} · ` : ""}${project.name}` : " · todos os empreendimentos"} · cadastro e comissões de vendas.`}
    actions={<><Link className="elos-button" href="/comercial/propostas">Abrir propostas</Link><Link className="elos-button" href="/comercial/vendas">Abrir vendas</Link><Link className="elos-button" href="/financeiro/contas-a-pagar">Contas a pagar</Link></>}
  >
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

    {schemaMissing ? <section className="setup-panel"><span>Banco de dados pendente</span><h2>Instale o módulo de corretores</h2><p>Execute a migration <code>20260729_0052_commercial_brokers.sql</code>.</p></section> : <>
      <section className="broker-summary-grid">
        <article><span>Parceiros ativos</span><strong>{summary.active_broker_count}</strong><small>{summary.broker_count} cadastro(s) no total</small></article>
        <article><span>Comissões pendentes</span><strong>{money(summary.pending_amount)}</strong><small>{summary.planned_count} planejada(s) · {summary.approved_count} aprovada(s)</small></article>
        <article><span>Contas geradas</span><strong>{money(summary.payable_amount)}</strong><small>{summary.generated_count} título(s) aguardando baixa</small></article>
        <article><span>Comissões pagas</span><strong>{money(summary.paid_amount)}</strong><small>{summary.paid_count} pagamento(s) confirmado(s)</small></article>
      </section>

      <section className="registry-toolbar broker-toolbar">
        <form method="get" className="finance-filter">
          <input name="q" defaultValue={queryText} placeholder="Nome, CPF/CNPJ, CRECI ou imobiliária" />
          <select name="kind" defaultValue={kind}><option value="">Todos os tipos</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select name="broker_status" defaultValue={brokerStatus}><option value="">Ativos e inativos</option><option value="active">Ativos</option><option value="inactive">Inativos</option></select>
          <select name="commission_status" defaultValue={commissionStatus}><option value="">Todas as comissões</option>{Object.entries(commissionStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <DateRangeFilter defaultPreset={dateRange.preset} defaultFrom={dateRange.from} defaultTo={dateRange.to} />
          <button type="submit">Filtrar</button><Link href="/comercial/corretores">Limpar</Link>
        </form>

        {canManage ? <details className="registry-create broker-create">
          <summary>+ Novo corretor / imobiliária</summary>
          <form action={saveBroker}><BrokerFields /><button className="auth-primary" type="submit">Salvar cadastro</button></form>
        </details> : null}
      </section>

      <section className="registry-table-panel">
        <div className="section-heading"><div><span>Cadastro comercial</span><h2>Corretores, imobiliárias e parceiros</h2></div><p>{brokersResult.count ?? brokers.length} cadastro(s) no filtro atual.</p></div>
        <div className="registry-table-wrap"><table className="registry-table finance-table broker-table">
          <thead><tr><th>Nome</th><th>Tipo</th><th>CRECI</th><th>Contato</th><th>Comissão padrão</th><th>Financeiro</th><th>Status</th><th>Ação</th></tr></thead>
          <tbody>{brokers.map((broker) => <tr key={broker.id}>
            <td><strong>{broker.name}</strong><small>{broker.agency_name || broker.legal_name || broker.tax_id}</small></td>
            <td>{kindLabels[broker.kind] || broker.kind}</td>
            <td><span>{broker.creci_number || "—"}</span><small>{broker.creci_state}</small></td>
            <td><span>{broker.phone || broker.email || "—"}</span><small>{broker.email && broker.phone ? broker.email : ""}</small></td>
            <td><strong>{decimal(broker.default_commission_pct)}%</strong><small>{broker.payment_due_days} dia(s) após a venda</small></td>
            <td><span>{broker.pix_key ? "PIX cadastrado" : "Sem PIX"}</span><small>{broker.supplier_id ? "Fornecedor vinculado" : "Será criado ao pagar"}</small></td>
            <td><span className={`broker-status ${broker.status}`}>{broker.status === "active" ? "Ativo" : "Inativo"}</span></td>
            <td>{canManage ? <details className="broker-row-edit"><summary>Editar</summary><form action={saveBroker}><BrokerFields broker={broker} /><button className="auth-primary" type="submit">Salvar alterações</button></form></details> : "—"}</td>
          </tr>)}{!brokers.length ? <tr><td className="empty-table" colSpan={8}>Nenhum corretor encontrado.</td></tr> : null}</tbody>
        </table></div>
      </section>

      <section className="registry-toolbar commission-toolbar">
        <div className="section-heading"><div><span>Comissões</span><h2>Agenda de comissões de vendas</h2></div><p>{commissionsResult.count ?? commissions.length} comissão(ões) no filtro atual.</p></div>
        {canManage && sales.length > 0 && activeBrokers.length > 0 ? <details className="registry-create commission-create">
          <summary>+ Adicionar comissão</summary>
          <form action={saveCommission}>
            <div className="registry-form-grid commission-form-grid">
              <label>Venda<select name="sale_id" defaultValue="" required><option value="" disabled>Selecione</option>{sales.map((sale) => { const unit = relatedOne(sale.units); const client = relatedOne(sale.clients); return <option key={sale.id} value={sale.id}>{sale.number} · {unit?.code || "Unidade"} · {client?.name || "Cliente"} · {money(sale.total_amount)}</option>; })}</select></label>
              <label>Favorecido<select name="broker_id" defaultValue="" required><option value="" disabled>Selecione</option>{activeBrokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.name} · {kindLabels[broker.kind]}</option>)}</select></label>
              <label>Participação<select name="role" defaultValue="broker">{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Base de cálculo<input name="calculation_base" inputMode="decimal" placeholder="Vazio = valor da venda" /></label>
              <label>Comissão (%)<input name="commission_pct" inputMode="decimal" required /></label>
              <label>Vencimento<input name="due_date" type="date" defaultValue={today} required /></label>
              <label className="registry-wide">Observações<textarea name="notes" rows={2} /></label>
            </div><button className="auth-primary" type="submit">Adicionar comissão</button>
          </form>
        </details> : null}
      </section>

      <section className="registry-table-panel commission-panel">
        <div className="registry-table-wrap"><table className="registry-table finance-table commission-table">
          <thead><tr><th>Venda</th><th>Favorecido</th><th>Participação</th><th>Base</th><th>Percentual</th><th>Comissão</th><th>Vencimento</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>{commissions.map((commission) => {
            const broker = relatedOne(commission.commercial_brokers);
            const sale = relatedOne(commission.sales);
            const unit = relatedOne(sale?.units ?? null);
            const client = relatedOne(sale?.clients ?? null);
            const overdue = commission.due_date < today && ["planned", "approved", "payable_generated"].includes(commission.status);
            return <tr key={commission.id} className={overdue ? "commission-overdue" : ""}>
              <td><strong>{sale?.number || "Venda"}</strong><small>{unit?.code || ""}{client?.name ? ` · ${client.name}` : ""}</small></td>
              <td><strong>{broker?.name || "Favorecido"}</strong><small>{broker?.creci_number}</small></td>
              <td>{roleLabels[commission.role] || commission.role}</td>
              <td>{money(commission.calculation_base)}</td>
              <td>{decimal(commission.commission_pct)}%</td>
              <td><strong>{money(commission.commission_amount)}</strong>{commission.paid_amount ? <small>Pago {money(commission.paid_amount)}</small> : null}</td>
              <td><span>{dateBR(commission.due_date)}</span><small>{overdue ? "Vencida" : commission.paid_at ? `Pago em ${dateBR(commission.paid_at)}` : ""}</small></td>
              <td><span className={`commission-status ${commission.status}`}>{commissionStatusLabels[commission.status] || commission.status}</span></td>
              <td><div className="commission-actions">
                {commission.status === "planned" && canApprove ? <form action={setCommissionStatus}><input type="hidden" name="commission_id" value={commission.id} /><input type="hidden" name="status" value="approved" /><input type="hidden" name="due_date" value={commission.due_date} /><button type="submit">Aprovar</button></form> : null}
                {commission.status === "approved" && canFinance ? <form action={generateCommissionPayable}><input type="hidden" name="commission_id" value={commission.id} /><button type="submit">Gerar conta</button></form> : null}
                {["planned", "approved"].includes(commission.status) && canManage ? <form action={setCommissionStatus}><input type="hidden" name="commission_id" value={commission.id} /><input type="hidden" name="status" value="cancelled" /><button className="danger" type="submit">Cancelar</button></form> : null}
                {commission.payable_id ? <Link href={`/financeiro/contas-a-pagar?q=${encodeURIComponent(`COM-${sale?.number || ""}`)}`}>Ver conta</Link> : null}
              </div></td>
            </tr>;
          })}{!commissions.length ? <tr><td className="empty-table" colSpan={9}>Nenhuma comissão encontrada.</td></tr> : null}</tbody>
        </table></div>
      </section>
    </>}
  </AppShell>;
}
