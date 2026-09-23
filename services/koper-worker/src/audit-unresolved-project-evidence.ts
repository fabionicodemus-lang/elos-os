import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
type J=Record<string,unknown>;
type Stage={koper_id:string;payload:unknown};
const obj=(v:unknown):J=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as J:{};
const id=(v:unknown):string|null=>(typeof v==="string"||typeof v==="number")&&String(v).trim()?String(v).trim():null;
async function all<T>(entity:string){
 const out:T[]=[];
 for(let o=0;;o+=1000){
  const rows=await requestSupabase<T[]>("koper_staging_records",{query:new URLSearchParams({
   select:"koper_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:`eq.${entity}`,sync_state:"eq.present",order:"koper_id.asc",limit:"1000",offset:String(o)
  }),timeoutMs:30000});
  out.push(...rows); if(rows.length<1000)return out;
 }
}
const [resolutions,enrichments]=await Promise.all([all<Stage>("bill_resolution"),all<Stage>("bill_detail_enrichment")]);
const enrich=new Map(enrichments.map(x=>[x.koper_id,obj(x.payload)]));
const targets=resolutions.filter(r=>{const p=obj(r.payload);return p.status==="unresolved"&&(p.route==="invoice"||p.route==="other");});
const groups:Record<string,{count:number;value:number}>={};
const bump=(k:string,v:number)=>{const g=groups[k]??{count:0,value:0};g.count++;g.value+=v;groups[k]=g};
const examples:J[]=[];
for(const r of targets){
 const p=obj(r.payload),pe=obj(p.projectEvidence),e=enrich.get(r.koper_id)??{};
 const value=Number(p.billValue??0);
 const projectId=id(pe.projectId);
 const bm=id(pe.buildMonitoringId)??id(e.buildMonitoringId);
 const cc=id(pe.costCenterId)??id(e.costCenterId);
 const route=String(p.route);
 const key=projectId?`${route}:projectId`:bm?`${route}:buildMonitoring`:cc?`${route}:costCenter`:`${route}:noProjectEvidence`;
 bump(key,value);
 if(examples.length<120)examples.push({billId:r.koper_id,route,value,projectId,buildMonitoringId:bm,costCenterId:cc,invoiceId:id(obj(p.ids).invoiceId),originId:id(p.originId)});
}
for(const g of Object.values(groups))g.value=Math.round(g.value*100)/100;
console.log("KOPER_UNRESOLVED_PROJECT_EVIDENCE",JSON.stringify({targets:targets.length,groups,examples}));
await new Promise(r=>setTimeout(r,1200));
