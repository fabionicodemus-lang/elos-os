import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
type Row={koper_id:string;payload:Record<string,unknown>};
async function all<T>(){const out:T[]=[];for(let o=0;;o+=1000){const rows=await requestSupabase<T[]>("koper_staging_records",{query:new URLSearchParams({select:"koper_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.bill_resolution",sync_state:"eq.present",order:"koper_id.asc",limit:"1000",offset:String(o)})});out.push(...rows);if(rows.length<1000)return out}}
const rows=await all<Row>();
const v2=rows.filter(r=>Number(r.payload?.version??0)>=2);
const byStatus:Record<string,{count:number,value:number}>={};const byRoute:Record<string,number>={};let multiService=0,multiWbs=0;const monitoring:any[]=[];const unresolved:any[]=[];
for(const r of v2){const p=r.payload??{},status=String(p.status??"none"),route=String(p.route??"none"),value=Number(p.billValue??0)||0;const s=byStatus[status]??{count:0,value:0};s.count++;s.value+=value;byStatus[status]=s;byRoute[route]=(byRoute[route]??0)+1;const services=Array.isArray(p.serviceSourceIds)?p.serviceSourceIds:[];const wbs=Array.isArray(p.wbsCodes)?p.wbsCodes:[];if(services.length>1)multiService++;if(wbs.length>1)multiWbs++;if(services.includes("1545")||wbs.includes("29.10"))monitoring.push({billId:r.koper_id,status,services,wbs,allocations:p.allocations});if(status==="unresolved"&&unresolved.length<30)unresolved.push({billId:r.koper_id,route,origin:p.originName,value,ids:p.ids});}
console.log("KOPER_RESOLUTION_V2_AUDIT",JSON.stringify({allRows:rows.length,v2Rows:v2.length,remaining:3838-v2.length,byStatus,byRoute,multiService,multiWbs,monitoring:monitoring.slice(0,20),unresolved}));
await new Promise(r=>setTimeout(r,1200));
