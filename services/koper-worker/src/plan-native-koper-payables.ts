import type { APIRequestContext, Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
type Payable = { source_id:string|null; amount:number; status:string; paid_at:string|null; paid_amount:number|null; supplier_id:string|null; project_id:string|null };
type Supplier = { id:string; source_id:string|null };
type Detail = { supplierId:string|null; costCenterId:string|null; costCenterName:string|null; chartAccountId:string|null; itemChartAccountId:string|null };
type Capture = { bills:Json[]; headers:Record<string,string>; request:APIRequestContext; blockedWrites:number };

const FLOW_PROJECT_ID="ffe8b7ec-1f01-4f6c-8a03-2bd6d3ae94fc";
const FLOW_COST_CENTER_ID="169";
const obj=(v:unknown):Json|null=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as Json:null;
const txt=(v:unknown):string|null=>v===null||v===undefined?null:(String(v).trim()||null);
const num=(v:unknown):number|null=>v===null||v===undefined||v===""?null:(Number.isFinite(Number(v))?Number(v):null);
const cents=(v:unknown):number|null=>{const x=num(v);return x===null?null:Math.round((x+Number.EPSILON)*100);};
const paid=(v:unknown):boolean=>v===true||v===1||v==="1"||String(v??"").toUpperCase()==="S";
const dateOnly=(v:unknown):string|null=>{const s=txt(v);if(!s||s==="-")return null;const m=s.match(/^\d{4}-\d{2}-\d{2}/);if(m)return m[0];const d=new Date(s.includes("T")?s:s.replace(" ","T"));return Number.isNaN(d.valueOf())?null:d.toISOString().slice(0,10);};
async function all<T>(table:string,query:Record<string,string>):Promise<T[]>{const out:T[]=[];for(let offset=0;;offset+=1000){const page=await requestSupabase<T[]>(table,{query:new URLSearchParams({...query,limit:"1000",offset:String(offset)})});out.push(...page);if(page.length<1000)return out;}}

async function liveCapture():Promise<Capture>{
 return withBrowserless(async({page})=>{
  const login=await performKoperLogin(page);if(!login.authenticated)throw new Error(login.message??"KOPER_AUTH_FAILED");
  let blockedWrites=0;
  await page.route("**/*",async route=>{const r=route.request();try{const u=new URL(r.url());const koper=u.hostname==="koper.com.br"||u.hostname.endsWith(".koper.com.br");if(koper&&!["GET","HEAD","OPTIONS"].includes(r.method())&&!isAllowedFlowSwitch(u,r.method(),r.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
  if(!await selectFlow(page))throw new Error("FLOW_NOT_SELECTED");
  const seedPromise=page.waitForResponse((r:Response)=>{try{const u=new URL(r.url());return r.request().method()==="GET"&&u.hostname==="api.koper.com.br"&&u.pathname==="/financial/v1/bills_to_pay"&&!u.searchParams.has("billId");}catch{return false;}},{timeout:20000}).catch(()=>null);
  await page.goto("https://app.koper.com.br/financeiro/contas_pagar",{waitUntil:"domcontentloaded",timeout:12000}).catch(()=>undefined);
  const seed=await seedPromise;if(!seed)throw new Error("PAYABLE_SEED_NOT_FOUND");
  const sourceHeaders=seed.request().headers();const headers:Record<string,string>={};for(const key of["accept","origin","referer","x-accesstoken","x-koper"])if(sourceHeaders[key])headers[key]=sourceHeaders[key];
  const base=new URL(seed.url());const bills:Json[]=[];let expected=0;
  for(let offset=0;offset<10000;offset+=500){const u=new URL(base);for(const[k,v]of Object.entries({allBills:"yes",initialDate:"",finalDate:"",limit:"500",offset:String(offset),orderFlag:"asc",orderby:"dueDate",typeDate:"dueDate",cb:String(Date.now())}))u.searchParams.set(k,v);const response=await page.request.get(u.toString(),{headers,timeout:8000});if(!response.ok())throw new Error(`PAGE_${response.status()}_${offset}`);const body=obj(await response.json().catch(()=>null));if(!body)throw new Error(`BODY_${offset}`);if(offset===0)expected=num(body.billsAmount)??0;const pageRows=Array.isArray(body.bills)?body.bills.map(obj).filter((x):x is Json=>Boolean(x)):[];bills.push(...pageRows);if(!pageRows.length||bills.length>=expected||pageRows.length<500)break;}
  const unique=new Map<string,Json>();for(const row of bills){const id=txt(row.billId);if(!id)throw new Error("BILL_WITHOUT_ID");if(unique.has(id))throw new Error(`DUPLICATE_BILL_${id}`);unique.set(id,row);}if(unique.size!==expected)throw new Error(`COUNT_${unique.size}_${expected}`);
  return{bills:[...unique.values()],headers,request:page.request,blockedWrites};
 },{sessionTimeoutMs:58_000});
}

async function details(request:APIRequestContext,headers:Record<string,string>,ids:string[]):Promise<Map<string,Detail>>{
 const result=new Map<string,Detail>();let cursor=0;const errors:string[]=[];const concurrency=Math.min(40,Math.max(1,Number.parseInt(process.env.KOPER_PAYABLE_DETAIL_CONCURRENCY??"24",10)||24));
 const worker=async()=>{while(true){const index=cursor++;if(index>=ids.length)return;const id=ids[index]!;try{const u=new URL("https://api.koper.com.br/financial/v1/bills_to_pay");u.searchParams.set("billId",id);u.searchParams.set("cb",`${Date.now()}-${index}`);const response=await request.get(u.toString(),{headers,timeout:10000});if(!response.ok())throw new Error(`HTTP_${response.status()}`);const body=obj(await response.json().catch(()=>null));if(!body)throw new Error("INVALID");const cc=obj(body.cost_center);result.set(id,{supplierId:txt(body.supplier_id),costCenterId:txt(cc?.id),costCenterName:txt(cc?.name),chartAccountId:txt(body.chart_account_id),itemChartAccountId:txt(body.item_chart_account_id)});}catch(e){errors.push(`${id}:${e instanceof Error?e.message:String(e)}`);}}};
 await Promise.all(Array.from({length:concurrency},()=>worker()));if(errors.length)throw new Error(`DETAIL_ERRORS_${errors.length}_${errors.slice(0,8).join("|")}`);return result;
}

try{
 const [elosRows,supplierRows]=await Promise.all([
  all<Payable>("payables",{select:"source_id,amount,status,paid_at,paid_amount,supplier_id,project_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper_flow",order:"source_id.asc"}),
  all<Supplier>("suppliers",{select:"id,source_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper",order:"source_id.asc"}),
 ]);
 const direct=new Map<string,Payable>();const synthetic=elosRows.filter(r=>r.source_id?.startsWith("koper_bill:missing-")===true);for(const row of elosRows){const m=row.source_id?.match(/^koper_bill:(\d+)$/);if(!m)continue;if(direct.has(m[1]!))throw new Error(`DUPLICATE_ELOS_SOURCE_${m[1]}`);direct.set(m[1]!,row);}
 const suppliers=new Map<string,string>();for(const row of supplierRows){if(!row.source_id)continue;const previous=suppliers.get(row.source_id);if(previous&&previous!==row.id)throw new Error(`DUPLICATE_SUPPLIER_${row.source_id}`);suppliers.set(row.source_id,row.id);}
 const source=await liveCapture();const live=new Map(source.bills.map(row=>[txt(row.billId)!,row]));const missing=[...live.keys()].filter(id=>!direct.has(id));const elosOnly=[...direct.keys()].filter(id=>!live.has(id));
 const amountMismatch:string[]=[];const statusMismatch:Array<{billId:string;elos:string;koper:string;paymentDate:string|null;paymentValue:number|null}>=[];for(const[id,elos]of direct){const row=live.get(id);if(!row)continue;if(cents(row.billValue)!==cents(elos.amount))amountMismatch.push(id);const target=paid(row.isPaid)?"paid":"open";if(elos.status!==target)statusMismatch.push({billId:id,elos:elos.status,koper:target,paymentDate:dateOnly(row.paymentDate),paymentValue:num(row.paymentValue)});}
 const found=await details(source.request,source.headers,missing);const unresolvedSupplier:Array<{billId:string;supplierId:string|null}>=[];const unexpectedCostCenter:Array<{billId:string;id:string|null;name:string|null}>=[];const invalidFinancial:string[]=[];const paidWithoutDate:string[]=[];const paidWithoutValue:string[]=[];let missingAmount=0;let missingPaid=0;let missingOpen=0;
 for(const id of missing){const row=live.get(id)!;const detail=found.get(id);const amount=cents(row.billValue);if(amount===null||amount<=0||!dateOnly(row.dueDate))invalidFinancial.push(id);else missingAmount+=amount;const isRowPaid=paid(row.isPaid);if(isRowPaid){missingPaid++;if(!dateOnly(row.paymentDate))paidWithoutDate.push(id);const pv=cents(row.paymentValue);if(pv===null||pv<=0)paidWithoutValue.push(id);}else missingOpen++;if(!detail||!detail.supplierId||!suppliers.has(detail.supplierId))unresolvedSupplier.push({billId:id,supplierId:detail?.supplierId??null});if(detail?.costCenterId&&detail.costCenterId!==FLOW_COST_CENTER_ID)unexpectedCostCenter.push({billId:id,id:detail.costCenterId,name:detail.costCenterName});}
 const liveAmount=source.bills.reduce((sum,row)=>sum+(cents(row.billValue)??0),0);const existingMatchedAmount=[...direct.entries()].reduce((sum,[id,row])=>live.has(id)?sum+(cents(row.amount)??0):sum,0);const reconciliationDiff=liveAmount-existingMatchedAmount-missingAmount;
 const blockers={elosOnlyDirect:elosOnly.length,amountMismatch:amountMismatch.length,missingDetail:missing.length-found.size,unresolvedSupplier:unresolvedSupplier.length,unexpectedCostCenter:unexpectedCostCenter.length,invalidFinancial:invalidFinancial.length,paidWithoutDate:paidWithoutDate.length,paidWithoutValue:paidWithoutValue.length,reconciliationDiff:reconciliationDiff/100};const ready=Object.values(blockers).every(v=>v===0);
 console.log("KOPER_NATIVE_PAYABLE_PLAN",JSON.stringify({ok:true,readOnly:true,ready,projectMapping:{koperCostCenter:FLOW_COST_CENTER_ID,elosProject:FLOW_PROJECT_ID},live:{rows:source.bills.length,amount:liveAmount/100,paid:source.bills.filter(r=>paid(r.isPaid)).length,open:source.bills.filter(r=>!paid(r.isPaid)).length},elos:{direct:direct.size,synthetic:synthetic.length},plan:{missing:missing.length,missingAmount:missingAmount/100,missingPaid,missingOpen,statusRepairs:statusMismatch.length},blockers,examples:{statusMismatch:statusMismatch.slice(0,20),unresolvedSupplier:unresolvedSupplier.slice(0,20),unexpectedCostCenter:unexpectedCostCenter.slice(0,20),invalidFinancial:invalidFinancial.slice(0,20),paidWithoutDate:paidWithoutDate.slice(0,20),paidWithoutValue:paidWithoutValue.slice(0,20)},safeguards:{koperReadOnly:true,blockedKoperWrites:source.blockedWrites,payablesWritten:0,syntheticTouched:0,budgetAppropriationInferred:false}}));
}catch(error){console.error("KOPER_NATIVE_PAYABLE_PLAN_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1800):String(error).slice(0,1800)}));process.exitCode=1;}
await import("./index.js");
