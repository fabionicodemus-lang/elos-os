import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Stage={koper_id:string;koper_parent_id:string|null;payload:any};
type Supplier={id:string;source_id:string|null;legal_name:string;trade_name:string|null;tax_id:string|null};
async function all<T>(table:string, params:Record<string,string>):Promise<T[]>{const out:T[]=[];for(let offset=0;;offset+=1000){const q=new URLSearchParams({...params,offset:String(offset),limit:"1000"});const rows=await requestSupabase<T[]>(table,{query:q});out.push(...rows);if(rows.length<1000)return out;}}
function obj(v:any){return v&&typeof v==="object"?v:{};}
function vals(v:any):string[]{if(Array.isArray(v))return v.flatMap(vals);if(v===null||v===undefined)return[];if(typeof v==="string"||typeof v==="number")return[String(v)];if(typeof v==="object")return Object.values(v).flatMap(vals);return[];}
const targetIds=new Set(["094d7eae-4153-11f0-b8a2-1a6b6ee5ff16","21a59d76-bbaf-11ef-8536-1219c832db49","264ffa78-d330-11ee-83c0-1219c832db49","2c691ef6-7af1-11f1-94ff-fa4feac7f6de","3acd7ffa-0ef0-11f0-8a2d-52bd07b98162","52356cb0-66fd-11f0-9d62-0aaa53fad23c","5b846520-d31d-11ee-83c0-1219c832db49","7645b8e0-d31e-11ee-83c0-1219c832db49","a2db1620-d332-11ee-83c0-1219c832db49","ac04c292-d318-11ee-83c0-1219c832db49","b5337d36-d32c-11ee-83c0-1219c832db49","b70d96a6-df37-11ef-8537-1219c832db49","d6319482-d31d-11ee-83c0-1219c832db49","fd144b52-d332-11ee-83c0-1219c832db49"]);
async function main(){
 const [invoices,stock,suppliers,payables]=await Promise.all([
  all<Stage>("koper_staging_records",{select:"koper_id,koper_parent_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.xml_invoice",sync_state:"eq.present",order:"koper_id.asc"}),
  all<Stage>("koper_staging_records",{select:"koper_id,koper_parent_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.stock_entry",sync_state:"eq.present",order:"koper_id.asc"}),
  all<Supplier>("suppliers",{select:"id,source_id,legal_name,trade_name,tax_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper",order:"source_id.asc"}),
  all<any>("payables",{select:"*",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"})
 ]);
 const bySource=new Map<string,Supplier[]>();for(const s of suppliers)if(s.source_id)bySource.set(s.source_id,[...(bySource.get(s.source_id)||[]),s]);
 const records=[];
 for(const inv of invoices.filter(x=>targetIds.has(x.koper_id))){const p=obj(inv.payload);const billId=String(obj(p.bill).billToPayId??"");const entries=stock.filter(s=>vals(obj(s.payload).invoiceIds).includes(inv.koper_id));const origins=[...new Set(entries.map(e=>String(obj(e.payload).originId??"")).filter(Boolean))];const originSuppliers=origins.flatMap(x=>(bySource.get(x)||[]).map(s=>({origin:x,id:s.id,source:s.source_id,name:s.legal_name,tax:s.tax_id})));const payableMatches=payables.filter((x:any)=>{const t=JSON.stringify(x);return (billId&&t.includes(billId))||t.includes(inv.koper_id);}).map((x:any)=>({id:x.id,supplier_id:x.supplier_id,project_id:x.project_id,source_id:x.source_id,description:x.description,document_number:x.document_number,notes:x.notes}));records.push({invoiceId:inv.koper_id,invoiceNumber:p.invoiceNumber,billToPayId:billId,origins,originSuppliers,payableMatches});}
 console.log("KOPER_NFE_FINAL14_SUPPLIERS",JSON.stringify({ok:true,readOnly:true,count:records.length,records}));
}
main().catch(e=>{console.error(e);process.exit(1)});