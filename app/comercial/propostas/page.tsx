import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { DateRangeFilter } from "@/components/date-range-filter";
import { resolveDateRange } from "@/lib/date-range";
import { requireCompanyPermission } from "@/lib/workspace";
import { createProposal } from "./actions";

const PAGE_SIZE = 50;

type Client = { id: string; name: string; tax_id: string | null };
type Unit = { id: string; code: string; floor: number | null; type: string | null; list_price: number | null; status: string };
type Broker = { id: string; name: string; kind: string; default_commission_pct: number };
type Proposal = {
  id: string;
  number: string;
  version_no: number;
  proposal_date: string;
  valid_until: string;
  reservation_until: string | null;
  list_price: number;
  proposed_amount: number;
  discount_amount: number;
  discount_percentage: number;
  broker_name: string | null;
  status: string;
  converted_sale_id: string | null;
  clients: Client | Client[] | null;
  units: Unit | Unit[] | null;
};
type Summary = {
  total_count: number;
  draft_count: number;
  pipeline_count: number;
  approved_count: number;
  converted_count: number;
  pipeline_amount: number;
  approved_amount: number;
  converted_amount: number;
  expiring_count: number;
  expired_open_count: number;
};

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  sent: "Enviada",
  negotiation: "Em negociação",
  approved: "Aprovada",
  rejected: "Recusada",
  expired: "Vencida",
  cancelled: "Cancelada",
  converted: "Convertida",
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

export default async function ProposalsPage({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string; client?: string; period?: string; from?: string; to?: string; page?: string; error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("commercial.proposals.view");
  const queryText = (params.q ?? "").trim();
  const status = Object.keys(statusLabels).includes(params.status ?? "") ? params.status! : "";
  const clientId = params.client ?? "";
  const dateRange = resolveDateRange(params.period, params.from, params.to);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const fromRow = (page - 1) * PAGE_SIZE;
  const toRow = fromRow + PAGE_SIZE - 1;

  const projectQuery = projectId
    ? supabase.from("projects").select("id,name,code").eq("id", projectId).eq("company_id", companyId).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const clientsQuery = supabase.from("clients").select("id,name,tax_id").eq("company_id", companyId).eq("status", "active").order("name").limit(1500);
  const brokersQuery = supabase.from("commercial_brokers").select("id,name,kind,default_commission_pct").eq("company_id", companyId).eq("status", "active").order("name").limit(1500);
  const unitsQuery = projectId
    ? supabase.from("units").select("id,code,floor,type,list_price,status").eq("company_id", companyId).eq("project_id", projectId).in("status", ["available", "reserved"]).order("code")
    : Promise.resolve({ data: [], error: null });

  let proposalsQuery = supabase
    .from("commercial_proposals")
    .select("id,number,version_no,proposal_date,valid_until,reservation_until,list_price,proposed_amount,discount_amount,discount_percentage,broker_name,status,converted_sale_id,clients(id,name,tax_id),units(id,code,floor,type,list_price,status)", { count: "exact" })
    .eq("company_id", companyId)
    .order("proposal_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(fromRow, toRow);
  if (projectId) proposalsQuery = proposalsQuery.eq("project_id", projectId);
  if (status) proposalsQuery = proposalsQuery.eq("status", status);
  if (clientId) proposalsQuery = proposalsQuery.eq("client_id", clientId);
  if (dateRange.from) proposalsQuery = proposalsQuery.gte("proposal_date", dateRange.from);
  if (dateRange.to) proposalsQuery = proposalsQuery.lte("proposal_date", dateRange.to);
  if (queryText) {
    const safe = queryText.replace(/[,%()]/g, " ").trim();
    proposalsQuery = proposalsQuery.or(`number.ilike.%${safe}%,broker_name.ilike.%${safe}%,source_channel.ilike.%${safe}%,notes.ilike.%${safe}%`);
  }

  const [projectResult, clientsResult, brokersResult, unitsResult, proposalsResult, summaryResult, manageResult] = await Promise.all([
    projectQuery,
    clientsQuery,
    brokersQuery,
    unitsQuery,
    proposalsQuery,
    supabase.rpc("commercial_proposals_summary", { p_company_id: companyId, p_project_id: projectId }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "commercial.proposals.manage" }),
  ]);

  const schemaMissing = proposalsResult.error?.code === "42P01" || proposalsResult.error?.message.includes("commercial_proposals");
  const clients = (clientsResult.data ?? []) as Client[];
  const brokers = (brokersResult.data ?? []) as Broker[];
  const units = (unitsResult.data ?? []) as Unit[];
  const proposals = (proposalsResult.data ?? []) as unknown as Proposal[];
  const summary = (summaryResult.data ?? { total_count: 0, draft_count: 0, pipeline_count: 0, approved_count: 0, converted_count: 0, pipeline_amount: 0, approved_amount: 0, converted_amount: 0, expiring_count: 0, expired_open_count: 0 }) as Summary;
  const privileged = roleKey === "owner" || roleKey === "admin";
  const canManage = manageResult.data === true || privileged;
  const totalPages = Math.max(1, Math.ceil((proposalsResult.count ?? 0) / PAGE_SIZE));
  const project = projectResult.data;
  const today = new Date().toISOString().slice(0, 10);
  const validDefault = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const paginationQuery = `q=${encodeURIComponent(queryText)}&status=${status}&client=${clientId}&period=${dateRange.preset}&from=${dateRange.from}&to=${dateRange.to}`;

  return <AppShell
    activeGroup="commercial"
    activeItem="proposals"
    eyebrow="Comercial"
    title="Propostas"
    description={`${company.name}${project ? ` · ${project.code ? `${project.code} · ` : ""}${project.name}` : " · todos os empreendimentos"} · negociações antes da venda.`}
    actions={<><Link className="elos-button" href="/comercial/corretores">Abrir corretores</Link><Link className="elos-button" href="/comercial/vendas">Abrir vendas</Link><Link className="elos-button" href="/cadastros/clientes">Abrir clientes</Link></>}
  >
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}

    {schemaMissing ? <section className="setup-panel"><span>Banco de dados pendente</span><h2>Instale a estrutura de propostas comerciais</h2><p>Execute a migration <code>20260729_0051_commercial_proposals.sql</code>.</p></section> : <>
      <section className="proposal-summary-grid">
        <article><span>Pipeline</span><strong>{money(summary.pipeline_amount)}</strong><small>{summary.pipeline_count} proposta(s) em andamento</small></article>
        <article><span>Aprovadas</span><strong>{money(summary.approved_amount)}</strong><small>{summary.approved_count} unidade(s) reservada(s)</small></article>
        <article><span>Convertidas</span><strong>{money(summary.converted_amount)}</strong><small>{summary.converted_count} venda(s) originada(s)</small></article>
        <article className={summary.expired_open_count > 0 ? "attention" : ""}><span>Atenção</span><strong>{summary.expired_open_count}</strong><small>{summary.expiring_count} vencem nos próximos 7 dias</small></article>
      </section>

      <section className="registry-toolbar proposal-toolbar">
        <form method="get" className="finance-filter">
          <input name="q" defaultValue={queryText} placeholder="Número, corretor, origem ou observação" />
          <select name="status" defaultValue={status}><option value="">Todos os status</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select name="client" defaultValue={clientId}><option value="">Todos os clientes</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
          <DateRangeFilter defaultPreset={dateRange.preset} defaultFrom={dateRange.from} defaultTo={dateRange.to} />
          <button type="submit">Filtrar</button><Link href="/comercial/propostas">Limpar</Link>
        </form>

        {canManage && projectId ? <details className="registry-create proposal-create">
          <summary>+ Nova proposta</summary>
          <form action={createProposal}>
            <div className="registry-form-grid proposal-form-grid">
              <label>Cliente<select name="client_id" defaultValue="" required><option value="" disabled>Selecione</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.tax_id ? ` · ${client.tax_id}` : ""}</option>)}</select></label>
              <label>Unidade<select name="unit_id" defaultValue="" required><option value="" disabled>Selecione</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.code}{unit.type ? ` · ${unit.type}` : ""}{unit.status === "reserved" ? " · reservada" : ""}</option>)}</select></label>
              <label>Data da proposta<input name="proposal_date" type="date" defaultValue={today} required /></label>
              <label>Validade<input name="valid_until" type="date" defaultValue={validDefault} required /></label>
              <label>Valor de tabela<input name="list_price" inputMode="decimal" placeholder="0,00" required /></label>
              <label>Valor proposto<input name="proposed_amount" inputMode="decimal" placeholder="0,00" required /></label>
              <label>Comissão (%)<input name="commission_pct" inputMode="decimal" defaultValue="0,00" /></label>
              <label>Corretor / imobiliária<select name="broker_name" defaultValue=""><option value="">Sem corretor</option>{brokers.map((broker) => <option key={broker.id} value={broker.name}>{broker.name}{broker.default_commission_pct > 0 ? ` · padrão ${Number(broker.default_commission_pct).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : ""}</option>)}</select></label>
              <label>Origem do atendimento<input name="source_channel" placeholder="Ex.: indicação, portal, plantão" /></label>
              <label className="registry-wide">Condições gerais<textarea name="terms" rows={3} placeholder="Condições comerciais, ressalvas e premissas" /></label>
              <label className="registry-wide">Observações internas<textarea name="notes" rows={3} /></label>
            </div>
            <button className="auth-primary" type="submit">Criar proposta</button>
          </form>
        </details> : null}
      </section>

      <section className="registry-table-panel">
        <div className="section-heading"><div><span>Negociações</span><h2>Propostas encontradas</h2></div><p>{proposalsResult.count ?? 0} proposta(s) no filtro atual.</p></div>
        <div className="registry-table-wrap"><table className="registry-table finance-table proposal-table">
          <thead><tr><th>Unidade</th><th>Cliente</th><th>Proposta</th><th>Validade</th><th>Tabela</th><th>Negociado</th><th>Desconto</th><th>Corretor</th><th>Status</th><th>Ação</th></tr></thead>
          <tbody>{proposals.map((proposal) => {
            const client = relatedOne(proposal.clients);
            const unit = relatedOne(proposal.units);
            const overdue = proposal.valid_until < today && !["rejected","expired","cancelled","converted"].includes(proposal.status);
            return <tr key={proposal.id} className={overdue ? "proposal-overdue" : ""}>
              <td><strong>{unit?.code || "—"}</strong><small>{unit?.type || (unit?.floor ? `${unit.floor}º pavimento` : "")}</small></td>
              <td><strong>{client?.name || "Cliente"}</strong><small>{client?.tax_id}</small></td>
              <td><strong>{proposal.number}</strong><small>Versão {proposal.version_no} · {dateBR(proposal.proposal_date)}</small></td>
              <td><span>{dateBR(proposal.valid_until)}</span><small>{proposal.reservation_until ? `Reserva até ${dateBR(proposal.reservation_until)}` : overdue ? "Prazo encerrado" : ""}</small></td>
              <td>{money(proposal.list_price)}</td><td><strong>{money(proposal.proposed_amount)}</strong></td>
              <td><span>{money(proposal.discount_amount)}</span><small>{Number(proposal.discount_percentage).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</small></td>
              <td>{proposal.broker_name || "—"}</td>
              <td><span className={`proposal-status ${overdue ? "expired" : proposal.status}`}>{overdue ? "Vencida" : statusLabels[proposal.status] || proposal.status}</span></td>
              <td><Link className="table-action table-action-link" href={`/comercial/propostas/${proposal.id}`}>{proposal.converted_sale_id ? "Ver proposta" : "Abrir"}</Link></td>
            </tr>;
          })}{!proposals.length ? <tr><td className="empty-table" colSpan={10}>Nenhuma proposta encontrada.</td></tr> : null}</tbody>
        </table></div>
        <div className="registry-pagination"><span>Página {page} de {totalPages}</span><div>{page > 1 ? <Link href={`?${paginationQuery}&page=${page - 1}`}>Anterior</Link> : null}{page < totalPages ? <Link href={`?${paginationQuery}&page=${page + 1}`}>Próxima</Link> : null}</div></div>
      </section>
    </>}
  </AppShell>;
}
