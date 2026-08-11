import type { Response } from "playwright-core";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type StageRow={koper_id:string;payload:Record<string,unknown>|null};
type Json=Record<string,unknown>;
const obj=(v:unknown):Json|null=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as Json:null;
const TARGET=2624;
function scalarMatches(v:unknown,prefix="",depth=0):Array<{path:string,value:unknown}>{
 if(depth>9)return[];
 if(Array.isArray(v))return v.flatMap((x,i)=>scalarMatches(x,`${prefix}[${i}]`,depth+1));
 const r=obj(v);if(!r)return[];const out:Array<{path:string,value:unknown}>=[];
 for(const[k,x]of Object.entries(r)){
  const p=prefix?`${prefix}.${k}`:k;
  if(x===TARGET||x===String(TARGET))out.push({path:p,value:x});
  else if(x&&(Array.isArray(x)||obj(x)))out.push(...scalarMatches(x,p,depth+1));
 }
 return out;
}

const staged:StageRow[]=[];
for(let offset=0;;offset+=1000){
 const page=await requestSupabase<StageRow[]>("koper_staging_records",{query:new URLSearchParams({select:"koper_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:"eq.bill_to_pay",limit:"1000",offset:String(offset)})});
 staged.push(...page);if(page.length<1000)break;
}
const sorted=staged.sort((a,b)=>Number(b.koper_id)-Number(a.koper_id));

try{
 const result=await withBrowserless(async({page})=>{
  const login=await performKoperLogin(page);if(!login.authenticated)return{ok:false,message:login.message};let blockedWrites=0;
  await page.route("**/*",async route=>{const r=route.request();try{const u=new URL(r.url());const koper=u.hostname==="koper.com.br"||u.hostname.endsWith(".koper.com.br");if(koper&&!["GET","HEAD","OPTIONS"].includes(r.method())&&!isAllowedFlowSwitch(u,r.method(),r.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
  if(!await selectFlow(page))return{ok:false,message:"FLOW_NOT_SELECTED",blockedWrites};
  const seedPromise=page.waitForResponse((response:Response)=>{try{const u=new URL(response.url());return response.request().method()==="GET"&&u.hostname==="api.koper.com.br"&&u.pathname==="/financial/v1/bills_to_pay";}catch{return false;}},{timeout:20000}).catch(()=>null);
  await page.goto("https://app.koper.com.br/financeiro/contas_pagar",{waitUntil:"domcontentloaded",timeout:12000}).catch(()=>undefined);
  const seed=await seedPromise;if(!seed)return{ok:false,message:"SEED_NOT_FOUND",blockedWrites};
  const sh=seed.request().headers();const headers:Record<string,string>={};for(const k of["accept","origin","referer","x-accesstoken","x-koper"])if(sh[k])headers[k]=sh[k]!;
  const hits:Array<Record<string,unknown>>=[];let inspected=0;let errors=0;
  for(let base=0;base<sorted.length;base+=40){
   const batch=sorted.slice(base,base+40);
   const results=await Promise.all(batch.map(async row=>{
    const u=new URL("https://api.koper.com.br/financial/v1/bills_to_pay");u.searchParams.set("billId",row.koper_id);
    try{const r=await page.request.get(u.toString(),{headers,timeout:7000});const body=await r.json().catch(()=>null);return{row,status:r.status(),body};}
    catch{return{row,status:0,body:null};}
   }));
   for(const item of results){inspected++;if(item.status!==200){errors++;continue;}const matches=scalarMatches(item.body);if(matches.length){const body=obj(item.body);hits.push({billId:item.row.koper_id,matches,billValue:body?.billValue??item.row.payload?.billValue??null,billOrigin:body?.bill_origin??null,origins:body?.origins??null,dueDate:body?.dueDate??item.row.payload?.dueDate??null,isPaid:body?.isPaid??item.row.payload?.isPaid??null});}}
   if(hits.length)break;
  }
  return{ok:true,readOnly:true,blockedWrites,staged:sorted.length,inspected,errors,targetMeasurementId:TARGET,hits};
 },{sessionTimeoutMs:58_000});
 console.log("KOPER_MEASUREMENT_2624_PAYABLE_LINK",JSON.stringify(result));
}catch(error:unknown){console.error("KOPER_MEASUREMENT_2624_PAYABLE_LINK_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1000):"unknown"}));}
await import("./index.js");
