import { createHash } from "node:crypto";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type J=Record<string,unknown>;
type Stage={koper_id:string;koper_parent_id:string|null;payload:unknown};
const obj=(v:unknown):J=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as J:{};
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");

async function all<T>(){
  const out:T[]=[];
  for(let o=0;;o+=1000){
    const rows=await requestSupabase<T[]>("koper_staging_records",{query:new URLSearchParams({
      select:"koper_id,koper_parent_id,payload",
      company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.bill_resolution",
      sync_state:"eq.present",order:"koper_id.asc",limit:"1000",offset:String(o)
    }),timeoutMs:30000});
    out.push(...rows); if(rows.length<1000)return out;
  }
}

const rows=await all<Stage>();
const targets=rows.filter(r=>{
  const p=obj(r.payload);
  return p.route==="measurement"&&p.status==="unresolved";
});
if(targets.length===0){
  console.log("KOPER_MEASUREMENT_PROJECT_ONLY",{targets:0,updated:0,alreadyDone:true});
}else{
  const total=Math.round(targets.reduce((s,r)=>s+Number(obj(r.payload).billValue??0),0)*100)/100;
  const eligible=targets.filter(r=>{
    const p=obj(r.payload),pe=obj(p.projectEvidence);
    return !!String(pe.buildMonitoringId??"").trim();
  });
  if(targets.length!==13||eligible.length!==13||Math.abs(total-180200.01)>0.01){
    throw new Error(`MEASUREMENT_PROJECT_ONLY_GUARD targets=${targets.length} eligible=${eligible.length} total=${total}`);
  }
  let updated=0;
  for(const r of eligible){
    const p=obj(r.payload),pe=obj(p.projectEvidence);
    const next={...p,version:7,status:"project_only",projectEvidence:{...pe,measurementFallback:"build_monitoring_project_only"},serviceSourceIds:[],wbsCodes:[],allocations:[]};
    const now=new Date().toISOString();
    await requestSupabase("koper_staging_records",{method:"POST",body:[{
      company_id:env.BOSSA_COMPANY_ID,source:"koper",entity:"bill_resolution",
      koper_id:r.koper_id,koper_parent_id:r.koper_parent_id,payload:next,payload_hash:hash(next),
      first_seen_at:now,last_seen_at:now,processing_status:"processed",processing_error:null,
      mapping_version:7,sync_state:"present",elos_id:null,updated_at:now
    }],prefer:"resolution=merge-duplicates,return=minimal",query:new URLSearchParams({on_conflict:"company_id,source,entity,koper_id"})});
    updated++;
  }
  console.log("KOPER_MEASUREMENT_PROJECT_ONLY",JSON.stringify({targets:targets.length,eligible:eligible.length,total,updated,method:"build_monitoring_project_only"}));
}
await new Promise(r=>setTimeout(r,1200));
