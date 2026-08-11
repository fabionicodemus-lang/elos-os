import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json=Record<string,unknown>;
const obj=(v:unknown):Json|null=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as Json:null;
function summarize(v:unknown):Json{if(Array.isArray(v))return{type:"array",length:v.length,firstKeys:Object.keys(obj(v[0])??{}).sort()};const r=obj(v);return r?{type:"object",keys:Object.keys(r).sort(),arrays:Object.fromEntries(Object.entries(r).filter(([,x])=>Array.isArray(x)).map(([k,x])=>[k,{length:(x as unknown[]).length,firstKeys:Object.keys(obj((x as unknown[])[0])??{}).sort()}]))}:{type:typeof v};}
function ev(v:unknown,prefix="",depth=0):Array<{path:string,value:unknown}>{if(depth>8)return[];if(Array.isArray(v))return v.slice(0,20).flatMap((x,i)=>ev(x,`${prefix}[${i}]`,depth+1));const r=obj(v);if(!r)return[];const out:Array<{path:string,value:unknown}>=[];for(const[k,x]of Object.entries(r)){if(/name|email|phone|address|cpf|cnpj|document|file|token|cookie|password|comment/i.test(k))continue;const p=prefix?`${prefix}.${k}`:k;if(x===null||typeof x==="string"||typeof x==="number"||typeof x==="boolean"){if(/id|code|status|value|amount|contract|measure|service|stage|cost|center|build|monitor|supplier|bill|pay|order|receipt|invoice|item|release|quantity|price|percent|total|reference/i.test(k))out.push({path:p,value:x});}else if(x&&(Array.isArray(x)||obj(x)))out.push(...ev(x,p,depth+1));}return out;}
try{
 const result=await withBrowserless(async({page})=>{
  const login=await performKoperLogin(page);if(!login.authenticated)return{ok:false,message:login.message};let blockedWrites=0;
  await page.route("**/*",async route=>{const r=route.request();try{const u=new URL(r.url());const koper=u.hostname==="koper.com.br"||u.hostname.endsWith(".koper.com.br");if(koper&&!["GET","HEAD","OPTIONS"].includes(r.method())&&!isAllowedFlowSwitch(u,r.method(),r.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
  if(!await selectFlow(page))return{ok:false,message:"FLOW_NOT_SELECTED",blockedWrites};
  const seedPromise=page.waitForResponse((response:Response)=>{try{const u=new URL(response.url());return response.request().method()==="GET"&&u.hostname==="api.koper.com.br"&&u.pathname==="/engineering/v1/build_measurement";}catch{return false;}},{timeout:20000}).catch(()=>null);
  await page.goto("https://app.koper.com.br/engenharia/medicoes",{waitUntil:"domcontentloaded",timeout:12000}).catch(()=>undefined);const seed=await seedPromise;if(!seed)return{ok:false,message:"SEED_NOT_FOUND",blockedWrites};
  const sh=seed.request().headers();const headers:Record<string,string>={};for(const k of["accept","origin","referer","x-accesstoken","x-koper"])if(sh[k])headers[k]=sh[k];
  const probes:Array<{label:string,path:string,params:Record<string,string>}>=[];
  for(const measurementId of["238","761"]){
    probes.push({label:`detail-${measurementId}`,path:"/engineering/v1/build_measurement",params:{measurementId}});
    probes.push({label:`detail-build-${measurementId}`,path:"/engineering/v1/build_measurement",params:{buildMonitoringId:"67",measurementId}});
    probes.push({label:`detail-stage-${measurementId}`,path:"/engineering/v1/build_measurement",params:{measurementId,page:"stage"}});
    probes.push({label:`detail-items-${measurementId}`,path:"/engineering/v1/build_measurement",params:{measurementId,page:"items"}});
  }
  probes.push({label:"monitor67-all",path:"/engineering/v1/build_measurement",params:{buildMonitoringId:"67",limit:"500",offset:"0"}});
  probes.push({label:"monitor71-all",path:"/engineering/v1/build_measurement",params:{buildMonitoringId:"71",limit:"500",offset:"0"}});
  const responses=[];
  for(const p of probes){const u=new URL(`https://api.koper.com.br${p.path}`);for(const[k,v]of Object.entries(p.params))u.searchParams.set(k,v);u.searchParams.set("cb",String(Date.now()));const r=await page.request.get(u.toString(),{headers,timeout:8000});const body=await r.json().catch(()=>null);responses.push({label:p.label,status:r.status(),shape:summarize(body),evidence:ev(body).slice(0,800)});}
  return{ok:true,readOnly:true,blockedWrites,responses};
 },{sessionTimeoutMs:58_000});console.log("KOPER_MEASUREMENT_STAGE_LINKS",JSON.stringify(result));
}catch(error:unknown){console.error("KOPER_MEASUREMENT_STAGE_LINKS_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1000):"unknown"}));}
await import("./index.js");