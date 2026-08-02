import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  approveServiceCompetition,
  approveServiceRequest,
  cancelServiceRequest,
  submitServiceRequest,
} from "./actions";
import {
  CompetitionOfferDialog,
  CompetitionStartDialog,
  ContractGenerationDialog,
  ContractStagesDialog,
  ServiceRequestDialog,
  type ActivityOption,
  type BudgetOption,
  type CompetitionRecord,
  type ContractItemRecord,
  type ContractStageRecord,
  type LocationOption,
  type OfferItemRecord,
  type OfferRecord,
  type RequestItem,
  type RequestRecord,
  type ServiceOption,
  type SupplierOption,
} from "./workflow-client";
import "../../execution-contract-workflow.css";

type Project = { id: string; code: string | null; name: string };
type RequestRow = RequestRecord & { sequence_no: number; requester_name: string | null; submitted_at: string | null; approved_at: string | null; approval_notes: string | null; created_at: string };
type CompetitionRow = CompetitionRecord & { sequence_no: number; approved_at: string | null; approval_notes: string | null; created_at: string };
type ContractRow = { id: string; source_request_id: string | null; source_competition_id: string | null; contract_number: string; title: string; supplier_id: string; status: string; current_value: number; measured_value: number; start_date: string; end_date: string; created_at: string };

const requestLabels: Record<string, string> = { draft: "Em elaboração", submitted: "Em aprovação", approved: "Aprovada", competition: "Em concorrência", contracted: "Contratada", cancelled: "Cancelada" };
const competitionLabels: Record<string, string> = { collecting: "Coletando propostas", analysis: "Em análise", approved: "Aprovada", cancelled: "Cancelada" };
const contractLabels: Record<string, string> = { draft: "Em elaboração", active: "Ativo", suspended: "Suspenso", finished: "Concluído", cancelled: "Cancelado" };
function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function number(value: number, digits = 3) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0)); }
function dateBR(value?: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : "—"; }
function supplierName(supplier?: SupplierOption | null) { return supplier ? supplier.trade_name || supplier.legal_name : "Fornecedor não localizado"; }

export default async function ServiceProcurementPage({ searchParams }: {
  searchParams: Promise<{ view?: string; request?: string; competition?: string; contract?: string; q?: string; status?: string; new?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const view = ["requests", "competitions", "contracts"].includes(params.view ?? "") ? params.view! : "requests";
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("execution.contract_procurement.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const permission = (key: string) => privileged ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: key });

  const [projectResult, requestsResult, requestItemsResult, competitionsResult, offersResult, offerItemsResult, suppliersResult, budgetsResult, servicesResult, locationsResult, baselinesResult, contractsResult, contractItemsResult, stagesResult, manageResult, approveResult, contractResult] = await Promise.all([
    projectId ? supabase.from("projects").select("id,code,name").eq("id", projectId).eq("company_id", companyId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    projectId ? fetchAllRows<RequestRow>(async (from, to) => { const { data, error } = await supabase.from("execution_service_requests").select("id,budget_id,sequence_no,request_number,title,scope_summary,status,needed_start,needed_finish,requester_name,notes,submitted_at,approved_at,approval_notes,created_at").eq("company_id", companyId).eq("project_id", projectId).order("sequence_no", { ascending: false }).range(from, to); return { data: (data ?? []) as RequestRow[], error }; }) : Promise.resolve({ data: [] as RequestRow[], error: null }),
    projectId ? fetchAllRows<RequestItem>(async (from, to) => { const { data, error } = await supabase.from("execution_service_request_items").select("id,request_id,service_id,location_id,schedule_activity_id,service_code,service_name,location_name,unit_snapshot,requested_quantity,estimated_unit_price,estimated_total,scope_notes,measurement_notes").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to); return { data: (data ?? []) as RequestItem[], error }; }) : Promise.resolve({ data: [] as RequestItem[], error: null }),
    projectId ? fetchAllRows<CompetitionRow>(async (from, to) => { const { data, error } = await supabase.from("execution_service_competitions").select("id,request_id,sequence_no,competition_number,title,status,response_deadline,award_criteria,notes,winner_offer_id,winner_supplier_id,generated_contract_id,approved_at,approval_notes,created_at").eq("company_id", companyId).eq("project_id", projectId).order("sequence_no", { ascending: false }).range(from, to); return { data: (data ?? []) as CompetitionRow[], error }; }) : Promise.resolve({ data: [] as CompetitionRow[], error: null }),
    projectId ? fetchAllRows<OfferRecord>(async (from, to) => { const { data, error } = await supabase.from("execution_service_competition_offers").select("id,competition_id,supplier_id,status,proposal_number,proposal_date,validity_date,payment_days,proposed_start,proposed_finish,total_amount,technical_score,commercial_score,notes").eq("company_id", companyId).eq("project_id", projectId).order("total_amount").range(from, to); return { data: (data ?? []) as OfferRecord[], error }; }) : Promise.resolve({ data: [] as OfferRecord[], error: null }),
    projectId ? fetchAllRows<OfferItemRecord>(async (from, to) => { const { data, error } = await supabase.from("execution_service_competition_offer_items").select("id,offer_id,request_item_id,offered_quantity,unit_price,total_amount,meets_specification,notes").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to); return { data: (data ?? []) as OfferItemRecord[], error }; }) : Promise.resolve({ data: [] as OfferItemRecord[], error: null }),
    fetchAllRows<SupplierOption>(async (from, to) => { const { data, error } = await supabase.from("suppliers").select("id,legal_name,trade_name,tax_id").eq("company_id", companyId).eq("status", "active").order("legal_name").range(from, to); return { data: (data ?? []) as SupplierOption[], error }; }),
    projectId ? fetchAllRows<BudgetOption>(async (from, to) => { const { data, error } = await supabase.from("engineering_budgets").select("id,code,name").eq("company_id", companyId).eq("project_id", projectId).eq("status", "approved").order("updated_at", { ascending: false }).range(from, to); return { data: (data ?? []) as BudgetOption[], error }; }) : Promise.resolve({ data: [] as BudgetOption[], error: null }),
    fetchAllRows<ServiceOption>(async (from, to) => { const { data, error } = await supabase.from("engineering_services").select("id,code,description,unit").eq("company_id", companyId).eq("status", "active").order("code").range(from, to); return { data: (data ?? []) as ServiceOption[], error }; }),
    projectId ? fetchAllRows<LocationOption>(async (from, to) => { const { data, error } = await supabase.from("engineering_takeoff_locations").select("id,code,name").eq("company_id", companyId).eq("project_id", projectId).eq("status", "active").order("sort_order").range(from, to); return { data: (data ?? []) as LocationOption[], error }; }) : Promise.resolve({ data: [] as LocationOption[], error: null }),
    projectId ? fetchAllRows<{ id: string; status: string }>(async (from, to) => { const { data, error } = await supabase.from("engineering_schedule_baselines").select("id,status").eq("company_id", companyId).eq("project_id", projectId).neq("status", "archived").order("updated_at", { ascending: false }).range(from, to); return { data: (data ?? []) as { id: string; status: string }[], error }; }) : Promise.resolve({ data: [] as { id: string; status: string }[], error: null }),
    projectId ? fetchAllRows<ContractRow>(async (from, to) => { const { data, error } = await supabase.from("execution_service_contracts").select("id,source_request_id,source_competition_id,contract_number,title,supplier_id,status,current_value,measured_value,start_date,end_date,created_at").eq("company_id", companyId).eq("project_id", projectId).order("created_at", { ascending: false }).range(from, to); return { data: (data ?? []) as ContractRow[], error }; }) : Promise.resolve({ data: [] as ContractRow[], error: null }),
    projectId ? fetchAllRows<ContractItemRecord>(async (from, to) => { const { data, error } = await supabase.from("execution_service_contract_items").select("id,contract_id,service_id,location_id,service_code,service_name,location_name,unit_snapshot,contracted_quantity,unit_price,total_value").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to); return { data: (data ?? []) as ContractItemRecord[], error }; }) : Promise.resolve({ data: [] as ContractItemRecord[], error: null }),
    projectId ? fetchAllRows<ContractStageRecord>(async (from, to) => { const { data, error } = await supabase.from("execution_service_contract_stages").select("id,contract_item_id,stage_code,stage_name,description,measurement_mode,weight_percent,unit_snapshot,contracted_quantity,unit_price,total_value").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to); return { data: (data ?? []) as ContractStageRecord[], error }; }) : Promise.resolve({ data: [] as ContractStageRecord[], error: null }),
    permission("execution.contract_procurement.manage"), permission("execution.contract_procurement.approve"), permission("execution.contract_procurement.contract"),
  ]);

  const selectedBaseline = baselinesResult.data.find((item) => item.status === "approved") ?? baselinesResult.data[0] ?? null;
  const activitiesResult = selectedBaseline && projectId ? await fetchAllRows<ActivityOption>(async (from, to) => { const { data, error } = await supabase.from("engineering_schedule_activities").select("id,service_id,location_id,code,name,planned_start,planned_finish").eq("company_id", companyId).eq("project_id", projectId).eq("baseline_id", selectedBaseline.id).eq("record_status", "active").order("planned_start").range(from, to); return { data: (data ?? []) as ActivityOption[], error }; }) : { data: [] as ActivityOption[], error: null };

  const project = projectResult.data as Project | null;
  const requests = requestsResult.data;
  const competitions = competitionsResult.data;
  const contracts = contractsResult.data;
  const supplierMap = new Map(suppliersResult.data.map((item) => [item.id, item]));
  const requestMap = new Map(requests.map((item) => [item.id, item]));
  const requestItemMap = new Map<string, RequestItem[]>(); requestItemsResult.data.forEach((item) => requestItemMap.set(item.request_id!, [...(requestItemMap.get(item.request_id!) ?? []), item]));
  const offerMap = new Map<string, OfferRecord[]>(); offersResult.data.forEach((item) => offerMap.set(item.competition_id, [...(offerMap.get(item.competition_id) ?? []), item]));
  const offerItemMap = new Map<string, OfferItemRecord[]>(); offerItemsResult.data.forEach((item) => offerItemMap.set(item.offer_id!, [...(offerItemMap.get(item.offer_id!) ?? []), item]));
  const contractItemMap = new Map<string, ContractItemRecord[]>(); contractItemsResult.data.forEach((item) => contractItemMap.set(item.contract_id, [...(contractItemMap.get(item.contract_id) ?? []), item]));
  const stageMap = new Map<string, ContractStageRecord[]>(); stagesResult.data.forEach((item) => stageMap.set(item.contract_item_id, [...(stageMap.get(item.contract_item_id) ?? []), item]));
  const canManage = manageResult.data === true || privileged;
  const canApprove = approveResult.data === true || privileged;
  const canContract = contractResult.data === true || privileged;
  const structureError = requestsResult.error || requestItemsResult.error || competitionsResult.error || offersResult.error || stagesResult.error;
  const query = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const selectedRequest = params.request ? requests.find((item) => item.id === params.request) ?? null : null;
  const selectedCompetition = params.competition ? competitions.find((item) => item.id === params.competition) ?? null : null;
  const selectedContract = params.contract ? contracts.find((item) => item.id === params.contract) ?? null : null;
  const filteredRequests = requests.filter((item) => !params.status || item.status === params.status).filter((item) => !query || [item.request_number, item.title, item.scope_summary, item.requester_name].join(" ").toLocaleLowerCase("pt-BR").includes(query));
  const filteredCompetitions = competitions.filter((item) => !params.status || item.status === params.status).filter((item) => !query || [item.competition_number, item.title, requestMap.get(item.request_id)?.title].join(" ").toLocaleLowerCase("pt-BR").includes(query));
  const filteredContracts = contracts.filter((item) => !params.status || item.status === params.status).filter((item) => !query || [item.contract_number, item.title, supplierName(supplierMap.get(item.supplier_id))].join(" ").toLocaleLowerCase("pt-BR").includes(query));
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";
  const estimated = requestItemsResult.data.reduce((sum, item) => sum + Number(item.estimated_total), 0);
  const contracted = contracts.filter((item) => item.status !== "cancelled").reduce((sum, item) => sum + Number(item.current_value), 0);
  const approvedMaps = competitions.filter((item) => item.status === "approved").length;

  return <AppShell activeGroup="execution" activeItem="service-procurement" eyebrow="Execução · Contratações" title="Contratações de Serviços"
    description={`${company.name} · ${context} · solicitação, concorrência, aprovação, contrato e etapas de medição.`}
    actions={canManage && projectId && view === "requests" ? <ServiceRequestDialog budgets={budgetsResult.data} services={servicesResult.data} locations={locationsResult.data} activities={activitiesResult.data} autoOpen={params.new === "1"} /> : undefined}>
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {structureError ? <div className="auth-message error workspace-message">A nova estrutura ainda não está instalada. Execute a migration <strong>20260801_0067_service_contract_procurement.sql</strong>.</div> : null}
    {!projectId ? <div className="contract-workflow-empty">Selecione uma obra no topo.</div> : null}

    <section className="contract-workflow-kpis">
      <article><span>Solicitações abertas</span><strong>{requests.filter((item) => !["contracted", "cancelled"].includes(item.status)).length}</strong><small>{money(estimated)} estimados no histórico</small></article>
      <article><span>Mapas em andamento</span><strong>{competitions.filter((item) => ["collecting", "analysis"].includes(item.status)).length}</strong><small>{approvedMaps} mapa(s) aprovados</small></article>
      <article><span>Contratos gerados</span><strong>{contracts.filter((item) => item.source_competition_id).length}</strong><small>{money(contracted)} atualizados</small></article>
      <article><span>Serviços com etapas</span><strong>{new Set(stagesResult.data.map((item) => item.contract_item_id)).size}</strong><small>{stagesResult.data.length} etapas mensuráveis</small></article>
    </section>

    <section className="contract-workflow-flow">{[["1","Solicitação","Engenharia define o escopo"],["2","Concorrência","Fornecedores e propostas"],["3","Aprovação","Vencedor formalizado"],["4","Contrato","Condições e etapas"],["5","Medição","Produção por etapa"]].map(([step,title,caption]) => <div key={step}><i>{step}</i><strong>{title}</strong><span>{caption}</span></div>)}</section>

    <nav className="contract-workflow-tabs">
      <Link className={view === "requests" ? "active" : ""} href="?view=requests">1. Solicitações</Link>
      <Link className={view === "competitions" ? "active" : ""} href="?view=competitions">2–3. Concorrências</Link>
      <Link className={view === "contracts" ? "active" : ""} href="?view=contracts">4. Contratos e etapas</Link>
      <Link href="/execucao/medicoes-por-etapas">5. Medições por etapas</Link>
    </nav>

    {projectId ? <>
      <section className="contract-workflow-toolbar"><form method="get"><input type="hidden" name="view" value={view} /><input name="q" defaultValue={params.q ?? ""} placeholder="Buscar número, escopo ou fornecedor" /><select name="status" defaultValue={params.status ?? ""}><option value="">Todos os status</option>{Object.entries(view === "requests" ? requestLabels : view === "competitions" ? competitionLabels : contractLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select><button type="submit">Filtrar</button><Link href={`?view=${view}`}>Limpar</Link></form></section>

      {view === "requests" ? <section className="contract-workflow-card"><div className="budget-section-head"><div><span>Etapa 1</span><h2>Solicitações de serviços</h2></div><p>{filteredRequests.length} solicitação(ões)</p></div><div className="registry-table-wrap"><table className="registry-table service-request-table"><thead><tr><th>Solicitação</th><th>Escopo</th><th>Serviços</th><th>Prazo</th><th>Estimativa</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        {filteredRequests.map((request) => { const items = requestItemMap.get(request.id) ?? []; const total = items.reduce((sum, item) => sum + Number(item.estimated_total), 0); return <tr key={request.id} className={selectedRequest?.id === request.id ? "selected-row" : ""}><td><strong>{request.request_number}</strong><span>{request.requester_name || "—"}</span><small>{dateBR(request.created_at)}</small></td><td><strong>{request.title}</strong><span>{request.scope_summary}</span></td><td>{items.map((item) => <span key={item.id}>{item.service_code} · {item.service_name}<small>{number(item.requested_quantity)} {item.unit_snapshot} · {item.location_name || "Geral"}</small></span>)}</td><td><span>{dateBR(request.needed_start)}</span><small>até {dateBR(request.needed_finish)}</small></td><td><strong>{money(total)}</strong></td><td><span className={`workflow-status ${request.status}`}>{requestLabels[request.status]}</span></td><td><div className="workflow-actions">
          {canManage && ["draft", "submitted"].includes(request.status) ? <ServiceRequestDialog budgets={budgetsResult.data} services={servicesResult.data} locations={locationsResult.data} activities={activitiesResult.data} request={request} items={items} label="Editar" /> : null}
          {canManage && request.status === "draft" ? <form action={submitServiceRequest}><input type="hidden" name="request_id" value={request.id} /><button className="table-action" type="submit">Enviar</button></form> : null}
          {canApprove && request.status === "submitted" ? <form action={approveServiceRequest}><input type="hidden" name="request_id" value={request.id} /><input name="notes" placeholder="Nota da aprovação" /><button className="table-action" type="submit">Aprovar</button></form> : null}
          {canManage && request.status === "approved" ? <CompetitionStartDialog request={request} /> : null}
          {canApprove && ["draft", "submitted", "approved"].includes(request.status) ? <details><summary>Cancelar</summary><form action={cancelServiceRequest}><input type="hidden" name="request_id" value={request.id} /><input name="notes" required placeholder="Motivo" /><button className="danger" type="submit">Confirmar</button></form></details> : null}
        </div></td></tr>; })}
        {!filteredRequests.length ? <tr><td colSpan={7} className="empty-table">Nenhuma solicitação encontrada.</td></tr> : null}
      </tbody></table></div></section> : null}

      {view === "competitions" ? selectedCompetition ? <CompetitionDetail competition={selectedCompetition} request={requestMap.get(selectedCompetition.request_id) ?? null} requestItems={requestItemMap.get(selectedCompetition.request_id) ?? []} offers={offerMap.get(selectedCompetition.id) ?? []} offerItemMap={offerItemMap} suppliers={suppliersResult.data} supplierMap={supplierMap} canManage={canManage} canApprove={canApprove} canContract={canContract} /> : <section className="contract-workflow-card"><div className="budget-section-head"><div><span>Etapas 2 e 3</span><h2>Mapas de concorrência</h2></div><p>{filteredCompetitions.length} mapa(s)</p></div><div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Mapa</th><th>Solicitação</th><th>Propostas</th><th>Prazo</th><th>Vencedor</th><th>Status</th><th>Ação</th></tr></thead><tbody>
        {filteredCompetitions.map((competition) => { const offers = offerMap.get(competition.id) ?? []; return <tr key={competition.id}><td><strong>{competition.competition_number}</strong><span>{competition.title}</span></td><td>{requestMap.get(competition.request_id)?.request_number}<small>{requestMap.get(competition.request_id)?.title}</small></td><td><strong>{offers.length}</strong><small>{offers.filter((offer) => offer.status === "responded").length} válidas</small></td><td>{dateBR(competition.response_deadline)}</td><td>{supplierName(supplierMap.get(competition.winner_supplier_id ?? ""))}</td><td><span className={`workflow-status ${competition.status}`}>{competitionLabels[competition.status]}</span></td><td><Link className="table-action" href={`?view=competitions&competition=${competition.id}`}>Abrir mapa</Link></td></tr>; })}
        {!filteredCompetitions.length ? <tr><td colSpan={7} className="empty-table">Nenhum mapa encontrado.</td></tr> : null}
      </tbody></table></div></section> : null}

      {view === "contracts" ? <section className="contract-workflow-card"><div className="budget-section-head"><div><span>Etapa 4</span><h2>Contratos e etapas de medição</h2></div><p>{filteredContracts.length} contrato(s)</p></div><div className="registry-table-wrap"><table className="registry-table contract-stage-table"><thead><tr><th>Contrato</th><th>Fornecedor</th><th>Serviços principais</th><th>Etapas de medição</th><th>Valor / medido</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        {filteredContracts.map((contract) => { const items = contractItemMap.get(contract.id) ?? []; const stages = items.flatMap((item) => stageMap.get(item.id) ?? []); return <tr key={contract.id} className={selectedContract?.id === contract.id ? "selected-row" : ""}><td><strong>{contract.contract_number}</strong><span>{contract.title}</span><small>{contract.source_competition_id ? "Gerado por concorrência" : "Contrato anterior"}</small></td><td>{supplierName(supplierMap.get(contract.supplier_id))}</td><td>{items.map((item) => <span key={item.id}>{item.service_code} · {item.service_name}<small>{number(item.contracted_quantity)} {item.unit_snapshot}</small></span>)}</td><td>{items.map((item) => <div key={item.id}><strong>{item.service_name}</strong>{(stageMap.get(item.id) ?? []).map((stage) => <span key={stage.id}>{stage.stage_name} · {number(stage.weight_percent, 2)}% · {stage.measurement_mode === "quantity" ? stage.unit_snapshot : "%"}</span>)}</div>)}</td><td><strong>{money(contract.current_value)}</strong><small>{money(contract.measured_value)} medidos</small></td><td><span className={`workflow-status ${contract.status}`}>{contractLabels[contract.status]}</span></td><td><div className="workflow-actions"><Link className="table-action" href={`/execucao/contratos-servicos?contract=${contract.id}`}>Abrir contrato</Link>{canContract && contract.status === "draft" ? <ContractStagesDialog contractId={contract.id} items={items} stages={stages} /> : null}<Link className="table-action" href={`/execucao/medicoes-por-etapas?contract=${contract.id}`}>Medir etapas</Link></div></td></tr>; })}
        {!filteredContracts.length ? <tr><td colSpan={7} className="empty-table">Nenhum contrato encontrado.</td></tr> : null}
      </tbody></table></div></section> : null}
    </> : null}
  </AppShell>;
}

function CompetitionDetail({ competition, request, requestItems, offers, offerItemMap, suppliers, supplierMap, canManage, canApprove, canContract }: {
  competition: CompetitionRow; request: RequestRow | null; requestItems: RequestItem[]; offers: OfferRecord[]; offerItemMap: Map<string, OfferItemRecord[]>;
  suppliers: SupplierOption[]; supplierMap: Map<string, SupplierOption>; canManage: boolean; canApprove: boolean; canContract: boolean;
}) {
  const winner = competition.winner_offer_id ? offers.find((offer) => offer.id === competition.winner_offer_id) ?? null : null;
  const winnerItems = winner ? offerItemMap.get(winner.id) ?? [] : [];
  return <section className="competition-detail">
    <div className="competition-detail-head"><div><Link href="?view=competitions">← Voltar aos mapas</Link><span>{competition.competition_number}</span><h2>{competition.title}</h2><p>{request?.scope_summary}</p></div><div><span className={`workflow-status ${competition.status}`}>{competitionLabels[competition.status]}</span>{canManage && ["collecting", "analysis"].includes(competition.status) ? <CompetitionOfferDialog competition={competition} requestItems={requestItems} suppliers={suppliers} /> : null}</div></div>
    <section className="competition-context"><article><span>Solicitação</span><strong>{request?.request_number}</strong><small>{request?.title}</small></article><article><span>Prazo das propostas</span><strong>{dateBR(competition.response_deadline)}</strong><small>{competition.award_criteria}</small></article><article><span>Participantes</span><strong>{offers.length}</strong><small>{offers.filter((offer) => offer.status === "responded").length} propostas válidas</small></article><article><span>Vencedor</span><strong>{supplierName(supplierMap.get(competition.winner_supplier_id ?? ""))}</strong><small>{winner ? money(winner.total_amount) : "Aguardando aprovação"}</small></article></section>
    <section className="contract-workflow-card"><div className="budget-section-head"><div><span>Mapa comparativo</span><h2>Propostas recebidas</h2></div><p>Preço, prazo, atendimento técnico e condição de pagamento.</p></div><div className="registry-table-wrap"><table className="registry-table competition-offer-table"><thead><tr><th>Fornecedor</th><th>Itens</th><th>Total</th><th>Prazo</th><th>Pagamento</th><th>Notas</th><th>Status</th><th>Ações</th></tr></thead><tbody>
      {offers.map((offer) => { const items = offerItemMap.get(offer.id) ?? []; return <tr key={offer.id} className={offer.status === "winner" ? "winner-row" : ""}><td><strong>{supplierName(supplierMap.get(offer.supplier_id))}</strong><span>{offer.proposal_number || "Sem número"}</span><small>{dateBR(offer.proposal_date)}</small></td><td>{items.map((item) => { const requestItem = requestItems.find((entry) => entry.id === item.request_item_id); return <span key={item.id}>{requestItem?.service_name}<small>{number(item.offered_quantity)} {requestItem?.unit_snapshot} · {money(item.unit_price)}/{requestItem?.unit_snapshot} · {item.meets_specification ? "Atende" : "Não atende"}</small></span>; })}</td><td><strong>{money(offer.total_amount)}</strong></td><td>{dateBR(offer.proposed_start)}<small>até {dateBR(offer.proposed_finish)}</small></td><td>{offer.payment_days} dias</td><td><span>Técnica: {offer.technical_score ?? "—"}</span><small>Comercial: {offer.commercial_score ?? "—"}</small></td><td><span className={`workflow-status ${offer.status}`}>{offer.status === "winner" ? "Vencedora" : offer.status === "responded" ? "Válida" : offer.status}</span></td><td>{canManage && offer.status === "responded" && competition.status !== "approved" ? <CompetitionOfferDialog competition={competition} requestItems={requestItems} suppliers={suppliers} offer={offer} offerItems={items} label="Editar" /> : null}</td></tr>; })}
      {!offers.length ? <tr><td colSpan={8} className="empty-table">Inclua pelo menos uma proposta para formar o mapa.</td></tr> : null}
    </tbody></table></div></section>
    {canApprove && ["collecting", "analysis"].includes(competition.status) && offers.some((offer) => offer.status === "responded") ? <section className="competition-approval"><div><span>Etapa 3</span><h3>Aprovar mapa e definir vencedor</h3><p>A aprovação congela as propostas. A escolha não é limitada ao menor preço e deve considerar o critério registrado.</p></div><form action={approveServiceCompetition}><input type="hidden" name="competition_id" value={competition.id} /><select name="winner_offer_id" required><option value="">Selecione a proposta vencedora</option>{offers.filter((offer) => offer.status === "responded").map((offer) => <option key={offer.id} value={offer.id}>{supplierName(supplierMap.get(offer.supplier_id))} · {money(offer.total_amount)} · {offer.payment_days} dias</option>)}</select><textarea name="approval_notes" rows={3} placeholder="Justificativa técnica e comercial da escolha" required /><button type="submit">Aprovar mapa</button></form></section> : null}
    {canContract && competition.status === "approved" && winner && request && !competition.generated_contract_id ? <ContractGenerationDialog competition={competition} request={request} requestItems={requestItems} winningOffer={winner} winningItems={winnerItems} supplier={supplierMap.get(winner.supplier_id) ?? null} /> : null}
    {competition.generated_contract_id ? <div className="auth-message success workspace-message">Contrato já gerado. <Link href={`/execucao/contratos-servicos?contract=${competition.generated_contract_id}`}>Abrir contrato</Link></div> : null}
  </section>;
}
