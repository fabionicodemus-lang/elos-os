import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import { changeInventoryReservation, saveInventoryReservation, transferInventoryBetweenProjects } from "./actions";
import "../../procurement-intelligence.css";

type Control = {
  company_id:string; project_id:string; supply_plan_item_id:string; baseline_id:string; input_id:string;
  code:string; name:string; unit_snapshot:string; category_snapshot:string; required_quantity:number;
  planned_unit_cost:number; planned_total_cost:number; first_use_date:string; quotation_start:string;
  order_deadline:string; delivery_deadline:string; requested_quantity:number; request_converted_quantity:number;
  ordered_quantity:number; received_quantity:number; rejected_quantity:number; invoiced_quantity:number;
  consumed_quantity:number; on_hand_quantity:number; reserved_quantity:number; available_quantity:number;
  minimum_quantity:number; maximum_quantity:number; outstanding_order_quantity:number;
  remaining_to_buy_quantity:number; suggested_purchase_quantity:number; ordered_value:number;
  received_value:number; invoiced_value:number; stock_value:number; budget_balance:number; coverage_status:string;
};
type Balance={id:string;input_id:string;location_id:string;input_code:string;input_name:string;unit_snapshot:string;batch_number:string;expiration_date:string;quantity_on_hand:number;reserved_quantity:number;available_quantity:number;average_unit_cost:number};
type Location={id:string;project_id:string;code:string;name:string;status:string};
type Service={id:string;code:string;description:string};
type Project={id:string;code:string|null;name:string;status:string};
type Reservation={id:string;balance_id:string;input_id:string;location_id:string;service_id:string|null;supply_plan_item_id:string|null;quantity:number;required_date:string|null;status:string;notes:string|null;created_at:string};

const riskLabels:Record<string,string>={covered:"Coberto",planned:"Planejado",quote_now:"Cotar agora",order_now:"Pedir agora",critical:"Crítico",rupture:"Ruptura"};
const money=(value:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(value||0));
const qty=(value:number,digits=3)=>new Intl.NumberFormat("pt-BR",{maximumFractionDigits:digits}).format(Number(value||0));
const dateBR=(value?:string|null)=>value?new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC"}).format(new Date(`${value.slice(0,10)}T12:00:00Z`)):"—";

export default async function IntegratedSupplyPage({searchParams}:{searchParams:Promise<{q?:string;risk?:string;view?:string;success?:string;error?:string}>}){
  const params=await searchParams;
  const {supabase,company,companyId,projectId,roleKey}=await requireCompanyPermission("procurement.intelligence.view");
  const privileged=roleKey==="owner"||roleKey==="admin";
  const [projectResult,controlResult,balancesResult,_locationsResult,servicesResult,reservationsResult,projectsResult,allLocationsResult,manageResult]=await Promise.all([
    projectId?supabase.from("projects").select("id,code,name,status").eq("id",projectId).eq("company_id",companyId).maybeSingle():Promise.resolve({data:null,error:null}),
    projectId?fetchAllRows<Control>(async(from,to)=>{const{data,error}=await supabase.from("procurement_integrated_supply_control").select("*").eq("company_id",companyId).eq("project_id",projectId).order("first_use_date").range(from,to);return{data:(data??[])as Control[],error};}):Promise.resolve({data:[]as Control[],error:null}),
    projectId?fetchAllRows<Balance>(async(from,to)=>{const{data,error}=await supabase.from("procurement_inventory_balances").select("id,input_id,location_id,input_code,input_name,unit_snapshot,batch_number,expiration_date,quantity_on_hand,reserved_quantity,available_quantity,average_unit_cost").eq("company_id",companyId).eq("project_id",projectId).gt("available_quantity",0).order("input_name").range(from,to);return{data:(data??[])as Balance[],error};}):Promise.resolve({data:[]as Balance[],error:null}),
    projectId?fetchAllRows<Location>(async(from,to)=>{const{data,error}=await supabase.from("procurement_inventory_locations").select("id,project_id,code,name,status").eq("company_id",companyId).eq("project_id",projectId).eq("status","active").order("name").range(from,to);return{data:(data??[])as Location[],error};}):Promise.resolve({data:[]as Location[],error:null}),
    fetchAllRows<Service>(async(from,to)=>{const{data,error}=await supabase.from("engineering_services").select("id,code,description").eq("company_id",companyId).eq("status","active").order("code").range(from,to);return{data:(data??[])as Service[],error};}),
    projectId?fetchAllRows<Reservation>(async(from,to)=>{const{data,error}=await supabase.from("procurement_inventory_reservations").select("id,balance_id,input_id,location_id,service_id,supply_plan_item_id,quantity,required_date,status,notes,created_at").eq("company_id",companyId).eq("project_id",projectId).order("created_at",{ascending:false}).range(from,to);return{data:(data??[])as Reservation[],error};}):Promise.resolve({data:[]as Reservation[],error:null}),
    fetchAllRows<Project>(async(from,to)=>{const{data,error}=await supabase.from("projects").select("id,code,name,status").eq("company_id",companyId).neq("status","archived").order("name").range(from,to);return{data:(data??[])as Project[],error};}),
    fetchAllRows<Location>(async(from,to)=>{const{data,error}=await supabase.from("procurement_inventory_locations").select("id,project_id,code,name,status").eq("company_id",companyId).eq("status","active").order("name").range(from,to);return{data:(data??[])as Location[],error};}),
    privileged?Promise.resolve({data:true,error:null}):supabase.rpc("has_company_permission",{target_company_id:companyId,target_permission:"procurement.intelligence.manage"}),
  ]);
  const project=projectResult.data as Project|null;
  const canManage=manageResult.data===true||privileged;
  const query=(params.q??"").trim().toLocaleLowerCase("pt-BR");
  const filtered=controlResult.data.filter(row=>!params.risk||row.coverage_status===params.risk).filter(row=>!query||[row.code,row.name,row.category_snapshot].join(" ").toLocaleLowerCase("pt-BR").includes(query));
  const controlMap=new Map(controlResult.data.map(row=>[row.input_id,row]));
  const balanceMap=new Map(balancesResult.data.map(row=>[row.id,row]));
  const locationMap=new Map(allLocationsResult.data.map(row=>[row.id,row]));
  const serviceMap=new Map(servicesResult.data.map(row=>[row.id,row]));
  const activeReservations=reservationsResult.data.filter(row=>row.status==="active");
  const planned=controlResult.data.reduce((s,row)=>s+Number(row.planned_total_cost),0);
  const committed=controlResult.data.reduce((s,row)=>s+Number(row.ordered_value),0);
  const received=controlResult.data.reduce((s,row)=>s+Number(row.received_value),0);
  const invoiced=controlResult.data.reduce((s,row)=>s+Number(row.invoiced_value),0);
  const stock=controlResult.data.reduce((s,row)=>s+Number(row.stock_value),0);
  const critical=controlResult.data.filter(row=>["critical","rupture","order_now"].includes(row.coverage_status)).length;
  const context=project?`${project.code?`${project.code} · `:""}${project.name}`:"Selecione uma obra";

  return <AppShell activeGroup="procurement" activeItem="integrated-control" eyebrow="Suprimentos · Inteligência" title="Controle Integrado de Materiais" description={`${company.name} · ${context} · orçamento, cronograma, solicitações, pedidos, estoque, consumo e faturamento em uma única visão.`}
    actions={<><Link className="elos-button secondary" href="/suprimentos/desempenho-fornecedores">Desempenho dos fornecedores</Link><Link className="elos-button" href="/suprimentos/indicadores">Abrir indicadores</Link></>}>
    {params.success?<div className="auth-message success workspace-message">{params.success}</div>:null}
    {params.error?<div className="auth-message error workspace-message">{params.error}</div>:null}
    {controlResult.error?<div className="auth-message error workspace-message">A inteligência de suprimentos ainda não está instalada. Execute a migration <strong>0066</strong>.</div>:null}
    {!projectId?<div className="intelligence-empty">Selecione uma obra no topo.</div>:<>
      <section className="intelligence-kpis"><article><span>Planejado a comprar</span><strong>{money(planned)}</strong><small>necessidade após estoque real</small></article><article><span>Comprometido</span><strong>{money(committed)}</strong><small>pedidos emitidos</small></article><article><span>Recebido</span><strong>{money(received)}</strong><small>materiais aceitos</small></article><article><span>Faturado</span><strong>{money(invoiced)}</strong><small>NF-e aprovadas</small></article><article><span>Estoque atual</span><strong>{money(stock)}</strong><small>{activeReservations.length} reserva(s) ativa(s)</small></article><article className={critical?"danger":""}><span>Riscos imediatos</span><strong>{critical}</strong><small>ruptura, atraso ou pedido vencido</small></article></section>

      <nav className="intelligence-tabs"><Link className={params.view!=="reservations"?"active":""} href="/suprimentos/controle-integrado">Cobertura dos materiais</Link><Link className={params.view==="reservations"?"active":""} href="?view=reservations">Reservas e transferências</Link></nav>

      {params.view==="reservations"?<>
        <section className="intelligence-grid two">
          <article className="intelligence-card"><span>Alocação para serviços</span><h2>Reservar estoque</h2><p>A reserva reduz o saldo disponível, protege o material para uma frente de serviço e pode ser consumida diretamente com rastreabilidade.</p>{canManage?<form action={saveInventoryReservation} className="intelligence-form"><label>Saldo / lote<select name="balance_id" required><option value="">Selecione</option>{balancesResult.data.map(row=><option key={row.id} value={row.id}>{row.input_code} · {row.input_name} · {locationMap.get(row.location_id)?.name} · disponível {qty(row.available_quantity)} {row.unit_snapshot}</option>)}</select></label><label>Serviço / centro de custo<select name="service_id"><option value="">Sem serviço definido</option>{servicesResult.data.map(row=><option key={row.id} value={row.id}>{row.code} · {row.description}</option>)}</select></label><label>Item do planejamento<select name="supply_plan_item_id"><option value="">Sem vínculo</option>{controlResult.data.map(row=><option key={row.supply_plan_item_id} value={row.supply_plan_item_id}>{row.code} · {row.name}</option>)}</select></label><label>Quantidade<input name="quantity" type="number" min="0.000001" step="0.000001" required/></label><label>Data de uso<input name="required_date" type="date"/></label><label className="wide">Observação<textarea name="notes" rows={2}/></label><button type="submit">Reservar material</button></form>:<p>Seu perfil possui acesso somente para consulta.</p>}</article>
          <article className="intelligence-card"><span>Movimentação entre empreendimentos</span><h2>Transferir para outra obra</h2><p>O sistema registra uma saída na obra atual e uma entrada com o mesmo custo médio na obra de destino.</p>{canManage?<form action={transferInventoryBetweenProjects} className="intelligence-form"><label>Saldo de origem<select name="from_balance_id" required><option value="">Selecione</option>{balancesResult.data.map(row=><option key={row.id} value={row.id}>{row.input_code} · {row.input_name} · {locationMap.get(row.location_id)?.name} · {qty(row.available_quantity)} {row.unit_snapshot}</option>)}</select></label><label>Obra de destino<select name="to_project_id" required><option value="">Selecione</option>{projectsResult.data.filter(row=>row.id!==projectId).map(row=><option key={row.id} value={row.id}>{row.code?`${row.code} · `:""}{row.name}</option>)}</select></label><label>Local de destino<select name="to_location_id" required><option value="">Selecione</option>{allLocationsResult.data.filter(row=>row.project_id!==projectId).map(row=><option key={row.id} value={row.id}>{projectsResult.data.find(p=>p.id===row.project_id)?.name} · {row.name}</option>)}</select></label><label>Quantidade<input name="quantity" type="number" min="0.000001" step="0.000001" required/></label><label className="wide">Motivo / observação<textarea name="notes" required rows={2}/></label><button type="submit">Transferir entre obras</button></form>:null}</article>
        </section>
        <section className="intelligence-card"><div className="section-heading"><div><span>Materiais protegidos</span><h2>Reservas da obra</h2></div><p>{activeReservations.length} ativa(s)</p></div><div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Material</th><th>Local</th><th>Serviço</th><th>Quantidade</th><th>Uso previsto</th><th>Status</th><th>Ações</th></tr></thead><tbody>{reservationsResult.data.map(row=>{const balance=balanceMap.get(row.balance_id);const location=locationMap.get(row.location_id);const service=row.service_id?serviceMap.get(row.service_id):null;return <tr key={row.id}><td><strong>{balance?.input_code??"—"}</strong><span>{balance?.input_name??controlMap.get(row.input_id)?.name}</span></td><td>{location?.name??"—"}<span>{balance?.batch_number?`Lote ${balance.batch_number}`:"Sem lote"}</span></td><td>{service?`${service.code} · ${service.description}`:"Não definido"}</td><td><strong>{qty(row.quantity)} {balance?.unit_snapshot??""}</strong></td><td>{dateBR(row.required_date)}</td><td><span className={`intelligence-status ${row.status}`}>{row.status==="active"?"Ativa":row.status==="consumed"?"Consumida":row.status==="released"?"Liberada":"Cancelada"}</span></td><td>{canManage&&row.status==="active"?<form action={changeInventoryReservation} className="inline-actions"><input type="hidden" name="reservation_id" value={row.id}/><button name="action" value="consume">Consumir</button><button name="action" value="release">Liberar</button><button name="action" value="cancel" className="danger">Cancelar</button></form>:"—"}</td></tr>})}{!reservationsResult.data.length?<tr><td colSpan={7} className="empty-table">Nenhuma reserva registrada.</td></tr>:null}</tbody></table></div></section>
      </>:<>
        <section className="intelligence-toolbar"><form method="get"><input name="q" defaultValue={params.q??""} placeholder="Buscar material ou código"/><select name="risk" defaultValue={params.risk??""}><option value="">Todos os riscos</option>{Object.entries(riskLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><button type="submit">Filtrar</button><Link href="/suprimentos/controle-integrado">Limpar</Link></form></section>
        <section className="intelligence-card"><div className="section-heading"><div><span>Ciclo completo por insumo</span><h2>Cobertura do orçamento e do cronograma</h2></div><p>{filtered.length} material(is)</p></div><div className="registry-table-wrap"><table className="registry-table intelligence-table"><thead><tr><th>Material</th><th>Orçado</th><th>Solicitado</th><th>Pedido</th><th>Recebido</th><th>Consumido</th><th>Estoque</th><th>Saldo a comprar</th><th>Impacto</th><th>Primeiro uso</th><th>Cobertura</th></tr></thead><tbody>{filtered.map(row=><tr key={row.supply_plan_item_id}><td><strong>{row.code}</strong><span>{row.name}</span><small>{row.category_snapshot}</small></td><td><strong>{qty(row.required_quantity)}</strong><span>{row.unit_snapshot}</span></td><td>{qty(row.requested_quantity)}<span>{qty(row.request_converted_quantity)} convertido</span></td><td>{qty(row.ordered_quantity)}<span>{qty(row.outstanding_order_quantity)} a entregar</span></td><td>{qty(row.received_quantity)}<span>{qty(row.rejected_quantity)} rejeitado</span></td><td>{qty(row.consumed_quantity)}</td><td><strong>{qty(row.on_hand_quantity)}</strong><span>{qty(row.reserved_quantity)} reservado</span><small>{qty(row.available_quantity)} disponível</small></td><td><strong>{qty(row.remaining_to_buy_quantity)}</strong><span>sugestão {qty(row.suggested_purchase_quantity)}</span></td><td><strong>{money(row.ordered_value)}</strong><span>saldo {money(row.budget_balance)}</span><small>faturado {money(row.invoiced_value)}</small></td><td>{dateBR(row.first_use_date)}<span>pedir até {dateBR(row.order_deadline)}</span></td><td><span className={`coverage-status ${row.coverage_status}`}>{riskLabels[row.coverage_status]??row.coverage_status}</span></td></tr>)}{!filtered.length?<tr><td colSpan={11} className="empty-table">Nenhum material encontrado. Sincronize o Planejamento de Suprimentos com uma linha de base.</td></tr>:null}</tbody></table></div></section>
      </>}
    </>}
  </AppShell>;
}
