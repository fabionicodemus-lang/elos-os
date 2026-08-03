import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Row={id:string;amount:number;paid_amount:number|null;status:string;source_id:string|null};
async function readAll<T>(table:string,query:Record<string,string>):Promise<T[]>{const result:T[]=[];for(let offset=0;;offset+=1000){const page=await requestSupabase<T[]>(table,{query:new URLSearchParams({...query,limit:"1000",offset:String(offset)})});result.push(...page);if(page.length<1000)return result;}}
await import("./index.js");
try{
 const enabled=process.env.KOPER_PAYABLE_REPAIR_WRITE_ENABLED==="true";
 const rows=await readAll<Row>("payables",{select:"id,amount,paid_amount,status,source_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper_flow",status:"eq.paid",order:"id.asc"});
 const targets=rows.filter((row)=>!(Number(row.paid_amount)>0)&&Number(row.amount)>0);
 if(!enabled){console.log("KOPER_PAYABLE_REPAIR_PLAN",JSON.stringify({ok:true,enabled:false,targets:targets.map((row)=>({id:row.id,sourceId:row.source_id,amount:row.amount,paidAmount:row.paid_amount}))}));}
 else{
  for(const row of targets) await requestSupabase("payables",{method:"PATCH",body:{paid_amount:Number(row.amount),updated_at:new Date().toISOString()},query:new URLSearchParams({id:`eq.${row.id}`,company_id:`eq.${env.BOSSA_COMPANY_ID}`}),prefer:"return=minimal"});
  const verified=await readAll<Row>("payables",{select:"id,amount,paid_amount,status,source_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper_flow",status:"eq.paid",order:"id.asc"});
  console.log("KOPER_PAYABLE_REPAIR_RESULT",JSON.stringify({ok:true,repaired:targets.length,remaining:verified.filter((row)=>!(Number(row.paid_amount)>0)).length}));
 }
}catch(error){console.error("KOPER_PAYABLE_REPAIR_ERROR",error instanceof Error?error.message:String(error));process.exitCode=1;}
