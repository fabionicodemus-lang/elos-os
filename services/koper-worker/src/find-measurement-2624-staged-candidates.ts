import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type StageRow={koper_id:string;payload:Record<string,unknown>|null};
type Json=Record<string,unknown>;
const obj=(v:unknown):Json|null=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as Json:null;
function findExact(v:unknown,target:string,prefix="",depth=0):Array<{path:string,value:unknown}>{
 if(depth>10)return[];
 if(Array.isArray(v))return v.flatMap((x,i)=>findExact(x,target,`${prefix}[${i}]`,depth+1));
 const r=obj(v);if(!r)return[];const out:Array<{path:string,value:unknown}>=[];
 for(const[k,x]of Object.entries(r)){
  const p=prefix?`${prefix}.${k}`:k;
  if(String(x)===target)out.push({path:p,value:x});
  else if(x&&(Array.isArray(x)||obj(x)))out.push(...findExact(x,target,p,depth+1));
 }
 return out;
}
const rows:StageRow[]=[];
for(let offset=0;;offset+=1000){
 const page=await requestSupabase<StageRow[]>("koper_staging_records",{query:new URLSearchParams({select:"koper_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.bill_to_pay",limit:"1000",offset:String(offset)})});
 rows.push(...page);if(page.length<1000)break;
}
const exact2624=[] as Array<Record<string,unknown>>;
const exact826=[] as Array<Record<string,unknown>>;
const amountCandidates=[] as Array<Record<string,unknown>>;
const recent=[] as Array<Record<string,unknown>>;
for(const row of rows){
 const p=row.payload??{};
 const h2624=findExact(p,"2624"); if(h2624.length)exact2624.push({billId:row.koper_id,hits:h2624,payload:p});
 const h826=findExact(p,"826"); if(h826.length)exact826.push({billId:row.koper_id,hits:h826,payload:p});
 const amount=Number(p.billValue);
 if(Number.isFinite(amount)&&Math.abs(amount-27955.30)<0.02)amountCandidates.push({billId:row.koper_id,payload:p});
 const date=String(p.issueDate??p.dueDate??"");
 if(date.startsWith("2026-08"))recent.push({billId:row.koper_id,payload:p});
}
console.log("KOPER_MEASUREMENT_2624_STAGED_CANDIDATES",JSON.stringify({rows:rows.length,exact2624:exact2624.slice(0,30),exact826:exact826.slice(0,50),amount27955_30:amountCandidates.slice(0,30),recentAugustCount:recent.length,recentAugust:recent.sort((a,b)=>Number(b.billId)-Number(a.billId)).slice(0,100)}));
await import("./index.js");
