import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
type Row={koper_id:string;payload:Record<string,unknown>};
const rows=await requestSupabase<Row[]>("koper_staging_records",{query:new URLSearchParams({select:"koper_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.bill_resolution",sync_state:"eq.present",limit:"1000"})});
const failed=rows.filter(r=>Number(r.payload?.version??0)>=2&&r.payload?.status==="failed");const byError:Record<string,number>={};for(const r of failed){const e=String(r.payload?.error??"none");byError[e]=(byError[e]??0)+1;}console.log("KOPER_V2_FAILURE_AUDIT",JSON.stringify({failed:failed.length,byError,samples:failed.slice(0,15).map(r=>({billId:r.koper_id,value:r.payload?.billValue,error:r.payload?.error}))}));await new Promise(r=>setTimeout(r,1200));
