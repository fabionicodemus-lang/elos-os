import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  cancelWorkOrder, pauseWorkOrder, releaseWorkOrder, removeWorkOrderDocument, requestWorkOrderAcceptance,
  resumeWorkOrder, startWorkOrder, uploadWorkOrderDocuments,
} from "./actions";
import {
  WorkOrderAcceptanceForm, WorkOrderDialog, WorkOrderProgressForm,
  type ContractItemOption, type ContractOption, type PrerequisiteRecord, type WorkOrderItemRecord, type WorkOrderRecord,
} from "./work-order-client";
import "../../execution-work-orders.css";

type Project = { id: string; code: string | null; name: string };
type WorkOrderIndicators = {
  order_count: number;
  active_count: number;
  pending_acceptance_count: number;
  authorized_total: number;
  executed_total: number;
};
type Supplier = { id: string; legal_name: string; trade_name: string | null; tax_id: string | null };
type Contract = { id: string; contract_number: string; title: string; supplier_id: string; start_date: string; end_date: string; status: string };
type ContractItem = { id: string; contract_id: string; service_code: string; service_name: string; location_name: string | null; unit_snapshot: string; unit_price: number; contracted_quantity: number; planned_start: string | null; planned_finish: string | null };
type WorkOrder = WorkOrderRecord & {
  company_id: string; project_id: string; supplier_id: string; sequence_no: number; work_order_number: string;
  authorized_value: number; executed_value: number; accepted_value: number; measured_value: number;
  responsible_name: string | null; actual_start: string | null; actual_finish: string | null; pause_reason: string | null;
  acceptance_result: string | null; acceptance_notes: string | null; cancellation_reason: string | null;
  released_at: string | null; acceptance_requested_at: string | null; created_at: string;
};
type WorkOrderItem = WorkOrderItemRecord & { work_order_id: string; contract_id: string };
type Prerequisite = PrerequisiteRecord & { id: string; work_order_id: string; sort_order: number };
type Acceptance = { id: string; work_order_id: string; sequence_no: number; result: string; quality_status: string; quality_reference: string | null; notes: string | null; punch_list: unknown; accepted_at: string };
type Document = { id: string; work_order_id: string; document_type: string; storage_path: string; file_name: string; caption: string | null; uploaded_at: string };
type SignedDocument = Document & { signed_url: string | null };

const statusLabels: Record<string, string> = { draft: "Em elaboração", released: "Liberada", in_progress: "Em execução", paused: "Pausada", pending_acceptance: "Aguardando aceite", finished: "Concluída", cancelled: "Cancelada" };
const acceptanceLabels: Record<string, string> = { approved: "Aprovada", approved_with_remarks: "Aprovada com ressalvas", rejected: "Devolvida" };
const qualityLabels: Record<string, string> = { passed: "Qualidade aprovada", waived: "Dispensada", pending: "Pendente" };
const documentLabels: Record<string, string> = { work_order: "Ordem de serviço", project: "Projeto", safety: "Segurança", evidence: "Evidência", acceptance: "Aceite", other: "Outro" };
function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function number(value: number, digits = 2) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0)); }
function dateBR(value?: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : "—"; }
function supplierName(supplier?: Supplier | null) { return supplier ? supplier.trade_name || supplier.legal_name : "Fornecedor não localizado"; }

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<{ work_order?: string; q?: string; status?: string; new?: string; edit?: string; success?: string; error?: string }> }) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("execution.work_orders.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const permission = (key: string) => privileged ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: key });

  const [projectResult, suppliersResult, contractsResult, contractItemsResult, ordersResult, orderItemsResult, prerequisitesResult, acceptancesResult, documentsResult, manageResult, releaseResult, progressResult, acceptResult, cancelResult] = await Promise.all([
    projectId ? supabase.from("projects").select("id,code,name").eq("id", projectId).eq("company_id", companyId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    fetchAllRows<Supplier>(async (from, to) => { const { data, error } = await supabase.from("suppliers").select("id,legal_name,trade_name,tax_id").eq("company_id", companyId).order("legal_name").range(from, to); return { data: (data ?? []) as Supplier[], error }; }),
    projectId ? fetchAllRows<Contract>(async (from, to) => { const { data, error } = await supabase.from("execution_service_contracts").select("id,contract_number,title,supplier_id,start_date,end_date,status").eq("company_id", companyId).eq("project_id", projectId).order("contract_number").range(from, to); return { data: (data ?? []) as Contract[], error }; }) : Promise.resolve({ data: [] as Contract[], error: null }),
    projectId ? fetchAllRows<ContractItem>(async (from, to) => { const { data, error } = await supabase.from("execution_service_contract_items").select("id,contract_id,service_code,service_name,location_name,unit_snapshot,unit_price,contracted_quantity,planned_start,planned_finish").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to); return { data: (data ?? []) as ContractItem[], error }; }) : Promise.resolve({ data: [] as ContractItem[], error: null }),
    projectId ? fetchAllRows<WorkOrder>(async (from, to) => { const { data, error } = await supabase.from("execution_work_orders").select("id,company_id,project_id,contract_id,supplier_id,sequence_no,work_order_number,title,scope_summary,status,planned_start,planned_finish,actual_start,actual_finish,authorized_value,executed_value,accepted_value,measured_value,responsible_name,supplier_contact_name,supplier_contact_phone,site_instructions,safety_instructions,quality_requirements,notes,pause_reason,acceptance_result,acceptance_notes,cancellation_reason,released_at,acceptance_requested_at,created_at").eq("company_id", companyId).eq("project_id", projectId).order("created_at", { ascending: false }).range(from, to); return { data: (data ?? []) as WorkOrder[], error }; }) : Promise.resolve({ data: [] as WorkOrder[], error: null }),
    projectId ? fetchAllRows<WorkOrderItem>(async (from, to) => { const { data, error } = await supabase.from("execution_work_order_items").select("id,work_order_id,contract_id,contract_item_id,service_code,service_name,location_name,unit_snapshot,unit_price,authorized_quantity,authorized_value,executed_quantity,executed_value,accepted_quantity,accepted_value,measured_quantity,measured_value,planned_start,planned_finish,scope_notes").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to); return { data: (data ?? []) as WorkOrderItem[], error }; }) : Promise.resolve({ data: [] as WorkOrderItem[], error: null }),
    projectId ? fetchAllRows<Prerequisite>(async (from, to) => { const { data, error } = await supabase.from("execution_work_order_prerequisites").select("id,work_order_id,code,title,is_required,is_completed,notes,sort_order").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to); return { data: (data ?? []) as Prerequisite[], error }; }) : Promise.resolve({ data: [] as Prerequisite[], error: null }),
    projectId ? fetchAllRows<Acceptance>(async (from, to) => { const { data, error } = await supabase.from("execution_work_order_acceptances").select("id,work_order_id,sequence_no,result,quality_status,quality_reference,notes,punch_list,accepted_at").eq("company_id", companyId).eq("project_id", projectId).order("accepted_at", { ascending: false }).range(from, to); return { data: (data ?? []) as Acceptance[], error }; }) : Promise.resolve({ data: [] as Acceptance[], error: null }),
    projectId ? fetchAllRows<Document>(async (from, to) => { const { data, error } = await supabase.from("execution_work_order_documents").select("id,work_order_id,document_type,storage_path,file_name,caption,uploaded_at").eq("company_id", companyId).eq("project_id", projectId).order("uploaded_at", { ascending: false }).range(from, to); return { data: (data ?? []) as Document[], error }; }) : Promise.resolve({ data: [] as Document[], error: null }),
    permission("execution.work_orders.manage"), permission("execution.work_orders.release"), permission("execution.work_orders.progress"), permission("execution.work_orders.accept"), permission("execution.work_orders.cancel"),
  ]);

  const project = projectResult.data as Project | null;
  const suppliers = suppliersResult.data;
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const contracts = contractsResult.data;
  const contractMap = new Map(contracts.map((contract) => [contract.id, contract]));
  const orders = ordersResult.data;
  const orderMap = new Map(orders.map((order) => [order.id, order]));
  const orderItemMap = new Map<string, WorkOrderItem[]>();
  orderItemsResult.data.forEach((item) => orderItemMap.set(item.work_order_id, [...(orderItemMap.get(item.work_order_id) ?? []), item]));
  const prerequisiteMap = new Map<string, Prerequisite[]>();
  prerequisitesResult.data.forEach((item) => prerequisiteMap.set(item.work_order_id, [...(prerequisiteMap.get(item.work_order_id) ?? []), item]));
  const acceptanceMap = new Map<string, Acceptance[]>();
  acceptancesResult.data.forEach((item) => acceptanceMap.set(item.work_order_id, [...(acceptanceMap.get(item.work_order_id) ?? []), item]));
  const documentMap = new Map<string, Document[]>();
  documentsResult.data.forEach((item) => documentMap.set(item.work_order_id, [...(documentMap.get(item.work_order_id) ?? []), item]));

  const authorizedByContractItem = new Map<string, number>();
  orderItemsResult.data.forEach((item) => { if (orderMap.get(item.work_order_id)?.status !== "cancelled") authorizedByContractItem.set(item.contract_item_id, (authorizedByContractItem.get(item.contract_item_id) ?? 0) + Number(item.authorized_quantity)); });
  const contractOptions: ContractOption[] = contracts.filter((contract) => contract.status === "active").map((contract) => ({
    id: contract.id, contract_number: contract.contract_number, title: contract.title, supplier_name: supplierName(supplierMap.get(contract.supplier_id)), start_date: contract.start_date, end_date: contract.end_date,
  }));
  const contractItemOptions: ContractItemOption[] = contractItemsResult.data.map((item) => ({ ...item, available_quantity: Math.max(0, Number(item.contracted_quantity) - Number(authorizedByContractItem.get(item.id) ?? 0)) }));

  const selected = params.work_order ? orders.find((order) => order.id === params.work_order) ?? null : null;
  const selectedItems = selected ? orderItemMap.get(selected.id) ?? [] : [];
  const selectedPrerequisites = selected ? prerequisiteMap.get(selected.id) ?? [] : [];
  const selectedAcceptances = selected ? acceptanceMap.get(selected.id) ?? [] : [];
  const selectedDocuments = selected ? documentMap.get(selected.id) ?? [] : [];
  let signedDocuments: SignedDocument[] = [];
  if (selectedDocuments.length) {
    const signed = await supabase.storage.from("work-order-documents").createSignedUrls(selectedDocuments.map((document) => document.storage_path), 3600);
    const urlMap = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));
    signedDocuments = selectedDocuments.map((document) => ({ ...document, signed_url: urlMap.get(document.storage_path) ?? null }));
  }

  const canManage = manageResult.data === true || privileged;
  const canRelease = releaseResult.data === true || privileged;
  const canProgress = progressResult.data === true || privileged;
  const canAccept = acceptResult.data === true || privileged;
  const canCancel = cancelResult.data === true || privileged;
  const structureError = ordersResult.error || orderItemsResult.error || prerequisitesResult.error || acceptancesResult.error || documentsResult.error;
  const query = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const filtered = orders.filter((order) => !params.status || order.status === params.status).filter((order) => !query || [order.work_order_number, order.title, order.scope_summary, contractMap.get(order.contract_id)?.contract_number, supplierName(supplierMap.get(order.supplier_id))].join(" ").toLocaleLowerCase("pt-BR").includes(query));
  // Indicadores agregados no banco, cobrindo toda a obra sem depender das linhas
  // carregadas nesta página. Equivalência coberta por
  // supabase/tests/20260806_0081_work_order_indicators.sql.
  const indicatorsResult = projectId
    ? await supabase.rpc("execution_work_order_indicators", { p_company_id: companyId, p_project_id: projectId })
    : { data: null, error: null };
  const indicators = (indicatorsResult.data as WorkOrderIndicators | null) ?? {
    order_count: 0, active_count: 0, pending_acceptance_count: 0, authorized_total: 0, executed_total: 0,
  };
  const authorizedTotal = Number(indicators.authorized_total);
  const executedTotal = Number(indicators.executed_total);
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";

  return <AppShell activeGroup="execution" activeItem="work-orders" eyebrow="Execução · Serviços" title="Ordens de Serviço" description={`${company.name} · ${context} · liberação formal das frentes, execução, qualidade e aceite técnico.`}
    actions={canManage && projectId && contractOptions.length ? <WorkOrderDialog contracts={contractOptions} contractItems={contractItemOptions} autoOpen={params.new === "1"} /> : undefined}>
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {structureError ? <div className="auth-message error workspace-message">A estrutura de ordens de serviço ainda não está instalada. Execute a migration <strong>20260729_0040_execution_work_orders.sql</strong>.</div> : null}
    {!projectId ? <div className="work-order-empty">Selecione uma obra no topo.</div> : null}
    {projectId && !contractOptions.length && !orders.length ? <div className="work-order-empty"><strong>Nenhum contrato ativo.</strong><p>Ative um contrato de serviços antes de emitir a primeira O.S.</p><Link href="/execucao/contratos-servicos">Abrir contratos</Link></div> : null}

    {projectId && selected ? <WorkOrderDetail order={selected} contract={contractMap.get(selected.contract_id) ?? null} supplier={supplierMap.get(selected.supplier_id) ?? null}
      items={selectedItems} prerequisites={selectedPrerequisites} acceptances={selectedAcceptances} documents={signedDocuments}
      contracts={contractOptions} contractItems={contractItemOptions} canManage={canManage} canRelease={canRelease} canProgress={canProgress} canAccept={canAccept} canCancel={canCancel} autoEdit={params.edit === "1"} /> : projectId && (contractOptions.length || orders.length) ? <>
      <section className="work-order-kpis"><article><span>Ordens cadastradas</span><strong>{indicators.order_count}</strong><small>incluindo elaboração e histórico</small></article><article><span>Frentes ativas</span><strong>{indicators.active_count}</strong><small>liberadas ou em execução</small></article><article><span>Valor autorizado</span><strong>{money(authorizedTotal)}</strong><small>ordens não canceladas</small></article><article><span>Valor executado</span><strong>{money(executedTotal)}</strong><small>{authorizedTotal ? number(executedTotal / authorizedTotal * 100, 1) : "0"}% autorizado</small></article><article><span>Aguardando aceite</span><strong>{indicators.pending_acceptance_count}</strong><small>pendência da engenharia</small></article></section>
      <section className="work-order-toolbar"><form method="get"><input name="q" defaultValue={params.q ?? ""} placeholder="Buscar O.S., contrato, fornecedor ou escopo" /><select name="status" defaultValue={params.status ?? ""}><option value="">Todos os status</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button type="submit">Filtrar</button><Link href="/execucao/ordens-servico">Limpar</Link></form></section>
      <section className="work-order-list-card"><div className="budget-section-head"><div><span>Frentes formalizadas</span><h2>Ordens de serviço da obra</h2></div><p>{filtered.length} registro(s)</p></div><div className="registry-table-wrap"><table className="registry-table work-order-table"><thead><tr><th>O.S.</th><th>Contrato / prestador</th><th>Escopo</th><th>Período</th><th>Autorizado</th><th>Executado</th><th>Progresso</th><th>Status</th></tr></thead><tbody>{filtered.map((order) => <tr key={order.id}><td><Link href={`?work_order=${order.id}`}><strong>{order.work_order_number}</strong><span>{order.title}</span></Link></td><td><strong>{contractMap.get(order.contract_id)?.contract_number}</strong><span>{supplierName(supplierMap.get(order.supplier_id))}</span></td><td><span className="work-order-scope-preview">{order.scope_summary}</span><small>{(orderItemMap.get(order.id) ?? []).length} item(ns)</small></td><td>{dateBR(order.planned_start)}<span>até {dateBR(order.planned_finish)}</span></td><td><strong>{money(order.authorized_value)}</strong></td><td>{money(order.executed_value)}</td><td><strong>{order.authorized_value ? number(order.executed_value / order.authorized_value * 100, 1) : "0"}%</strong></td><td><span className={`work-order-status ${order.status}`}>{statusLabels[order.status]}</span></td></tr>)}{!filtered.length ? <tr><td colSpan={8} className="budget-empty-state">Nenhuma ordem de serviço encontrada.</td></tr> : null}</tbody></table></div></section>
    </> : null}
  </AppShell>;
}

function WorkOrderDetail({ order, contract, supplier, items, prerequisites, acceptances, documents, contracts, contractItems, canManage, canRelease, canProgress, canAccept, canCancel, autoEdit }: {
  order: WorkOrder; contract: Contract | null; supplier: Supplier | null; items: WorkOrderItem[]; prerequisites: Prerequisite[]; acceptances: Acceptance[]; documents: SignedDocument[];
  contracts: ContractOption[]; contractItems: ContractItemOption[]; canManage: boolean; canRelease: boolean; canProgress: boolean; canAccept: boolean; canCancel: boolean; autoEdit: boolean;
}) {
  const completedRequired = prerequisites.filter((item) => item.is_required && item.is_completed).length;
  const required = prerequisites.filter((item) => item.is_required).length;
  return <>
    <div className="work-order-back"><Link href="/execucao/ordens-servico">← Voltar às ordens</Link><span>{order.work_order_number}</span></div>
    <section className="work-order-hero"><div><span>Ordem de serviço</span><h2>{order.work_order_number} · {order.title}</h2><p>{contract?.contract_number} · {supplierName(supplier)}</p></div><div><span className={`work-order-status ${order.status}`}>{statusLabels[order.status]}</span>{canManage && order.status === "draft" ? <WorkOrderDialog contracts={contracts} contractItems={contractItems} workOrder={order} items={items} prerequisites={prerequisites} autoOpen={autoEdit} label="Editar O.S." /> : null}</div></section>
    <section className="work-order-detail-kpis"><article><span>Valor autorizado</span><strong>{money(order.authorized_value)}</strong><small>{items.length} item(ns)</small></article><article><span>Valor executado</span><strong>{money(order.executed_value)}</strong><small>{order.authorized_value ? number(order.executed_value / order.authorized_value * 100, 1) : "0"}%</small></article><article><span>Valor aceito</span><strong>{money(order.accepted_value)}</strong><small>liberado tecnicamente</small></article><article><span>Valor medido</span><strong>{money(order.measured_value)}</strong><small>vinculado a medições</small></article><article><span>Pré-requisitos</span><strong>{completedRequired}/{required}</strong><small>obrigatórios concluídos</small></article><article><span>Prazo</span><strong>{dateBR(order.planned_finish)}</strong><small>{dateBR(order.planned_start)} a {dateBR(order.planned_finish)}</small></article></section>

    <section className="work-order-detail-grid"><article className="work-order-card wide"><div className="work-order-card-title"><div><span>Escopo formal</span><h3>Objeto e instruções</h3></div></div><p className="work-order-scope-full">{order.scope_summary}</p><dl className="work-order-facts"><div><dt>Responsável interno</dt><dd>{order.responsible_name || "—"}</dd></div><div><dt>Contato do prestador</dt><dd>{order.supplier_contact_name || "—"}</dd></div><div><dt>Telefone</dt><dd>{order.supplier_contact_phone || "—"}</dd></div><div><dt>Início real</dt><dd>{dateBR(order.actual_start)}</dd></div></dl>{order.site_instructions ? <div className="work-order-note"><strong>Frente de serviço</strong><p>{order.site_instructions}</p></div> : null}{order.safety_instructions ? <div className="work-order-note safety"><strong>Segurança</strong><p>{order.safety_instructions}</p></div> : null}{order.quality_requirements ? <div className="work-order-note quality"><strong>Qualidade</strong><p>{order.quality_requirements}</p></div> : null}</article>
      <article className="work-order-card"><div className="work-order-card-title"><div><span>Liberação</span><h3>Pré-requisitos</h3></div><strong>{completedRequired}/{required}</strong></div><div className="work-order-check-list">{prerequisites.map((item) => <div key={item.id} className={item.is_completed ? "done" : "pending"}><span>{item.is_completed ? "✓" : "!"}</span><div><strong>{item.title}</strong><small>{item.is_required ? "Obrigatório" : "Opcional"}{item.notes ? ` · ${item.notes}` : ""}</small></div></div>)}{!prerequisites.length ? <p>Nenhum pré-requisito informado.</p> : null}</div></article></section>

    <section className="work-order-card"><div className="work-order-card-title"><div><span>Escopo autorizado</span><h3>Serviços, locais e avanço</h3></div><strong>{money(order.authorized_value)}</strong></div><div className="registry-table-wrap"><table className="registry-table work-order-items-table"><thead><tr><th>Serviço / local</th><th>Período</th><th>Autorizado</th><th>Executado</th><th>Aceito</th><th>Medido</th><th>Progresso</th><th>Valor</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.service_code} · {item.service_name}</strong><span>{item.location_name || "Todos os locais"}</span>{item.scope_notes ? <small>{item.scope_notes}</small> : null}</td><td>{dateBR(item.planned_start)}<span>até {dateBR(item.planned_finish)}</span></td><td>{number(item.authorized_quantity, 4)} {item.unit_snapshot}</td><td>{number(item.executed_quantity, 4)} {item.unit_snapshot}</td><td>{number(item.accepted_quantity, 4)} {item.unit_snapshot}</td><td>{number(item.measured_quantity, 4)} {item.unit_snapshot}</td><td><strong>{item.authorized_quantity ? number(item.executed_quantity / item.authorized_quantity * 100, 1) : "0"}%</strong></td><td><strong>{money(item.authorized_value)}</strong><span>{money(item.executed_value)} executado</span></td></tr>)}</tbody></table></div></section>

    <section className="work-order-detail-grid">{canProgress && ["released", "in_progress", "paused"].includes(order.status) ? <article className="work-order-card wide"><WorkOrderProgressForm workOrderId={order.id} items={items} /></article> : <article className="work-order-card wide"><div className="work-order-card-title"><div><span>Histórico de aceite</span><h3>Inspeções e encerramento</h3></div></div>{acceptances.length ? <div className="work-order-acceptance-list">{acceptances.map((acceptance) => <div key={acceptance.id}><div><strong>Aceite {acceptance.sequence_no} · {acceptanceLabels[acceptance.result]}</strong><span>{dateBR(acceptance.accepted_at)}</span></div><p>{qualityLabels[acceptance.quality_status]}{acceptance.quality_reference ? ` · ${acceptance.quality_reference}` : ""}</p>{acceptance.notes ? <small>{acceptance.notes}</small> : null}</div>)}</div> : <p className="work-order-muted">Nenhum aceite registrado.</p>}</article>}
      <article className="work-order-card"><div className="work-order-card-title"><div><span>Arquivo privado</span><h3>Documentos</h3></div><strong>{documents.length}</strong></div>{documents.length ? <div className="work-order-document-list">{documents.map((document) => <div key={document.id}><div><strong>{document.file_name}</strong><small>{documentLabels[document.document_type]} · {dateBR(document.uploaded_at)}</small></div>{document.signed_url ? <a href={document.signed_url} target="_blank" rel="noreferrer">Abrir</a> : null}{canManage && order.status === "draft" ? <form action={removeWorkOrderDocument}><input type="hidden" name="work_order_id" value={order.id} /><input type="hidden" name="document_id" value={document.id} /><button type="submit">Remover</button></form> : null}</div>)}</div> : <p className="work-order-muted">Nenhum documento anexado.</p>}{canProgress && order.status !== "cancelled" ? <form action={uploadWorkOrderDocuments} className="work-order-upload-form" encType="multipart/form-data"><input type="hidden" name="work_order_id" value={order.id} /><label>Tipo<select name="document_type"><option value="work_order">Ordem de serviço</option><option value="project">Projeto</option><option value="safety">Segurança</option><option value="evidence">Evidência</option><option value="acceptance">Aceite</option><option value="other">Outro</option></select></label><label>Arquivos<input name="documents" type="file" multiple accept="application/pdf,image/*,.docx" /></label><label>Legenda<input name="caption" /></label><button type="submit">Anexar</button></form> : null}</article></section>

    {canAccept && order.status === "pending_acceptance" ? <section className="work-order-card"><WorkOrderAcceptanceForm workOrderId={order.id} /></section> : null}
    <section className="work-order-workflow"><div><span>Fluxo operacional</span><h3>Ações disponíveis</h3><p>A medição futura poderá ser vinculada aos itens aceitos desta O.S.</p></div><div className="work-order-workflow-actions">{canRelease && order.status === "draft" ? <form action={releaseWorkOrder}><input type="hidden" name="work_order_id" value={order.id} /><button className="primary" type="submit">Liberar O.S.</button></form> : null}{canRelease && order.status === "released" ? <form action={startWorkOrder}><input type="hidden" name="work_order_id" value={order.id} /><button className="primary" type="submit">Iniciar execução</button></form> : null}{canProgress && order.status === "in_progress" ? <form action={pauseWorkOrder} className="inline-reason"><input type="hidden" name="work_order_id" value={order.id} /><input name="reason" required placeholder="Motivo da pausa" /><button type="submit">Pausar</button></form> : null}{canProgress && order.status === "paused" ? <form action={resumeWorkOrder}><input type="hidden" name="work_order_id" value={order.id} /><button className="primary" type="submit">Retomar</button></form> : null}{canProgress && ["in_progress", "paused"].includes(order.status) ? <form action={requestWorkOrderAcceptance}><input type="hidden" name="work_order_id" value={order.id} /><button type="submit">Solicitar aceite</button></form> : null}{canCancel && !["pending_acceptance", "finished", "cancelled"].includes(order.status) ? <form action={cancelWorkOrder} className="inline-reason"><input type="hidden" name="work_order_id" value={order.id} /><input name="reason" required placeholder="Motivo do cancelamento" /><button className="danger" type="submit">Cancelar</button></form> : null}</div></section>
  </>;
}
