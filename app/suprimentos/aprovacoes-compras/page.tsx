import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import { approvePurchaseOrderLevel, rejectPurchaseOrderApproval, savePurchaseApprovalSettings, submitPurchaseOrderForApproval } from "./actions";

type ApprovalSettings = {
  enabled: boolean; level1_limit: number; level2_limit: number; require_distinct_approvers: boolean; requester_cannot_approve: boolean;
};
type Order = {
  id:string; order_number:string; supplier_id:string; total_amount:number; expected_delivery_date:string|null; status:string;
  approval_status:string; required_approval_level:number; current_approval_level:number; approval_submitted_at:string|null;
  approval_completed_at:string|null; approval_rejection_reason:string|null; created_at:string;
};
type Supplier = { id:string; legal_name:string; trade_name:string|null };
type Approval = { order_id:string; approval_level:number; decision:string; notes:string|null; decided_at:string; decided_by:string };

function money(value:number){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(value||0));}
function dateBR(value?:string|null){if(!value)return"—";return new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC"}).format(new Date(`${value.slice(0,10)}T12:00:00Z`));}
const approvalLabels:Record<string,string>={not_required:"Sem alçada",pending:"Aguardando aprovação",approved:"Aprovado",rejected:"Rejeitado"};

export default async function PurchaseApprovalsPage({searchParams}:{searchParams:Promise<{success?:string;error?:string}>}){
  const params=await searchParams;
  const {supabase,company,companyId,projectId,roleKey}=await requireCompanyPermission("procurement.orders.view");
  const privileged=roleKey==="owner"||roleKey==="admin";
  const permission=(key:string)=>privileged?Promise.resolve({data:true,error:null}):supabase.rpc("has_company_permission",{target_company_id:companyId,target_permission:key});
  const [settingsResult,ordersResult,suppliersResult,approvalsResult,approvePermission,settingsPermission,managePermission]=await Promise.all([
    supabase.from("procurement_purchase_approval_settings").select("enabled,level1_limit,level2_limit,require_distinct_approvers,requester_cannot_approve").eq("company_id",companyId).maybeSingle(),
    projectId?fetchAllRows<Order>(async(from,to)=>{const{data,error}=await supabase.from("procurement_purchase_orders").select("id,order_number,supplier_id,total_amount,expected_delivery_date,status,approval_status,required_approval_level,current_approval_level,approval_submitted_at,approval_completed_at,approval_rejection_reason,created_at").eq("company_id",companyId).eq("project_id",projectId).eq("status","draft").order("created_at",{ascending:false}).range(from,to);return{data:(data??[])as Order[],error};}):Promise.resolve({data:[]as Order[],error:null}),
    fetchAllRows<Supplier>(async(from,to)=>{const{data,error}=await supabase.from("suppliers").select("id,legal_name,trade_name").eq("company_id",companyId).order("legal_name").range(from,to);return{data:(data??[])as Supplier[],error};}),
    projectId?fetchAllRows<Approval>(async(from,to)=>{const{data,error}=await supabase.from("procurement_purchase_order_approvals").select("order_id,approval_level,decision,notes,decided_at,decided_by").eq("company_id",companyId).eq("project_id",projectId).order("decided_at").range(from,to);return{data:(data??[])as Approval[],error};}):Promise.resolve({data:[]as Approval[],error:null}),
    permission("procurement.orders.approve"),permission("procurement.approval_settings.manage"),permission("procurement.orders.manage"),
  ]);
  const settings=(settingsResult.data??{enabled:false,level1_limit:5000,level2_limit:40000,require_distinct_approvers:true,requester_cannot_approve:true})as ApprovalSettings;
  const suppliers=new Map(suppliersResult.data.map((supplier)=>[supplier.id,supplier.trade_name||supplier.legal_name]));
  const approvalMap=new Map<string,Approval[]>();approvalsResult.data.forEach((row)=>approvalMap.set(row.order_id,[...(approvalMap.get(row.order_id)??[]),row]));
  const canApprove=approvePermission.data===true||privileged;const canSettings=settingsPermission.data===true||privileged;const canManage=managePermission.data===true||privileged;
  const pending=ordersResult.data.filter((order)=>order.approval_status==="pending");
  const rejected=ordersResult.data.filter((order)=>order.approval_status==="rejected");
  const approved=ordersResult.data.filter((order)=>order.approval_status==="approved");
  const waitingSubmission=ordersResult.data.filter((order)=>["not_required","rejected"].includes(order.approval_status));
  const structureError=settingsResult.error||ordersResult.error||approvalsResult.error;

  return <AppShell activeGroup="procurement" activeItem="purchase-orders" eyebrow="Suprimentos · Governança" title="Alçadas de Compras"
    description={`${company.name} · controle de autorização de pedidos por valor, com trilha de decisão e separação entre comprador e aprovador.`}
    actions={<Link className="elos-button" prefetch={false} href="/suprimentos/pedidos-compras">Pedidos de Compras</Link>}>
    {params.success?<div className="auth-message success workspace-message">{params.success}</div>:null}
    {params.error?<div className="auth-message error workspace-message">{params.error}</div>:null}
    {structureError?<div className="auth-message error workspace-message">A migration de alçadas de compras precisa estar aplicada para usar esta tela.</div>:null}
    {!projectId?<div className="quotation-empty">Selecione uma obra para visualizar os pedidos.</div>:null}

    <section className="finance-summary-grid">
      <article><span>Regra</span><strong>{settings.enabled?"Ativa":"Desativada"}</strong><small>{settings.enabled?"emissão exige alçadas":"fluxo atual sem bloqueio"}</small></article>
      <article><span>Aguardando</span><strong>{pending.length}</strong><small>pedido(s) esperando decisão</small></article>
      <article><span>Aprovados</span><strong>{approved.length}</strong><small>prontos para emissão</small></article>
      <article><span>Rejeitados</span><strong>{rejected.length}</strong><small>precisam de revisão</small></article>
    </section>

    {canSettings?<section className="registry-table-panel">
      <div className="section-heading"><div><span>Configuração da empresa</span><h2>Limites das alçadas</h2></div><small>3 níveis automáticos pelo valor total do pedido</small></div>
      <form action={savePurchaseApprovalSettings} className="quotation-form-grid">
        <label>Controle de alçadas<select name="enabled" defaultValue={settings.enabled?"1":"0"}><option value="1">Ativo</option><option value="0">Desativado</option></select></label>
        <label>1ª alçada até<input name="level1_limit" inputMode="decimal" defaultValue={Number(settings.level1_limit).toFixed(2).replace(".",",")} required /></label>
        <label>2ª alçada até<input name="level2_limit" inputMode="decimal" defaultValue={Number(settings.level2_limit).toFixed(2).replace(".",",")} required /></label>
        <label>Acima da 2ª<select defaultValue="3" disabled><option value="3">3ª alçada</option></select></label>
        <label>Aprovadores diferentes<select name="require_distinct" defaultValue={settings.require_distinct_approvers?"1":"0"}><option value="1">Sim</option><option value="0">Não</option></select></label>
        <label>Criador pode aprovar<select name="requester_cannot_approve" defaultValue={settings.requester_cannot_approve?"1":"0"}><option value="1">Não</option><option value="0">Sim</option></select></label>
        <button className="elos-button" type="submit">Salvar regras</button>
      </form>
      <p>Até {money(settings.level1_limit)}: 1 aprovação · até {money(settings.level2_limit)}: 2 aprovações · acima disso: 3 aprovações.</p>
    </section>:null}

    {projectId?<section className="registry-table-panel">
      <div className="section-heading"><div><span>Fila de decisão</span><h2>Pedidos aguardando alçada</h2></div><small>{pending.length} pendente(s)</small></div>
      <div className="registry-table-wrap"><table><thead><tr><th>Pedido</th><th>Fornecedor</th><th>Valor</th><th>Entrega</th><th>Alçada</th><th>Histórico</th><th>Ação</th></tr></thead><tbody>
        {pending.map((order)=>{const history=approvalMap.get(order.id)??[];const next=Math.min(order.required_approval_level,order.current_approval_level+1);return <tr key={order.id}>
          <td><strong>{order.order_number}</strong><br/><small>enviado {dateBR(order.approval_submitted_at)}</small></td>
          <td>{suppliers.get(order.supplier_id)??"Fornecedor"}</td><td><strong>{money(order.total_amount)}</strong></td><td>{dateBR(order.expected_delivery_date)}</td>
          <td><strong>{next}ª de {order.required_approval_level}</strong><br/><small>{order.current_approval_level} concluída(s)</small></td>
          <td>{history.length?history.map((entry)=><small key={`${entry.approval_level}-${entry.decided_at}`} style={{display:"block"}}>{entry.approval_level}ª · {entry.decision==="approved"?"aprovada":"rejeitada"} · {dateBR(entry.decided_at)}</small>):"—"}</td>
          <td>{canApprove?<div className="material-request-actions"><form action={approvePurchaseOrderLevel}><input type="hidden" name="order_id" value={order.id}/><input name="notes" placeholder="Observação opcional"/><button className="table-action primary" type="submit">Aprovar {next}ª</button></form><details><summary>Rejeitar</summary><form action={rejectPurchaseOrderApproval}><input type="hidden" name="order_id" value={order.id}/><textarea name="reason" required placeholder="Motivo" rows={2}/><button className="table-action danger" type="submit">Confirmar rejeição</button></form></details></div>:"Aguardando aprovador"}</td>
        </tr>})}
        {!pending.length?<tr><td colSpan={7}>Nenhum pedido aguardando aprovação.</td></tr>:null}
      </tbody></table></div>
    </section>:null}

    {projectId&&settings.enabled&&canManage&&waitingSubmission.length?<section className="registry-table-panel">
      <div className="section-heading"><div><span>Preparação</span><h2>Pedidos ainda não enviados</h2></div><small>{waitingSubmission.length}</small></div>
      <div className="registry-table-wrap"><table><thead><tr><th>Pedido</th><th>Fornecedor</th><th>Valor</th><th>Situação</th><th></th></tr></thead><tbody>{waitingSubmission.map((order)=><tr key={order.id}><td><strong>{order.order_number}</strong></td><td>{suppliers.get(order.supplier_id)??"Fornecedor"}</td><td>{money(order.total_amount)}</td><td>{approvalLabels[order.approval_status]??order.approval_status}{order.approval_rejection_reason?<><br/><small>{order.approval_rejection_reason}</small></>:null}</td><td><form action={submitPurchaseOrderForApproval}><input type="hidden" name="order_id" value={order.id}/><button className="table-action primary" type="submit">Enviar para aprovação</button></form></td></tr>)}</tbody></table></div>
    </section>:null}
  </AppShell>;
}
