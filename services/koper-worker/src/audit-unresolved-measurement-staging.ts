import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type J = Record<string, unknown>;
type Stage = { entity:string; koper_id:string; koper_parent_id:string|null; payload:unknown };
const obj=(v:unknown):J=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as J:{};
const targetIds=new Set(["1011","1087","1122","1132","1159","1387","1423","14972","611","8119","8872","9083","9084"]);
const sensitive=/name|email|phone|address|cpf|cnpj|document|file|token|cookie|password|comment/i;
const interesting=/id|code|status|value|amount|contract|measure|service|stage|cost|center|build|monitor|bill|pay|order|receipt|invoice|item|release|quantity|price|percent|reference|date|origin|project/i;

function safe(v:unknown,prefix="",depth=0):Array<{path:string,value:unknown}>{
  if(depth>9)return[];
  if(Array.isArray(v))return v.slice(0,100).flatMap((x,i)=>safe(x,`${prefix}[${i}]`,depth+1));
  const r=obj(v),out:Array<{path:string,value:unknown}>=[];
  for(const [k,x] of Object.entries(r)){
    if(sensitive.test(k))continue;
    const p=prefix?`${prefix}.${k}`:k;
    if(x===null||typeof x==="string"||typeof x==="number"||typeof x==="boolean"){
      if(interesting.test(k))out.push({path:p,value:x});
    }else if(x&&(Array.isArray(x)||typeof x==="object"))out.push(...safe(x,p,depth+1));
  }
  return out;
}

async function readEntity(entity:string){
  const out:Stage[]=[];
  for(let o=0;;o+=1000){
    const rows=await requestSupabase<Stage[]>("koper_staging_records",{query:new URLSearchParams({
      select:"entity,koper_id,koper_parent_id,payload",
      company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:`eq.${entity}`,sync_state:"eq.present",
      order:"koper_id.asc",limit:"1000",offset:String(o)
    }),timeoutMs:30000});
    out.push(...rows); if(rows.length<1000)return out;
  }
}

const entities=["bill_resolution","bill_detail_enrichment","bill_to_pay"];
const allRows=(await Promise.all(entities.map(readEntity))).flat();
const selected=allRows.filter(r=>targetIds.has(r.koper_id)||!!(r.koper_parent_id&&targetIds.has(r.koper_parent_id)));
const result=selected.map(r=>({
  entity:r.entity,koperId:r.koper_id,parentId:r.koper_parent_id,
  evidence:safe(r.payload).slice(0,500)
}));
console.log("KOPER_MEASUREMENT_STAGING_EVIDENCE",JSON.stringify({count:result.length,rows:result}));
await new Promise(r=>setTimeout(r,1200));
