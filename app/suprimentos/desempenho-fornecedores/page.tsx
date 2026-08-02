import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { requireCompanyPermission } from "@/lib/workspace";
import "../../procurement-intelligence.css";

type Project={id:string;code:string|null;name:string};
type Performance={company_id:string;project_id:string;supplier_id:string;legal_name:string;trade_name:string|null;category:string|null;status:string;order_count:number;ordered_quantity:number;accepted_quantity:number;rejected_quantity:number;ordered_value:number;receipt_count:number;on_time_receipts:number;avg_delivery_days:number|null;invoice_count:number;matched_invoices:number;invoice_item_count:number;conforming_price_items:number;discrepancy_count:number;resolved_discrepancy_count:number;avg_resolution_days:number|null;punctuality_score:number;completeness_score:number;quality_score:number;price_score:number;resolution_score:number;documentation_score:number;overall_score:number|null;classification:string};

const money=(value:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(value||0));
const number=(value:number|null|undefined,digits=1)=>value==null?"—":new Intl.NumberFormat("pt-BR",{maximumFractionDigits:digits}).format(Number(value));
const classificationOrder:Record<string,number>={Excelente:4,Bom:3,Atenção:2,"Crítico":1,"Sem histórico":0};

export default async function SupplierPerformancePage({searchParams}:{searchParams:Promise<{q?:string;classification?:string;sort?:string;success?:string;error?:string}>}){
  const params=await searchParams;
  const {supabase,company,companyId,projectId}=await requireCompanyPermission("procurement.intelligence.view");
  const [projectResult,performanceResult]=await Promise.all([
    projectId?supabase.from("projects").select("id,code,name").eq("id",projectId).eq("company_id",companyId).maybeSingle():Promise.resolve({data:null,error:null}),
    projectId?fetchAllRows<Performance>(async(from,to)=>{const{data,error}=await supabase.from("procurement_supplier_performance").select("*").eq("company_id",companyId).eq("project_id",projectId).order("overall_score",{ascending:false,nullsFirst:false}).range(from,to);return{data:(data??[])as Performance[],error};}):Promise.resolve({data:[]as Performance[],error:null}),
  ]);
  const project=projectResult.data as Project|null;
  const query=(params.q??"").trim().toLocaleLowerCase("pt-BR");
  let rows=performanceResult.data.filter(row=>!params.classification||row.classification===params.classification).filter(row=>!query||[row.legal_name,row.trade_name,row.category].join(" ").toLocaleLowerCase("pt-BR").includes(query));
  rows=[...rows].sort((a,b)=>params.sort==="orders"?b.order_count-a.order_count:params.sort==="value"?Number(b.ordered_value)-Number(a.ordered_value):params.sort==="risk"?(classificationOrder[a.classification]??0)-(classificationOrder[b.classification]??0):Number(b.overall_score??-1)-Number(a.overall_score??-1));
  const evaluated=performanceResult.data.filter(row=>row.overall_score!=null);
  const average=evaluated.length?evaluated.reduce((s,row)=>s+Number(row.overall_score),0)/evaluated.length:0;
  const excellent=evaluated.filter(row=>row.classification==="Excelente").length;
  const critical=evaluated.filter(row=>row.classification==="Crítico").length;
  const rejection=evaluated.reduce((s,row)=>s+Number(row.rejected_quantity),0);
  const context=project?`${project.code?`${project.code} · `:""}${project.name}`:"Selecione uma obra";

  return <AppShell activeGroup="procurement" activeItem="supplier-performance" eyebrow="Suprimentos · Inteligência" title="Desempenho de Fornecedores" description={`${company.name} · ${context} · avaliação automática baseada em pedidos, entregas, rejeições, preços, documentos e resolução de divergências.`}
    actions={<><Link className="elos-button secondary" href="/suprimentos/controle-integrado">Controle integrado</Link><Link className="elos-button" href="/suprimentos/indicadores">Indicadores</Link></>}>
    {performanceResult.error?<div className="auth-message error workspace-message">A avaliação automática ainda não está instalada. Execute a migration <strong>0066</strong>.</div>:null}
    {!projectId?<div className="intelligence-empty">Selecione uma obra no topo.</div>:<>
      <section className="intelligence-kpis"><article><span>Fornecedores avaliados</span><strong>{evaluated.length}</strong><small>{performanceResult.data.length-evaluated.length} ainda sem histórico</small></article><article><span>Nota média</span><strong>{number(average)}</strong><small>escala de 0 a 100</small></article><article><span>Excelente</span><strong>{excellent}</strong><small>nota igual ou superior a 90</small></article><article className={critical?"danger":""}><span>Críticos</span><strong>{critical}</strong><small>nota inferior a 60</small></article><article><span>Quantidade rejeitada</span><strong>{number(rejection,3)}</strong><small>acumulada na obra</small></article></section>

      <section className="score-method"><div><span>Composição da nota</span><h2>Critérios automáticos</h2></div><div className="score-weights"><span><strong>30%</strong>Pontualidade</span><span><strong>20%</strong>Entrega completa</span><span><strong>20%</strong>Qualidade</span><span><strong>15%</strong>Preço</span><span><strong>10%</strong>Resolução</span><span><strong>5%</strong>Documentação</span></div><p>Quando ainda não existe evidência para um critério, o sistema usa nota neutra de 50. Fornecedores sem pedido permanecem como “Sem histórico” e não entram na média.</p></section>

      <section className="intelligence-toolbar"><form method="get"><input name="q" defaultValue={params.q??""} placeholder="Buscar fornecedor ou categoria"/><select name="classification" defaultValue={params.classification??""}><option value="">Todas as classificações</option><option>Excelente</option><option>Bom</option><option>Atenção</option><option>Crítico</option><option>Sem histórico</option></select><select name="sort" defaultValue={params.sort??"score"}><option value="score">Maior nota</option><option value="risk">Maior risco</option><option value="orders">Mais pedidos</option><option value="value">Maior valor comprado</option></select><button type="submit">Filtrar</button><Link href="/suprimentos/desempenho-fornecedores">Limpar</Link></form></section>

      <section className="intelligence-card"><div className="section-heading"><div><span>Ranking da obra</span><h2>Fornecedores e evidências</h2></div><p>{rows.length} fornecedor(es)</p></div><div className="registry-table-wrap"><table className="registry-table supplier-score-table"><thead><tr><th>#</th><th>Fornecedor</th><th>Nota</th><th>Pontualidade</th><th>Entrega</th><th>Qualidade</th><th>Preço</th><th>Resolução</th><th>Documentos</th><th>Evidências</th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.supplier_id}><td><strong>{index+1}</strong></td><td><strong>{row.trade_name||row.legal_name}</strong><span>{row.trade_name?row.legal_name:""}</span><small>{row.category||"Categoria não informada"}</small></td><td><span className={`supplier-grade grade-${row.classification.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"-")}`}><strong>{row.overall_score==null?"—":number(row.overall_score)}</strong>{row.classification}</span></td><td><strong>{number(row.punctuality_score)}%</strong><span>{row.on_time_receipts}/{row.receipt_count} no prazo</span></td><td><strong>{number(row.completeness_score)}%</strong><span>{number(row.accepted_quantity,3)}/{number(row.ordered_quantity,3)}</span></td><td><strong>{number(row.quality_score)}%</strong><span>{number(row.rejected_quantity,3)} rejeitado</span></td><td><strong>{number(row.price_score)}%</strong><span>{row.conforming_price_items}/{row.invoice_item_count} conforme</span></td><td><strong>{number(row.resolution_score)}%</strong><span>{row.resolved_discrepancy_count}/{row.discrepancy_count} tratada(s)</span><small>{row.avg_resolution_days==null?"sem ocorrências":`${number(row.avg_resolution_days)} dias em média`}</small></td><td><strong>{number(row.documentation_score)}%</strong><span>{row.matched_invoices}/{row.invoice_count} NF-e conferida(s)</span></td><td><strong>{row.order_count} pedido(s)</strong><span>{money(row.ordered_value)}</span><small>{row.receipt_count} recebimento(s)</small></td></tr>)}{!rows.length?<tr><td colSpan={10} className="empty-table">Nenhum fornecedor encontrado.</td></tr>:null}</tbody></table></div></section>
    </>}
  </AppShell>;
}
