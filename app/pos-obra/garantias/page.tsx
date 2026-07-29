import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import {
  analyzeAssistanceWarranty,
  cancelWarrantyAsset,
  completeWarrantyMaintenance,
  createWarrantyAsset,
  removeWarrantyDocument,
  saveWarrantyPolicy,
  scheduleWarrantyMaintenance,
  uploadWarrantyDocuments,
} from "./actions";
import "../../postwork-warranties.css";

type Supplier = { id: string; legal_name: string; trade_name: string | null; status: string };
type Unit = { id: string; code: string; floor: number | null; type: string | null; status: string };
type Client = { id: string; name: string };
type Policy = {
  id: string; company_id: string; project_id: string | null; code: string; name: string; scope_type: string; category: string;
  start_rule: string; term_months: number; alert_days: number; supplier_id: string | null; manufacturer: string | null;
  coverage_terms: string; exclusions: string | null; maintenance_requirements: string | null; status: string; created_at: string;
};
type Asset = {
  id: string; policy_id: string; unit_id: string | null; sale_id: string | null; supplier_id: string | null; asset_code: string;
  item_name: string; location_detail: string | null; brand: string | null; model: string | null; serial_number: string | null;
  invoice_number: string | null; purchase_date: string | null; installation_date: string | null; start_date: string; end_date: string;
  status: string; cancellation_reason: string | null; notes: string | null; created_at: string;
};
type Maintenance = {
  id: string; asset_id: string; supplier_id: string | null; title: string; due_date: string; status: string;
  completion_notes: string | null; cost: number; completed_at: string | null; cancellation_reason: string | null;
};
type Ticket = {
  id: string; unit_id: string | null; client_id: string | null; number: string; opened_at: string; category: string; priority: string;
  title: string; status: string; warranty_claimed: boolean; warranty_status: string; warranty_reason: string | null;
  warranty_policy_id: string | null; warranty_asset_id: string | null; warranty_analysis_at: string | null;
  units: Pick<Unit,"id"|"code"> | Pick<Unit,"id"|"code">[] | null; clients: Client | Client[] | null;
};
type Document = {
  id: string; policy_id: string | null; asset_id: string | null; maintenance_id: string | null; document_type: string;
  storage_path: string; file_name: string; caption: string | null; uploaded_at: string; signed_url?: string | null;
};
type Summary = {
  policy_count: number; active_asset_count: number; expiring_count: number; expired_count: number;
  maintenance_due_count: number; maintenance_overdue_count: number; pending_claim_count: number; covered_claim_count: number;
};

const categoryLabels: Record<string,string> = {
  waterproofing:"Impermeabilização", hydraulic:"Hidráulica", electrical:"Elétrica", finishes:"Acabamentos", frames:"Esquadrias",
  painting:"Pintura", flooring:"Pisos e revestimentos", equipment:"Equipamentos", structure:"Estrutura", gas:"Gás", common_area:"Área comum", other:"Outro",
};
const scopeLabels: Record<string,string> = { project:"Empreendimento", common_area:"Área comum", unit:"Unidade", system:"Sistema construtivo", equipment:"Equipamento" };
const startRuleLabels: Record<string,string> = { project_delivery:"Entrega do empreendimento", unit_delivery:"Entrega da unidade", installation:"Instalação", purchase:"Compra", custom:"Data personalizada" };
const warrantyLabels: Record<string,string> = { pending:"Em análise", covered:"Coberta", not_covered:"Não coberta", courtesy:"Cortesia", not_applicable:"Não aplicável" };
const documentLabels: Record<string,string> = { policy:"Termo/regra", manual:"Manual", invoice:"Nota fiscal", certificate:"Certificado", maintenance:"Manutenção", claim:"Chamado", other:"Outro" };
const activeTicketStatuses = new Set(["open","triage","inspection_scheduled","awaiting_supplier","approved","in_progress","awaiting_acceptance"]);

function relatedOne<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function dateBR(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone:"America/Sao_Paulo" }).format(new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value));
}
function money(value: number | null | undefined) { return new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" }).format(Number(value ?? 0)); }
function supplierName(value: Supplier | null | undefined) { return value ? value.trade_name || value.legal_name : "—"; }
function daysBetween(start: Date, end: Date) { return Math.ceil((end.getTime() - start.getTime()) / 86400000); }
function assetSituation(asset: Asset) {
  if (asset.status === "cancelled") return { key:"cancelled", label:"Cancelada" };
  const days = daysBetween(new Date(), new Date(`${asset.end_date}T23:59:59-03:00`));
  if (days < 0) return { key:"expired", label:"Vencida" };
  if (days <= 90) return { key:"expiring", label:`Vence em ${days} dia(s)` };
  return { key:"active", label:"Vigente" };
}
function progress(asset: Asset) {
  const start = new Date(`${asset.start_date}T12:00:00-03:00`).getTime();
  const end = new Date(`${asset.end_date}T12:00:00-03:00`).getTime();
  const now = Date.now();
  if (end <= start) return 100;
  return Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100));
}

export default async function WarrantiesPage({ searchParams }: {
  searchParams: Promise<{ asset?:string; policy?:string; ticket?:string; q?:string; situation?:string; category?:string; newPolicy?:string; newAsset?:string; success?:string; error?:string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("postwork.warranties.view");
  const privileged = roleKey === "owner" || roleKey === "admin";
  const permission = (key:string) => privileged ? Promise.resolve({ data:true, error:null }) : supabase.rpc("has_company_permission", { target_company_id:companyId, target_permission:key });

  const [projectResult, unitsResult, suppliersResult, policiesResult, assetsResult, maintenanceResult, ticketsResult, documentsResult, summaryResult, manageResult, analyzeResult, maintenancePermissionResult] = await Promise.all([
    projectId ? supabase.from("projects").select("id,code,name").eq("id",projectId).eq("company_id",companyId).maybeSingle() : Promise.resolve({ data:null, error:null }),
    projectId ? fetchAllRows<Unit>(async(from,to) => { const {data,error}=await supabase.from("units").select("id,code,floor,type,status").eq("company_id",companyId).eq("project_id",projectId).order("code").range(from,to); return {data:(data??[]) as Unit[],error}; }) : Promise.resolve({data:[] as Unit[],error:null}),
    fetchAllRows<Supplier>(async(from,to) => { const {data,error}=await supabase.from("suppliers").select("id,legal_name,trade_name,status").eq("company_id",companyId).order("legal_name").range(from,to); return {data:(data??[]) as Supplier[],error}; }),
    fetchAllRows<Policy>(async(from,to) => {
      let query=supabase.from("postwork_warranty_policies").select("id,company_id,project_id,code,name,scope_type,category,start_rule,term_months,alert_days,supplier_id,manufacturer,coverage_terms,exclusions,maintenance_requirements,status,created_at").eq("company_id",companyId).order("name").range(from,to);
      if(projectId) query=query.or(`project_id.is.null,project_id.eq.${projectId}`);
      const {data,error}=await query; return {data:(data??[]) as Policy[],error};
    }),
    projectId ? fetchAllRows<Asset>(async(from,to) => { const {data,error}=await supabase.from("postwork_warranty_assets").select("id,policy_id,unit_id,sale_id,supplier_id,asset_code,item_name,location_detail,brand,model,serial_number,invoice_number,purchase_date,installation_date,start_date,end_date,status,cancellation_reason,notes,created_at").eq("company_id",companyId).eq("project_id",projectId).order("end_date").range(from,to); return {data:(data??[]) as Asset[],error}; }) : Promise.resolve({data:[] as Asset[],error:null}),
    projectId ? fetchAllRows<Maintenance>(async(from,to) => { const {data,error}=await supabase.from("postwork_warranty_maintenance").select("id,asset_id,supplier_id,title,due_date,status,completion_notes,cost,completed_at,cancellation_reason").eq("company_id",companyId).eq("project_id",projectId).order("due_date").range(from,to); return {data:(data??[]) as Maintenance[],error}; }) : Promise.resolve({data:[] as Maintenance[],error:null}),
    projectId ? fetchAllRows<Ticket>(async(from,to) => { const {data,error}=await supabase.from("postwork_assistance_tickets").select("id,unit_id,client_id,number,opened_at,category,priority,title,status,warranty_claimed,warranty_status,warranty_reason,warranty_policy_id,warranty_asset_id,warranty_analysis_at,units(id,code),clients(id,name)").eq("company_id",companyId).eq("project_id",projectId).eq("warranty_claimed",true).order("opened_at",{ascending:false}).range(from,to); return {data:(data??[]) as unknown as Ticket[],error}; }) : Promise.resolve({data:[] as Ticket[],error:null}),
    projectId ? fetchAllRows<Document>(async(from,to) => { const {data,error}=await supabase.from("postwork_warranty_documents").select("id,policy_id,asset_id,maintenance_id,document_type,storage_path,file_name,caption,uploaded_at").eq("company_id",companyId).eq("project_id",projectId).order("uploaded_at",{ascending:false}).range(from,to); return {data:(data??[]) as Document[],error}; }) : Promise.resolve({data:[] as Document[],error:null}),
    supabase.rpc("postwork_warranties_summary", { p_company_id:companyId, p_project_id:projectId }),
    permission("postwork.warranties.manage"), permission("postwork.warranties.analyze"), permission("postwork.warranties.maintenance"),
  ]);

  const project = projectResult.data;
  const units = unitsResult.data.filter(item => item.status !== "inactive");
  const suppliers = suppliersResult.data.filter(item => item.status === "active");
  const supplierMap = new Map(suppliersResult.data.map(item => [item.id,item]));
  const unitMap = new Map(unitsResult.data.map(item => [item.id,item]));
  const policies = policiesResult.data;
  const policyMap = new Map(policies.map(item => [item.id,item]));
  const assets = assetsResult.data;
  const maintenance = maintenanceResult.data;
  const tickets = ticketsResult.data;
  let documents = documentsResult.data;
  if(documents.length){
    const signed=await supabase.storage.from("postwork-warranties").createSignedUrls(documents.map(item=>item.storage_path),3600);
    const signedMap=new Map((signed.data??[]).map(item=>[item.path,item.signedUrl]));
    documents=documents.map(item=>({...item,signed_url:signedMap.get(item.storage_path)??null}));
  }
  const summary=(summaryResult.data??{policy_count:0,active_asset_count:0,expiring_count:0,expired_count:0,maintenance_due_count:0,maintenance_overdue_count:0,pending_claim_count:0,covered_claim_count:0}) as Summary;
  const canManage=manageResult.data===true||privileged;
  const canAnalyze=analyzeResult.data===true||privileged;
  const canMaintenance=maintenancePermissionResult.data===true||privileged;
  const query=(params.q??"").trim().toLocaleLowerCase("pt-BR");
  const filteredAssets=assets.filter(asset=>!params.category||policyMap.get(asset.policy_id)?.category===params.category).filter(asset=>!params.situation||assetSituation(asset).key===params.situation).filter(asset=>!query||[asset.asset_code,asset.item_name,asset.location_detail,asset.brand,asset.model,asset.serial_number,unitMap.get(asset.unit_id??"")?.code,policyMap.get(asset.policy_id)?.name].join(" ").toLocaleLowerCase("pt-BR").includes(query));
  const selectedAsset=(params.asset?assets.find(item=>item.id===params.asset):null)??filteredAssets[0]??null;
  const selectedPolicy=(params.policy?policies.find(item=>item.id===params.policy):null)??null;
  const pendingTickets=tickets.filter(item=>activeTicketStatuses.has(item.status)&&item.warranty_status==="pending");
  const selectedTicket=(params.ticket?tickets.find(item=>item.id===params.ticket):null)??null;
  const selectedMaintenance=selectedAsset?maintenance.filter(item=>item.asset_id===selectedAsset.id):[];
  const selectedDocuments=selectedAsset?documents.filter(item=>item.asset_id===selectedAsset.id):selectedPolicy?documents.filter(item=>item.policy_id===selectedPolicy.id):[];
  const selectedLinkedTickets=selectedAsset?tickets.filter(item=>item.warranty_asset_id===selectedAsset.id):[];
  const structureError=policiesResult.error||assetsResult.error||maintenanceResult.error||ticketsResult.error||documentsResult.error||summaryResult.error;
  const context=project?`${project.code?`${project.code} · `:""}${project.name}`:"Selecione um empreendimento";
  const today=new Date().toISOString().slice(0,10);

  return <AppShell activeGroup="postwork" activeItem="warranties" eyebrow="Pós-Obra · Cobertura e manutenção" title="Garantias" description={`${company.name} · ${context} · vigências, documentos, manutenção e análise de chamados.`}
    actions={canManage&&projectId?<><a className="elos-button" href="?newPolicy=1">+ Regra de garantia</a><a className="elos-button" href="?newAsset=1">+ Item garantido</a></>:undefined}>
    <div className="warranty-page">
      {params.success?<div className="auth-message success workspace-message">{params.success}</div>:null}
      {params.error?<div className="auth-message error workspace-message">{params.error}</div>:null}
      {structureError?<div className="auth-message error workspace-message">A estrutura de Garantias ainda não está instalada. Execute a migration <strong>20260729_0055_postwork_warranties.sql</strong>.</div>:null}
      {!projectId?<div className="warranty-empty warranty-card">Selecione um empreendimento para visualizar suas garantias.</div>:<>
        <section className="warranty-kpis">
          <article><span>Itens vigentes</span><strong>{summary.active_asset_count}</strong><small>{summary.policy_count} regra(s) ativa(s)</small></article>
          <article><span>Vencendo em 90 dias</span><strong>{summary.expiring_count}</strong><small>{summary.expired_count} já vencido(s)</small></article>
          <article><span>Manutenções</span><strong>{summary.maintenance_due_count}</strong><small>{summary.maintenance_overdue_count} atrasada(s)</small></article>
          <article><span>Chamados em análise</span><strong>{summary.pending_claim_count}</strong><small>{summary.covered_claim_count} coberto(s) no histórico</small></article>
        </section>

        <section className="warranty-card warranty-toolbar">
          <form method="get">
            <label><span>Buscar</span><input name="q" defaultValue={params.q??""} placeholder="Código, item, unidade, marca ou série"/></label>
            <label><span>Situação</span><select name="situation" defaultValue={params.situation??""}><option value="">Todas</option><option value="active">Vigentes</option><option value="expiring">Vencendo</option><option value="expired">Vencidas</option><option value="cancelled">Canceladas</option></select></label>
            <label><span>Categoria</span><select name="category" defaultValue={params.category??""}><option value="">Todas</option>{Object.entries(categoryLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            <button type="submit">Aplicar</button>
            {(params.q||params.situation||params.category)?<Link className="warranty-action secondary" href="/pos-obra/garantias">Limpar</Link>:null}
          </form>
          <div className="warranty-tabs"><a href="#itens" className="active">Itens</a><a href="#regras">Regras</a><a href="#manutencoes">Manutenções</a><a href="#chamados">Chamados</a></div>
        </section>

        {params.newPolicy&&canManage?<section className="warranty-card"><div className="warranty-card-header"><div><h2>Nova regra de garantia</h2><p>Defina prazo, início, cobertura, exclusões e manutenção exigida.</p></div><Link href="/pos-obra/garantias" className="warranty-action secondary">Fechar</Link></div><PolicyForm suppliers={suppliers}/></section>:null}
        {selectedPolicy&&canManage?<section className="warranty-card"><div className="warranty-card-header"><div><h2>Editar regra · {selectedPolicy.code}</h2><p>{selectedPolicy.name}</p></div><Link href="/pos-obra/garantias#regras" className="warranty-action secondary">Fechar</Link></div><PolicyForm policy={selectedPolicy} suppliers={suppliers}/></section>:null}
        {params.newAsset&&canManage?<section className="warranty-card"><div className="warranty-card-header"><div><h2>Novo item garantido</h2><p>A vigência será calculada conforme a regra escolhida.</p></div><Link href="/pos-obra/garantias" className="warranty-action secondary">Fechar</Link></div><AssetForm policies={policies.filter(item=>item.status==="active")} units={units} suppliers={suppliers}/></section>:null}
        {selectedTicket?<section className="warranty-card"><div className="warranty-card-header"><div><h2>Análise do chamado {selectedTicket.number}</h2><p>{selectedTicket.title} · {relatedOne(selectedTicket.units)?.code??"Área comum"}</p></div><Link href="/pos-obra/garantias#chamados" className="warranty-action secondary">Fechar</Link></div>{canAnalyze?<WarrantyAnalysisForm ticket={selectedTicket} policies={policies.filter(item=>item.status==="active")} assets={assets.filter(item=>item.status==="active"&&(!item.unit_id||!selectedTicket.unit_id||item.unit_id===selectedTicket.unit_id))}/>:<div className="warranty-empty">Somente leitura.</div>}</section>:null}

        <section id="itens" className="warranty-layout">
          <div className="warranty-card"><div className="warranty-card-header"><div><h2>Itens garantidos</h2><p>{filteredAssets.length} registro(s) no filtro.</p></div></div><div className="warranty-list">{filteredAssets.length?filteredAssets.map(asset=>{const state=assetSituation(asset);const unit=asset.unit_id?unitMap.get(asset.unit_id):null;return <Link key={asset.id} href={`?asset=${asset.id}`} className={`warranty-list-item ${selectedAsset?.id===asset.id?"active":""}`}><span className="warranty-list-main"><strong>{asset.asset_code} · {asset.item_name}</strong><small>{unit?`Unidade ${unit.code}`:asset.location_detail||scopeLabels[policyMap.get(asset.policy_id)?.scope_type??""]||"Empreendimento"} · {policyMap.get(asset.policy_id)?.name??"Regra não localizada"}</small></span><span className="warranty-list-side"><span className={`warranty-status ${state.key}`}>{state.label}</span><small>até {dateBR(asset.end_date)}</small></span></Link>}):<div className="warranty-empty">Nenhum item garantido no filtro atual.</div>}</div></div>
          <div className="warranty-card">{selectedAsset?<AssetDetail asset={selectedAsset} policy={policyMap.get(selectedAsset.policy_id)} unit={selectedAsset.unit_id?unitMap.get(selectedAsset.unit_id):null} supplier={selectedAsset.supplier_id?supplierMap.get(selectedAsset.supplier_id):null} maintenance={selectedMaintenance} documents={selectedDocuments} linkedTickets={selectedLinkedTickets} suppliers={suppliers} canManage={canManage} canMaintenance={canMaintenance}/>:<div className="warranty-empty">Selecione ou cadastre um item garantido.</div>}</div>
        </section>

        <section id="regras" className="warranty-card"><div className="warranty-card-header"><div><h2>Catálogo de regras</h2><p>Regras gerais da empresa e específicas deste empreendimento.</p></div>{canManage?<a className="warranty-action" href="?newPolicy=1">+ Nova regra</a>:null}</div><div className="warranty-table-wrap"><table className="warranty-table"><thead><tr><th>Código / garantia</th><th>Abrangência</th><th>Início / prazo</th><th>Responsável</th><th>Situação</th><th></th></tr></thead><tbody>{policies.map(policy=><tr key={policy.id}><td><strong>{policy.code} · {policy.name}</strong><span>{categoryLabels[policy.category]??policy.category}{policy.project_id?" · específica da obra":" · regra geral"}</span></td><td>{scopeLabels[policy.scope_type]??policy.scope_type}</td><td>{startRuleLabels[policy.start_rule]??policy.start_rule}<br/><span>{policy.term_months} meses · alerta {policy.alert_days} dias</span></td><td>{supplierName(policy.supplier_id?supplierMap.get(policy.supplier_id):null)}{policy.manufacturer?<><br/><span>{policy.manufacturer}</span></>:null}</td><td><span className={`warranty-status ${policy.status==="active"?"active":"cancelled"}`}>{policy.status==="active"?"Ativa":"Inativa"}</span></td><td>{canManage?<Link href={`?policy=${policy.id}`} className="warranty-action secondary">Editar</Link>:null}</td></tr>)}</tbody></table></div></section>

        <section id="manutencoes" className="warranty-card"><div className="warranty-card-header"><div><h2>Agenda de manutenções</h2><p>Serviços preventivos que preservam desempenho e evidenciam o cumprimento das condições de garantia.</p></div></div><div className="warranty-table-wrap"><table className="warranty-table"><thead><tr><th>Vencimento</th><th>Item</th><th>Serviço</th><th>Fornecedor</th><th>Situação</th><th>Custo</th></tr></thead><tbody>{maintenance.length?maintenance.map(item=>{const asset=assets.find(asset=>asset.id===item.asset_id);const overdue=item.status==="scheduled"&&item.due_date<today;return <tr key={item.id}><td><strong>{dateBR(item.due_date)}</strong></td><td>{asset?<Link href={`?asset=${asset.id}`}>{asset.asset_code} · {asset.item_name}</Link>:"—"}</td><td>{item.title}{item.completion_notes?<><br/><span>{item.completion_notes}</span></>:null}</td><td>{supplierName(item.supplier_id?supplierMap.get(item.supplier_id):null)}</td><td><span className={`warranty-status ${overdue?"overdue":item.status}`}>{overdue?"Atrasada":item.status==="scheduled"?"Agendada":item.status==="completed"?"Concluída":"Cancelada"}</span></td><td>{money(item.cost)}</td></tr>}):<tr><td colSpan={6}><div className="warranty-empty">Nenhuma manutenção agendada.</div></td></tr>}</tbody></table></div></section>

        <section id="chamados" className="warranty-card"><div className="warranty-card-header"><div><h2>Chamados e cobertura</h2><p>{pendingTickets.length} chamado(s) aguardando análise de garantia.</p></div><Link className="warranty-action secondary" href="/pos-obra/assistencias">Abrir Assistências Técnicas</Link></div><div className="warranty-table-wrap"><table className="warranty-table"><thead><tr><th>Chamado</th><th>Unidade / cliente</th><th>Ocorrência</th><th>Garantia</th><th>Regra / item</th><th></th></tr></thead><tbody>{tickets.length?tickets.map(ticket=>{const policy=ticket.warranty_policy_id?policyMap.get(ticket.warranty_policy_id):null;const asset=ticket.warranty_asset_id?assets.find(item=>item.id===ticket.warranty_asset_id):null;return <tr key={ticket.id}><td><strong>{ticket.number}</strong><span>{dateBR(ticket.opened_at)}</span></td><td>{relatedOne(ticket.units)?.code??"Área comum"}<br/><span>{relatedOne(ticket.clients)?.name??"—"}</span></td><td><strong>{ticket.title}</strong><span>{categoryLabels[ticket.category]??ticket.category}</span></td><td><span className={`warranty-status ${ticket.warranty_status}`}>{warrantyLabels[ticket.warranty_status]??ticket.warranty_status}</span>{ticket.warranty_reason?<><br/><span>{ticket.warranty_reason}</span></>:null}</td><td>{policy?.name??"—"}{asset?<><br/><span>{asset.asset_code} · {asset.item_name}</span></>:null}</td><td>{canAnalyze&&activeTicketStatuses.has(ticket.status)?<Link href={`?ticket=${ticket.id}`} className="warranty-action secondary">Analisar</Link>:null}</td></tr>}):<tr><td colSpan={6}><div className="warranty-empty">Nenhum chamado com garantia solicitada.</div></td></tr>}</tbody></table></div></section>
      </>}
    </div>
  </AppShell>;
}

function PolicyForm({policy,suppliers}:{policy?:Policy;suppliers:Supplier[]}) {
  return <form action={saveWarrantyPolicy} className="warranty-form"><input type="hidden" name="policy_id" value={policy?.id??""}/><div className="warranty-form-grid">
    <label><span>Código</span><input name="code" required defaultValue={policy?.code??""} placeholder="EST-01"/></label>
    <label><span>Nome da garantia</span><input name="name" required defaultValue={policy?.name??""} placeholder="Estrutura de concreto"/></label>
    <label><span>Abrangência</span><select name="scope_type" defaultValue={policy?.scope_type??"system"}>{Object.entries(scopeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label><span>Categoria</span><select name="category" defaultValue={policy?.category??"other"}>{Object.entries(categoryLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label><span>Início da vigência</span><select name="start_rule" defaultValue={policy?.start_rule??"custom"}>{Object.entries(startRuleLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label><span>Prazo em meses</span><input name="term_months" type="number" min="1" max="600" required defaultValue={policy?.term_months??60}/></label>
    <label><span>Alertar antes, em dias</span><input name="alert_days" type="number" min="0" max="730" defaultValue={policy?.alert_days??60}/></label>
    <label><span>Situação</span><select name="status" defaultValue={policy?.status??"active"}><option value="active">Ativa</option><option value="inactive">Inativa</option></select></label>
    <label><span>Fornecedor responsável</span><select name="supplier_id" defaultValue={policy?.supplier_id??""}><option value="">Não definido</option>{suppliers.map(item=><option key={item.id} value={item.id}>{supplierName(item)}</option>)}</select></label>
    <label><span>Fabricante</span><input name="manufacturer" defaultValue={policy?.manufacturer??""}/></label>
    <label className="full"><span>Condições de cobertura</span><textarea name="coverage_terms" required defaultValue={policy?.coverage_terms??""} placeholder="Descreva o que está coberto e em quais condições."/></label>
    <label className="full"><span>Exclusões</span><textarea name="exclusions" defaultValue={policy?.exclusions??""} placeholder="Mau uso, reformas, ausência de manutenção..."/></label>
    <label className="full"><span>Manutenções exigidas</span><textarea name="maintenance_requirements" defaultValue={policy?.maintenance_requirements??""} placeholder="Periodicidade e evidências necessárias."/></label>
    <label className="warranty-check"><input type="checkbox" name="use_all_projects" defaultChecked={policy?.project_id===null}/><span>Disponibilizar esta regra para todos os empreendimentos da empresa</span></label>
  </div><button type="submit">Salvar regra de garantia</button></form>;
}

function AssetForm({policies,units,suppliers}:{policies:Policy[];units:Unit[];suppliers:Supplier[]}) {
  return <form action={createWarrantyAsset} className="warranty-form"><div className="warranty-form-grid">
    <label><span>Regra de garantia</span><select name="policy_id" required><option value="">Selecione</option>{policies.map(item=><option key={item.id} value={item.id}>{item.code} · {item.name} · {item.term_months} meses</option>)}</select></label>
    <label><span>Unidade</span><select name="unit_id"><option value="">Área comum / empreendimento</option>{units.map(item=><option key={item.id} value={item.id}>{item.code}{item.type?` · ${item.type}`:""}</option>)}</select></label>
    <label className="full"><span>Item, sistema ou equipamento</span><input name="item_name" required placeholder="Ex.: Impermeabilização da cobertura ou elevador social"/></label>
    <label><span>Local</span><input name="location_detail" placeholder="Cobertura, banheiro suíte, casa de máquinas..."/></label>
    <label><span>Fornecedor</span><select name="supplier_id"><option value="">Usar o fornecedor da regra</option>{suppliers.map(item=><option key={item.id} value={item.id}>{supplierName(item)}</option>)}</select></label>
    <label><span>Marca</span><input name="brand"/></label><label><span>Modelo</span><input name="model"/></label>
    <label><span>Número de série</span><input name="serial_number"/></label><label><span>Nota fiscal</span><input name="invoice_number"/></label>
    <label><span>Data da compra</span><input name="purchase_date" type="date"/></label><label><span>Data da instalação</span><input name="installation_date" type="date"/></label>
    <label><span>Data inicial personalizada</span><input name="start_date" type="date"/></label><label><span>Referência</span><input disabled value="Preencha conforme a regra escolhida"/></label>
    <label className="full"><span>Observações</span><textarea name="notes"/></label>
  </div><div className="warranty-alert">Quando a regra iniciar na entrega da unidade, a data será buscada automaticamente no termo concluído em Vistorias e Chamados.</div><button type="submit">Cadastrar e calcular vigência</button></form>;
}

function WarrantyAnalysisForm({ticket,policies,assets}:{ticket:Ticket;policies:Policy[];assets:Asset[]}) {
  return <form action={analyzeAssistanceWarranty} className="warranty-form"><input type="hidden" name="ticket_id" value={ticket.id}/><div className="warranty-form-grid">
    <label><span>Resultado</span><select name="warranty_status" defaultValue={ticket.warranty_status}><option value="pending">Em análise</option><option value="covered">Coberta</option><option value="not_covered">Não coberta</option><option value="courtesy">Cortesia</option><option value="not_applicable">Não aplicável</option></select></label>
    <label><span>Regra aplicável</span><select name="policy_id" defaultValue={ticket.warranty_policy_id??""}><option value="">Não selecionada</option>{policies.map(item=><option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
    <label className="full"><span>Item garantido</span><select name="asset_id" defaultValue={ticket.warranty_asset_id??""}><option value="">Não selecionado</option>{assets.map(item=><option key={item.id} value={item.id}>{item.asset_code} · {item.item_name} · até {dateBR(item.end_date)}</option>)}</select></label>
    <label className="full"><span>Justificativa técnica</span><textarea name="warranty_reason" defaultValue={ticket.warranty_reason??""} placeholder="Obrigatória para não coberta e cortesia."/></label>
  </div><button type="submit">Registrar análise de garantia</button></form>;
}

function AssetDetail({asset,policy,unit,supplier,maintenance,documents,linkedTickets,suppliers,canManage,canMaintenance}:{asset:Asset;policy?:Policy;unit?:Unit|null;supplier?:Supplier|null;maintenance:Maintenance[];documents:Document[];linkedTickets:Ticket[];suppliers:Supplier[];canManage:boolean;canMaintenance:boolean}) {
  const state=assetSituation(asset); const pct=progress(asset); const scheduled=maintenance.filter(item=>item.status==="scheduled");
  return <div className="warranty-detail"><div className="warranty-detail-title"><div><h2>{asset.asset_code}</h2><p>{asset.item_name}</p></div><span className={`warranty-status ${state.key}`}>{state.label}</span></div>
    <div className="warranty-progress" title={`${Math.round(pct)}% do prazo transcorrido`}><span style={{width:`${pct}%`}}/></div>
    <div className="warranty-meta"><div><span>Regra</span><strong>{policy?.code} · {policy?.name??"—"}</strong></div><div><span>Unidade / local</span><strong>{unit?unit.code:asset.location_detail||"Área comum"}</strong></div><div><span>Vigência</span><strong>{dateBR(asset.start_date)} a {dateBR(asset.end_date)}</strong></div><div><span>Fornecedor</span><strong>{supplierName(supplier)}</strong></div><div><span>Identificação</span><strong>{[asset.brand,asset.model,asset.serial_number].filter(Boolean).join(" · ")||"—"}</strong></div><div><span>Nota fiscal</span><strong>{asset.invoice_number||"—"}</strong></div></div>
    {policy?<div className="warranty-callout"><h3>Condições de cobertura</h3><p>{policy.coverage_terms}</p>{policy.exclusions?<><h3>Exclusões</h3><p>{policy.exclusions}</p></>:null}{policy.maintenance_requirements?<><h3>Manutenção exigida</h3><p>{policy.maintenance_requirements}</p></>:null}</div>:null}
    <div className="warranty-section"><h3>Manutenções deste item</h3>{maintenance.length?maintenance.map(item=><div className="warranty-doc" key={item.id}><div><strong>{dateBR(item.due_date)} · {item.title}</strong><small>{item.status==="completed"?`Concluída · ${money(item.cost)}`:item.due_date<new Date().toISOString().slice(0,10)?"Atrasada":"Agendada"}</small></div>{canMaintenance&&item.status==="scheduled"?<form action={completeWarrantyMaintenance} className="warranty-inline-form"><input type="hidden" name="asset_id" value={asset.id}/><input type="hidden" name="maintenance_id" value={item.id}/><input name="completion_notes" required placeholder="Serviço executado"/><input name="cost" placeholder="R$ 0,00"/><button type="submit">Concluir</button></form>:null}</div>):<span className="warranty-muted">Nenhuma manutenção registrada.</span>}
      {canMaintenance&&asset.status==="active"?<form action={scheduleWarrantyMaintenance} className="warranty-inline-form"><input type="hidden" name="asset_id" value={asset.id}/><input name="title" required placeholder="Nova manutenção"/><input name="due_date" type="date" required/><select name="supplier_id"><option value="">Fornecedor do item</option>{suppliers.map(item=><option key={item.id} value={item.id}>{supplierName(item)}</option>)}</select><button type="submit">Agendar</button></form>:null}
      {scheduled.some(item=>item.due_date<new Date().toISOString().slice(0,10))?<div className="warranty-alert error">Há manutenção vencida. Verifique o impacto nas condições de cobertura antes de analisar um chamado.</div>:null}
    </div>
    <div className="warranty-section"><h3>Documentos</h3><div className="warranty-docs">{documents.map(doc=><div className="warranty-doc" key={doc.id}><div>{doc.signed_url?<a href={doc.signed_url} target="_blank" rel="noreferrer">{doc.file_name}</a>:<strong>{doc.file_name}</strong>}<small>{documentLabels[doc.document_type]??doc.document_type} · {dateBR(doc.uploaded_at)}{doc.caption?` · ${doc.caption}`:""}</small></div>{canManage?<form action={removeWarrantyDocument}><input type="hidden" name="document_id" value={doc.id}/><input type="hidden" name="asset_id" value={asset.id}/><button type="submit" className="warranty-action danger">Excluir</button></form>:null}</div>)}</div>{canManage?<form action={uploadWarrantyDocuments} encType="multipart/form-data" className="warranty-form"><input type="hidden" name="policy_id" value={asset.policy_id}/><input type="hidden" name="asset_id" value={asset.id}/><div className="warranty-form-grid"><label><span>Tipo</span><select name="document_type">{Object.entries(documentLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label><span>Legenda</span><input name="caption"/></label><label className="full"><span>Arquivos</span><input name="documents" type="file" multiple required accept="image/*,.pdf,.docx,.xlsx"/></label></div><button type="submit">Anexar documentos</button></form>:null}</div>
    <div className="warranty-section"><h3>Chamados vinculados</h3>{linkedTickets.length?linkedTickets.map(ticket=><Link key={ticket.id} href={`?ticket=${ticket.id}`} className="warranty-doc"><span><strong>{ticket.number} · {ticket.title}</strong><small>{warrantyLabels[ticket.warranty_status]??ticket.warranty_status}</small></span></Link>):<span className="warranty-muted">Nenhum chamado vinculado.</span>}</div>
    {asset.notes?<div className="warranty-callout"><h3>Observações</h3><p>{asset.notes}</p></div>:null}
    {canManage&&asset.status==="active"?<details><summary>Cancelar este item de garantia</summary><form action={cancelWarrantyAsset} className="warranty-inline-form"><input type="hidden" name="asset_id" value={asset.id}/><input name="reason" required placeholder="Motivo do cancelamento"/><button className="danger" type="submit">Cancelar garantia</button></form></details>:null}
  </div>;
}
