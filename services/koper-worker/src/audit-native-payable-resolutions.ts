import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Row={koper_id:string;payload:Record<string,unknown>};
async function all<T>(){const out:T[]=[];for(let o=0;;o+=1000){const rows=await requestSupabase<T[]>("koper_staging_records",{query:new URLSearchParams({select:"koper_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.bill_resolution",sync_state:"eq.present",order:"koper_id.asc",limit:"1000",offset:String(o)})});out.push(...rows);if(rows.length<1000)return out}}
const rows=await all<Row>();
const stats:Record<string,{count:number,value:number}>={};
const routes:Record<string,Record<string,{count:number,value:number}>>={};
const serviceCard:Record<string,number>={};
const originCounts:Record<string,number>={};
const exceptions:Array<Record<string,unknown>>=[];
for(const row of rows){const p=row.payload??{};const status=String(p.status??"none"),route=String(p.route??"none"),value=Number(p.billValue??0)||0;const s=stats[status]??{count:0,value:0};s.count++;s.value+=value;stats[status]=s;const rr=routes[route]??{};const rs=rr[status]??{count:0,value:0};rs.count++;rs.value+=value;rr[status]=rs;routes[route]=rr;const services=Array.isArray(p.serviceSourceIds)?p.serviceSourceIds:[];if(status==="service_only")serviceCard[String(services.length)]=(serviceCard[String(services.length)]??0)+1;const origin=String(p.originName??"(none)");originCounts[origin]=(originCounts[origin]??0)+1;if(["unresolved","project_only","service_only","exact_wbs_unallocated","failed"].includes(status)&&exceptions.length<120)exceptions.push({billId:row.koper_id,status,route,origin,value,services,wbs:p.wbsCodes,ids:p.ids,project:p.projectEvidence,error:p.error});}
console.log("KOPER_RESOLUTION_AUDIT",JSON.stringify({rows,stats,routes,serviceOnlyCardinality:serviceCard,topOrigins:Object.entries(originCounts).sort((a,b)=>b[1]-a[1]).slice(0,30)}));
for(const e of exceptions)console.log("KOPER_RESOLUTION_EXCEPTION",JSON.stringify(e));
await new Promise(r=>setTimeout(r,1000));
