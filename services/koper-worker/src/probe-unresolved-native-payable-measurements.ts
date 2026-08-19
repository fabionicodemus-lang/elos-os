import type { Response } from "playwright-core";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type J=Record<string,unknown>;
type Stage={koper_id:string;payload:unknown};
const obj=(v:unknown):J=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as J:{};
const id=(v:unknown):string|null=>(typeof v==="string"||typeof v==="number")&&String(v).trim()?String(v).trim():null;
async function all<T>(table:string,q:Record<string,string>){const out:T[]=[];for(let o=0;;o+=1000){const rows=await requestSupabase<T[]>(table,{query:new URLSearchParams({...q,limit:"1000",offset:String(o)}),timeoutMs:30000});out.push(...rows);if(rows.length<1000)return out}}
function safe(v:unknown,prefix="",depth=0):Array<{path:string,value:unknown}>{
 if(depth>8)return[];if(Array.isArray(v))return v.slice(0,80).flatMap((x,i)=>safe(x,`${prefix}[${i}]`,depth+1));const r=obj(v);const out:Array<{path:string,value:unknown}>=[];
 for(const[k,x]of Object.entries(r)){if(/name|email|phone|address|cpf|cnpj|document|file|token|cookie|password|comment/i.test(k))continue;const p=prefix?`${prefix}.${k}`:k;if(x===null||typeof x==="string"||typeof x==="number"||typeof x==="boolean"){if(/id|code|status|value|amount|contract|measure|service|stage|cost|center|build|monitor|bill|pay|order|receipt|invoice|item|release|quantity|price|percent|reference|date/i.test(k))out.push({path:p,value:x});}else if(x&&(Array.isArray(x)||typeof x==="object"))out.push(...safe(x,p,depth+1));}return out;
}
function matches(v:unknown,needles:Set<string>){return safe(v).filter(e=>needles.has(String(e.value)));}

await import("./index.js");
const resolutions=await all<Stage>("koper_staging_records",{select:"koper_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.bill_resolution",sync_state:"eq.present",order:"koper_id.asc"});
const targets=resolutions.filter(r=>{const p=obj(r.payload);return Number(p.version??0)>=2&&p.route==="measurement"&&p.status==="unresolved";});
const targetSummary=targets.map(r=>{const p=obj(r.payload),ids=obj(p.ids);return{billId:r.koper_id,billValue:p.billValue??null,releaseId:id(ids.releaseId),stageReleaseId:id(ids.stageReleaseId),buildMonitoringId:id(ids.buildMonitoringId)}});
try{
 const result=await withBrowserless(async({page})=>{
  const login=await performKoperLogin(page);if(!login.authenticated)return{ok:false,message:login.message,targetSummary};let blockedWrites=0;
  await page.route("**/*",async route=>{const req=route.request();try{const u=new URL(req.url());const koper=u.hostname==="koper.com.br"||u.hostname.endsWith(".koper.com.br");if(koper&&!["GET","HEAD","OPTIONS"].includes(req.method())&&!isAllowedFlowSwitch(u,req.method(),req.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
  if(!await selectFlow(page))return{ok:false,message:"FLOW_NOT_SELECTED",blockedWrites,targetSummary};
  const seedPromise=page.waitForResponse((response:Response)=>{try{const u=new URL(response.url());return response.request().method()==="GET"&&u.hostname==="api.koper.com.br"&&u.pathname==="/financial/v1/bills_to_pay";}catch{return false;}},{timeout:20000}).catch(()=>null);
  await page.goto("https://app.koper.com.br/financeiro/contas_pagar",{waitUntil:"domcontentloaded",timeout:12000}).catch(()=>undefined);const seed=await seedPromise;if(!seed)return{ok:false,message:"FINANCIAL_SEED_NOT_FOUND",blockedWrites,targetSummary};
  const sh=seed.request().headers();const headers:Record<string,string>={};for(const k of["accept","origin","referer","x-accesstoken","x-koper"])if(sh[k])headers[k]=sh[k]!;
  const details=[];
  for(const t of targetSummary.slice(0,20)){
   const needles=new Set([t.releaseId,t.stageReleaseId,t.buildMonitoringId].filter((x):x is string=>!!x));
   const billUrl=new URL("https://api.koper.com.br/financial/v1/bills_to_pay");billUrl.searchParams.set("billId",t.billId);const billResp=await page.request.get(billUrl.toString(),{headers,timeout:8000}).catch(()=>null);const billBody=billResp?await billResp.json().catch(()=>null):null;
   const probes:Array<{label:string,url:URL}>=[];
   if(t.buildMonitoringId){for(const open of["no","false","all",""]){const u=new URL("https://api.koper.com.br/engineering/v1/build_measurement");u.searchParams.set("buildMonitoringId",t.buildMonitoringId);u.searchParams.set("limit","500");u.searchParams.set("offset","0");if(open)u.searchParams.set("open",open);probes.push({label:`build:${t.buildMonitoringId}:open:${open||"none"}`,url:u});}}
   for(const candidate of[t.releaseId,t.stageReleaseId])if(candidate){const u=new URL("https://api.koper.com.br/engineering/v1/build_measurement");u.searchParams.set("measurementId",candidate);probes.push({label:`measurementId:${candidate}`,url:u});}
   const responses=[];for(const pr of probes){const rr=await page.request.get(pr.url.toString(),{headers,timeout:8000}).catch(()=>null);const body=rr?await rr.json().catch(()=>null):null;const m=matches(body,needles);if(m.length)responses.push({label:pr.label,status:rr?.status()??0,matches:m.slice(0,80),evidence:safe(body).slice(0,350)});}
   details.push({...t,billStatus:billResp?.status()??0,billEvidence:safe(billBody).slice(0,350),responses});
  }
  return{ok:true,readOnly:true,blockedWrites,targetCount:targets.length,targetSummary,details};
 },{sessionTimeoutMs:190_000});
 console.log("KOPER_UNRESOLVED_MEASUREMENT_PROBE",JSON.stringify(result));
}catch(error:unknown){console.error("KOPER_UNRESOLVED_MEASUREMENT_PROBE_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1200):"unknown",targetCount:targets.length,targetSummary}));}
