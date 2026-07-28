import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  activateServiceContract,
  addServiceContractAmendment,
  cancelServiceContract,
  finishServiceContract,
  removeServiceContractDocument,
  resumeServiceContract,
  suspendServiceContract,
  uploadServiceContractDocuments,
} from "./actions";
import {
  ServiceContractDialog,
  type ActivityOption,
  type BudgetOption,
  type ContractItem,
  type ContractRecord,
  type LocationOption,
  type ServiceOption,
  type SupplierOption,
} from "./contract-client";
import "../../execution-service-contracts.css";

type Project = { id: string; code: string | null; name: string };
type Contract = ContractRecord & {
  company_id: string; project_id: string; sequence_no: number; contract_number: string;
  original_value: number; amendments_value: number; current_value: number; measured_value: number;
  retained_value: number; invoiced_value: number; paid_value: number; responsible_name: string | null;
  activated_at: string | null; finished_at: string | null; cancellation_reason: string | null; created_at: string;
};
type Amendment = { id: string; contract_id: string; amendment_number: string; amendment_type: string; description: string; value_change: number; previous_end_date: string | null; new_end_date: string | null; justification: string; approved_at: string };
type Document = { id: string; contract_id: string; document_type: string; storage_path: string; file_name: string; caption: string | null; uploaded_at: string };
type SignedDocument = Document & { signed_url: string | null };
type Baseline = { id: string; status: string };

const statusLabels: Record<string, string> = { draft: "Em elaboração", active: "Ativo", suspended: "Suspenso", finished: "Concluído", cancelled: "Cancelado" };
const amendmentLabels: Record<string, string> = { addition: "Acréscimo", suppression: "Supressão", time: "Prazo", mixed: "Valor e prazo" };
const documentLabels: Record<string, string> = { contract: "Contrato", proposal: "Proposta", insurance: "Seguro", certificate: "Certidão", amendment: "Aditivo", termination: "Distrato", other: "Outro" };
function money(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function number(value: number, digits = 2) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value || 0)); }
function dateBR(value?: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : "—"; }
function supplierName(supplier?: SupplierOption | null) { return supplier ? supplier.trade_name || supplier.legal_name : "Fornecedor não localizado"; }

export default async function ServiceContractsPage({ searchParams }: {
  searchParams: Promise<{ contract?: string; q?: string; status?: string; new?: string; edit?: string; success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("execution.contracts.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const permission = (key: string) => privileged ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: key });

  const [projectResult, contractsResult, itemsResult, amendmentsResult, documentsResult, suppliersResult, budgetsResult, servicesResult, locationsResult, baselinesResult, manageResult, approveResult, amendResult, cancelResult] = await Promise.all([
    projectId ? supabase.from("projects").select("id,code,name").eq("id", projectId).eq("company_id", companyId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    projectId ? fetchAllRows<Contract>(async (from, to) => {
      const { data, error } = await supabase.from("execution_service_contracts").select("id,company_id,project_id,supplier_id,budget_id,sequence_no,contract_number,title,scope_summary,status,signed_date,start_date,end_date,original_value,amendments_value,current_value,measured_value,retained_value,invoiced_value,paid_value,retention_percent,guarantee_percent,guarantee_months,payment_days,adjustment_index,adjustment_base_date,contact_name,contact_phone,contact_email,notes,responsible_name,activated_at,finished_at,cancellation_reason,created_at").eq("company_id", companyId).eq("project_id", projectId).order("created_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as Contract[], error };
    }) : Promise.resolve({ data: [] as Contract[], error: null }),
    projectId ? fetchAllRows<ContractItem & { contract_id: string }>(async (from, to) => {
      const { data, error } = await supabase.from("execution_service_contract_items").select("id,contract_id,service_id,location_id,schedule_activity_id,service_code,service_name,location_name,unit_snapshot,contracted_quantity,unit_price,total_value,measured_quantity,measured_value,planned_start,planned_finish,scope_notes").eq("company_id", companyId).eq("project_id", projectId).order("sort_order").range(from, to);
      return { data: (data ?? []) as (ContractItem & { contract_id: string })[], error };
    }) : Promise.resolve({ data: [] as (ContractItem & { contract_id: string })[], error: null }),
    projectId ? fetchAllRows<Amendment>(async (from, to) => {
      const { data, error } = await supabase.from("execution_service_contract_amendments").select("id,contract_id,amendment_number,amendment_type,description,value_change,previous_end_date,new_end_date,justification,approved_at").eq("company_id", companyId).eq("project_id", projectId).order("approved_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as Amendment[], error };
    }) : Promise.resolve({ data: [] as Amendment[], error: null }),
    projectId ? fetchAllRows<Document>(async (from, to) => {
      const { data, error } = await supabase.from("execution_service_contract_documents").select("id,contract_id,document_type,storage_path,file_name,caption,uploaded_at").eq("company_id", companyId).eq("project_id", projectId).order("uploaded_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as Document[], error };
    }) : Promise.resolve({ data: [] as Document[], error: null }),
    fetchAllRows<SupplierOption>(async (from, to) => {
      const { data, error } = await supabase.from("suppliers").select("id,legal_name,trade_name,tax_id").eq("company_id", companyId).eq("status", "active").order("legal_name").range(from, to);
      return { data: (data ?? []) as SupplierOption[], error };
    }),
    projectId ? fetchAllRows<BudgetOption>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_budgets").select("id,code,name").eq("company_id", companyId).eq("project_id", projectId).eq("status", "approved").order("updated_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as BudgetOption[], error };
    }) : Promise.resolve({ data: [] as BudgetOption[], error: null }),
    fetchAllRows<ServiceOption>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_services").select("id,code,description,unit").eq("company_id", companyId).eq("status", "active").order("code").range(from, to);
      return { data: (data ?? []) as ServiceOption[], error };
    }),
    projectId ? fetchAllRows<LocationOption>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_takeoff_locations").select("id,code,name").eq("company_id", companyId).eq("project_id", projectId).eq("status", "active").order("sort_order").range(from, to);
      return { data: (data ?? []) as LocationOption[], error };
    }) : Promise.resolve({ data: [] as LocationOption[], error: null }),
    projectId ? fetchAllRows<Baseline>(async (from, to) => {
      const { data, error } = await supabase.from("engineering_schedule_baselines").select("id,status").eq("company_id", companyId).eq("project_id", projectId).neq("status", "archived").order("updated_at", { ascending: false }).range(from, to);
      return { data: (data ?? []) as Baseline[], error };
    }) : Promise.resolve({ data: [] as Baseline[], error: null }),
    permission("execution.contracts.manage"), permission("execution.contracts.approve"), permission("execution.contracts.amend"), permission("execution.contracts.cancel"),
  ]);

  const project = projectResult.data as Project | null;
  const contracts = contractsResult.data;
  const supplierMap = new Map(suppliersResult.data.map((supplier) => [supplier.id, supplier]));
  const itemMap = new Map<string, ContractItem[]>();
  itemsResult.data.forEach((item) => itemMap.set(item.contract_id, [...(itemMap.get(item.contract_id) ?? []), item]));
  const amendmentMap = new Map<string, Amendment[]>();
  amendmentsResult.data.forEach((item) => amendmentMap.set(item.contract_id, [...(amendmentMap.get(item.contract_id) ?? []), item]));
  const documentMap = new Map<string, Document[]>();
  documentsResult.data.forEach((item) => documentMap.set(item.contract_id, [...(documentMap.get(item.contract_id) ?? []), item]));
  const selected = params.contract ? contracts.find((contract) => contract.id === params.contract) ?? null : null;
  const selectedItems = selected ? itemMap.get(selected.id) ?? [] : [];
  const selectedAmendments = selected ? amendmentMap.get(selected.id) ?? [] : [];
  const selectedDocuments = selected ? documentMap.get(selected.id) ?? [] : [];
  let signedDocuments: SignedDocument[] = [];
  if (selectedDocuments.length) {
    const signed = await supabase.storage.from("service-contract-documents").createSignedUrls(selectedDocuments.map((document) => document.storage_path), 3600);
    const urlMap = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]));
    signedDocuments = selectedDocuments.map((document) => ({ ...document, signed_url: urlMap.get(document.storage_path) ?? null }));
  }

  const selectedBaseline = baselinesResult.data.find((baseline) => baseline.status === "approved") ?? baselinesResult.data[0] ?? null;
  const activitiesResult = selectedBaseline && projectId ? await fetchAllRows<ActivityOption>(async (from, to) => {
    const { data, error } = await supabase.from("engineering_schedule_activities").select("id,service_id,location_id,code,name,planned_start,planned_finish").eq("company_id", companyId).eq("project_id", projectId).eq("baseline_id", selectedBaseline.id).eq("record_status", "active").order("planned_start").range(from, to);
    return { data: (data ?? []) as ActivityOption[], error };
  }) : { data: [] as ActivityOption[], error: null };

  const canManage = manageResult.data === true || privileged;
  const canApprove = approveResult.data === true || privileged;
  const canAmend = amendResult.data === true || privileged;
  const canCancel = cancelResult.data === true || privileged;
  const structureError = contractsResult.error || itemsResult.error || amendmentsResult.error || documentsResult.error;
  const query = (params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const filtered = contracts.filter((contract) => !params.status || contract.status === params.status).filter((contract) => !query || [contract.contract_number, contract.title, contract.scope_summary, supplierName(supplierMap.get(contract.supplier_id))].join(" ").toLocaleLowerCase("pt-BR").includes(query));

  const active = contracts.filter((contract) => contract.status === "active");
  const originalTotal = contracts.filter((contract) => contract.status !== "cancelled").reduce((sum, contract) => sum + Number(contract.original_value), 0);
  const currentTotal = contracts.filter((contract) => contract.status !== "cancelled").reduce((sum, contract) => sum + Number(contract.current_value), 0);
  const measuredTotal = contracts.filter((contract) => contract.status !== "cancelled").reduce((sum, contract) => sum + Number(contract.measured_value), 0);
  const context = project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione uma obra";

  return <AppShell
    activeGroup="execution" activeItem="service-contracts" eyebrow="Execução · Contratações" title="Contratos de Serviços"
    description={`${company.name} · ${context} · escopo, valores, vigência, aditivos, documentos e saldo contratual por prestador.`}
    actions={canManage && projectId ? <ServiceContractDialog suppliers={suppliersResult.data} budgets={budgetsResult.data} services={servicesResult.data} locations={locationsResult.data} activities={activitiesResult.data} autoOpen={params.new === "1"} /> : undefined}
  >
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {structureError ? <div className="auth-message error workspace-message">A estrutura de contratos ainda não está instalada. Execute a migration <strong>20260728_0038_execution_service_contracts.sql</strong>.</div> : null}
    {!projectId ? <div className="contract-empty">Selecione uma obra no topo.</div> : null}

    {projectId && selected ? <ContractDetail
      contract={selected} supplier={supplierMap.get(selected.supplier_id) ?? null} items={selectedItems} amendments={selectedAmendments} documents={signedDocuments}
      suppliers={suppliersResult.data} budgets={budgetsResult.data} services={servicesResult.data} locations={locationsResult.data} activities={activitiesResult.data}
      canManage={canManage} canApprove={canApprove} canAmend={canAmend} canCancel={canCancel} autoEdit={params.edit === "1"}
    /> : projectId ? <>
      <section className="contract-kpis">
        <article><span>Contratos cadastrados</span><strong>{contracts.length}</strong><small>incluindo elaboração e histórico</small></article>
        <article><span>Contratos ativos</span><strong>{active.length}</strong><small>vigentes e liberados</small></article>
        <article><span>Valor original</span><strong>{money(originalTotal)}</strong><small>escopo inicial contratado</small></article>
        <article><span>Valor atualizado</span><strong>{money(currentTotal)}</strong><small>{money(currentTotal - originalTotal)} em aditivos</small></article>
        <article><span>Valor medido</span><strong>{money(measuredTotal)}</strong><small>{currentTotal ? number(measuredTotal / currentTotal * 100, 1) : "0"}% do contratado</small></article>
      </section>
      <section className="contract-toolbar"><form method="get"><input name="q" defaultValue={params.q ?? ""} placeholder="Buscar contrato, fornecedor ou escopo" /><select name="status" defaultValue={params.status ?? ""}><option value="">Todos os status</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button type="submit">Filtrar</button><Link href="/execucao/contratos-servicos">Limpar</Link></form></section>
      <section className="contract-list-card"><div className="budget-section-head"><div><span>Contratos vinculados à obra</span><h2>Prestadores e escopos contratados</h2></div><p>{filtered.length} contrato(s)</p></div><div className="registry-table-wrap"><table className="registry-table contract-table"><thead><tr><th>Contrato</th><th>Fornecedor</th><th>Escopo</th><th>Vigência</th><th>Original</th><th>Aditivos</th><th>Atual</th><th>Medido</th><th>Saldo</th><th>Status</th></tr></thead><tbody>{filtered.map((contract) => <tr key={contract.id}><td><Link href={`?contract=${contract.id}`}><strong>{contract.contract_number}</strong><span>{contract.title}</span></Link></td><td><strong>{supplierName(supplierMap.get(contract.supplier_id))}</strong><span>{supplierMap.get(contract.supplier_id)?.tax_id ?? ""}</span></td><td><span className="contract-scope-preview">{contract.scope_summary}</span><small>{(itemMap.get(contract.id) ?? []).length} item(ns)</small></td><td>{dateBR(contract.start_date)}<span>até {dateBR(contract.end_date)}</span></td><td>{money(contract.original_value)}</td><td className={Number(contract.amendments_value) < 0 ? "negative" : Number(contract.amendments_value) > 0 ? "positive" : ""}>{money(contract.amendments_value)}</td><td><strong>{money(contract.current_value)}</strong></td><td>{money(contract.measured_value)}<span>{contract.current_value ? number(contract.measured_value / contract.current_value * 100, 1) : "0"}%</span></td><td><strong>{money(Math.max(0, contract.current_value - contract.measured_value))}</strong></td><td><span className={`contract-status ${contract.status}`}>{statusLabels[contract.status]}</span></td></tr>)}{!filtered.length ? <tr><td colSpan={10} className="budget-empty-state">Nenhum contrato encontrado.</td></tr> : null}</tbody></table></div></section>
    </> : null}
  </AppShell>;
}

function ContractDetail({ contract, supplier, items, amendments, documents, suppliers, budgets, services, locations, activities, canManage, canApprove, canAmend, canCancel, autoEdit }: {
  contract: Contract; supplier: SupplierOption | null; items: ContractItem[]; amendments: Amendment[]; documents: SignedDocument[];
  suppliers: SupplierOption[]; budgets: BudgetOption[]; services: ServiceOption[]; locations: LocationOption[]; activities: ActivityOption[];
  canManage: boolean; canApprove: boolean; canAmend: boolean; canCancel: boolean; autoEdit: boolean;
}) {
  const balance = Math.max(0, Number(contract.current_value) - Number(contract.measured_value));
  return <>
    <div className="contract-back"><Link href="/execucao/contratos-servicos">← Voltar aos contratos</Link><span>{contract.contract_number}</span></div>
    <section className="contract-hero"><div><span>Contrato de prestação de serviços</span><h2>{contract.contract_number} · {contract.title}</h2><p>{supplierName(supplier)} · {supplier?.tax_id ?? "CPF/CNPJ não informado"}</p></div><div><span className={`contract-status ${contract.status}`}>{statusLabels[contract.status]}</span>{canManage && contract.status === "draft" ? <ServiceContractDialog suppliers={suppliers} budgets={budgets} services={services} locations={locations} activities={activities} contract={contract} items={items} autoOpen={autoEdit} label="Editar contrato" /> : null}</div></section>

    <section className="contract-detail-kpis">
      <article><span>Valor original</span><strong>{money(contract.original_value)}</strong><small>escopo inicial</small></article>
      <article><span>Aditivos</span><strong>{money(contract.amendments_value)}</strong><small>{amendments.length} aditivo(s)</small></article>
      <article><span>Valor atualizado</span><strong>{money(contract.current_value)}</strong><small>base das medições</small></article>
      <article><span>Valor medido</span><strong>{money(contract.measured_value)}</strong><small>{contract.current_value ? number(contract.measured_value / contract.current_value * 100, 1) : "0"}%</small></article>
      <article><span>Saldo contratual</span><strong>{money(balance)}</strong><small>a medir</small></article>
      <article><span>Vigência</span><strong>{dateBR(contract.end_date)}</strong><small>{dateBR(contract.start_date)} a {dateBR(contract.end_date)}</small></article>
    </section>

    <section className="contract-detail-grid">
      <article className="contract-card wide"><div className="contract-card-title"><div><span>Objeto e condições</span><h3>Resumo contratual</h3></div></div><p className="contract-scope-full">{contract.scope_summary}</p><dl className="contract-facts"><div><dt>Assinatura</dt><dd>{dateBR(contract.signed_date)}</dd></div><div><dt>Retenção</dt><dd>{number(contract.retention_percent)}%</dd></div><div><dt>Garantia retida</dt><dd>{number(contract.guarantee_percent)}%</dd></div><div><dt>Garantia do serviço</dt><dd>{contract.guarantee_months} meses</dd></div><div><dt>Pagamento</dt><dd>{contract.payment_days} dias após aprovação</dd></div><div><dt>Reajuste</dt><dd>{contract.adjustment_index || "Não definido"}</dd></div><div><dt>Data-base</dt><dd>{dateBR(contract.adjustment_base_date)}</dd></div><div><dt>Responsável interno</dt><dd>{contract.responsible_name || "—"}</dd></div></dl>{contract.notes ? <div className="contract-note"><strong>Observações</strong><p>{contract.notes}</p></div> : null}</article>
      <article className="contract-card"><div className="contract-card-title"><div><span>Contato</span><h3>Prestador</h3></div></div><strong>{supplierName(supplier)}</strong><p>{contract.contact_name || "Contato não informado"}</p><p>{contract.contact_phone || "Telefone não informado"}</p><p>{contract.contact_email || "E-mail não informado"}</p><Link href="/cadastros/fornecedores">Abrir cadastro do fornecedor</Link></article>
    </section>

    <section className="contract-card"><div className="contract-card-title"><div><span>Escopo contratado</span><h3>Serviços e locais</h3></div><strong>{items.length} item(ns)</strong></div><div className="registry-table-wrap"><table className="registry-table contract-items-table"><thead><tr><th>Serviço / centro de custo</th><th>Local</th><th>Período</th><th>Quantidade</th><th>Preço unitário</th><th>Total</th><th>Medido</th><th>Saldo</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.service_code}</strong><span>{item.service_name}</span>{item.scope_notes ? <small>{item.scope_notes}</small> : null}</td><td>{item.location_name || "Todos / não definido"}</td><td>{dateBR(item.planned_start)}<span>até {dateBR(item.planned_finish)}</span></td><td>{number(item.contracted_quantity, 4)} {item.unit_snapshot}</td><td>{money(item.unit_price)}</td><td><strong>{money(item.total_value)}</strong></td><td>{money(item.measured_value)}<span>{item.total_value ? number(item.measured_value / item.total_value * 100, 1) : "0"}%</span></td><td><strong>{money(Math.max(0, item.total_value - item.measured_value))}</strong></td></tr>)}</tbody></table></div></section>

    <section className="contract-detail-grid">
      <article className="contract-card wide"><div className="contract-card-title"><div><span>Histórico imutável</span><h3>Aditivos contratuais</h3></div><strong>{money(contract.amendments_value)}</strong></div>{amendments.length ? <div className="contract-amendment-list">{amendments.map((amendment) => <div key={amendment.id}><div><span>{amendment.amendment_number} · {amendmentLabels[amendment.amendment_type]}</span><strong className={amendment.value_change < 0 ? "negative" : "positive"}>{money(amendment.value_change)}</strong></div><h4>{amendment.description}</h4><p>{amendment.justification}</p><small>Aprovado em {dateBR(amendment.approved_at)}{amendment.new_end_date ? ` · nova vigência até ${dateBR(amendment.new_end_date)}` : ""}</small></div>)}</div> : <p className="contract-muted">Nenhum aditivo aprovado.</p>}{canAmend && ["active", "suspended"].includes(contract.status) ? <form action={addServiceContractAmendment} className="contract-amendment-form"><input type="hidden" name="contract_id" value={contract.id} /><h4>Novo aditivo — aprovação restrita</h4><div><label>Tipo<select name="amendment_type" required><option value="addition">Acréscimo</option><option value="suppression">Supressão</option><option value="time">Prazo</option><option value="mixed">Valor e prazo</option></select></label><label>Alteração de valor<input name="value_change" type="number" min="0" step="0.01" defaultValue="0" /></label><label>Nova data final<input name="new_end_date" type="date" min={contract.end_date} /></label></div><label>Descrição<input name="description" required placeholder="Escopo ou condição alterada" /></label><label>Justificativa<textarea name="justification" rows={2} required placeholder="Motivo técnico/comercial e autorização" /></label><button type="submit">Aprovar e incorporar aditivo</button></form> : null}</article>
      <article className="contract-card"><div className="contract-card-title"><div><span>Arquivo privado</span><h3>Documentos</h3></div><strong>{documents.length}</strong></div>{documents.length ? <div className="contract-document-list">{documents.map((document) => <div key={document.id}><div><strong>{document.file_name}</strong><small>{documentLabels[document.document_type]} · {dateBR(document.uploaded_at)}</small></div>{document.signed_url ? <a href={document.signed_url} target="_blank" rel="noreferrer">Abrir</a> : null}{canManage && contract.status === "draft" ? <form action={removeServiceContractDocument}><input type="hidden" name="contract_id" value={contract.id} /><input type="hidden" name="document_id" value={document.id} /><button type="submit">Remover</button></form> : null}</div>)}</div> : <p className="contract-muted">Nenhum documento anexado.</p>}{canManage ? <form action={uploadServiceContractDocuments} className="contract-upload-form" encType="multipart/form-data"><input type="hidden" name="contract_id" value={contract.id} /><label>Tipo<select name="document_type"><option value="contract">Contrato</option><option value="proposal">Proposta</option><option value="insurance">Seguro</option><option value="certificate">Certidão</option><option value="amendment">Aditivo</option><option value="termination">Distrato</option><option value="other">Outro</option></select></label><label>Arquivos<input name="documents" type="file" multiple accept="application/pdf,image/*,.docx" /></label><label>Legenda<input name="caption" /></label><button type="submit">Anexar documentos</button></form> : null}</article>
    </section>

    <section className="contract-workflow"><div><span>Fluxo contratual</span><h3>Ações disponíveis</h3><p>Contratos ativos alimentarão Ordens de Serviço e Medições dos Contratos.</p></div><div className="contract-workflow-actions">{canApprove && contract.status === "draft" ? <form action={activateServiceContract}><input type="hidden" name="contract_id" value={contract.id} /><button className="primary" type="submit">Ativar contrato</button></form> : null}{canApprove && contract.status === "active" ? <form action={suspendServiceContract}><input type="hidden" name="contract_id" value={contract.id} /><button type="submit">Suspender</button></form> : null}{canApprove && contract.status === "suspended" ? <form action={resumeServiceContract}><input type="hidden" name="contract_id" value={contract.id} /><button className="primary" type="submit">Retomar contrato</button></form> : null}{canApprove && ["active", "suspended"].includes(contract.status) ? <form action={finishServiceContract}><input type="hidden" name="contract_id" value={contract.id} /><button type="submit">Concluir contrato</button></form> : null}{canCancel && !["finished", "cancelled"].includes(contract.status) ? <form action={cancelServiceContract} className="contract-cancel-form"><input type="hidden" name="contract_id" value={contract.id} /><input name="reason" required placeholder="Motivo obrigatório do cancelamento" /><button className="danger" type="submit">Cancelar</button></form> : null}</div></section>
  </>;
}
