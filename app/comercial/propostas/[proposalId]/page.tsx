import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  convertProposalToSale,
  createProposalRevision,
  deleteProposalPaymentItem,
  saveProposalPaymentItem,
  setProposalStatus,
  updateProposal,
} from "../actions";

type Client = { id: string; name: string; tax_id: string | null; status: string };
type Unit = { id: string; code: string; floor: number | null; type: string | null; list_price: number | null; status: string };
type Project = { id: string; name: string; code: string | null };
type Proposal = {
  id: string;
  project_id: string;
  unit_id: string;
  client_id: string;
  number: string;
  version_no: number;
  parent_proposal_id: string | null;
  proposal_date: string;
  valid_until: string;
  reservation_until: string | null;
  list_price: number;
  proposed_amount: number;
  discount_amount: number;
  discount_percentage: number;
  commission_pct: number;
  broker_name: string | null;
  source_channel: string | null;
  status: string;
  terms: string | null;
  notes: string | null;
  converted_sale_id: string | null;
  converted_at: string | null;
  clients: Client | Client[] | null;
  units: Unit | Unit[] | null;
  projects: Project | Project[] | null;
};
type PaymentItem = {
  id: string;
  category: string;
  description: string;
  installment_count: number;
  first_due_date: string;
  interval_months: number;
  amount_per_installment: number;
  total_amount: number;
  adjustment_index: string | null;
  interest_rate_monthly: number | null;
  sort_order: number;
  notes: string | null;
};
type CorrectionIndex = { code: string; name: string };

const categoryLabels: Record<string, string> = { entry: "Entrada", monthly: "Mensais", reinforcement: "Reforços", keys: "Chaves", post_keys: "Pós-chaves", other: "Outra" };
const statusLabels: Record<string, string> = { draft: "Rascunho", sent: "Enviada", negotiation: "Em negociação", approved: "Aprovada", rejected: "Recusada", expired: "Vencida", cancelled: "Cancelada", converted: "Convertida" };

function relatedOne<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function money(value: number | null | undefined) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0)); }
function inputMoney(value: number | null | undefined) { return Number(value ?? 0).toFixed(2).replace(".", ","); }
function dateBR(value: string | null | undefined) { if (!value) return "—"; const [year, month, day] = value.slice(0, 10).split("-"); return `${day}/${month}/${year}`; }
function percent(value: number | null | undefined) { return Number(value ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 }); }

function PaymentItemFields({ item, proposalId, correctionIndices }: { item?: PaymentItem; proposalId: string; correctionIndices: CorrectionIndex[] }) {
  return <>
    <input type="hidden" name="proposal_id" value={proposalId} />
    <input type="hidden" name="item_id" value={item?.id ?? ""} />
    <div className="registry-form-grid proposal-payment-form">
      <label>Tipo<select name="category" defaultValue={item?.category ?? "monthly"}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Descrição<input name="description" defaultValue={item?.description ?? ""} placeholder="Ex.: parcelas mensais" required /></label>
      <label>Quantidade<input name="installment_count" type="number" min="1" max="240" defaultValue={item?.installment_count ?? 1} required /></label>
      <label>Primeiro vencimento<input name="first_due_date" type="date" defaultValue={item?.first_due_date ?? new Date().toISOString().slice(0, 10)} required /></label>
      <label>Intervalo em meses<input name="interval_months" type="number" min="0" max="120" defaultValue={item?.interval_months ?? 1} required /></label>
      <label>Valor por parcela<input name="amount_per_installment" inputMode="decimal" defaultValue={item ? inputMoney(item.amount_per_installment) : ""} placeholder="0,00" required /></label>
      <label>Índice de correção<select name="adjustment_index" defaultValue={item?.adjustment_index ?? ""}><option value="">Sem correção</option>{correctionIndices.map((index) => <option key={index.code} value={index.code}>{index.code} · {index.name}</option>)}</select></label>
      <label>Juros ao mês (%)<input name="interest_rate_monthly" inputMode="decimal" defaultValue={item?.interest_rate_monthly === null || item?.interest_rate_monthly === undefined ? "" : inputMoney(item.interest_rate_monthly)} /></label>
      <label>Ordem<input name="sort_order" type="number" min="0" defaultValue={item?.sort_order ?? 0} /></label>
      <label className="registry-wide">Observações<textarea name="notes" rows={2} defaultValue={item?.notes ?? ""} /></label>
    </div>
  </>;
}

export default async function ProposalDetailPage({ params, searchParams }: {
  params: Promise<{ proposalId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { proposalId } = await params;
  const messages = await searchParams;
  const { supabase, company, companyId, roleKey } = await requireCompanyPermission("commercial.proposals.view");
  const proposalResult = await supabase
    .from("commercial_proposals")
    .select("id,project_id,unit_id,client_id,number,version_no,parent_proposal_id,proposal_date,valid_until,reservation_until,list_price,proposed_amount,discount_amount,discount_percentage,commission_pct,broker_name,source_channel,status,terms,notes,converted_sale_id,converted_at,clients(id,name,tax_id,status),units(id,code,floor,type,list_price,status),projects(id,name,code)")
    .eq("id", proposalId).eq("company_id", companyId).maybeSingle();
  if (!proposalResult.data) notFound();
  const proposal = proposalResult.data as unknown as Proposal;

  const [clientsResult, unitsResult, itemsResult, versionsResult, indicesResult, manageResult, approveResult, convertResult] = await Promise.all([
    supabase.from("clients").select("id,name,tax_id,status").eq("company_id", companyId).order("name").limit(1500),
    supabase.from("units").select("id,code,floor,type,list_price,status").eq("company_id", companyId).eq("project_id", proposal.project_id).neq("status", "inactive").order("code"),
    supabase.from("commercial_proposal_payment_items").select("id,category,description,installment_count,first_due_date,interval_months,amount_per_installment,total_amount,adjustment_index,interest_rate_monthly,sort_order,notes").eq("company_id", companyId).eq("proposal_id", proposalId).order("sort_order").order("first_due_date"),
    supabase.from("commercial_proposals").select("id,version_no,status,proposal_date,valid_until,proposed_amount").eq("company_id", companyId).eq("project_id", proposal.project_id).eq("number", proposal.number).order("version_no", { ascending: false }),
    supabase.from("correction_indices").select("code,name").eq("company_id", companyId).eq("status", "active").order("code"),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "commercial.proposals.manage" }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "commercial.proposals.approve" }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "commercial.proposals.convert" }),
  ]);

  const client = relatedOne(proposal.clients);
  const unit = relatedOne(proposal.units);
  const project = relatedOne(proposal.projects);
  const clients = (clientsResult.data ?? []) as Client[];
  const units = (unitsResult.data ?? []) as Unit[];
  const items = (itemsResult.data ?? []) as PaymentItem[];
  const versions = (versionsResult.data ?? []) as { id: string; version_no: number; status: string; proposal_date: string; valid_until: string; proposed_amount: number }[];
  const correctionIndices = (indicesResult.data ?? []) as CorrectionIndex[];
  const privileged = roleKey === "owner" || roleKey === "admin";
  const canManage = manageResult.data === true || privileged;
  const canApprove = approveResult.data === true || privileged;
  const canConvert = convertResult.data === true || privileged;
  const editable = canManage && ["draft", "sent", "negotiation"].includes(proposal.status);
  const plannedAmount = items.reduce((sum, item) => sum + Number(item.total_amount), 0);
  const difference = Math.round((proposal.proposed_amount - plannedAmount) * 100) / 100;
  const planClosed = Math.abs(difference) <= 0.01 && plannedAmount > 0;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = proposal.valid_until < today && !["rejected", "expired", "cancelled", "converted"].includes(proposal.status);
  const revisionDefault = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  return <AppShell
    activeGroup="commercial" activeItem="proposals" eyebrow="Comercial · Negociação"
    title={`${proposal.number} · V${proposal.version_no}`}
    description={`${company.name}${project ? ` · ${project.code ? `${project.code} · ` : ""}${project.name}` : ""}`}
    actions={<><Link className="elos-button" href="/comercial/propostas">Voltar às propostas</Link>{proposal.converted_sale_id ? <Link className="elos-button" href={`/comercial/vendas/${proposal.converted_sale_id}`}>Abrir venda</Link> : null}</>}
  >
    {messages.error ? <div className="auth-message error workspace-message">{messages.error}</div> : null}
    {messages.success ? <div className="auth-message success workspace-message">{messages.success}</div> : null}
    {overdue ? <div className="auth-message error workspace-message">A validade terminou em {dateBR(proposal.valid_until)}. Crie uma nova versão antes de aprovar.</div> : null}

    <section className="proposal-detail-hero">
      <div><span>Unidade e cliente</span><h2>{unit?.code || "Unidade"} · {client?.name || "Cliente"}</h2><p>Emitida em {dateBR(proposal.proposal_date)} · válida até {dateBR(proposal.valid_until)}{proposal.reservation_until ? ` · reserva até ${dateBR(proposal.reservation_until)}` : ""}</p></div>
      <div className="proposal-detail-status"><span className={`proposal-status ${overdue ? "expired" : proposal.status}`}>{overdue ? "Vencida" : statusLabels[proposal.status] || proposal.status}</span><small>{proposal.broker_name || "Sem corretor informado"}</small></div>
    </section>

    <section className="proposal-summary-grid detail">
      <article><span>Valor de tabela</span><strong>{money(proposal.list_price)}</strong><small>referência comercial</small></article>
      <article><span>Valor negociado</span><strong>{money(proposal.proposed_amount)}</strong><small>{percent(proposal.discount_percentage)}% abaixo da tabela</small></article>
      <article><span>Plano financeiro</span><strong>{money(plannedAmount)}</strong><small>{items.reduce((sum, item) => sum + item.installment_count, 0)} parcela(s)</small></article>
      <article className={planClosed ? "closed" : "attention"}><span>{planClosed ? "Plano fechado" : "Diferença"}</span><strong>{money(Math.abs(difference))}</strong><small>{planClosed ? "pronto para aprovação" : difference > 0 ? "ainda falta distribuir" : "plano acima da proposta"}</small></article>
    </section>

    <section className="proposal-detail-columns">
      <details className="registry-create proposal-edit" open={proposal.status === "draft"}>
        <summary>Dados comerciais</summary>
        {editable ? <form action={updateProposal}>
          <input type="hidden" name="proposal_id" value={proposal.id} />
          <div className="registry-form-grid proposal-form-grid">
            <label>Cliente<select name="client_id" defaultValue={proposal.client_id} required>{clients.map((item) => <option key={item.id} value={item.id} disabled={item.status === "inactive" && item.id !== proposal.client_id}>{item.name}{item.status === "inactive" ? " · inativo" : ""}</option>)}</select></label>
            <label>Unidade<select name="unit_id" defaultValue={proposal.unit_id} required>{units.map((item) => <option key={item.id} value={item.id} disabled={item.status === "sold" && item.id !== proposal.unit_id}>{item.code}{item.type ? ` · ${item.type}` : ""}{item.status === "sold" && item.id !== proposal.unit_id ? " · vendida" : item.status === "reserved" && item.id !== proposal.unit_id ? " · reservada" : ""}</option>)}</select></label>
            <label>Data da proposta<input name="proposal_date" type="date" defaultValue={proposal.proposal_date} required /></label>
            <label>Validade<input name="valid_until" type="date" defaultValue={proposal.valid_until} required /></label>
            <label>Valor de tabela<input name="list_price" inputMode="decimal" defaultValue={inputMoney(proposal.list_price)} required /></label>
            <label>Valor proposto<input name="proposed_amount" inputMode="decimal" defaultValue={inputMoney(proposal.proposed_amount)} required /></label>
            <label>Comissão (%)<input name="commission_pct" inputMode="decimal" defaultValue={inputMoney(proposal.commission_pct)} /></label>
            <label>Corretor / imobiliária<input name="broker_name" defaultValue={proposal.broker_name ?? ""} /></label>
            <label>Origem<input name="source_channel" defaultValue={proposal.source_channel ?? ""} /></label>
            <label className="registry-wide">Condições gerais<textarea name="terms" rows={4} defaultValue={proposal.terms ?? ""} /></label>
            <label className="registry-wide">Observações internas<textarea name="notes" rows={3} defaultValue={proposal.notes ?? ""} /></label>
          </div><button className="auth-primary" type="submit">Salvar dados</button>
        </form> : <div className="proposal-readonly"><p>{proposal.terms || "Nenhuma condição geral registrada."}</p><small>{proposal.notes}</small></div>}
      </details>

      <aside className="proposal-workflow-panel">
        <span>Fluxo da proposta</span><h2>Próxima ação</h2>
        {proposal.status === "draft" && canManage ? <form action={setProposalStatus}><input type="hidden" name="proposal_id" value={proposal.id} /><input type="hidden" name="status" value="sent" /><button className="auth-primary" type="submit">Marcar como enviada</button></form> : null}
        {proposal.status === "sent" && canManage ? <form action={setProposalStatus}><input type="hidden" name="proposal_id" value={proposal.id} /><input type="hidden" name="status" value="negotiation" /><button className="auth-primary" type="submit">Iniciar negociação</button></form> : null}
        {["sent", "negotiation"].includes(proposal.status) && canApprove ? <form action={setProposalStatus} className="proposal-approval-form"><input type="hidden" name="proposal_id" value={proposal.id} /><input type="hidden" name="status" value="approved" /><label>Reservar unidade até<input name="reservation_until" type="date" defaultValue={proposal.valid_until} required /></label><button className="auth-primary" type="submit" disabled={!planClosed || overdue}>Aprovar e reservar unidade</button>{!planClosed ? <small>Feche o plano financeiro para aprovar.</small> : null}</form> : null}
        {proposal.status === "approved" && canConvert ? <form action={convertProposalToSale} className="proposal-convert-form"><input type="hidden" name="proposal_id" value={proposal.id} /><label>Data da venda<input name="sale_date" type="date" defaultValue={today} required /></label><label>Número do contrato<input name="contract_number" /></label><button className="auth-primary" type="submit" disabled={!planClosed || overdue}>Converter em venda</button><small>Cria o contrato e todas as parcelas automaticamente.</small></form> : null}
        {proposal.status === "converted" ? <div className="proposal-completed"><strong>Negociação concluída</strong><p>Esta versão originou uma venda e não pode mais ser alterada.</p>{proposal.converted_sale_id ? <Link href={`/comercial/vendas/${proposal.converted_sale_id}`}>Abrir venda gerada</Link> : null}</div> : null}
        {!['converted','cancelled'].includes(proposal.status) && canManage ? <div className="proposal-secondary-actions">
          {!['rejected','expired'].includes(proposal.status) ? <form action={setProposalStatus}><input type="hidden" name="proposal_id" value={proposal.id} /><input type="hidden" name="status" value="rejected" /><button type="submit">Marcar como recusada</button></form> : null}
          <form action={setProposalStatus}><input type="hidden" name="proposal_id" value={proposal.id} /><input type="hidden" name="status" value="cancelled" /><button className="danger" type="submit">Cancelar proposta</button></form>
        </div> : null}
        {proposal.status !== "converted" && canManage ? <details className="proposal-revision"><summary>Criar nova versão</summary><form action={createProposalRevision}><input type="hidden" name="proposal_id" value={proposal.id} /><label>Nova validade<input name="valid_until" type="date" defaultValue={revisionDefault} required /></label><button type="submit">Copiar como nova versão</button></form></details> : null}
      </aside>
    </section>

    <section className="registry-table-panel proposal-payment-panel">
      <div className="section-heading"><div><span>Condições de pagamento</span><h2>Plano financeiro negociado</h2></div><p>{money(plannedAmount)} de {money(proposal.proposed_amount)}</p></div>
      {editable ? <details className="registry-create proposal-add-payment"><summary>+ Adicionar condição</summary><form action={saveProposalPaymentItem}><PaymentItemFields proposalId={proposal.id} correctionIndices={correctionIndices} /><button className="auth-primary" type="submit">Adicionar ao plano</button></form></details> : null}
      <div className="registry-table-wrap"><table className="registry-table finance-table proposal-payment-table"><thead><tr><th>Tipo</th><th>Descrição</th><th>Parcelas</th><th>Primeiro vencimento</th><th>Periodicidade</th><th>Valor unitário</th><th>Total</th><th>Correção</th><th>Ação</th></tr></thead><tbody>
        {items.map((item) => <tr key={item.id}><td>{categoryLabels[item.category] || item.category}</td><td><strong>{item.description}</strong><small>{item.notes}</small></td><td>{item.installment_count}</td><td>{dateBR(item.first_due_date)}</td><td>{item.interval_months === 0 ? "Única data" : item.interval_months === 1 ? "Mensal" : `A cada ${item.interval_months} meses`}</td><td>{money(item.amount_per_installment)}</td><td><strong>{money(item.total_amount)}</strong></td><td><span>{item.adjustment_index || "Sem correção"}</span><small>{item.interest_rate_monthly ? `${percent(item.interest_rate_monthly)}% a.m.` : ""}</small></td><td>{editable ? <div className="proposal-payment-actions"><details><summary>Editar</summary><form action={saveProposalPaymentItem}><PaymentItemFields item={item} proposalId={proposal.id} correctionIndices={correctionIndices} /><button className="auth-primary" type="submit">Salvar</button></form></details><form action={deleteProposalPaymentItem}><input type="hidden" name="proposal_id" value={proposal.id} /><input type="hidden" name="item_id" value={item.id} /><button className="table-action danger" type="submit">Excluir</button></form></div> : "—"}</td></tr>)}
        {!items.length ? <tr><td className="empty-table" colSpan={9}>Nenhuma condição de pagamento cadastrada.</td></tr> : null}
      </tbody></table></div>
    </section>

    <section className="proposal-version-panel"><div className="section-heading"><div><span>Histórico</span><h2>Versões da negociação</h2></div><p>{versions.length} versão(ões)</p></div><div className="proposal-version-list">{versions.map((version) => <Link key={version.id} className={version.id === proposal.id ? "active" : ""} href={`/comercial/propostas/${version.id}`}><strong>V{version.version_no}</strong><span>{money(version.proposed_amount)}</span><small>{dateBR(version.proposal_date)} · {statusLabels[version.status] || version.status}</small></Link>)}</div></section>
  </AppShell>;
}
