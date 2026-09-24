import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type J=Record<string,unknown>;
type Stage={koper_id:string;payload:J};
type Payable={id:string;source_id:string|null;project_id:string;supplier_id:string;amount:number;notes:string|null};
type Invoice={registry_number:string;project_id:string;supplier_id:string};
const o=(v:unknown):J=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as J:{};
const s=(v:unknown)=>v==null?"":String(v).trim();
const cents=(v:unknown)=>Math.round(Number(v??0)*100);
async function all<T>(table:string,query:Record<string,string>):Promise<T[]>{const out:T[]=[];for(let offset=0;;offset+=1000){const rows=await requestSupabase<T[]>(table,{query:new URLSearchParams({...query,limit:"1000",offset:String(offset)}),timeoutMs:30000});out.push(...rows);if(rows.length<1000)return out;}}
const [resolutions,payables,invoices,allocations]=await Promise.all([
 all<Stage>("koper_staging_records",{select:"koper_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.bill_resolution",sync_state:"eq.present",order:"koper_id.asc"}),
 all<Payable>("payables",{select:"id,source_id,project_id,supplier_id,amount,notes",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
 all<Invoice>("finance_electronic_invoices",{select:"registry_number,project_id,supplier_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
 all<{payable_id:string}>("payable_cost_allocations",{select:"payable_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
]);
const pm=new Map(payables.filter(x=>x.source_id).map(x=>[x.source_id!,x]));
const im=new Map(invoices.map(x=>[x.registry_number,x]));
const occupied=new Set(allocations.map(x=>x.payable_id));
const targets=resolutions.filter(x=>{const p=o(x.payload);return p.status==="project_only"&&Number(p.version)===8&&p.route==="invoice";});
if(targets.length!==362||targets.reduce((sum,x)=>sum+cents(o(x.payload).billValue),0)!==94615311)throw new Error("362_INVOICE_GUARD");
const plan: Array<{id:string;notes:string;billId:string}>=[];
for(const target of targets){const p=o(target.payload),ids=o(p.ids),inv=im.get(`KOPER-NFE-${s(ids.invoiceId)}`),payable=pm.get(`koper_bill:${target.koper_id}`);
 if(!inv||!payable||occupied.has(payable.id)||payable.project_id!==inv.project_id||payable.supplier_id!==inv.supplier_id||cents(payable.amount)!==cents(p.billValue))throw new Error(`INVOICE_EVIDENCE_GUARD ${target.koper_id}`);
 const notes=s(payable.notes);const next=notes.startsWith("À Apropriar · ")?notes:`À Apropriar · ${notes||`Importação histórica Koper · título ${target.koper_id}`}`;
 if(next!==notes)plan.push({id:payable.id,notes:next,billId:target.koper_id});
}
const write=process.argv.includes("--write");
console.log("KOPER_INVOICE_TO_ALLOCATE_PLAN",JSON.stringify({eligible:targets.length,value:946153.11,toMark:plan.length,alreadyMarked:targets.length-plan.length,write}));
if(write){for(const row of plan)await requestSupabase("payables",{method:"PATCH",body:{notes:row.notes},query:new URLSearchParams({id:`eq.${row.id}`,company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper_flow",source_id:`eq.koper_bill:${row.billId}`}),prefer:"return=minimal",timeoutMs:30000});
 const current=await all<Payable>("payables",{select:"id,source_id,project_id,supplier_id,amount,notes",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"});const byId=new Map(current.map(x=>[x.id,x]));
 if(targets.some(x=>!s(byId.get(pm.get(`koper_bill:${x.koper_id}`)!.id)?.notes).startsWith("À Apropriar · ")))throw new Error("MARK_VERIFICATION_FAILED");
 console.log("KOPER_INVOICE_TO_ALLOCATE_RESULT",JSON.stringify({verified:362,updated:plan.length,value:946153.11}));}
