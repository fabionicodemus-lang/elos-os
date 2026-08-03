import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Payable = { id:string; project_id:string; supplier_id:string; document:string|null; due_date:string; amount:number; status:string; source_system:string|null; source_id:string|null; paid_at:string|null; paid_amount:number|null; paid_account_name:string|null };
async function readAll<T>(table:string,query:Record<string,string>):Promise<T[]>{const result:T[]=[];for(let offset=0;;offset+=1000){const page=await requestSupabase<T[]>(table,{query:new URLSearchParams({...query,limit:"1000",offset:String(offset)})});result.push(...page);if(page.length<1000)return result;}}
await import("./index.js");
try{
 const [payables,bankTransactions]=await Promise.all([
  readAll<Payable>("payables",{select:"id,project_id,supplier_id,document,due_date,amount,status,source_system,source_id,paid_at,paid_amount,paid_account_name",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper_flow",order:"id.asc"}),
  readAll<{id:string;description:string|null}>("finance_bank_transactions",{select:"id,description",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}).catch(()=>[]),
 ]);
 const ids=new Set<string>();const sources=new Set<string>();let duplicateIds=0,duplicateSources=0;
 for(const row of payables){if(ids.has(row.id))duplicateIds+=1;ids.add(row.id);if(row.source_id){if(sources.has(row.source_id))duplicateSources+=1;sources.add(row.source_id);}}
 const paid=payables.filter((row)=>row.status==="paid");const open=payables.filter((row)=>row.status==="open");
 console.log("KOPER_PAYABLE_FINAL_AUDIT",JSON.stringify({ok:true,total:payables.length,statuses:{paid:paid.length,open:open.length,other:payables.length-paid.length-open.length},amounts:{total:payables.reduce((s,r)=>s+Number(r.amount||0),0),paid:paid.reduce((s,r)=>s+Number(r.paid_amount??r.amount??0),0),open:open.reduce((s,r)=>s+Number(r.amount||0),0)},integrity:{duplicateIds,duplicateSources,missingProject:payables.filter((r)=>!r.project_id).length,missingSupplier:payables.filter((r)=>!r.supplier_id).length,missingDueDate:payables.filter((r)=>!r.due_date).length,invalidAmount:payables.filter((r)=>!(Number(r.amount)>0)).length,paidWithoutDate:paid.filter((r)=>!r.paid_at).length,paidWithoutAmount:paid.filter((r)=>!(Number(r.paid_amount)>0)).length,openWithPaidDate:open.filter((r)=>r.paid_at).length,invalidSource:payables.filter((r)=>!String(r.source_id??"").startsWith("koper_bill:")).length},bankSafety:{bankTransactionsTotal:bankTransactions.length,koperHistoricalBankTransactions:bankTransactions.filter((r)=>/koper|histórico/i.test(String(r.description??""))).length}}));
}catch(error){console.error("KOPER_PAYABLE_FINAL_AUDIT_ERROR",error instanceof Error?error.message:String(error));process.exitCode=1;}
