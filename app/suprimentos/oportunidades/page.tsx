import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import { transferStockOpportunity } from "./actions";

type Need = {
  input_id:string; code:string; name:string; unit_snapshot:string; required_quantity:number; planned_unit_cost:number;
  remaining_to_buy_quantity:number; suggested_purchase_quantity:number; available_quantity:number; outstanding_order_quantity:number;
  first_use_date:string; order_deadline:string; coverage_status:string;
};
type Balance = {
  id:string; project_id:string; input_id:string; location_id:string; input_code:string; input_name:string; unit_snapshot:string;
  batch_number:string; expiration_date:string; available_quantity:number; average_unit_cost:number; last_movement_at:string|null;
};
type Project = { id:string; code:string|null; name:string };
type Location = { id:string; code:string; name:string };
type Order = { id:string; status:string; supplier_id:string; order_number:string; created_at:string };
type OrderItem = { order_id:string; input_id:string; delivered_unit_cost:number; ordered_quantity:number; created_at:string };
type Supplier = { id:string; legal_name:string; trade_name:string|null };

type Opportunity = {
  need:Need; balance:Balance; sourceProject:Project; transferQty:number; referenceCost:number; lastCost:number|null;
  lastSupplier:string|null; lastOrder:string|null; lastDate:string|null;
};

function qty(value:number,digits=3){return new Intl.NumberFormat("pt-BR",{maximumFractionDigits:digits}).format(Number(value||0));}
function money(value:number){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(value||0));}
function dateBR(value?:string|null){if(!value)return"—";const date=new Date(`${value.slice(0,10)}T12:00:00Z`);return Number.isNaN(date.getTime())?"—":new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC"}).format(date);}
function percent(value:number){return `${value>=0?"+":""}${new Intl.NumberFormat("pt-BR",{maximumFractionDigits:1}).format(value)}%`;}
const coverage:Record<string,string>={covered:"Coberto",planned:"Planejado",quote_now:"Cotar agora",order_now:"Pedir agora",critical:"Crítico",rupture:"Ruptura"};

export default async function ProcurementOpportunitiesPage({searchParams}:{searchParams:Promise<{success?:string;error?:string}>}){
  const params=await searchParams;
  const {supabase,company,companyId,projectId,roleKey}=await requireCompanyPermission("procurement.intelligence.view");
  const privileged=roleKey==="owner"||roleKey==="admin";
  const manageResult=privileged?{data:true,error:null}:await supabase.rpc("has_company_permission",{target_company_id:companyId,target_permission:"procurement.intelligence.manage"});
  const canTransfer=manageResult.data===true||privileged;

  const [needsResult,balancesResult,projectsResult,locationsResult,ordersResult,orderItemsResult,suppliersResult]=await Promise.all([
    projectId?fetchAllRows<Need>(async(from,to)=>{const{data,error}=await supabase.from("procurement_integrated_supply_control").select("input_id,code,name,unit_snapshot,required_quantity,planned_unit_cost,remaining_to_buy_quantity,suggested_purchase_quantity,available_quantity,outstanding_order_quantity,first_use_date,order_deadline,coverage_status").eq("company_id",companyId).eq("project_id",projectId).gt("remaining_to_buy_quantity",0).order("order_deadline").range(from,to);return{data:(data??[])as Need[],error};}):Promise.resolve({data:[]as Need[],error:null}),
    projectId?fetchAllRows<Balance>(async(from,to)=>{const{data,error}=await supabase.from("procurement_inventory_balances").select("id,project_id,input_id,location_id,input_code,input_name,unit_snapshot,batch_number,expiration_date,available_quantity,average_unit_cost,last_movement_at").eq("company_id",companyId).neq("project_id",projectId).gt("available_quantity",0).order("input_name").range(from,to);return{data:(data??[])as Balance[],error};}):Promise.resolve({data:[]as Balance[],error:null}),
    fetchAllRows<Project>(async(from,to)=>{const{data,error}=await supabase.from("projects").select("id,code,name").eq("company_id",companyId).neq("status","archived").order("name").range(from,to);return{data:(data??[])as Project[],error};}),
    projectId?fetchAllRows<Location>(async(from,to)=>{const{data,error}=await supabase.from("procurement_inventory_locations").select("id,code,name").eq("company_id",companyId).eq("project_id",projectId).eq("status","active").order("name").range(from,to);return{data:(data??[])as Location[],error};}):Promise.resolve({data:[]as Location[],error:null}),
    fetchAllRows<Order>(async(from,to)=>{const{data,error}=await supabase.from("procurement_purchase_orders").select("id,status,supplier_id,order_number,created_at").eq("company_id",companyId).in("status",["issued","confirmed","partially_received","received","closed"]).order("created_at",{ascending:false}).range(from,to);return{data:(data??[])as Order[],error};}),
    fetchAllRows<OrderItem>(async(from,to)=>{const{data,error}=await supabase.from("procurement_purchase_order_items").select("order_id,input_id,delivered_unit_cost,ordered_quantity,created_at").eq("company_id",companyId).order("created_at",{ascending:false}).range(from,to);return{data:(data??[])as OrderItem[],error};}),
    fetchAllRows<Supplier>(async(from,to)=>{const{data,error}=await supabase.from("suppliers").select("id,legal_name,trade_name").eq("company_id",companyId).order("legal_name").range(from,to);return{data:(data??[])as Supplier[],error};}),
  ]);

  const projectMap=new Map(projectsResult.data.map((row)=>[row.id,row]));
  const orderMap=new Map(ordersResult.data.map((row)=>[row.id,row]));
  const supplierMap=new Map(suppliersResult.data.map((row)=>[row.id,row.trade_name||row.legal_name]));
  const lastPurchase=new Map<string,{cost:number;supplier:string|null;order:string|null;date:string|null}>();
  for(const item of orderItemsResult.data){
    if(lastPurchase.has(item.input_id))continue;
    const order=orderMap.get(item.order_id);if(!order)continue;
    lastPurchase.set(item.input_id,{cost:Number(item.delivered_unit_cost||0),supplier:supplierMap.get(order.supplier_id)??null,order:order.order_number,date:order.created_at});
  }

  const balanceByInput=new Map<string,Balance[]>();
  balancesResult.data.forEach((row)=>balanceByInput.set(row.input_id,[...(balanceByInput.get(row.input_id)??[]),row]));
  const opportunities:Opportunity[]=[];
  for(const need of needsResult.data){
    let remaining=Number(need.remaining_to_buy_quantity||0);
    const purchase=lastPurchase.get(need.input_id);
    for(const balance of (balanceByInput.get(need.input_id)??[]).sort((a,b)=>Number(b.available_quantity)-Number(a.available_quantity))){
      if(remaining<=0)break;
      const sourceProject=projectMap.get(balance.project_id);if(!sourceProject)continue;
      const transferQty=Math.min(remaining,Number(balance.available_quantity||0));
      if(transferQty<=0)continue;
      const referenceCost=Number(purchase?.cost||need.planned_unit_cost||balance.average_unit_cost||0);
      opportunities.push({need,balance,sourceProject,transferQty,referenceCost,lastCost:purchase?.cost??null,lastSupplier:purchase?.supplier??null,lastOrder:purchase?.order??null,lastDate:purchase?.date??null});
      remaining-=transferQty;
    }
  }
  const inputsWithOpportunity=new Set(opportunities.map((row)=>row.need.input_id));
  const transferableQty=opportunities.reduce((sum,row)=>sum+row.transferQty,0);
  const avoidableCash=opportunities.reduce((sum,row)=>sum+row.transferQty*row.referenceCost,0);
  const urgent=opportunities.filter((row)=>["order_now","critical","rupture"].includes(row.need.coverage_status)).length;
  const structureError=needsResult.error||balancesResult.error||projectsResult.error||locationsResult.error;

  return <AppShell activeGroup="procurement" activeItem="procurement-opportunities" eyebrow="Suprimentos · Inteligência" title="Oportunidades antes de comprar"
    description={`${company.name} · o Elos procura o mesmo material em outras obras e compara com o último custo de compra antes de gerar nova aquisição.`}
    actions={<><Link className="elos-button" prefetch={false} href="/suprimentos/controle-integrado">Controle Integrado</Link><Link className="elos-button" prefetch={false} href="/suprimentos/orcamentos-materiais">Cotações</Link></>}>
    {params.success?<div className="auth-message success workspace-message">{params.success}</div>:null}
    {params.error?<div className="auth-message error workspace-message">{params.error}</div>:null}
    {structureError?<div className="auth-message error workspace-message">Não foi possível consolidar todas as fontes de suprimentos. Verifique permissões/migrations de estoque.</div>:null}
    {!projectId?<div className="quotation-empty">Selecione a obra que precisa comprar.</div>:null}

    {projectId?<>
      <section className="finance-summary-grid">
        <article><span>Materiais aproveitáveis</span><strong>{inputsWithOpportunity.size}</strong><small>itens com saldo em outras obras</small></article>
        <article><span>Oportunidades</span><strong>{opportunities.length}</strong><small>origens/lotes disponíveis</small></article>
        <article><span>Quantidade transferível</span><strong>{qty(transferableQty)}</strong><small>soma indicativa entre unidades diversas</small></article>
        <article><span>Compra potencialmente evitável</span><strong>{money(avoidableCash)}</strong><small>referência pelo último/preço planejado</small></article>
        <article><span>Urgentes</span><strong>{urgent}</strong><small>pedir agora, crítico ou ruptura</small></article>
      </section>

      <section className="registry-table-panel">
        <div className="section-heading"><div><span>Estoque consolidado da empresa</span><h2>Transferir antes de cotar</h2></div><small>{opportunities.length} oportunidade(s)</small></div>
        {!locationsResult.data.length?<div className="auth-message error workspace-message">Cadastre ao menos um local de estoque ativo nesta obra para receber transferências.</div>:null}
        <div className="registry-table-wrap"><table><thead><tr><th>Material / necessidade</th><th>Origem disponível</th><th>Última compra</th><th>Referência de custo</th><th>Potencial</th><th>Ação</th></tr></thead><tbody>
          {opportunities.map((row,index)=>{
            const planned=Number(row.need.planned_unit_cost||0);
            const variation=row.lastCost&&planned?((row.lastCost/planned)-1)*100:null;
            return <tr key={`${row.balance.id}-${index}`}>
              <td><strong>{row.need.code} · {row.need.name}</strong><br/><span>Saldo a comprar: {qty(row.need.remaining_to_buy_quantity)} {row.need.unit_snapshot}</span><br/><small>{coverage[row.need.coverage_status]??row.need.coverage_status} · pedir até {dateBR(row.need.order_deadline)} · 1º uso {dateBR(row.need.first_use_date)}</small></td>
              <td><strong>{row.sourceProject.code?`${row.sourceProject.code} · `:""}{row.sourceProject.name}</strong><br/><span>{qty(row.balance.available_quantity)} {row.balance.unit_snapshot} disponíveis</span><br/><small>{row.balance.batch_number?`lote ${row.balance.batch_number} · `:""}custo médio {money(row.balance.average_unit_cost)}</small></td>
              <td>{row.lastCost?<><strong>{money(row.lastCost)}</strong><br/><span>{row.lastSupplier||"Fornecedor"}</span><br/><small>{row.lastOrder||"Pedido"} · {dateBR(row.lastDate)}</small></>:<span>Sem histórico de pedido</span>}</td>
              <td><strong>Planejado {money(planned)}</strong><br/><span>Ref. atual {money(row.referenceCost)}</span>{variation!==null?<><br/><small>último × planejado: {percent(variation)}</small></>:null}</td>
              <td><strong>{qty(row.transferQty)} {row.need.unit_snapshot}</strong><br/><span>{money(row.transferQty*row.referenceCost)}</span><br/><small>caixa de nova compra potencialmente preservado</small></td>
              <td>{canTransfer&&locationsResult.data.length?<form action={transferStockOpportunity}>
                <input type="hidden" name="from_project_id" value={row.balance.project_id}/><input type="hidden" name="from_balance_id" value={row.balance.id}/>
                <select name="to_location_id" required defaultValue={locationsResult.data[0]?.id}>{locationsResult.data.map((location)=><option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select>
                <input name="quantity" type="number" min="0.000001" max={row.transferQty} step="0.000001" defaultValue={row.transferQty} required/>
                <input name="notes" placeholder="Observação opcional"/><button className="table-action primary" type="submit">Trazer para esta obra</button>
              </form>:<span>{canTransfer?"Cadastre um local de destino":"Somente consulta"}</span>}</td>
            </tr>;
          })}
          {!opportunities.length?<tr><td colSpan={6}>Nenhum saldo aproveitável em outras obras para as necessidades atuais. O próximo passo é cotar/comprar.</td></tr>:null}
        </tbody></table></div>
      </section>
    </>:null}
  </AppShell>;
}
