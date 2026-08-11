import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json=Record<string,unknown>;
const obj=(v:unknown):Json|null=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as Json:null;
function shape(v:unknown):Json{if(Array.isArray(v))return{type:"array",length:v.length,firstKeys:Object.keys(obj(v[0])??{}).sort()};const r=obj(v);return r?{type:"object",keys:Object.keys(r).sort(),arrays:Object.fromEntries(Object.entries(r).filter(([,x])=>Array.isArray(x)).map(([k,x])=>[k,{length:(x as unknown[]).length,firstKeys:Object.keys(obj((x as unknown[])[0])??{}).sort()}]))}:{type:typeof v};}
function ev(v:unknown,prefix="",depth=0):Array<{path:string,value:unknown}>{if(depth>7)return[];if(Array.isArray(v))return v.slice(0,12).flatMap((x,i)=>ev(x,`${prefix}[${i}]`,depth+1));const r=obj(v);if(!r)return[];const out:Array<{path:string,value:unknown}>=[];for(const[k,x]of Object.entries(r)){if(/name|email|phone|address|cpf|cnpj|document|file|token|cookie|password|comment/i.test(k))continue;const p=prefix?`${prefix}.${k}`:k;if(x===null||typeof x==="string"||typeof x==="number"||typeof x==="boolean"){if(/id|code|status|value|amount|contract|measure|service|stage|cost|center|build|monitor|supplier|bill|pay|order|receipt|invoice|item|release|quantity|price|percent/i.test(k))out.push({path:p,value:x});}else if(x&&(Array.isArray(x)||obj(x)))out.push(...ev(x,p,depth+1));}return out;}
try{
 const result=await withBrowserless(async({page})=>{
  const login=await performKoperLogin(page);if(!login.authenticated)return{ok:false,message:login.message};let blockedWrites=0;
  await page.route("**/*",async route=>{const r=route.request();try{const u=new URL(r.url());const koper=u.hostname==="koper.com.br"||u.hostname.endsWith(".koper.com.br");if(koper&&!["GET","HEAD","OPTIONS"].includes(r.method())&&!isAllowedFlowSwitch(u,r.method(),r.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
  if(!await selectFlow(page))return{ok:false,message:"FLOW_NOT_SELECTED",blockedWrites};
  const calls:Json[]=[];const pending:Promise<void>[]=[];
  const onResponse=(response:Response)=>{try{const u=new URL(response.url());if(response.request().method()!=="GET"||u.hostname!=="api.koper.com.br")return;const task=(async()=>{const ct=response.headers()["content-type"]??"";const body=ct.includes("json")?await response.json().catch(()=>null):null;calls.push({route:page.url().replace(/^https?:\/\/[^/]+/,""),path:u.pathname,status:response.status(),query:Object.fromEntries([...u.searchParams.entries()].filter(([k])=>!/token|auth|cb/i.test(k))),response:shape(body),evidence:ev(body).slice(0,450)});})();pending.push(task);}catch{}};
  page.on("response",onResponse);
  const routes=["https://app.koper.com.br/engenharia/medicoes/761","https://app.koper.com.br/engenharia/medicoes/238","https://app.koper.com.br/engenharia/contratos/826","https://app.koper.com.br/engenharia/contratos/793"];
  const pages=[];
  for(const route of routes){await page.goto(route,{waitUntil:"domcontentloaded",timeout:15000}).catch(()=>undefined);await page.waitForTimeout(6000);pages.push({requested:route,finalUrl:page.url(),body:(await page.locator("body").innerText().catch(()=>"")).replace(/\s+/g," ").slice(0,2200)});}
  page.off("response",onResponse);await Promise.allSettled(pending);
  return{ok:true,readOnly:true,blockedWrites,pages,calls:[...new Map(calls.map(c=>[`${c.route}|${c.path}|${JSON.stringify(c.query)}`,c])).values()]};
 },{sessionTimeoutMs:58_000});console.log("KOPER_CONTRACT_MEASUREMENT_DETAIL_NETWORK",JSON.stringify(result));
}catch(error:unknown){console.error("KOPER_CONTRACT_MEASUREMENT_DETAIL_NETWORK_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1000):"unknown"}));}
await import("./index.js");
