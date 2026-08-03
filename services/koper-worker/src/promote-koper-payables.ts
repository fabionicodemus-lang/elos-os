import { createHash } from "node:crypto";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type Stage = { koper_id: string; payload: unknown };
type NativeInvoice = { id: string; project_id: string; supplier_id: string; registry_number: string; invoice_number: string; invoice_total: number; issue_date: string };

const object = (value: unknown): Json => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};
const rows = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : [];
const text = (value: unknown): string | null => (typeof value === "string" || typeof value === "number") && String(value).trim() ? String(value).trim() : null;
const numeric = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const dateOnly = (value: unknown): string | null => { const raw = text(value); if (!raw) return null; const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T")); return Number.isNaN(parsed.valueOf()) ? (/^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0,10) : null) : parsed.toISOString().slice(0,10); };
function stableUuid(seed: string): string { const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0,32), "hex"); bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; const hex = bytes.toString("hex"); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`; }
async function readAll<T>(table: string, query: Record<string,string>): Promise<T[]> { const result:T[]=[]; for(let offset=0;;offset+=1000){ const page=await requestSupabase<T[]>(table,{query:new URLSearchParams({...query,limit:"1000",offset:String(offset)})}); result.push(...page); if(page.length<1000)return result; } }
function chunks<T>(values:T[],size:number):T[][]{ const result:T[][]=[]; for(let i=0;i<values.length;i+=size)result.push(values.slice(i,i+size)); return result; }
function quotedIn(values:string[]):string{return `in.(${values.map((value)=>`"${value.replaceAll("\"","\\\"")}"`).join(",")})`;}

await import("./index.js");

try {
  const writeEnabled = process.env.KOPER_PAYABLE_WRITE_ENABLED === "true";
  const offset = Math.max(0, Number.parseInt(process.env.KOPER_PAYABLE_BATCH_OFFSET ?? "0",10)||0);
  const size = Math.min(200, Math.max(1, Number.parseInt(process.env.KOPER_PAYABLE_BATCH_SIZE ?? "1",10)||1));
  const [stages,invoices,existing,actors] = await Promise.all([
    readAll<Stage>("koper_staging_records",{select:"koper_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.xml_invoice",sync_state:"eq.present",order:"koper_id.asc"}),
    readAll<NativeInvoice>("finance_electronic_invoices",{select:"id,project_id,supplier_id,registry_number,invoice_number,invoice_total,issue_date",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"registry_number.asc"}),
    readAll<{id:string;source_id:string|null}>("payables",{select:"id,source_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
    requestSupabase<Array<{user_id:string}>>("company_memberships",{query:new URLSearchParams({select:"user_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,status:"eq.active",order:"created_at.asc",limit:"1"})}),
  ]);
  const actor=actors[0]; if(!actor) throw new Error("No active company actor available");
  const nativeBySource=new Map(invoices.map((invoice)=>[invoice.registry_number.replace(/^KOPER-NFE-/,""),invoice]));
  const existingSources=new Set(existing.flatMap((row)=>row.source_id?[row.source_id]:[]));
  const plans:Array<Record<string,unknown>>=[]; const exclusions:Record<string,number>={};
  for(const stage of stages){
    const invoice=nativeBySource.get(stage.koper_id); if(!invoice){exclusions.missing_native_invoice=(exclusions.missing_native_invoice??0)+1;continue;}
    const payload=object(stage.payload); const bill=object(payload.bill); const duplicates=rows(bill.duplicates); if(!duplicates.length){exclusions.missing_duplicates=(exclusions.missing_duplicates??0)+1;continue;}
    const parsed=duplicates.map((duplicate,index)=>({ billId:text(duplicate.billId), dueDate:dateOnly(duplicate.dueDate), amount:numeric(duplicate.billValue), isPaid:duplicate.isPaid===true, paymentDate:dateOnly(duplicate.paymentDate), paymentValue:numeric(duplicate.paymentValue), duplicateNumber:text(duplicate.duplicateNumber)??String(index+1) }));
    if(parsed.some((item)=>!item.billId||!item.dueDate||item.amount===null||item.amount<=0||(item.isPaid&&!item.paymentDate))){exclusions.invalid_duplicate=(exclusions.invalid_duplicate??0)+1;continue;}
    const sum=parsed.reduce((total,item)=>total+(item.amount??0),0); if(Math.abs(sum-Number(invoice.invoice_total))>Math.max(0.02,Math.abs(Number(invoice.invoice_total))*0.00001)){exclusions.unbalanced_invoice=(exclusions.unbalanced_invoice??0)+1;continue;}
    for(let index=0;index<parsed.length;index+=1){ const item=parsed[index]!; const sourceId=`koper_bill:${item.billId}`; plans.push({ id:stableUuid(`elos:koper:payable:${item.billId}`), company_id:env.BOSSA_COMPANY_ID, project_id:invoice.project_id, supplier_id:invoice.supplier_id, document:`NF ${invoice.invoice_number}`, fiscal_class:null, payment_method:null, due_date:item.dueDate, amount:item.amount, status:item.isPaid?"paid":"open", installment_label:`${item.duplicateNumber} / ${parsed.length}`, notes:`Importação histórica Koper · NF-e ${stage.koper_id} · título ${text(bill.billToPayId)??"—"} · parcela ${item.billId}`, origin:"historical_import", source_system:"koper_flow", source_category:"electronic_invoice", source_id:sourceId, beneficiary_name:null, beneficiary_tax_id:null, paid_at:item.isPaid?item.paymentDate:null, paid_amount:item.isPaid?(item.paymentValue??item.amount):null, paid_account_name:item.isPaid?"Koper (histórico)":null, created_by:actor.user_id, alreadyExists:existingSources.has(sourceId) }); }
  }
  const selected=plans.slice(offset,offset+size); const rowsToWrite=selected.map(({alreadyExists,...row})=>row);
  if(!writeEnabled){ console.log("KOPER_PAYABLE_BATCH_PLAN",JSON.stringify({ok:true,writeEnabled:false,totalPlans:plans.length,exclusions,existing:existing.length,batch:{offset,size,selected:selected.length,paid:selected.filter((row)=>row.status==="paid").length,open:selected.filter((row)=>row.status==="open").length,alreadyExisting:selected.filter((row)=>row.alreadyExists===true).length,nextOffset:offset+selected.length,complete:offset+selected.length>=plans.length},examples:selected.slice(0,3)})); }
  else if(selected.length===0){ console.log("KOPER_PAYABLE_BATCH_RESULT",JSON.stringify({ok:true,selected:0,nextOffset:offset,complete:true})); }
  else {
    for(const batch of chunks(rowsToWrite,100)) await requestSupabase("payables",{method:"POST",body:batch,prefer:"resolution=merge-duplicates,return=minimal",query:new URLSearchParams({on_conflict:"id"})});
    const ids=rowsToWrite.map((row)=>String(row.id)); const verified=await requestSupabase<Array<{id:string,status:string,source_id:string,paid_at:string|null,paid_amount:number|null}>>("payables",{query:new URLSearchParams({select:"id,status,source_id,paid_at,paid_amount",id:quotedIn(ids),limit:String(ids.length+10)})});
    console.log("KOPER_PAYABLE_BATCH_RESULT",JSON.stringify({ok:true,totalPlans:plans.length,selected:selected.length,verified:verified.length,statuses:verified.reduce<Record<string,number>>((counts,row)=>{counts[row.status]=(counts[row.status]??0)+1;return counts;},{}),paidRowsWithoutDate:verified.filter((row)=>row.status==="paid"&&!row.paid_at).length,nextOffset:offset+selected.length,complete:offset+selected.length>=plans.length}));
  }
} catch(error){ console.error("KOPER_PAYABLE_BATCH_ERROR",error instanceof Error?error.message:String(error)); process.exitCode=1; }
