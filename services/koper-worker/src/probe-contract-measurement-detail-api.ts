import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const obj=(v:unknown):Json|null=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as Json:null;
function evidence(v:unknown,prefix="",depth=0):Array<{path:string,value:unknown}>{
 if(depth>8)return[];
 if(Array.isArray(v))return v.slice(0,15).flatMap((x,i)=>evidence(x,`${prefix}[${i}]`,depth+1));
 const r=obj(v); if(!r)return[]; const out:Array<{path:string,value:unknown}>=[];
 for(const[k,x]of Object.entries(r)){
  if(/email|phone|address|cpf|cnpj|document|file|token|cookie|password|name|comment/i.test(k))continue;
  const p=prefix?`${prefix}.${k}`:k;
  if(x===null||typeof x==="string"||typeof x==="number"||typeof x==="boolean"){
   if(/id|code|status|value|amount|contract|measure|service|stage|cost|center|build|monitor|supplier|bill|pay|order|receipt|invoice|item|release|quantity|price|percent|total/i.test(k))out.push({path:p,value:x});
  } else if(x&&(Array.isArray(x)||obj(x))) out.push(...evidence(x,p,depth+1));
 }
 return out;
}
try{
 const result=await withBrowserless(async({page})=>{
  const login=await performKoperLogin(page); if(!login.authenticated)return{ok:false,message:login.message};
  let blockedWrites=0;
  await page.route("**/*",async route=>{const r=route.request();try{const u=new URL(r.url());const koper=u.hostname==="koper.com.br"||u.hostname.endsWith(".koper.com.br");if(koper&&!["GET","HEAD","OPTIONS"].includes(r.method())&&!isAllowedFlowSwitch(u,r.method(),r.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
  if(!await selectFlow(page))return{ok:false,message:"FLOW_NOT_SELECTED",blockedWrites};
  const seedPromise=page.waitForResponse((response:Response)=>{try{const u=new URL(response.url());return response.request().method()==="GET"&&u.hostname==="api.koper.com.br"&&u.pathname==="/engineering/v1/contract";}catch{return false;}},{timeout:20000}).catch(()=>null);
  await page.goto("https://app.koper.com.br/engenharia/contratos",{waitUntil:"domcontentloaded",timeout:12000}).catch(()=>undefined);
  const seed=await seedPromise; if(!seed)return{ok:false,message:"CONTRACT_SEED_NOT_FOUND",blockedWrites};
  const sh=seed.request().headers(); const headers:Record<string,string>={}; for(const k of["accept","origin","referer","x-accesstoken","x-koper"])if(sh[k])headers[k]=sh[k];
  const probes:Array<{label:string,path:string,params:Record<string,string>}>= [
   {label:"contract-contractId-826",path:"/engineering/v1/contract",params:{contractId:"826"}},
   {label:"contract-id-826",path:"/engineering/v1/contract",params:{id:"826"}},
   {label:"contract-build-826",path:"/engineering/v1/contract",params:{buildMonitoringId:"67",contractId:"826"}},
   {label:"measurement-measurementId-761",path:"/engineering/v1/build_measurement",params:{measurementId:"761"}},
   {label:"measurement-buildMeasurementId-761",path:"/engineering/v1/build_measurement",params:{buildMeasurementId:"761"}},
   {label:"measurement-build-761",path:"/engineering/v1/build_measurement",params:{buildMonitoringId:"67",measurementId:"761"}},
   {label:"measurement-stage",path:"/engineering/v1/build_measurement_stage",params:{measurementId:"761"}},
   {label:"contract-measurements",path:"/engineering/v1/contract_measurement",params:{contractId:"826"}},
   {label:"contract-items",path:"/engineering/v1/contract_service",params:{contractId:"826"}},
  ];
  const responses=[];
  for(const p of probes){const u=new URL(`https://api.koper.com.br${p.path}`);for(const[k,v]of Object.entries(p.params))u.searchParams.set(k,v);u.searchParams.set("cb",String(Date.now()));const r=await page.request.get(u.toString(),{headers,timeout:8000});const body=await r.json().catch(()=>null);responses.push({label:p.label,status:r.status(),keys:Object.keys(obj(body)??{}).sort(),isArray:Array.isArray(body),arrayLength:Array.isArray(body)?body.length:null,evidence:evidence(body).slice(0,600)});}
  return{ok:true,readOnly:true,blockedWrites,responses};
 },{sessionTimeoutMs:58_000});
 console.log("KOPER_CONTRACT_MEASUREMENT_DETAIL_API_PROBE",JSON.stringify(result));
}catch(error:unknown){console.error("KOPER_CONTRACT_MEASUREMENT_DETAIL_API_PROBE_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1000):"unknown"}));}
await import("./index.js");
