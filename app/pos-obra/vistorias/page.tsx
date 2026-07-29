import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  cancelUnitInspection,
  completeUnitInspection,
  createUnitInspection,
  deliverUnitInspection,
  markInspectionItemCorrected,
  removeInspectionDocument,
  saveInspectionTemplate,
  startUnitInspection,
  transferInspectionItemToAssistance,
  uploadInspectionDocuments,
  verifyInspectionItem,
} from "./actions";
import "../../postwork-inspections.css";

type Unit = { id: string; code: string; tower: string | null; floor: number | null; type: string | null; status: string };
type Client = { id: string; name: string; tax_id: string | null; status: string };
type Supplier = { id: string; legal_name: string; trade_name: string | null; status: string };
type Template = { id: string; name: string; inspection_type: string; version: number; instructions: string | null; status: string; project_id: string | null };
type TemplateItem = { id: string; template_id: string; environment: string; code: string | null; title: string; criterion: string | null; sort_order: number };
type Inspection = {
  id: string; unit_id: string; client_id: string | null; sale_id: string | null; template_id: string | null; number: string; inspection_type: string; status: string;
  scheduled_at: string | null; inspector_name: string | null; customer_attendee_name: string | null; customer_attendee_document: string | null;
  contact_phone: string | null; access_notes: string | null; general_notes: string | null; correction_notes: string | null; delivery_notes: string | null;
  started_at: string | null; completed_at: string | null; approved_at: string | null; delivered_at: string | null; cancellation_reason: string | null;
  accepted_by_name: string | null; accepted_by_document: string | null; accepted_at: string | null; customer_rating: number | null;
  keys_delivered: number; tags_delivered: number; water_meter_reading: string | null; energy_meter_reading: string | null; gas_meter_reading: string | null;
  created_at: string; units: Unit | Unit[] | null; clients: Client | Client[] | null; postwork_inspection_templates: Pick<Template,"id"|"name"> | Pick<Template,"id"|"name">[] | null;
};
type InspectionItem = {
  id: string; inspection_id: string; environment: string; code: string | null; title: string; criterion: string | null; is_mandatory: boolean;
  result: string; notes: string | null; correction_status: string; correction_due_date: string | null; correction_responsible_name: string | null;
  supplier_id: string | null; correction_notes: string | null; corrected_at: string | null; verification_notes: string | null; verified_at: string | null;
  assistance_ticket_id: string | null; sort_order: number;
};
type Document = { id: string; inspection_id: string; inspection_item_id: string | null; document_type: string; storage_path: string; file_name: string; caption: string | null; uploaded_at: string; signed_url?: string | null };
type Audit = { id: string; inspection_id: string; inspection_item_id: string | null; action: string; previous_status: string | null; new_status: string | null; notes: string | null; details: unknown; changed_at: string };
type Summary = { total_count: number; scheduled_count: number; in_progress_count: number; pending_corrections_count: number; approved_count: number; delivered_count: number; open_issue_count: number; overdue_issue_count: number; average_rating: number | null };

const statusLabels: Record<string,string> = { draft:"Em preparação",scheduled:"Agendada",in_progress:"Em vistoria",pending_corrections:"Com pendências",ready_for_reinspection:"Pronta para reinspeção",approved:"Aprovada",delivered:"Unidade entregue",cancelled:"Cancelada" };
const inspectionTypeLabels: Record<string,string> = { unit_pre_delivery:"Pré-vistoria interna",unit_delivery:"Vistoria com cliente",reinspection:"Reinspeção" };
const templateTypeLabels: Record<string,string> = { unit_pre_delivery:"Pré-vistoria interna",unit_delivery:"Entrega da unidade",common_area:"Área comum" };
const resultLabels: Record<string,string> = { pending:"Não avaliado",conform:"Conforme",nonconform:"Não conforme",not_applicable:"Não se aplica" };
const correctionLabels: Record<string,string> = { none:"Sem pendência",open:"Pendente",corrected:"Corrigida · reinspecionar",verified:"Verificada",transferred:"Transferida para assistência" };
const documentLabels: Record<string,string> = { schedule:"Agendamento",inspection:"Vistoria",nonconformity:"Não conformidade",correction:"Correção",reinspection:"Reinspeção",handover:"Entrega",term:"Termo",evidence:"Evidência",other:"Outro" };
const auditLabels: Record<string,string> = { created:"Vistoria criada",started:"Vistoria iniciada",completed:"Checklist concluído",correction_recorded:"Correção registrada",reinspection:"Reinspeção",transferred_to_assistance:"Transferida para assistência",delivered:"Unidade entregue",cancelled:"Vistoria cancelada" };

function relatedOne<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function dateTimeBR(value: string | null | undefined) { return value ? new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",timeZone:"America/Sao_Paulo"}).format(new Date(value)) : "—"; }
function dateBR(value: string | null | undefined) { if (!value) return "—"; const [y,m,d] = value.slice(0,10).split("-"); return `${d}/${m}/${y}`; }
function supplierName(value: Supplier | null | undefined) { return value ? value.trade_name || value.legal_name : "—"; }
function environmentGroups(items: InspectionItem[]) {
  const groups = new Map<string,InspectionItem[]>();
  items.forEach((item) => groups.set(item.environment,[...(groups.get(item.environment) ?? []),item]));
  return Array.from(groups.entries());
}

export default async function InspectionsPage({ searchParams }: { searchParams: Promise<{ inspection?: string; q?: string; status?: string; unit?: string; new?: string; template?: string; success?: string; error?: string }> }) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("postwork.inspections.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const permission = (key: string) => privileged ? Promise.resolve({ data: true, error: null }) : supabase.rpc("has_company_permission",{target_company_id:companyId,target_permission:key});

  const [projectResult,unitsResult,clientsResult,suppliersResult,templatesResult,templateItemsResult,inspectionsResult,itemsResult,documentsResult,auditResult,summaryResult,manageResult,fillResult,correctResult,deliverResult] = await Promise.all([
    projectId ? supabase.from("projects").select("id,code,name").eq("id",projectId).eq("company_id",companyId).maybeSingle() : Promise.resolve({data:null,error:null}),
    projectId ? fetchAllRows<Unit>(async (from,to) => { const {data,error}=await supabase.from("units").select("id,code,tower,floor,type,status").eq("company_id",companyId).eq("project_id",projectId).neq("status","inactive").order("floor").order("code").range(from,to); return {data:(data ?? []) as Unit[],error}; }) : Promise.resolve({data:[] as Unit[],error:null}),
    fetchAllRows<Client>(async (from,to) => { const {data,error}=await supabase.from("clients").select("id,name,tax_id,status").eq("company_id",companyId).order("name").range(from,to); return {data:(data ?? []) as Client[],error}; }),
    fetchAllRows<Supplier>(async (from,to) => { const {data,error}=await supabase.from("suppliers").select("id,legal_name,trade_name,status").eq("company_id",companyId).order("legal_name").range(from,to); return {data:(data ?? []) as Supplier[],error}; }),
    fetchAllRows<Template>(async (from,to) => { let query=supabase.from("postwork_inspection_templates").select("id,name,inspection_type,version,instructions,status,project_id").eq("company_id",companyId).eq("status","active").order("name").range(from,to); if (projectId) query=query.or(`project_id.is.null,project_id.eq.${projectId}`); const {data,error}=await query; return {data:(data ?? []) as Template[],error}; }),
    fetchAllRows<TemplateItem>(async (from,to) => { const {data,error}=await supabase.from("postwork_inspection_template_items").select("id,template_id,environment,code,title,criterion,sort_order").eq("company_id",companyId).order("sort_order").range(from,to); return {data:(data ?? []) as TemplateItem[],error}; }),
    projectId ? fetchAllRows<Inspection>(async (from,to) => { const {data,error}=await supabase.from("postwork_unit_inspections").select("id,unit_id,client_id,sale_id,template_id,number,inspection_type,status,scheduled_at,inspector_name,customer_attendee_name,customer_attendee_document,contact_phone,access_notes,general_notes,correction_notes,delivery_notes,started_at,completed_at,approved_at,delivered_at,cancellation_reason,accepted_by_name,accepted_by_document,accepted_at,customer_rating,keys_delivered,tags_delivered,water_meter_reading,energy_meter_reading,gas_meter_reading,created_at,units(id,code,tower,floor,type,status),clients(id,name,tax_id,status),postwork_inspection_templates(id,name)").eq("company_id",companyId).eq("project_id",projectId).order("created_at",{ascending:false}).range(from,to); return {data:(data ?? []) as unknown as Inspection[],error}; }) : Promise.resolve({data:[] as Inspection[],error:null}),
    projectId ? fetchAllRows<InspectionItem>(async (from,to) => { const {data,error}=await supabase.from("postwork_unit_inspection_items").select("id,inspection_id,environment,code,title,criterion,is_mandatory,result,notes,correction_status,correction_due_date,correction_responsible_name,supplier_id,correction_notes,corrected_at,verification_notes,verified_at,assistance_ticket_id,sort_order").eq("company_id",companyId).eq("project_id",projectId).order("sort_order").range(from,to); return {data:(data ?? []) as InspectionItem[],error}; }) : Promise.resolve({data:[] as InspectionItem[],error:null}),
    projectId ? fetchAllRows<Document>(async (from,to) => { const {data,error}=await supabase.from("postwork_inspection_documents").select("id,inspection_id,inspection_item_id,document_type,storage_path,file_name,caption,uploaded_at").eq("company_id",companyId).eq("project_id",projectId).order("uploaded_at",{ascending:false}).range(from,to); return {data:(data ?? []) as Document[],error}; }) : Promise.resolve({data:[] as Document[],error:null}),
    projectId ? fetchAllRows<Audit>(async (from,to) => { const {data,error}=await supabase.from("postwork_inspection_audit").select("id,inspection_id,inspection_item_id,action,previous_status,new_status,notes,details,changed_at").eq("company_id",companyId).eq("project_id",projectId).order("changed_at",{ascending:false}).range(from,to); return {data:(data ?? []) as Audit[],error}; }) : Promise.resolve({data:[] as Audit[],error:null}),
    supabase.rpc("postwork_inspections_summary",{p_company_id:companyId,p_project_id:projectId}),
    permission("postwork.inspections.manage"),permission("postwork.inspections.fill"),permission("postwork.inspections.correct"),permission("postwork.inspections.deliver"),
  ]);

  const project=projectResult.data;
  const units=unitsResult.data;
  const clients=clientsResult.data.filter((item)=>item.status==="active");
  const suppliers=suppliersResult.data.filter((item)=>item.status==="active");
  const supplierMap=new Map(suppliersResult.data.map((item)=>[item.id,item]));
  const templates=templatesResult.data;
  const templateItemMap=new Map<string,TemplateItem[]>();
  templateItemsResult.data.forEach((item)=>templateItemMap.set(item.template_id,[...(templateItemMap.get(item.template_id) ?? []),item]));
  const inspections=inspectionsResult.data;
  const selected=params.inspection ? inspections.find((item)=>item.id===params.inspection) ?? null : null;
  const selectedItems=selected ? itemsResult.data.filter((item)=>item.inspection_id===selected.id) : [];
  let selectedDocuments=selected ? documentsResult.data.filter((item)=>item.inspection_id===selected.id) : [];
  if (selectedDocuments.length) {
    const signed=await supabase.storage.from("postwork-inspections").createSignedUrls(selectedDocuments.map((item)=>item.storage_path),3600);
    const signedMap=new Map((signed.data ?? []).map((item)=>[item.path,item.signedUrl]));
    selectedDocuments=selectedDocuments.map((item)=>({...item,signed_url:signedMap.get(item.storage_path) ?? null}));
  }
  const selectedAudit=selected ? auditResult.data.filter((item)=>item.inspection_id===selected.id) : [];
  const summary=(summaryResult.data ?? {total_count:0,scheduled_count:0,in_progress_count:0,pending_corrections_count:0,approved_count:0,delivered_count:0,open_issue_count:0,overdue_issue_count:0,average_rating:null}) as Summary;
  const canManage=manageResult.data===true || privileged;
  const canFill=fillResult.data===true || privileged;
  const canCorrect=correctResult.data===true || privileged;
  const canDeliver=deliverResult.data===true || privileged;
  const query=(params.q ?? "").trim().toLocaleLowerCase("pt-BR");
  const filtered=inspections.filter((item)=>!params.status || item.status===params.status).filter((item)=>!params.unit || item.unit_id===params.unit).filter((item)=>!query || [item.number,relatedOne(item.units)?.code,relatedOne(item.clients)?.name,item.inspector_name].join(" ").toLocaleLowerCase("pt-BR").includes(query));
  const structureError=templatesResult.error || inspectionsResult.error || itemsResult.error || documentsResult.error || auditResult.error;
  const context=project ? `${project.code ? `${project.code} · ` : ""}${project.name}` : "Selecione um empreendimento";

  return <AppShell activeGroup="postwork" activeItem="inspections" eyebrow="Pós-Obra · Entrega" title="Vistorias e Chamados" description={`${company.name} · ${context} · checklists, pendências, reinspeção e termo de entrega.`}
    actions={projectId && canManage ? <div className="inspection-page-actions"><Link className="elos-button" href="?new=1">+ Nova vistoria</Link><Link className="elos-button secondary" href="?template=1">+ Modelo de checklist</Link></div> : undefined}>
    {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
    {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
    {structureError ? <div className="auth-message error workspace-message">A estrutura de Vistorias e Chamados ainda não está instalada. Execute a migration <strong>20260729_0054_postwork_inspections.sql</strong>.</div> : null}
    {!projectId ? <div className="inspection-empty"><strong>Selecione um empreendimento no topo.</strong><span>As vistorias são controladas por obra e unidade.</span></div> : null}

    {projectId ? <>
      <section className="inspection-summary-grid">
        <article><span>Agenda ativa</span><strong>{summary.scheduled_count + summary.in_progress_count}</strong><small>{summary.scheduled_count} agendadas · {summary.in_progress_count} em vistoria</small></article>
        <article><span>Unidades com pendências</span><strong>{summary.pending_corrections_count}</strong><small>{summary.open_issue_count} chamados abertos · {summary.overdue_issue_count} atrasados</small></article>
        <article><span>Prontas para entrega</span><strong>{summary.approved_count}</strong><small>checklist e reinspeções aprovados</small></article>
        <article><span>Unidades entregues</span><strong>{summary.delivered_count}</strong><small>{summary.average_rating ? `avaliação média ${summary.average_rating}/5` : "sem avaliações ainda"}</small></article>
      </section>

      {params.template === "1" && canManage ? <section className="inspection-form-card">
        <div className="inspection-section-title"><div><span>Modelos</span><h2>Novo modelo de checklist</h2></div><Link href="/pos-obra/vistorias">Fechar</Link></div>
        <form action={saveInspectionTemplate} className="inspection-template-form">
          <label><span>Nome do modelo</span><input name="name" required placeholder="Checklist padrão de entrega" /></label>
          <label><span>Tipo</span><select name="inspection_type" defaultValue="unit_delivery"><option value="unit_delivery">Entrega da unidade</option><option value="unit_pre_delivery">Pré-vistoria interna</option><option value="common_area">Área comum</option></select></label>
          <label className="inspection-span-2"><span>Orientações gerais</span><textarea name="instructions" rows={2} placeholder="Procedimentos, instrumentos e tolerâncias gerais" /></label>
          <label className="inspection-span-2"><span>Itens do checklist</span><textarea name="items_text" rows={12} required defaultValue={"Sala | Piso sem peças ocas ou danificadas | Inspeção visual e percussão | SAL-01\nSala | Pintura uniforme e sem fissuras | Inspeção visual | SAL-02\nCozinha | Pontos hidráulicos sem vazamento | Teste funcional | COZ-01\nBanheiro | Caimento direcionado ao ralo | Teste com água | BAN-01\nQuartos | Esquadrias abrem e fecham corretamente | Teste funcional | QUA-01\nGeral | Instalações elétricas funcionando | Teste com equipamento | GER-01"} /></label>
          <p className="inspection-helper">Use uma linha por item no formato: <strong>Ambiente | Item | Critério | Código</strong>.</p>
          <button className="elos-button" type="submit">Salvar modelo</button>
        </form>
      </section> : null}

      {params.new === "1" && canManage ? <section className="inspection-form-card">
        <div className="inspection-section-title"><div><span>Agenda de entrega</span><h2>Criar vistoria</h2></div><Link href="/pos-obra/vistorias">Fechar</Link></div>
        {!templates.length ? <div className="inspection-empty compact"><strong>Nenhum modelo ativo.</strong><span>Cadastre primeiro um modelo de checklist.</span><Link href="?template=1">Criar modelo</Link></div> : <form action={createUnitInspection} className="inspection-create-form">
          <label><span>Unidade</span><select name="unit_id" required><option value="">Selecione</option>{units.map((item)=><option key={item.id} value={item.id}>{item.code} · {item.type || "sem tipo"}</option>)}</select></label>
          <label><span>Cliente</span><select name="client_id"><option value="">Vincular pela venda ativa</option>{clients.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Modelo</span><select name="template_id" required><option value="">Selecione</option>{templates.filter((item)=>item.inspection_type!=="common_area").map((item)=><option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}</select></label>
          <label><span>Tipo de vistoria</span><select name="inspection_type" defaultValue="unit_delivery"><option value="unit_pre_delivery">Pré-vistoria interna</option><option value="unit_delivery">Vistoria com cliente</option><option value="reinspection">Reinspeção</option></select></label>
          <label><span>Data e hora</span><input type="datetime-local" name="scheduled_at" /></label>
          <label><span>Responsável pela vistoria</span><input name="inspector_name" placeholder="Engenheiro ou assistente" /></label>
          <label><span>Acompanhante do cliente</span><input name="customer_attendee_name" /></label>
          <label><span>Telefone</span><input name="contact_phone" /></label>
          <label className="inspection-span-2"><span>Orientações de acesso</span><textarea name="access_notes" rows={2} /></label>
          <label className="inspection-span-2"><span>Observações iniciais</span><textarea name="general_notes" rows={2} /></label>
          <button className="elos-button" type="submit">Criar vistoria</button>
        </form>}
      </section> : null}

      {!selected ? <>
        <section className="inspection-toolbar">
          <form method="get">
            <label><span>Buscar</span><input name="q" defaultValue={params.q ?? ""} placeholder="Número, unidade, cliente ou vistoriador" /></label>
            <label><span>Situação</span><select name="status" defaultValue={params.status ?? ""}><option value="">Todas</option>{Object.entries(statusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Unidade</span><select name="unit" defaultValue={params.unit ?? ""}><option value="">Todas</option>{units.map((item)=><option key={item.id} value={item.id}>{item.code}</option>)}</select></label>
            <button type="submit">Aplicar</button>{(params.q || params.status || params.unit) ? <Link href="/pos-obra/vistorias">Limpar</Link> : null}
          </form>
          <p>{filtered.length} vistoria(s) no filtro · {templates.length} modelo(s) ativo(s).</p>
        </section>

        <section className="inspection-table-card"><div className="inspection-table-wrap"><table className="inspection-table"><thead><tr><th>Vistoria</th><th>Unidade / cliente</th><th>Tipo</th><th>Agenda</th><th>Responsável</th><th>Situação</th><th>Pendências</th><th></th></tr></thead><tbody>
          {filtered.map((inspection)=>{
            const unit=relatedOne(inspection.units); const client=relatedOne(inspection.clients); const issues=itemsResult.data.filter((item)=>item.inspection_id===inspection.id && item.result==="nonconform" && ["open","corrected"].includes(item.correction_status));
            return <tr key={inspection.id}><td><strong>{inspection.number}</strong><small>{dateTimeBR(inspection.created_at)}</small></td><td><strong>{unit?.code ?? "—"}</strong><small>{client?.name ?? "Cliente não vinculado"}</small></td><td>{inspectionTypeLabels[inspection.inspection_type] ?? inspection.inspection_type}</td><td>{dateTimeBR(inspection.scheduled_at)}</td><td>{inspection.inspector_name ?? "—"}</td><td><span className={`inspection-status ${inspection.status}`}>{statusLabels[inspection.status] ?? inspection.status}</span></td><td><strong className={issues.length ? "inspection-issue-count" : undefined}>{issues.length}</strong></td><td><Link href={`?inspection=${inspection.id}`}>Abrir ficha</Link></td></tr>;
          })}
          {!filtered.length ? <tr><td colSpan={8}><div className="inspection-empty compact"><strong>Nenhuma vistoria encontrada.</strong><span>Crie a primeira vistoria ou ajuste os filtros.</span></div></td></tr> : null}
        </tbody></table></div></section>

        <section className="inspection-template-list"><div className="inspection-section-title"><div><span>Biblioteca</span><h2>Modelos ativos</h2></div>{canManage ? <Link href="?template=1">Novo modelo</Link> : null}</div><div className="inspection-template-grid">{templates.map((template)=><article key={template.id}><span>{templateTypeLabels[template.inspection_type] ?? template.inspection_type}</span><strong>{template.name}</strong><small>Versão {template.version} · {templateItemMap.get(template.id)?.length ?? 0} itens</small>{template.instructions ? <p>{template.instructions}</p> : null}</article>)}</div></section>
      </> : <InspectionDetail inspection={selected} items={selectedItems} documents={selectedDocuments} audit={selectedAudit} suppliers={suppliers} supplierMap={supplierMap} canManage={canManage} canFill={canFill} canCorrect={canCorrect} canDeliver={canDeliver} />}
    </> : null}
  </AppShell>;
}

function InspectionDetail({ inspection,items,documents,audit,suppliers,supplierMap,canManage,canFill,canCorrect,canDeliver }: { inspection: Inspection; items: InspectionItem[]; documents: Document[]; audit: Audit[]; suppliers: Supplier[]; supplierMap: Map<string,Supplier>; canManage:boolean; canFill:boolean; canCorrect:boolean; canDeliver:boolean }) {
  const unit=relatedOne(inspection.units); const client=relatedOne(inspection.clients); const template=relatedOne(inspection.postwork_inspection_templates);
  const openIssues=items.filter((item)=>item.result==="nonconform" && ["open","corrected"].includes(item.correction_status));
  const verifiedIssues=items.filter((item)=>item.result==="nonconform" && ["verified","transferred"].includes(item.correction_status));
  return <div className="inspection-detail">
    <div className="inspection-detail-header"><div><Link href="/pos-obra/vistorias">← Voltar às vistorias</Link><span>{inspection.number}</span><h2>Unidade {unit?.code ?? "—"}</h2><p>{client?.name ?? "Cliente não vinculado"} · {inspectionTypeLabels[inspection.inspection_type] ?? inspection.inspection_type} · {template?.name ?? "Modelo preservado no histórico"}</p></div><span className={`inspection-status ${inspection.status}`}>{statusLabels[inspection.status]}</span></div>
    <section className="inspection-detail-kpis"><article><span>Agendamento</span><strong>{dateTimeBR(inspection.scheduled_at)}</strong><small>{inspection.inspector_name || "responsável não informado"}</small></article><article><span>Checklist</span><strong>{items.filter((item)=>item.result!=="pending").length}/{items.length}</strong><small>{items.filter((item)=>item.result==="conform").length} conformes</small></article><article><span>Pendências atuais</span><strong>{openIssues.length}</strong><small>{verifiedIssues.length} verificadas ou transferidas</small></article><article><span>Aceite</span><strong>{inspection.accepted_by_name || "Pendente"}</strong><small>{inspection.delivered_at ? dateTimeBR(inspection.delivered_at) : "unidade ainda não entregue"}</small></article></section>

    <section className="inspection-info-grid"><article><h3>Contato e acesso</h3><p><strong>Acompanhante:</strong> {inspection.customer_attendee_name || "—"}</p><p><strong>Telefone:</strong> {inspection.contact_phone || "—"}</p><p><strong>Acesso:</strong> {inspection.access_notes || "—"}</p></article><article><h3>Histórico da etapa</h3><p><strong>Início:</strong> {dateTimeBR(inspection.started_at)}</p><p><strong>Conclusão:</strong> {dateTimeBR(inspection.completed_at)}</p><p><strong>Aprovação:</strong> {dateTimeBR(inspection.approved_at)}</p></article><article><h3>Observações</h3><p>{inspection.general_notes || "Sem observações gerais."}</p>{inspection.cancellation_reason ? <p><strong>Cancelamento:</strong> {inspection.cancellation_reason}</p> : null}</article></section>

    {["draft","scheduled","ready_for_reinspection"].includes(inspection.status) && canFill ? <section className="inspection-action-card"><h3>{inspection.status==="ready_for_reinspection" ? "Iniciar reinspeção" : "Iniciar vistoria"}</h3><p>O checklist ficará liberado para preenchimento.</p><form action={startUnitInspection}><input type="hidden" name="inspection_id" value={inspection.id}/><button className="elos-button" type="submit">Iniciar agora</button></form></section> : null}

    {inspection.status==="in_progress" && canFill ? <form action={completeUnitInspection} className="inspection-checklist-form"><input type="hidden" name="inspection_id" value={inspection.id}/><div className="inspection-section-title"><div><span>Preenchimento</span><h2>Checklist da vistoria</h2></div><small>Todos os itens obrigatórios precisam ser respondidos.</small></div>
      {environmentGroups(items).map(([environment,group])=><section className="inspection-environment" key={environment}><h3>{environment}</h3>{group.map((item)=><article className="inspection-check-item" key={item.id}><input type="hidden" name="item_id" value={item.id}/><div className="inspection-check-description"><strong>{item.code ? `${item.code} · ` : ""}{item.title}</strong><small>{item.criterion || "Sem critério específico"}{item.is_mandatory ? " · obrigatório" : ""}</small></div><label><span>Resultado</span><select name={`result_${item.id}`} defaultValue={item.result}><option value="pending">Não avaliado</option><option value="conform">Conforme</option><option value="nonconform">Não conforme</option><option value="not_applicable">Não se aplica</option></select></label><label><span>Observação</span><input name={`notes_${item.id}`} defaultValue={item.notes ?? ""}/></label><label><span>Prazo da correção</span><input type="date" name={`due_${item.id}`} defaultValue={item.correction_due_date ?? ""}/></label><label><span>Responsável</span><input name={`responsible_${item.id}`} defaultValue={item.correction_responsible_name ?? ""}/></label><label><span>Fornecedor</span><select name={`supplier_${item.id}`} defaultValue={item.supplier_id ?? ""}><option value="">Equipe própria / definir depois</option>{suppliers.map((supplier)=><option key={supplier.id} value={supplier.id}>{supplierName(supplier)}</option>)}</select></label></article>)}</section>)}
      <label className="inspection-general-notes"><span>Observações gerais da vistoria</span><textarea name="general_notes" rows={3} defaultValue={inspection.general_notes ?? ""}/></label><button className="elos-button" type="submit">Concluir checklist</button>
    </form> : <section className="inspection-read-checklist"><div className="inspection-section-title"><div><span>Resultado</span><h2>Checklist e chamados</h2></div><small>{items.length} itens avaliados</small></div>{environmentGroups(items).map(([environment,group])=><section className="inspection-environment" key={environment}><h3>{environment}</h3>{group.map((item)=><article className={`inspection-result-item ${item.result}`} key={item.id}><div><strong>{item.code ? `${item.code} · ` : ""}{item.title}</strong><small>{item.criterion || "Sem critério"}</small>{item.notes ? <p>{item.notes}</p> : null}</div><div className="inspection-result-badges"><span className={`inspection-result ${item.result}`}>{resultLabels[item.result]}</span>{item.result==="nonconform" ? <span className={`inspection-correction ${item.correction_status}`}>{correctionLabels[item.correction_status]}</span> : null}</div>{item.result==="nonconform" ? <IssueActions inspection={inspection} item={item} suppliers={suppliers} supplier={item.supplier_id ? supplierMap.get(item.supplier_id) : null} canCorrect={canCorrect}/> : null}</article>)}</section>)}</section>}

    {inspection.status==="approved" && canDeliver ? <section className="inspection-delivery-card"><div className="inspection-section-title"><div><span>Termo de recebimento</span><h2>Formalizar entrega da unidade</h2></div><small>Somente após todas as pendências verificadas ou transferidas.</small></div><form action={deliverUnitInspection}><input type="hidden" name="inspection_id" value={inspection.id}/><label><span>Recebido por</span><input name="accepted_by_name" required defaultValue={inspection.customer_attendee_name ?? ""}/></label><label><span>CPF/documento</span><input name="accepted_by_document"/></label><label><span>Chaves entregues</span><input type="number" min="0" name="keys_delivered" defaultValue="0"/></label><label><span>Tags/controles</span><input type="number" min="0" name="tags_delivered" defaultValue="0"/></label><label><span>Leitura água</span><input name="water_meter_reading"/></label><label><span>Leitura energia</span><input name="energy_meter_reading"/></label><label><span>Leitura gás</span><input name="gas_meter_reading"/></label><label><span>Avaliação</span><select name="customer_rating"><option value="">Não informar</option>{[5,4,3,2,1].map((value)=><option key={value} value={value}>{value} de 5</option>)}</select></label><label className="inspection-span-2"><span>Observações do termo</span><textarea name="delivery_notes" rows={3}/></label><button className="elos-button" type="submit">Confirmar entrega</button></form></section> : null}

    {inspection.status==="delivered" ? <section className="inspection-term"><div className="inspection-section-title"><div><span>Entrega concluída</span><h2>Termo de recebimento</h2></div><strong>{dateTimeBR(inspection.delivered_at)}</strong></div><div><p><strong>Recebedor:</strong> {inspection.accepted_by_name}</p><p><strong>Documento:</strong> {inspection.accepted_by_document || "—"}</p><p><strong>Chaves / tags:</strong> {inspection.keys_delivered} / {inspection.tags_delivered}</p><p><strong>Medidores:</strong> água {inspection.water_meter_reading || "—"} · energia {inspection.energy_meter_reading || "—"} · gás {inspection.gas_meter_reading || "—"}</p><p><strong>Avaliação:</strong> {inspection.customer_rating ? `${inspection.customer_rating}/5` : "—"}</p><p><strong>Observações:</strong> {inspection.delivery_notes || "—"}</p></div></section> : null}

    <section className="inspection-documents"><div className="inspection-section-title"><div><span>Rastreabilidade</span><h2>Fotos e documentos</h2></div><small>{documents.length} arquivo(s)</small></div>{canFill ? <form action={uploadInspectionDocuments} className="inspection-upload" encType="multipart/form-data"><input type="hidden" name="inspection_id" value={inspection.id}/><label><span>Tipo</span><select name="document_type" defaultValue="evidence">{Object.entries(documentLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label><span>Legenda</span><input name="caption"/></label><label><span>Arquivos</span><input type="file" name="documents" multiple accept="image/*,.pdf,.docx" required/></label><button type="submit">Anexar</button></form> : null}<div className="inspection-document-grid">{documents.map((document)=><article key={document.id}><span>{documentLabels[document.document_type] ?? document.document_type}</span><strong>{document.file_name}</strong><small>{document.caption || dateTimeBR(document.uploaded_at)}</small><div>{document.signed_url ? <a href={document.signed_url} target="_blank" rel="noreferrer">Abrir</a> : null}{canManage ? <form action={removeInspectionDocument}><input type="hidden" name="inspection_id" value={inspection.id}/><input type="hidden" name="document_id" value={document.id}/><button type="submit">Remover</button></form> : null}</div></article>)}</div></section>

    {canManage && !["delivered","cancelled"].includes(inspection.status) ? <details className="inspection-cancel"><summary>Cancelar vistoria</summary><form action={cancelUnitInspection}><input type="hidden" name="inspection_id" value={inspection.id}/><label><span>Justificativa</span><textarea name="reason" rows={2} required/></label><button type="submit">Confirmar cancelamento</button></form></details> : null}

    <section className="inspection-timeline"><div className="inspection-section-title"><div><span>Auditoria</span><h2>Linha do tempo</h2></div></div>{audit.map((entry)=><article key={entry.id}><span>{dateTimeBR(entry.changed_at)}</span><div><strong>{auditLabels[entry.action] ?? entry.action}</strong><small>{entry.previous_status ? `${statusLabels[entry.previous_status] ?? entry.previous_status} → ` : ""}{entry.new_status ? statusLabels[entry.new_status] ?? entry.new_status : ""}</small>{entry.notes ? <p>{entry.notes}</p> : null}</div></article>)}</section>
  </div>;
}

function IssueActions({ inspection,item,suppliers,supplier,canCorrect }: { inspection: Inspection; item: InspectionItem; suppliers: Supplier[]; supplier: Supplier | null | undefined; canCorrect:boolean }) {
  if (!canCorrect) return <div className="inspection-issue-meta"><small>Prazo: {dateBR(item.correction_due_date)} · Responsável: {item.correction_responsible_name || supplierName(supplier)}</small></div>;
  return <div className="inspection-issue-actions">
    <div className="inspection-issue-meta"><small>Prazo: {dateBR(item.correction_due_date)} · Responsável: {item.correction_responsible_name || supplierName(supplier)}</small>{item.correction_notes ? <p><strong>Correção:</strong> {item.correction_notes}</p> : null}{item.verification_notes ? <p><strong>Reinspeção:</strong> {item.verification_notes}</p> : null}{item.assistance_ticket_id ? <Link href={`/pos-obra/assistencias?ticket=${item.assistance_ticket_id}`}>Abrir Assistência Técnica</Link> : null}</div>
    {item.correction_status==="open" ? <details><summary>Registrar correção</summary><form action={markInspectionItemCorrected}><input type="hidden" name="inspection_id" value={inspection.id}/><input type="hidden" name="item_id" value={item.id}/><label><span>Correção executada</span><textarea name="correction_notes" rows={2} required/></label><label><span>Responsável</span><input name="responsible_name" defaultValue={item.correction_responsible_name ?? ""}/></label><label><span>Fornecedor</span><select name="supplier_id" defaultValue={item.supplier_id ?? ""}><option value="">Equipe própria</option>{suppliers.map((value)=><option key={value.id} value={value.id}>{supplierName(value)}</option>)}</select></label><button type="submit">Salvar correção</button></form></details> : null}
    {item.correction_status==="corrected" ? <details><summary>Reinspecionar</summary><form action={verifyInspectionItem}><input type="hidden" name="inspection_id" value={inspection.id}/><input type="hidden" name="item_id" value={item.id}/><label><span>Resultado</span><select name="verification_result" defaultValue="verified"><option value="verified">Correção aprovada</option><option value="rejected">Correção reprovada</option></select></label><label><span>Observações</span><textarea name="verification_notes" rows={2}/></label><button type="submit">Registrar reinspeção</button></form></details> : null}
    {["open","corrected"].includes(item.correction_status) ? <details><summary>Transferir para assistência</summary><form action={transferInspectionItemToAssistance}><input type="hidden" name="inspection_id" value={inspection.id}/><input type="hidden" name="item_id" value={item.id}/><label><span>Prioridade</span><select name="priority" defaultValue="normal"><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label><label><span>Prazo do atendimento</span><input type="datetime-local" name="sla_due_at"/></label><button type="submit">Criar Assistência Técnica</button></form></details> : null}
  </div>;
}
