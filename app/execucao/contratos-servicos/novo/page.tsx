import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  CompetitionApprovalForm,
  ContractStageForm,
  NewServiceRequestButton,
  OpenCompetitionButton,
  ProposalForm,
  type ActivityOption,
  type BudgetOption,
  type LocationOption,
  type ProposalRecord,
  type ServiceOption,
  type ServiceRequestRecord,
  type SupplierOption,
} from "./procurement-client";
import "../../../execution-service-procurement.css";

type Project = { id: string; code: string | null; name: string };
type RequestRow = ServiceRequestRecord & { requester_name: string | null; approved_at: string | null; created_at: string };

const statusLabels: Record<string, string> = {
  draft: "Solicitação em elaboração",
  quotation: "Mapa aberto",
  analysis: "Propostas em análise",
  approved: "Fornecedor aprovado",
  contracted: "Contrato formulado",
  cancelled: "Cancelada",
};
function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function quantity(value: number, digits = 4) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0)); }
function dateBR(value?: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : "—"; }

export default async function ServiceContractingFlowPage({ searchParams }: {
  searchParams: Promise<{ request?: string; q?: string; status?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("execution.contracts.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const permission = (key: string) => privileged ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: key });

  const [projectResult, requestsResult, proposalsResult, suppliersResult, servicesResult, budgetsResult, locationsResult, activitiesResult, manageResult, approveResult] = await Promise.all([
    projectId ? supabase.from("projects").select("id,code,name").eq("id", projectId).eq("company_id", companyId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    projectId ? fetchAllRows<RequestRow>(async (from, to) => {
      const { data, error } = await supabase.from("execution_service_requests").select("id,request_number,title,scope_summary,status,budget_id,service_id,location_id,schedule_activity_id,service_code,service_name,unit_snapshot,location_name,requested_quantity,estimated_unit_price,estimated_total,desired_start,desired_finish,notes,selected_supplier_id,selected_proposal_id,approved_total,approval_justification,contract_id,requester_name,approved_at,created_at").eq("company_id", companyId).eq("project_id", projectId).order("created_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as RequestRow[], error };
    }) : Promise.resolve({ data: [] as RequestRow[], error: null }),
    projectId ? fetchAllRows<ProposalRecord>(async (from, to) => {
      const { data, error } = await supabase.from("execution_service_request_proposals").select("id,request_id,supplier_id,supplier_name,proposal_number,proposal_date,validity_date,total_price,duration_days,payment_terms,warranty_months,technical_score,commercial_score,is_qualified,is_selected,notes").eq("company_id", companyId).eq("project_id", projectId).order("total_price").range(from, to);
      return { data: (data ?? []) as ProposalRecord[], error };
    }) : Promise.resolve({ data: [] as ProposalRecord[], error: null }),
    fetchAllRows<SupplierOption>(async (from, to) => {
      const { data, error } = await supabase.from("suppliers").select("id,legal_name,trade_name,tax_id").eq("company_id", companyId).eq("status", "active").order("legal_name").range(from, to);
      return { data: (data ?? []) as SupplierOption[], error };
    }),
    fetchAllRows<ServiceOption>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_services").select("id,code,description,unit").eq("company_id", companyId).eq("status", "active").order("code").range(from, to);
      return { data: (data ?? []) as ServiceOption[], error };
    }),
    projectId ? fetchAllRows<BudgetOption>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_budgets").select("id,code,name").eq("company_id", companyId).eq("project_id", projectId).eq("status", "approved").order("updated_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as BudgetOption[], error };
    }) : Promise.resolve({ data: [] as BudgetOption[], error: null }),
    projectId ? fetchAllRows<LocationOption>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_takeoff_locations").select("id,code,name").eq("company_id", companyId).eq("project_id", projectId).eq("status", "active").order("sort_order").range(from, to);
      return { data: (data ?? []) as LocationOption[], error };
    }) : Promise.resolve({ data: [] as LocationOption[], error: null }),
    projectId ? fetchAllRows<ActivityOption>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_schedule_activities").select("id,service_id,location_id,code,name,planned_start,planned_finish").eq("company_id", companyId).eq("project_id", projectId).eq("record_status", "active").order("planned_start").range(from, to);
      return { data: (data ?? []) as ActivityOption[], error };
    }) : Promise.resolve({ data: [] as ActivityOption[], error: null }),
    permission("execution.contracts.manage"),
    permission("execution.contracts.approve"),
  ]);

  const project = projectResult.data as Project | null;
  const requests = requestsResult.data;
  const proposalMap = new Map<string, ProposalRecord[]>();
  proposalsResult.data.forEach((proposal) => proposalMap.set(proposal.request_id, [...(proposalMap.get(proposal.request_id) ?? []), proposal]));
  const selected = params.request ? requests.find((request) => request.id === params.request) ?? null : null;
  const selectedProposals = selected ? proposalMap.get(selected.id) ?? [] : [];
  const canManage = manageResult.data === true || privileged;
  const canApprove = approveResult.data === true || privileged;
  const structureError = requestsResult.error || proposalsResult.error;
  const query = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const filtered = requests.filter((request) => !params.status || request.status === params.status).filter((request) => !query || [request.request_number, request.title, request.service_code, request.service_name, request.location_name, request.requester_name].join(" ").toLocaleLowerCase("pt-BR").includes(query));
  const awaitingCompetition = requests.filter((request) => request.status === "draft").length;
  const inCompetition = requests.filter((request) => ["quotation", "analysis"].includes(request.status)).length;
  const awaitingStages = requests.filter((request) => request.status === "approved").length;
  const contractedTotal = requests.filter((request) => request.status === "contracted").reduce((sum, request) => sum + Number(request.approved_total ?? 0), 0);
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";

  return <AppShell
    activeGroup="execution" activeItem="service-contracts" eyebrow="Execução · Contratações" title="Contratação de Serviços"
    description={`${company.name} · ${context} · solicitação, mapa de concorrência, aprovação do fornecedor e etapas de medição.`}
    actions={canManage && projectId && !selected ? <NewServiceRequestButton services={servicesResult.data} budgets={budgetsResult.data} locations={locationsResult.data} activities={activitiesResult.data} /> : <Link className="elos-button service-flow-main-button" href="/execucao/contratos-servicos">Voltar aos contratos</Link>}
  >
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {structureError ? <div className="auth-message error workspace-message">A nova estrutura de contratação ainda não está instalada. Execute a migration <strong>20260801_0067_service_contracting_flow.sql</strong>.</div> : null}
    {!projectId ? <div className="service-flow-empty">Selecione uma obra no topo.</div> : null}

    {projectId && selected ? <>
      <section className="service-flow-detail-head">
        <Link href="/execucao/contratos-servicos/novo">← Todas as contratações</Link>
        <div><span>{selected.request_number} · {statusLabels[selected.status]}</span><h2>{selected.title}</h2><p>{selected.scope_summary}</p></div>
        {selected.contract_id ? <Link className="service-flow-primary link" href={`/execucao/contratos-servicos?contract=${selected.contract_id}`}>Abrir contrato</Link> : null}
      </section>
      <section className="service-flow-steps">
        {[["1", "Solicitação", true], ["2", "Mapa de concorrência", selected.status !== "draft"], ["3", "Aprovação do fornecedor", ["approved", "contracted"].includes(selected.status)], ["4", "Etapas e contrato", selected.status === "contracted"]].map(([number, label, complete]) => <div key={String(number)} className={complete ? "complete" : ""}><i>{number}</i><strong>{label}</strong></div>)}
      </section>
      <section className="service-request-summary">
        <article><span>Serviço</span><strong>{selected.service_code} · {selected.service_name}</strong><small>{selected.location_name || "Toda a obra / não definido"}</small></article>
        <article><span>Quantidade</span><strong>{quantity(selected.requested_quantity)} {selected.unit_snapshot}</strong><small>estimativa {money(selected.estimated_total)}</small></article>
        <article><span>Execução desejada</span><strong>{dateBR(selected.desired_start)} a {dateBR(selected.desired_finish)}</strong><small>{selected.requester_name || "Solicitante não identificado"}</small></article>
        <article><span>Valor aprovado</span><strong>{selected.approved_total ? money(selected.approved_total) : "—"}</strong><small>{selectedProposals.length} proposta(s) no mapa</small></article>
      </section>

      {selected.status === "draft" && canManage ? <section className="service-flow-card service-open-card"><div><span>Próxima ação</span><h3>Abrir o mapa de concorrência</h3><p>A solicitação ficará bloqueada para edição e pronta para receber propostas.</p></div><OpenCompetitionButton requestId={selected.id} /></section> : null}

      {["quotation", "analysis", "approved", "contracted"].includes(selected.status) ? <section className="service-flow-card">
        <div className="service-flow-card-head"><div><span>Mapa de concorrência</span><h3>Comparativo dos fornecedores</h3></div><small>{selectedProposals.length} participante(s)</small></div>
        <div className="service-map-table-wrap"><table className="service-map-table"><thead><tr><th>Fornecedor</th><th>Valor</th><th>Prazo</th><th>Pagamento</th><th>Técnica</th><th>Comercial</th><th>Situação</th></tr></thead><tbody>{selectedProposals.map((proposal) => <tr key={proposal.id} className={proposal.is_selected ? "winner" : ""}><td><strong>{proposal.supplier_name}</strong><small>{proposal.proposal_number || "Sem número"} · {dateBR(proposal.proposal_date)}</small></td><td>{money(proposal.total_price)}</td><td>{proposal.duration_days ? `${proposal.duration_days} dias` : "—"}</td><td>{proposal.payment_terms || "—"}</td><td>{proposal.technical_score}</td><td>{proposal.commercial_score}</td><td><span className={proposal.is_selected ? "selected" : proposal.is_qualified ? "qualified" : "disqualified"}>{proposal.is_selected ? "Vencedor" : proposal.is_qualified ? "Habilitado" : "Desclassificado"}</span></td></tr>)}{!selectedProposals.length ? <tr><td colSpan={7}>Nenhuma proposta registrada.</td></tr> : null}</tbody></table></div>
      </section> : null}

      {["quotation", "analysis"].includes(selected.status) && canManage ? <ProposalForm requestId={selected.id} suppliers={suppliersResult.data} proposals={selectedProposals} /> : null}
      {["quotation", "analysis"].includes(selected.status) && canApprove && selectedProposals.length ? <CompetitionApprovalForm requestId={selected.id} proposals={selectedProposals} /> : null}
      {selected.status === "approved" && canManage ? <ContractStageForm request={selected} /> : null}
      {selected.status === "contracted" ? <section className="service-flow-card service-complete-card"><span>Fluxo concluído</span><h3>Contrato formulado com etapas de medição</h3><p>As etapas foram convertidas em itens mensuráveis do contrato. A ativação e as medições seguem pelo módulo atual.</p><Link className="service-flow-primary link" href={`/execucao/contratos-servicos?contract=${selected.contract_id}`}>Revisar e ativar contrato</Link></section> : null}
    </> : projectId ? <>
      <section className="service-flow-kpis">
        <article><span>Aguardando mapa</span><strong>{awaitingCompetition}</strong><small>solicitações em elaboração</small></article>
        <article><span>Em concorrência</span><strong>{inCompetition}</strong><small>coleta e análise de propostas</small></article>
        <article><span>Aguardando etapas</span><strong>{awaitingStages}</strong><small>fornecedor já aprovado</small></article>
        <article><span>Contratado</span><strong>{money(contractedTotal)}</strong><small>valor aprovado e formulado</small></article>
      </section>
      <section className="service-flow-overview">
        {[["1", "Solicitação de serviços", "Definição técnica da demanda"], ["2", "Mapa de concorrência", "Propostas e comparação"], ["3", "Aprovação", "Fornecedor e valor definidos"], ["4", "Etapas de medição", "Contrato pronto para execução"]].map(([number, title, caption]) => <div key={number}><i>{number}</i><strong>{title}</strong><span>{caption}</span></div>)}
      </section>
      <section className="service-flow-toolbar"><form method="get"><input name="q" defaultValue={params.q ?? ""} placeholder="Buscar solicitação, serviço, local ou solicitante" /><select name="status" defaultValue={params.status ?? ""}><option value="">Todos os status</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button type="submit">Filtrar</button><Link href="/execucao/contratos-servicos/novo">Limpar</Link></form></section>
      <section className="service-flow-list"><div className="budget-section-head"><div><span>Processos de contratação</span><h2>Solicitações e mapas de concorrência</h2></div><p>{filtered.length} processo(s)</p></div><div className="service-flow-list-grid">{filtered.map((request) => <Link href={`/execucao/contratos-servicos/novo?request=${request.id}`} key={request.id}><div><span>{request.request_number}</span><strong>{request.title}</strong><small>{request.service_code} · {request.service_name}</small></div><div><span className={`service-flow-status ${request.status}`}>{statusLabels[request.status]}</span><strong>{request.approved_total ? money(request.approved_total) : money(request.estimated_total)}</strong><small>{request.location_name || "Toda a obra"} · {dateBR(request.desired_start)}</small></div></Link>)}{!filtered.length ? <div className="service-flow-empty">Nenhuma contratação encontrada para os filtros informados.</div> : null}</div></section>
    </> : null}
  </AppShell>;
}
