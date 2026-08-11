import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json=Record<string,unknown>;
const obj=(v:unknown):Json|null=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as Json:null;
function safe(value:unknown,prefix="",depth=0):Array<{path:string,value:unknown}>{
 if(depth>7)return[]; if(Array.isArray(value))return value.slice(0,10).flatMap((x,i)=>safe(x,`${prefix}[${i}]`,depth+1));
 const row=obj(value);if(!row)return[];const out:Array<{path:string,value:unknown}>=[];
 for(const[k,v]of Object.entries(row)){if(/email|phone|address|cpf|cnpj|document|file|token|cookie|password|supplierName|supplier_name|user_name|comments?/i.test(k))continue;const p=prefix?`${prefix}.${k}`:k;
  if(v===null||typeof v==="string"||typeof v==="number"||typeof v==="boolean"){if(/id|code|cost|center|build|monitor|stock|order|request|contract|measurement|service|receipt|invoice|bill|chart|account|origin|type|apportion|allocation|purchase|entry|input|stage|item|amount|value|status/i.test(k))out.push({path:p,value:v});}
  else if(v&&(Array.isArray(v)||obj(v)))out.push(...safe(v,p,depth+1));}
 return out;
}
try{
 const result=await withBrowserless(async({page})=>{
  const login=await performKoperLogin(page);if(!login.authenticated)return{ok:false,message:login.message};let blockedWrites=0;
  await page.route("**/*",async route=>{const r=route.request();try{const u=new URL(r.url());const koper=u.hostname==="koper.com.br"||u.hostname.endsWith(".koper.com.br");if(koper&&!["GET","HEAD","OPTIONS"].includes(r.method())&&!isAllowedFlowSwitch(u,r.method(),r.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
  if(!await selectFlow(page))return{ok:false,message:"FLOW_NOT_SELECTED",blockedWrites};
  const seedPromise=page.waitForResponse((response:Response)=>{try{const u=new URL(response.url());return response.request().method()==="GET"&&u.hostname==="api.koper.com.br"&&u.pathname==="/financial/v1/bills_to_pay";}catch{return false;}},{timeout:20000}).catch(()=>null);
  await page.goto("https://app.koper.com.br/financeiro/contas_pagar",{waitUntil:"domcontentloaded",timeout:12000}).catch(()=>undefined);const seed=await seedPromise;if(!seed)return{ok:false,message:"SEED_NOT_FOUND",blockedWrites};
  const sh=seed.request().headers();const headers:Record<string,string>={};for(const k of["accept","origin","referer","x-accesstoken","x-koper"])if(sh[k])headers[k]=sh[k];
  const calls:Array<{kind:string,id:string,status:number,keys:string[],evidence:Array<{path:string,value:unknown}>}>=[];
  for(const receiptId of["1044","100","458"]){const u=new URL("https://api.koper.com.br/financial/v1/receipt");u.searchParams.set("receiptId",receiptId);u.searchParams.set("cb",String(Date.now()));const r=await page.request.get(u.toString(),{headers,timeout:8000});const body=await r.json().catch(()=>null);calls.push({kind:"receipt",id:receiptId,status:r.status(),keys:Object.keys(obj(body)??{}).sort(),evidence:safe(body).slice(0,400)});}
  for(const orderId of["11516","11517"]){const u=new URL("https://api.koper.com.br/purchase/v1/service_order");u.searchParams.set("orderId",orderId);u.searchParams.set("cb",String(Date.now()));const r=await page.request.get(u.toString(),{headers,timeout:8000});const body=await r.json().catch(()=>null);calls.push({kind:"service_order",id:orderId,status:r.status(),keys:Object.keys(obj(body)??{}).sort(),evidence:safe(body).slice(0,500)});}
  return{ok:true,readOnly:true,blockedWrites,calls};
 },{sessionTimeoutMs:58_000});console.log("KOPER_RECEIPT_SERVICE_ORDER_LINKS",JSON.stringify(result));
}catch(error:unknown){console.error("KOPER_RECEIPT_SERVICE_ORDER_LINKS_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1000):"unknown"}));}
await import("./index.js");
