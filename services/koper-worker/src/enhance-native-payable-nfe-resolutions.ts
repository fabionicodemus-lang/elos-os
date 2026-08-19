import { createHash } from "node:crypto";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type J=Record<string,unknown>;
type Stage={koper_id:string;koper_parent_id:string|null;payload:unknown};
type Order={id:string;source_id:string|null};
type OrderItem={id:string;order_id:string;input_id:string;cost_center_service_id:string|null;accepted_quantity:number;received_quantity:number;ordered_quantity:number};
type Input={id:string;source_id:string|null};
type Service={id:string;source_id:string|null;description:string};
type Budget={id:string;status:string};
type BudgetItem={id:string;budget_id:string;service_id:string|null;code:string|null;status:string};
const obj=(v:unknown):J=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as J:{};
const arr=(v:unknown):J[]=>Array.isArray(v)?v.map(obj):[];
const id=(v:unknown):string|null=>(typeof v==="string"||typeof v==="number")&&String(v).trim()?String(v).trim():null;
const num=(v:unknown):number|null=>typeof v==="number"&&Number.isFinite(v)?v:typeof v==="string"&&v.trim()&&Number.isFinite(Number(v))?Number(v):null;
const money=(v:number)=>Math.round(v*100)/100;
const uniq=<T>(v:T[])=>[...new Set(v)];
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
async function all<T>(table:string,q:Record<string,string>){const out:T[]=[];for(let o=0;;o+=1000){const rows=await requestSupabase<T[]>(table,{query:new URLSearchParams({...q,limit:"1000",offset:String(o)}),timeoutMs:30000});out.push(...rows);if(rows.length<1000)return out}}
function purchaseOrderSources(p:J){return uniq(arr(p.purchaseOrders).flatMap(r=>{const x=id(r.purchaseOrderId??r.purchase_order_id);return x?[x]:[]}));}
function sourceProductIds(p:J){return uniq([id(p.mainProductId),id(p.productId),id(p.inputId),id(p.genericProdSeq)].filter((x):x is string=>!!x));}
function qty(p:J){return num(p.productAmount)??num(p.quantity)??num(p.amount)??num(p.invoiceProductAmount);}
function lineTotal(p:J){return num(p.productTotal)??num(p.totalValue)??num(p.total_amount)??num(p.invoiceProductTotal)??((qty(p)??0)*(num(p.productValue)??num(p.unitValue)??num(p.unitPrice)??0));}
function close(a:number,b:number){const d=Math.abs(a-b);return d<=0.1||d/Math.max(1,Math.abs(b))<=0.005;}

await import("./index.js");
const [resolutions,invoices,products,orders,orderItems,inputs,services,budgets,budgetItems]=await Promise.all([
 all<Stage>("koper_staging_records",{select:"koper_id,koper_parent_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.bill_resolution",sync_state:"eq.present",order:"koper_id.asc"}),
 all<Stage>("koper_staging_records",{select:"koper_id,koper_parent_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.xml_invoice",sync_state:"eq.present",order:"koper_id.asc"}),
 all<Stage>("koper_staging_records",{select:"koper_id,koper_parent_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.xml_invoice_product",sync_state:"eq.present",order:"koper_parent_id.asc"}),
 all<Order>("procurement_purchase_orders",{select:"id,source_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper",order:"source_id.asc"}),
 all<OrderItem>("procurement_purchase_order_items",{select:"id,order_id,input_id,cost_center_service_id,accepted_quantity,received_quantity,ordered_quantity",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper",order:"order_id.asc"}),
 all<Input>("engineering_inputs",{select:"id,source_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper",order:"source_id.asc"}),
 all<Service>("engineering_services",{select:"id,source_id,description",company_id:`eq.${env.BOSSA_COMPANY_ID}`,status:"eq.active",order:"id.asc"}),
 all<Budget>("engineering_budgets",{select:"id,status",company_id:`eq.${env.BOSSA_COMPANY_ID}`,status:"eq.approved",order:"id.asc"}),
 all<BudgetItem>("engineering_budget_items",{select:"id,budget_id,service_id,code,status",company_id:`eq.${env.BOSSA_COMPANY_ID}`,status:"eq.active",order:"id.asc"}),
]);
const invoiceById=new Map(invoices.map(x=>[x.koper_id,x]));
const productsByInvoice=new Map<string,Stage[]>();for(const p of products)if(p.koper_parent_id)productsByInvoice.set(p.koper_parent_id,[...(productsByInvoice.get(p.koper_parent_id)??[]),p]);
const orderBySource=new Map(orders.flatMap(o=>o.source_id?[[o.source_id,o] as const]:[]));
const itemsByOrder=new Map<string,OrderItem[]>();for(const x of orderItems)itemsByOrder.set(x.order_id,[...(itemsByOrder.get(x.order_id)??[]),x]);
const inputBySource=new Map(inputs.flatMap(x=>x.source_id?[[x.source_id,x] as const]:[]));
const serviceById=new Map(services.map(x=>[x.id,x]));
const approved=new Set(budgets.map(x=>x.id));
const wbsByService=new Map<string,BudgetItem[]>();for(const x of budgetItems)if(x.service_id&&approved.has(x.budget_id)&&x.code)wbsByService.set(x.service_id,[...(wbsByService.get(x.service_id)??[]),x]);
const currentWbs=(serviceId:string)=>{const rows=wbsByService.get(serviceId)??[];const codes=uniq(rows.flatMap(x=>x.code?[x.code]:[]));return codes.length===1?rows.find(x=>x.code===codes[0])??null:null};
const targets=resolutions.filter(r=>{const p=obj(r.payload);return Number(p.version??0)>=2&&p.status==="unresolved"&&p.route==="invoice";});
let upgraded=0,skippedNoInvoice=0,skippedOrder=0,skippedProduct=0,skippedQuantity=0,skippedService=0;const examples:J[]=[];
for(const row of targets){const p=obj(row.payload);const ids=obj(p.ids);const invoiceId=id(ids.invoiceId);const billValue=num(p.billValue)??0;if(!invoiceId||billValue<=0){skippedNoInvoice++;continue}const inv=invoiceById.get(invoiceId);if(!inv){skippedNoInvoice++;continue}const invPayload=obj(inv.payload);const nativeOrders=purchaseOrderSources(invPayload).flatMap(s=>{const o=orderBySource.get(s);return o?[o]:[]});if(nativeOrders.length!==1){skippedOrder++;continue}const order=nativeOrders[0]!;const prods=productsByInvoice.get(invoiceId)??[];if(!prods.length){skippedProduct++;continue}
 const mapped:Array<{serviceId:string;orderItemId:string;weight:number;quantity:number|null;accepted:number;received:number}> = [];let bad=false;let quantityBad=false;
 for(const prod of prods){const q=qty(obj(prod.payload));const sources=sourceProductIds(obj(prod.payload));const nativeInputs=new Set(sources.flatMap(s=>{const i=inputBySource.get(s);return i?[i.id]:[]}));const candidates=(itemsByOrder.get(order.id)??[]).filter(oi=>nativeInputs.has(oi.input_id));if(candidates.length!==1){bad=true;break}const oi=candidates[0]!;if(!oi.cost_center_service_id){bad=true;break}if(q!==null&&q>0&&!close(q,Number(oi.accepted_quantity??0))&&!close(q,Number(oi.received_quantity??0))&&!close(q,Number(oi.ordered_quantity??0))){quantityBad=true;break}mapped.push({serviceId:oi.cost_center_service_id,orderItemId:oi.id,weight:Math.max(0.01,lineTotal(obj(prod.payload))??q??1),quantity:q,accepted:Number(oi.accepted_quantity??0),received:Number(oi.received_quantity??0)});}
 if(quantityBad){skippedQuantity++;continue}if(bad||mapped.length!==prods.length){skippedProduct++;continue}const grouped=new Map<string,{weight:number;orderItemIds:string[]}>();for(const m of mapped){const g=grouped.get(m.serviceId)??{weight:0,orderItemIds:[]};g.weight+=m.weight;g.orderItemIds.push(m.orderItemId);grouped.set(m.serviceId,g)}const totalWeight=[...grouped.values()].reduce((a,g)=>a+g.weight,0);if(totalWeight<=0){skippedProduct++;continue}let assigned=0;const allocations:J[]=[];const serviceSourceIds:string[]=[];const wbsCodes:string[]=[];const groups=[...grouped.entries()];
 groups.forEach(([serviceId,g],index)=>{const service=serviceById.get(serviceId);if(!service)return;const amount=index===groups.length-1?money(billValue-assigned):money(billValue*g.weight/totalWeight);assigned=money(assigned+amount);const w=currentWbs(serviceId);allocations.push({serviceId,serviceSourceId:service.source_id,serviceName:service.description,budgetItemId:w?.id??null,wbsCode:w?.code??null,amount,method:"koper_nfe_native_order_product",evidence:{invoiceId,orderSourceIds:purchaseOrderSources(invPayload),orderItemIds:uniq(g.orderItemIds),allProductsUnique:true,quantityCrosscheck:true}});if(service.source_id)serviceSourceIds.push(service.source_id);if(w?.code)wbsCodes.push(w.code);});
 if(allocations.length!==groups.length||money(allocations.reduce((a,x)=>a+Number(x.amount??0),0))!==money(billValue)){skippedService++;continue}const next={...p,version:3,status:"exact_allocated",serviceSourceIds:uniq(serviceSourceIds),wbsCodes:uniq(wbsCodes),allocations,projectEvidence:{...obj(p.projectEvidence),nativeOrderSourceIds:purchaseOrderSources(invPayload),nfeFallback:"native_order_product_quantity"}};const now=new Date().toISOString();await requestSupabase("koper_staging_records",{method:"POST",body:[{company_id:env.BOSSA_COMPANY_ID,source:"koper",entity:"bill_resolution",koper_id:row.koper_id,koper_parent_id:row.koper_parent_id,payload:next,payload_hash:hash(next),first_seen_at:now,last_seen_at:now,processing_status:"processed",processing_error:null,mapping_version:3,sync_state:"present",elos_id:null,updated_at:now}],prefer:"resolution=merge-duplicates,return=minimal",query:new URLSearchParams({on_conflict:"company_id,source,entity,koper_id"})});upgraded++;if(examples.length<15)examples.push({billId:row.koper_id,invoiceId,orderId:order.id,services:uniq(serviceSourceIds),wbs:uniq(wbsCodes),billValue});}
console.log("KOPER_NFE_RESOLUTION_ENHANCER",JSON.stringify({targets:targets.length,upgraded,skippedNoInvoice,skippedOrder,skippedProduct,skippedQuantity,skippedService,examples}));
await new Promise(r=>setTimeout(r,1200));
