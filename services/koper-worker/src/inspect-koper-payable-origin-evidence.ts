import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const obj=(v:unknown):Json|null=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as Json:null;
const has=(v:unknown)=>v!==null&&v!==undefined&&String(v).trim()!=="";

function evidence(value:unknown,prefix="",depth=0):Array<{path:string,value:unknown}>{
  if(depth>6)return[];
  if(Array.isArray(value))return value.slice(0,6).flatMap((item,i)=>evidence(item,`${prefix}[${i}]`,depth+1));
  const row=obj(value); if(!row)return[];
  const out:Array<{path:string,value:unknown}>=[];
  for(const [key,child] of Object.entries(row)){
    if(/name|comment|email|phone|address|cpf|cnpj|document|file|token|cookie|password/i.test(key))continue;
    const path=prefix?`${prefix}.${key}`:key;
    if(child===null||typeof child==="string"||typeof child==="number"||typeof child==="boolean"){
      if(/(^|_)(id|code)$|Id$|ID$|cost|center|build|monitor|stock|order|request|contract|measurement|service|receipt|invoice|bill|chart|account|origin|type|recType|apportion|allocation|purchase|entry|input/i.test(key))out.push({path,value:child});
    }else if(child&&(Array.isArray(child)||obj(child)))out.push(...evidence(child,path,depth+1));
  }
  return out;
}

try{
 const result=await withBrowserless(async({page})=>{
  const login=await performKoperLogin(page); if(!login.authenticated)return{ok:false,message:login.message};
  let blockedWrites=0;
  await page.route("**/*",async route=>{const request=route.request();try{const url=new URL(request.url());const koper=url.hostname==="koper.com.br"||url.hostname.endsWith(".koper.com.br");if(koper&&!["GET","HEAD","OPTIONS"].includes(request.method())&&!isAllowedFlowSwitch(url,request.method(),request.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
  if(!await selectFlow(page))return{ok:false,message:"FLOW_NOT_SELECTED",blockedWrites};
  const seedPromise=page.waitForResponse((response:Response)=>{try{const u=new URL(response.url());return response.request().method()==="GET"&&u.hostname==="api.koper.com.br"&&u.pathname==="/financial/v1/bills_to_pay";}catch{return false;}},{timeout:20000}).catch(()=>null);
  await page.goto("https://app.koper.com.br/financeiro/contas_pagar",{waitUntil:"domcontentloaded",timeout:12000}).catch(()=>undefined);
  const seed=await seedPromise;if(!seed)return{ok:false,message:"SEED_NOT_FOUND",blockedWrites};
  const sh=seed.request().headers();const headers:Record<string,string>={};for(const k of["accept","origin","referer","x-accesstoken","x-koper"])if(sh[k])headers[k]=sh[k];
  const u=new URL(seed.url());for(const[k,v]of Object.entries({allBills:"yes",initialDate:"",finalDate:"",limit:"500",offset:"0",orderFlag:"asc",orderby:"dueDate",typeDate:"dueDate",cb:String(Date.now())}))u.searchParams.set(k,v);
  const listResponse=await page.request.get(u.toString(),{headers,timeout:8000});const body=obj(await listResponse.json().catch(()=>null));if(!body)return{ok:false,message:"LIST_FAILED",status:listResponse.status(),blockedWrites};
  const bills=Array.isArray(body.bills)?body.bills.map(obj).filter((v):v is Json=>Boolean(v)):[];
  const groups:Record<string,Json[]>={invoiceOnly:[],receiptOnly:[],neither:[],recurring:[]};
  for(const b of bills){const inv=has(b.invoiceNumber),rec=has(b.receiptNumber);if(inv&&!rec&&groups.invoiceOnly.length<3)groups.invoiceOnly.push(b);if(rec&&!inv&&groups.receiptOnly.length<4)groups.receiptOnly.push(b);if(!inv&&!rec&&groups.neither.length<5)groups.neither.push(b);if(b.hasRecurrence===true&&groups.recurring.length<3)groups.recurring.push(b);}
  const chosen=[...new Map(Object.entries(groups).flatMap(([group,rows])=>rows.map(r=>[String(r.billId),{group,row:r}] as const))).values()];
  const details=[];
  for(const item of chosen.slice(0,12)){
    const billId=String(item.row.billId);
    const durl=new URL("https://api.koper.com.br/financial/v1/bills_to_pay");durl.searchParams.set("billId",billId);
    const response=await page.request.get(durl.toString(),{headers,timeout:8000});const detail=await response.json().catch(()=>null);
    details.push({group:item.group,billId,status:response.status(),list:{invoiceNumber:item.row.invoiceNumber??null,receiptNumber:item.row.receiptNumber??null,recTypeId:item.row.recTypeId??null,hasRecurrence:item.row.hasRecurrence??null,billValue:item.row.billValue??null},detailKeys:Object.keys(obj(detail)??{}).sort(),evidence:evidence(detail).slice(0,260)});
  }
  return{ok:true,readOnly:true,blockedWrites,totals:{billsAmount:body.billsAmount??null,totalBills:body.totalBills??null,totalPaid:body.totalPaid??null,totalNotPaid:body.totalNotPaid??null,totalConsolidated:body.totalConsolidated??null,totalNotConsolidated:body.totalNotConsolidated??null,totalDiscount:body.totalDiscount??null,totalInterest:body.totalInterest??null},sampleGroups:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.map(r=>({billId:r.billId??null,billValue:r.billValue??null,invoiceNumber:r.invoiceNumber??null,receiptNumber:r.receiptNumber??null,recTypeId:r.recTypeId??null,hasRecurrence:r.hasRecurrence??null}))])),details};
 },{sessionTimeoutMs:58_000});
 console.log("KOPER_PAYABLE_ORIGIN_EVIDENCE",JSON.stringify(result));
}catch(error:unknown){console.error("KOPER_PAYABLE_ORIGIN_EVIDENCE_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1000):"unknown"}));}
await import("./index.js");
