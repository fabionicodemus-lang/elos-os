import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Stage={koper_id:string;payload:unknown};
type J=Record<string,unknown>;
const obj=(v:unknown):J=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as J:{};
const id=(v:unknown):string|null=>(typeof v==="string"||typeof v==="number")?(String(v).trim()||null):null;
async function all<T>(entity:string){const out:T[]=[];for(let o=0;;o+=1000){const rows=await requestSupabase<T[]>("koper_staging_records",{query:new URLSearchParams({select:"koper_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:`eq.${entity}`,sync_state:"eq.present",order:"koper_id.asc",limit:"1000",offset:String(o)})});out.push(...rows);if(rows.length<1000)return out}}
const rows=await all<Stage>("budget_item");
const map=new Map<string,Set<string>>();
const names=new Map<string,Set<string>>();
let linked=0;
for(const row of rows){const p=obj(row.payload);const sid=id(p.serviceId);const ref=id(p.itemReference??p.monItemReference??p.reference);if(!sid)continue;const name=id(p.itemName??p.serviceName??p.description);if(name){const s=names.get(sid)??new Set<string>();s.add(name);names.set(sid,s)}if(ref){linked++;const s=map.get(sid)??new Set<string>();s.add(ref);map.set(sid,s)}}
const safe=[...map.entries()].filter(([,refs])=>refs.size===1);
const ambiguous=[...map.entries()].filter(([,refs])=>refs.size>1);
const targets=(process.env.KOPER_SERVICE_WBS_TARGETS??"1215,433,287,437,438,435,73,286,1908,369,293,364,377,446,378,376,3426,3690,375,3756,368,720,278,440,436,456,266,886,294").split(",").map(x=>x.trim()).filter(Boolean);
console.log("KOPER_BUDGET_SERVICE_WBS",JSON.stringify({ok:true,readOnly:true,budgetItems:rows.length,linkedItems:linked,servicesWithWbs:map.size,safeUniqueWbs:safe.length,ambiguousServices:ambiguous.length,targets:targets.map(serviceId=>({serviceId,names:[...(names.get(serviceId)??[])].slice(0,4),wbs:[...(map.get(serviceId)??[])],safe:(map.get(serviceId)?.size??0)===1}))}));
await new Promise(r=>setTimeout(r,1200));
