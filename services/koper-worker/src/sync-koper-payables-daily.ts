import { createHash } from "node:crypto";
import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { env } from "./config/env.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";
import { requestSupabase } from "./elos/supabase.js";
import { createKoperStagingRecord } from "./sync/staging-record.js";

type J=Record<string,unknown>;
type Bill={billId:string;billToPayId:string|null;billValue:number;dueDate:string|null;isPaid:boolean;paymentDate:string|null;paymentValue:number|null;invoiceNumber:string|null;receiptNumber:string|null;originName:string|null};
type Detail={supplierId:string|null;supplierName:string|null;costCenterId:string|null;invoiceId:string|null};
type Stage={id:string;koper_id:string;payload:J};
type Payable={id:string;source_id:string|null;project_id:string;supplier_id:string;amount:number;due_date:string;status:string;paid_at:string|null;paid_amount:number|null;notes:string|null};
type Invoice={registry_number:string;project_id:string;supplier_id:string;invoice_number:string};
type Supplier={id:string;source_id:string|null;source_system:string|null};
const o=(v:unknown):J=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as J:{};
const s=(v:unknown):string|null=>v==null||String(v).trim()===""?null:String(v).trim();
const cents=(v:unknown):number=>Math.round(Number(v??0)*100);
const date=(v:unknown):string|null=>{const raw=s(v);return raw&&/^\d{4}-\d{2}-\d{2}/.test(raw)?raw.slice(0,10):null;};
const uuid=(seed:string)=>{const b=Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0,32),"hex");b[6]=((b[6]??0)&15)|80;b[8]=((b[8]??0)&63)|128;const h=b.toString("hex");return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
async function all<T>(table:string,query:Record<string,string>):Promise<T[]>{const out:T[]=[];for(let offset=0;;offset+=1000){const rows=await requestSupabase<T[]>(table,{query:new URLSearchParams({...query,limit:"1000",offset:String(offset)}),timeoutMs:30000});out.push(...rows);if(rows.length<1000)return out;}}
const stage=(entity:string)=>all<Stage>("koper_staging_records",{select:"id,koper_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:`eq.${entity}`,sync_state:"eq.present",order:"koper_id.asc"});
const parseBill=(row:J):Bill=>({billId:s(row.billId)??"",billToPayId:s(row.billToPayId),billValue:Number(row.billValue),dueDate:date(row.dueDate),isPaid:row.isPaid===true,paymentDate:date(row.paymentDate),paymentValue:row.paymentValue==null?null:Number(row.paymentValue),invoiceNumber:s(row.invoiceNumber),receiptNumber:s(row.receiptNumber),originName:s(row.originName)});
const parseDetail=(raw:J):Detail=>{const beneficiary=o(raw.beneficiary),cost=o(raw.cost_center??raw.costCenter),origins=o(raw.origins);return{supplierId:s(raw.supplier_id??raw.supplierId??beneficiary.supplier_id??beneficiary.supplierId),supplierName:s(raw.supplier_name??raw.supplierName??beneficiary.supplier_name??beneficiary.supplierName),costCenterId:s(cost.id??raw.cost_center_id??raw.costCenterId),invoiceId:s(origins.invoice_id??origins.invoiceId??raw.invoice_id??raw.invoiceId)};};

async function capture():Promise<{bills:Bill[];details:Map<string,Detail>;blockedWrites:number;headerTotal:number}> {
 return withBrowserless(async({page})=>{
  const login=await performKoperLogin(page);if(!login.authenticated)throw new Error(`KOPER_AUTH_FAILED: ${login.message??"unknown"}`);
  let blockedWrites=0;
  await page.route("**/*",async route=>{const req=route.request();try{const u=new URL(req.url());const koper=u.hostname==="koper.com.br"||u.hostname.endsWith(".koper.com.br");if(koper&&!(["GET","HEAD","OPTIONS"].includes(req.method()))&&!isAllowedFlowSwitch(u,req.method(),req.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
  if(!await selectFlow(page))throw new Error("KOPER_FLOW_NOT_SELECTED");
  const seedPromise=page.waitForResponse((response:Response)=>{try{const u=new URL(response.url());return response.request().method()==="GET"&&u.hostname==="api.koper.com.br"&&u.pathname==="/financial/v1/bills_to_pay"&&!u.searchParams.has("billId");}catch{return false;}},{timeout:20000}).catch(()=>null);
  await page.goto("https://app.koper.com.br/financeiro/contas_pagar",{waitUntil:"domcontentloaded",timeout:15000}).catch(()=>undefined);
  const seed=await seedPromise;if(!seed)throw new Error("KOPER_PAYABLE_LIST_SEED_MISSING");
  const original=seed.request().headers(),headers:Record<string,string>={};for(const k of ["accept","origin","referer","x-accesstoken","x-koper"])if(original[k])headers[k]=original[k]!;
  const template=new URL(seed.url());for(const[k,v]of Object.entries({allBills:"yes",initialDate:"",finalDate:"",limit:"500",offset:"0",orderFlag:"asc",orderby:"dueDate",typeDate:"dueDate"}))template.searchParams.set(k,v);
  const bills:Bill[]=[];let expected=-1,headerTotal=0;
  for(let offset=0;offset<20000;offset+=500){const u=new URL(template);u.searchParams.set("offset",String(offset));u.searchParams.set("cb",String(Date.now()));const res=await page.request.get(u.toString(),{headers,timeout:12000});if(!res.ok())throw new Error(`KOPER_LIST_HTTP_${res.status()}`);const body=o(await res.json().catch(()=>null));if(offset===0){expected=Number(body.billsAmount);headerTotal=cents(body.totalBills);}const list=Array.isArray(body.bills)?body.bills.map(o):[];bills.push(...list.map(parseBill));if(!list.length||bills.length>=expected||list.length<500)break;}
  if(!Number.isInteger(expected)||expected<0||bills.length!==expected||new Set(bills.map(x=>x.billId)).size!==expected||bills.some(x=>!x.billId||!Number.isFinite(x.billValue)))throw new Error(`KOPER_LIST_INCOMPLETE_${bills.length}_${expected}`);
  if(bills.reduce((v,x)=>v+cents(x.billValue),0)!==headerTotal)throw new Error("KOPER_LIST_TOTAL_MISMATCH");
  const [posted,storedDetails]=await Promise.all([all<{source_id:string|null}>("payables",{select:"source_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper_flow",order:"id.asc"}),stage("bill_detail_enrichment")]);const known=new Set(posted.map(x=>x.source_id)),detailIds=new Set(storedDetails.map(x=>x.koper_id));const newBills=bills.filter(x=>!known.has(`koper_bill:${x.billId}`)&&!detailIds.has(x.billId));
  const cap=Math.max(1,Math.min(500,Number(process.env.KOPER_DAILY_NEW_LIMIT??"250")||250));
  const selected=newBills.slice(0,cap);const details=new Map<string,Detail>();let cursor=0;
  await Promise.all(Array.from({length:Math.min(8,selected.length)},async()=>{while(true){const i=cursor++;if(i>=selected.length)return;const bill=selected[i]!;const u=new URL("https://api.koper.com.br/financial/v1/bills_to_pay");u.searchParams.set("billId",bill.billId);const res=await page.request.get(u.toString(),{headers,timeout:12000});if(!res.ok())throw new Error(`KOPER_DETAIL_HTTP_${res.status()}_${bill.billId}`);details.set(bill.billId,parseDetail(o(await res.json().catch(()=>null))));}}));
  return{bills,details,blockedWrites,headerTotal:headerTotal/100};
 },{sessionTimeoutMs:180000});
}

try{
 const source=await capture();
 const [previous,oldDetails,resolutions,payables,invoices,suppliers,projects]=await Promise.all([
  stage("bill_to_pay"),stage("bill_detail_enrichment"),stage("bill_resolution"),
  all<Payable>("payables",{select:"id,source_id,project_id,supplier_id,amount,due_date,status,paid_at,paid_amount,notes",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper_flow",order:"id.asc"}),
  all<Invoice>("finance_electronic_invoices",{select:"registry_number,project_id,supplier_id,invoice_number",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"registry_number.asc"}),
  all<Supplier>("suppliers",{select:"id,source_id,source_system",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
  all<{id:string}>("projects",{select:"id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
 ]);
 const byStage=new Map(previous.map(x=>[x.koper_id,x])),byPayable=new Map(payables.filter(x=>x.source_id).map(x=>[x.source_id!,x]));
 const invoiceBySource=new Map(invoices.map(x=>[x.registry_number,x]));const supplierBySource=new Map(suppliers.filter(x=>x.source_id&&x.source_system==="koper").map(x=>[x.source_id!,x]));
 const projectIds=new Set(projects.map(x=>x.id));const projectByCenter=new Map<string,Set<string>>();const resolutionByBill=new Map(resolutions.map(x=>[x.koper_id,o(x.payload)]));
 for(const row of oldDetails){const center=s(o(row.payload).costCenterId),p=byPayable.get(`koper_bill:${row.koper_id}`),evidenceProject=s(o(o(resolutionByBill.get(row.koper_id)).projectEvidence).projectId);if(center&&p&&evidenceProject===p.project_id){const set=projectByCenter.get(center)??new Set<string>();set.add(p.project_id);projectByCenter.set(center,set);}}
 const newBills=source.bills.filter(x=>!byPayable.has(`koper_bill:${x.billId}`));const detailByBill=new Map(oldDetails.map(x=>[x.koper_id,o(x.payload) as Detail]));for(const[id,detail]of source.details)detailByBill.set(id,detail);const selected=newBills.filter(x=>detailByBill.has(x.billId));
 const exceptions:Array<{billId:string;reason:string;amount:number}>=[];const creates:J[]=[];const paymentUpdates:Array<{payable:Payable;bill:Bill}>=[];let unchanged=0;
 for(const bill of source.bills){const posted=byPayable.get(`koper_bill:${bill.billId}`);if(posted){if(cents(posted.amount)!==cents(bill.billValue)||posted.due_date!==bill.dueDate){exceptions.push({billId:bill.billId,reason:"existing_value_or_due_date_conflict",amount:bill.billValue});continue;}if(posted.status==="open"&&bill.isPaid&&bill.paymentDate)paymentUpdates.push({payable:posted,bill});else if(posted.status==="paid"&&!bill.isPaid)exceptions.push({billId:bill.billId,reason:"payment_reversal_requires_review",amount:bill.billValue});else unchanged++;continue;}
  if(!detailByBill.has(bill.billId))continue;const detail=detailByBill.get(bill.billId)!;const inv=detail.invoiceId?invoiceBySource.get(`KOPER-NFE-${detail.invoiceId}`):undefined;const centerProjects=detail.costCenterId?projectByCenter.get(detail.costCenterId):undefined;
  const projectId=inv?.project_id??(centerProjects?.size===1?[...centerProjects][0]:null);const supplierId=inv?.supplier_id??(detail.supplierId?supplierBySource.get(detail.supplierId)?.id:null);
  const reason=!projectId||!projectIds.has(projectId)?"project_unresolved":!supplierId?"supplier_unresolved":!bill.dueDate||cents(bill.billValue)<=0?"invalid_amount_or_due_date":bill.isPaid&&!bill.paymentDate?"paid_without_payment_date":null;
  if(reason){exceptions.push({billId:bill.billId,reason,amount:bill.billValue});continue;}
  creates.push({id:uuid(`elos:koper:payable:${bill.billId}`),company_id:env.BOSSA_COMPANY_ID,project_id:projectId,supplier_id:supplierId,document:inv?`NF ${inv.invoice_number}`:bill.invoiceNumber?`NF ${bill.invoiceNumber}`:bill.receiptNumber?`Recibo ${bill.receiptNumber}`:`Koper ${bill.billToPayId??bill.billId}`,due_date:bill.dueDate,amount:bill.billValue,status:bill.isPaid?"paid":"open",paid_at:bill.isPaid?bill.paymentDate:null,paid_amount:bill.isPaid?(bill.paymentValue??bill.billValue):null,paid_account_name:bill.isPaid?"Koper (sincronização)":null,notes:`À Apropriar · Sincronização Koper · título ${bill.billToPayId??bill.billId} · parcela ${bill.billId}`,origin:"historical_import",source_system:"koper_flow",source_category:inv?"electronic_invoice":"daily_import",source_id:`koper_bill:${bill.billId}`});
 }
 const write=process.argv.includes("--write");const summary={write,source:source.bills.length,sourceTotal:source.headerTotal,previousStage:previous.length,previousPayables:payables.length,newInSource:newBills.length,detailsFetched:source.details.size,detailsAvailable:selected.length,remainingDetails:newBills.length-selected.length,toCreate:creates.length,paymentUpdates:paymentUpdates.length,unchanged,exceptions:exceptions.length,exceptionsByReason:exceptions.reduce<Record<string,number>>((m,x)=>(m[x.reason]=(m[x.reason]??0)+1,m),{}),examples:exceptions.slice(0,12),blockedKoperWrites:source.blockedWrites};
 console.log("KOPER_DAILY_SYNC_PLAN",JSON.stringify(summary));
 if(write){
 // Persist the source snapshot before promotion so a failed mapping remains reviewable.
 const now=new Date();for(let i=0;i<selected.length;i+=100){const batch=selected.slice(i,i+100).map(b=>createKoperStagingRecord({companyId:env.BOSSA_COMPANY_ID,entity:"bill_to_pay",koperId:b.billId,koperParentId:b.billToPayId,sanitizedPayload:{...b},mappingVersion:9,seenAt:now}));await requestSupabase("koper_staging_records",{method:"POST",body:batch,prefer:"resolution=ignore-duplicates,return=minimal",query:new URLSearchParams({on_conflict:"company_id,source,entity,koper_id"}),timeoutMs:30000});}
 for(const bill of selected){const detail=source.details.get(bill.billId);if(!detail)continue;const row=createKoperStagingRecord({companyId:env.BOSSA_COMPANY_ID,entity:"bill_detail_enrichment",koperId:bill.billId,koperParentId:bill.billToPayId,sanitizedPayload:detail,mappingVersion:9,seenAt:now});await requestSupabase("koper_staging_records",{method:"POST",body:row,prefer:"resolution=ignore-duplicates,return=minimal",query:new URLSearchParams({on_conflict:"company_id,source,entity,koper_id"})});}
 for(const item of exceptions.filter(x=>!byStage.has(x.billId))){const row=createKoperStagingRecord({companyId:env.BOSSA_COMPANY_ID,entity:"bill_daily_exception",koperId:item.billId,sanitizedPayload:{reason:item.reason,amount:item.amount,observedAt:now.toISOString()},mappingVersion:1,seenAt:now});await requestSupabase("koper_staging_records",{method:"POST",body:row,prefer:"resolution=ignore-duplicates,return=minimal",query:new URLSearchParams({on_conflict:"company_id,source,entity,koper_id"})});}
 for(let i=0;i<creates.length;i+=50)await requestSupabase("payables",{method:"POST",body:creates.slice(i,i+50),prefer:"resolution=ignore-duplicates,return=minimal",query:new URLSearchParams({on_conflict:"id"}),timeoutMs:30000});
 for(const {payable,bill} of paymentUpdates)await requestSupabase("payables",{method:"PATCH",body:{status:"paid",paid_at:bill.paymentDate,paid_amount:bill.paymentValue??bill.billValue,paid_account_name:"Koper (sincronização)"},query:new URLSearchParams({id:`eq.${payable.id}`,company_id:`eq.${env.BOSSA_COMPANY_ID}`,status:"eq.open",source_id:`eq.koper_bill:${bill.billId}`}),prefer:"return=minimal"});
 const checked=await all<Payable>("payables",{select:"id,source_id,project_id,supplier_id,amount,due_date,status,paid_at,paid_amount,notes",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper_flow",order:"id.asc"});const checkMap=new Map(checked.filter(x=>x.source_id).map(x=>[x.source_id!,x]));
 if(creates.some(row=>{const p=checkMap.get(String(row.source_id));return !p||cents(p.amount)!==cents(row.amount)||p.project_id!==row.project_id||p.supplier_id!==row.supplier_id;})||paymentUpdates.some(({bill})=>checkMap.get(`koper_bill:${bill.billId}`)?.status!=="paid"))throw new Error("KOPER_DAILY_POST_VERIFICATION_FAILED");
 console.log("KOPER_DAILY_SYNC_RESULT",JSON.stringify({createdOrPresent:creates.length,paymentsUpdated:paymentUpdates.length,verified:true,exceptions:exceptions.length,remainingDetails:newBills.length-selected.length}));
 }
}catch(error){console.error("KOPER_DAILY_SYNC_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,500):String(error)}));process.exitCode=1;}
