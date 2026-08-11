import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json=Record<string,unknown>;
const obj=(v:unknown):Json|null=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as Json:null;
const n=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
const c=(v:unknown)=>Math.round((n(v)+Number.EPSILON)*100);
const has=(v:unknown)=>v!==null&&v!==undefined&&String(v).trim()!=="";

try{
 const result=await withBrowserless(async({page})=>{
  const login=await performKoperLogin(page);if(!login.authenticated)return{ok:false,message:login.message};
  let blockedWrites=0;
  await page.route("**/*",async route=>{const r=route.request();try{const u=new URL(r.url());const koper=u.hostname==="koper.com.br"||u.hostname.endsWith(".koper.com.br");if(koper&&!["GET","HEAD","OPTIONS"].includes(r.method())&&!isAllowedFlowSwitch(u,r.method(),r.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
  if(!await selectFlow(page))return{ok:false,message:"FLOW_NOT_SELECTED",blockedWrites};
  const seedPromise=page.waitForResponse((response:Response)=>{try{const u=new URL(response.url());return response.request().method()==="GET"&&u.hostname==="api.koper.com.br"&&u.pathname==="/financial/v1/bills_to_pay";}catch{return false;}},{timeout:20000}).catch(()=>null);
  await page.goto("https://app.koper.com.br/financeiro/contas_pagar",{waitUntil:"domcontentloaded",timeout:12000}).catch(()=>undefined);const seed=await seedPromise;if(!seed)return{ok:false,message:"SEED_NOT_FOUND",blockedWrites};
  const sh=seed.request().headers();const headers:Record<string,string>={};for(const k of["accept","origin","referer","x-accesstoken","x-koper"])if(sh[k])headers[k]=sh[k];
  const base=new URL(seed.url());const rows:Json[]=[];let header:Json|null=null;
  for(let offset=0;offset<10000;offset+=500){const u=new URL(base);for(const[k,v]of Object.entries({allBills:"yes",initialDate:"",finalDate:"",limit:"500",offset:String(offset),orderFlag:"asc",orderby:"dueDate",typeDate:"dueDate",cb:String(Date.now())}))u.searchParams.set(k,v);const response=await page.request.get(u.toString(),{headers,timeout:8000});if(!response.ok())return{ok:false,message:"PAGE_FAILED",status:response.status(),offset,blockedWrites};const body=obj(await response.json().catch(()=>null));if(!body)return{ok:false,message:"INVALID_BODY",offset,blockedWrites};if(!header)header=body;const pr=Array.isArray(body.bills)?body.bills.map(obj).filter((x):x is Json=>Boolean(x)):[];rows.push(...pr);if(rows.length>=n(body.billsAmount)||pr.length<500)break;}
  const seen=new Map<string,Json>();for(const r of rows){const id=String(r.billId??"");if(id&&!seen.has(id))seen.set(id,r);}const bills=[...seen.values()];const paid=bills.filter(r=>r.isPaid===true);
  const sum=(arr:Json[],field="billValue")=>arr.reduce((s,r)=>s+c(r[field]),0);
  const subset=(pred:(r:Json)=>boolean)=>{const a=paid.filter(pred);return{count:a.length,billValue:sum(a)/100,paymentValue:sum(a,"paymentValue")/100,ids:a.slice(0,25).map(r=>r.billId)};};
  const byPaymentType:Record<string,{count:number,billValue:number,paymentValue:number}>={};
  for(const r of paid){const k=String(r.paymentType??"null");const g=byPaymentType[k]??{count:0,billValue:0,paymentValue:0};g.count++;g.billValue+=c(r.billValue);g.paymentValue+=c(r.paymentValue);byPaymentType[k]=g;}
  for(const g of Object.values(byPaymentType)){g.billValue/=100;g.paymentValue/=100;}
  const byRecType:Record<string,{count:number,billValue:number}>={};for(const r of paid){const k=String(r.recTypeId??"null");const g=byRecType[k]??{count:0,billValue:0};g.count++;g.billValue+=c(r.billValue);byRecType[k]=g;}for(const g of Object.values(byRecType))g.billValue/=100;
  const target=c(header?.totalPaid);const raw=sum(paid);const gap=raw-target;
  const tests={
   splittedTrue:subset(r=>r.splitted===true),
   fatherBill:subset(r=>has(r.fatherBillId)),
   joinBill:subset(r=>has(r.joinBillId)),
   hasRecurrence:subset(r=>r.hasRecurrence===true),
   receiptDraft:subset(r=>r.receiptDraft===true),
   taxDraft:subset(r=>r.taxDraft===true),
   paymentValueZero:subset(r=>c(r.paymentValue)===0),
   accountNull:subset(r=>!has(r.accountId)),
   billReceipt:subset(r=>has(r.billReceiptNumber)),
   check:subset(r=>has(r.checkId)),
   fatherOrJoin:subset(r=>has(r.fatherBillId)||has(r.joinBillId)),
   splitOrFatherOrJoin:subset(r=>r.splitted===true||has(r.fatherBillId)||has(r.joinBillId)),
   recurrenceOrSplit:subset(r=>r.hasRecurrence===true||r.splitted===true),
  };
  const matching=Object.entries(tests).filter(([,v])=>Math.abs(Math.round(v.billValue*100)-gap)<=1).map(([k])=>k);
  return{ok:true,readOnly:true,blockedWrites,paidCount:paid.length,headerPaid:target/100,rawPaidBillValue:raw/100,gap:gap/100,tests,matching,byPaymentType,byRecType};
 },{sessionTimeoutMs:58_000});
 console.log("KOPER_PAYABLE_HEADER_EXCLUSIONS",JSON.stringify(result));
}catch(error:unknown){console.error("KOPER_PAYABLE_HEADER_EXCLUSIONS_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1000):"unknown"}));}
await import("./index.js");
