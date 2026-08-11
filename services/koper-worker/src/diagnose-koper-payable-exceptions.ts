import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type Stage = { koper_id: string; payload: unknown };
const object = (value: unknown): Json => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};
const rows = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : [];
const text = (value: unknown): string | null => (typeof value === "string" || typeof value === "number") && String(value).trim() ? String(value).trim() : null;
const numeric = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const dateOnly = (value: unknown): string | null => { const raw=text(value); if(!raw)return null; const parsed=new Date(raw.includes("T")?raw:raw.replace(" ","T")); return Number.isNaN(parsed.valueOf()) ? (/^\d{4}-\d{2}-\d{2}/.test(raw)?raw.slice(0,10):null) : parsed.toISOString().slice(0,10); };
async function readAll<T>(table:string, query:Record<string,string>):Promise<T[]>{const result:T[]=[];for(let offset=0;;offset+=1000){const page=await requestSupabase<T[]>(table,{query:new URLSearchParams({...query,limit:"1000",offset:String(offset)})});result.push(...page);if(page.length<1000)return result;}}
await import("./index.js");
try {
 const stages=await readAll<Stage>("koper_staging_records",{select:"koper_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.xml_invoice",sync_state:"eq.present",order:"koper_id.asc"});
 const exceptions=[] as Array<Record<string,unknown>>;
 for(const stage of stages){
  const payload=object(stage.payload); const bill=object(payload.bill); const duplicates=rows(bill.duplicates);
  if(!duplicates.length){exceptions.push({sourceInvoiceId:stage.koper_id,kind:"missing_duplicates",bill});continue;}
  const parsed=duplicates.map((duplicate,index)=>({index,billId:text(duplicate.billId),dueDate:dateOnly(duplicate.dueDate),rawDueDate:duplicate.dueDate,amount:numeric(duplicate.billValue),rawAmount:duplicate.billValue,isPaid:duplicate.isPaid===true,paymentDate:dateOnly(duplicate.paymentDate),rawPaymentDate:duplicate.paymentDate,paymentValue:numeric(duplicate.paymentValue),duplicateNumber:text(duplicate.duplicateNumber)}));
  const invalid=parsed.filter((item)=>!item.billId||!item.dueDate||item.amount===null||item.amount<=0||(item.isPaid&&!item.paymentDate));
  if(invalid.length) exceptions.push({sourceInvoiceId:stage.koper_id,kind:"invalid_duplicate",billToPayId:text(bill.billToPayId),invalid,all:parsed});
 }
 console.log("KOPER_PAYABLE_EXCEPTIONS",JSON.stringify({ok:true,totalStages:stages.length,count:exceptions.length,exceptions}));
} catch(error){console.error("KOPER_PAYABLE_EXCEPTIONS_ERROR",error instanceof Error?error.message:String(error));process.exitCode=1;}
