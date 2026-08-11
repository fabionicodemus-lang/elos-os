import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json=Record<string,unknown>;
const obj=(v:unknown):Json|null=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as Json:null;
function evidence(v:unknown,p="",d=0):Array<{path:string,value:unknown}>{if(d>9)return[];if(Array.isArray(v))return v.slice(0,40).flatMap((x,i)=>evidence(x,`${p}[${i}]`,d+1));const r=obj(v);if(!r)return[];const out:Array<{path:string,value:unknown}>=[];for(const[k,x]of Object.entries(r)){if(/name|description|comment|address|email|phone|document|cnpj|cpf|token|cookie|file|url|user/i.test(k))continue;const q=p?`${p}.${k}`:k;if(x===null||typeof x==="string"||typeof x==="number"||typeof x==="boolean"){if(/id|status|type|date|amount|value|price|total|number|order|purchase|invoice|receipt|contract|measurement|monitor|service|stage|release|cost|center|allocation|discount|deduction|retention|tax|reference|father|join|origin/i.test(k))out.push({path:q,value:x});}else if(x&&(Array.isArray(x)||obj(x)))out.push(...evidence(x,q,d+1));}return out;}
try{
 const result=await withBrowserless(async({page})=>{
  const login=await performKoperLogin(page);if(!login.authenticated)return{ok:false,message:login.message};let blockedWrites=0;
  await page.route("**/*",async route=>{const r=route.request();try{const u=new URL(r.url());const koper=u.hostname==="koper.com.br"||u.hostname.endsWith(".koper.com.br");if(koper&&!["GET","HEAD","OPTIONS"].includes(r.method())&&!isAllowedFlowSwitch(u,r.method(),r.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
  if(!await selectFlow(page))return{ok:false,message:"FLOW_NOT_SELECTED",blockedWrites};
  const calls:Json[]=[];const pending:Promise<void>[]=[];const onResponse=(response:Response)=>{try{const u=new URL(response.url());if(response.request().method()!=="GET"||u.hostname!=="api.koper.com.br")return;const task=(async()=>{const ct=response.headers()["content-type"]??"";const body=ct.includes("json")?await response.json().catch(()=>null):null;calls.push({path:u.pathname,status:response.status(),query:Object.fromEntries([...u.searchParams.entries()].filter(([k])=>!/token|auth|cb/i.test(k))),evidence:evidence(body).slice(0,800)});})();pending.push(task);}catch{}};page.on("response",onResponse);
  await page.goto("https://web.koper.com.br/financeiro/contas-a-pagar/15955",{waitUntil:"domcontentloaded",timeout:15000}).catch(()=>undefined);await page.waitForTimeout(6000);
  const before=(await page.locator("body").innerText().catch(()=>"")).replace(/\s+/g," ").slice(0,9000);
  const links=await page.locator("a").evaluateAll((els:any[])=>els.slice(0,150).map((a:any)=>({text:(a.innerText||"").trim().replace(/\s+/g," ").slice(0,200),href:a.href}))).catch(()=>[]);
  let clickedText="";
  for(const pattern of [/nota manual/i,/origem/i,/recibo/i,/122/]){const loc=page.getByText(pattern).first();if(await loc.count()){const text=(await loc.innerText().catch(()=>"")).trim();const tag=await loc.evaluate((el:any)=>el.tagName).catch(()=>"");if(["A","BUTTON"].includes(tag)||await loc.getAttribute("role")==="button"){clickedText=text;await loc.click().catch(()=>undefined);await page.waitForTimeout(5000);break;}}}
  page.off("response",onResponse);await Promise.allSettled(pending);
  return{ok:true,readOnly:true,blockedWrites,finalUrl:page.url(),clickedText,before,after:(await page.locator("body").innerText().catch(()=>"")).replace(/\s+/g," ").slice(0,9000),links,calls:[...new Map(calls.map(c=>[`${c.path}|${JSON.stringify(c.query)}`,c])).values()]};
 },{sessionTimeoutMs:58_000});console.log("KOPER_PAYABLE_15955_PARENT_NETWORK",JSON.stringify(result));
}catch(error:unknown){console.error("KOPER_PAYABLE_15955_PARENT_NETWORK_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1200):"unknown"}));}
await import("./index.js");
