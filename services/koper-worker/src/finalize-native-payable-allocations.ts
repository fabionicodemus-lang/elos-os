import { createHash } from "node:crypto";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type J=Record<string,unknown>;
type Stage={koper_id:string;payload:J};
type Payable={id:string;source_id:string|null;company_id:string;project_id:string;amount:number};
type Existing={payable_id:string;source_id:string|null;allocation_amount:number};
const o=(v:unknown):J=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as J:{};
const s=(v:unknown):string|null=>v==null||String(v).trim()===""?null:String(v).trim();
const cents=(v:unknown)=>Math.round(Number(v??0)*100);
const uuid=(seed:string)=>{const b=Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0,32),"hex");b[6]=((b[6]??0)&15)|80;b[8]=((b[8]??0)&63)|128;const h=b.toString("hex");return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
async function all<T>(table:string,query:Record<string,string>):Promise<T[]>{const out:T[]=[];for(let offset=0;;offset+=1000){const rows=await requestSupabase<T[]>(table,{query:new URLSearchParams({...query,limit:"1000",offset:String(offset)}),timeoutMs:30000});out.push(...rows);if(rows.length<1000)return out;}}
const [resolutions,payables,existing,services,budgetItems]=await Promise.all([
 all<Stage>("koper_staging_records",{select:"koper_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.bill_resolution",sync_state:"eq.present",order:"koper_id.asc"}),
 all<Payable>("payables",{select:"id,source_id,company_id,project_id,amount",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
 all<Existing>("payable_cost_allocations",{select:"payable_id,source_id,allocation_amount",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
 all<{id:string;company_id:string}>("engineering_services",{select:"id,company_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
 all<{id:string;company_id:string;project_id:string;service_id:string|null}>("engineering_budget_items",{select:"id,company_id,project_id,service_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
]);
const pm=new Map(payables.filter(x=>x.source_id).map(x=>[x.source_id!,x]));
const occupied=new Set(existing.map(x=>x.payable_id));
const serviceIds=new Set(services.map(x=>x.id));
const budgetById=new Map(budgetItems.map(x=>[x.id,x]));
const targets=resolutions.filter(x=>o(x.payload).status==="exact_allocated"&&!occupied.has(pm.get(`koper_bill:${x.koper_id}`)?.id??""));
const total=targets.reduce((v,x)=>v+cents(o(x.payload).billValue),0);
if(targets.length!==33||total!==7950488)throw new Error(`TARGET_GUARD ${targets.length} ${total}`);
const rows:J[]=[];const methods:Record<string,number>={};
for(const target of targets){
 const p=o(target.payload),payable=pm.get(`koper_bill:${target.koper_id}`),items=Array.isArray(p.allocations)?p.allocations.map(o):[];
 if(!payable||payable.company_id!==env.BOSSA_COMPANY_ID||cents(payable.amount)!==cents(p.billValue)||!items.length||items.reduce((v,x)=>v+cents(x.amount),0)!==cents(payable.amount))throw new Error(`PAYABLE_GUARD ${target.koper_id}`);
 items.forEach((a,index)=>{
  const serviceId=s(a.serviceId),budgetItemId=s(a.budgetItemId),wbs=s(a.wbsCode),budget=budgetItemId?budgetById.get(budgetItemId):null,method=s(a.method)??"import_other";
  if((!serviceId&&!budgetItemId&&!wbs)||(serviceId&&!serviceIds.has(serviceId))||(budgetItemId&&(!budget||budget.project_id!==payable.project_id||(serviceId&&budget.service_id&&budget.service_id!==serviceId)))||cents(a.amount)<=0)throw new Error(`ALLOCATION_GUARD ${target.koper_id}:${index}`);
  methods[method]=(methods[method]??0)+1;
  rows.push({id:uuid(`elos:koper:payable-allocation:${target.koper_id}:${index}`),company_id:env.BOSSA_COMPANY_ID,project_id:payable.project_id,payable_id:payable.id,service_id:serviceId,budget_item_id:budgetItemId,wbs_code_snapshot:wbs,service_name_snapshot:s(a.serviceName),allocation_amount:cents(a.amount)/100,resolution_method:["koper_service_order","koper_receipt_purchase","koper_measurement_contract","koper_invoice_purchase_order","koper_monitoring_crosswalk"].includes(method)?method:"import_other",source_system:"koper_flow",source_id:`koper_bill:${target.koper_id}:allocation:${index}`,evidence:{...o(a.evidence),original_method:method,bill_id:target.koper_id},created_by:null});
 });
}
const write=process.argv.includes("--write");
console.log("KOPER_FINAL_ALLOCATIONS_PLAN",JSON.stringify({write,titles:targets.length,rows:rows.length,total:total/100,methods,examples:rows.slice(0,2).map(x=>({source_id:x.source_id,project_id:x.project_id,service_id:x.service_id,budget_item_id:x.budget_item_id,amount:x.allocation_amount}))}));
if(write){
 for(let i=0;i<rows.length;i+=50)await requestSupabase("payable_cost_allocations",{method:"POST",body:rows.slice(i,i+50),prefer:"resolution=ignore-duplicates,return=minimal",query:new URLSearchParams({on_conflict:"id"}),timeoutMs:30000});
 const checked=await all<Existing>("payable_cost_allocations",{select:"payable_id,source_id,allocation_amount",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"});
 const bySource=new Map(checked.filter(x=>x.source_id).map(x=>[x.source_id!,x]));
 if(rows.some(x=>cents(bySource.get(String(x.source_id))?.allocation_amount)!==cents(x.allocation_amount)))throw new Error("POST_WRITE_VERIFICATION_FAILED");
 console.log("KOPER_FINAL_ALLOCATIONS_RESULT",JSON.stringify({insertedOrPresent:rows.length,titles:targets.length,total:total/100,verified:true}));
}
