import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
type J=Record<string,unknown>;
const codes=(process.env.FLOW_ACTIVE_CODES??"").split(",").map(s=>s.trim()).filter(Boolean);
const services=await requestSupabase<J[]>("engineering_services",{query:new URLSearchParams({select:"id,code,description,unit,group_code,status,source_system,source_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,limit:"1000"})});
const byCode=new Map(services.map(s=>[String(s.code??""),s]));
const matched=codes.filter(c=>byCode.has(c));
const missing=codes.filter(c=>!byCode.has(c));
console.log("FLOW_ACTIVE_SERVICE_MATCHES",JSON.stringify({ok:true,targetCount:codes.length,matchedCount:matched.length,missingCount:missing.length,missing,matchedSamples:matched.slice(0,12).map(c=>byCode.get(c))}));
