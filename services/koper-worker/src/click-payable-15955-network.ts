import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Json : null;
function safe(value: unknown, prefix = "", depth = 0): Array<{path:string;value:unknown}> {
  if (depth > 9) return [];
  if (Array.isArray(value)) return value.slice(0,40).flatMap((x,i)=>safe(x,`${prefix}[${i}]`,depth+1));
  const row=obj(value); if(!row) return [];
  const out:Array<{path:string;value:unknown}>=[];
  for(const [k,v] of Object.entries(row)){
    if(/name|description|comment|address|email|phone|document|cnpj|cpf|token|cookie|file|url|user/i.test(k)) continue;
    const p=prefix?`${prefix}.${k}`:k;
    if(v===null||typeof v==="string"||typeof v==="number"||typeof v==="boolean"){
      if(/id|status|state|type|date|amount|value|price|total|quantity|number|sequence|order|request|budget|purchase|stock|movement|entry|invoice|receipt|contract|measurement|monitor|service|stage|release|cost|center|allocation|apportion|discount|deduction|retention|tax|withheld|percent|reference|paid|open|closed|cancel|father|join|origin/i.test(k)) out.push({path:p,value:v});
    } else if(v&&(Array.isArray(v)||obj(v))) out.push(...safe(v,p,depth+1));
  }
  return out;
}
try{
 const result=await withBrowserless(async({page})=>{
  const login=await performKoperLogin(page); if(!login.authenticated) return {ok:false,message:login.message};
  let blockedWrites=0;
  await page.route("**/*",async route=>{const r=route.request();try{const u=new URL(r.url());const koper=u.hostname==="koper.com.br"||u.hostname.endsWith(".koper.com.br");if(koper&&!["GET","HEAD","OPTIONS"].includes(r.method())&&!isAllowedFlowSwitch(u,r.method(),r.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
  if(!await selectFlow(page)) return {ok:false,message:"FLOW_NOT_SELECTED",blockedWrites};
  const calls:Json[]=[]; const pending:Promise<void>[]=[];
  const onResponse=(response:Response)=>{try{const u=new URL(response.url());if(response.request().method()!=="GET"||u.hostname!=="api.koper.com.br")return;const task=(async()=>{const ct=response.headers()["content-type"]??"";const body=ct.includes("json")?await response.json().catch(()=>null):null;calls.push({path:u.pathname,status:response.status(),query:Object.fromEntries([...u.searchParams.entries()].filter(([k])=>!/token|auth|cb/i.test(k))),evidence:safe(body).slice(0,700)});})();pending.push(task);}catch{}};
  page.on("response",onResponse);
  await page.goto("https://app.koper.com.br/financeiro/contas_pagar",{waitUntil:"domcontentloaded",timeout:15000}).catch(()=>undefined);
  await page.waitForTimeout(5000);
  const body0=(await page.locator("body").innerText().catch(()=>"")).replace(/\s+/g," ");
  let clicked=false; let locatorText="";
  const candidates=[
    page.locator("tr",{hasText:/\b15955\b/}).first(),
    page.locator("tr",{hasText:/\b122\b/}).first(),
    page.getByText(/15955/).first(),
  ];
  for(const loc of candidates){ if(await loc.count()){locatorText=await loc.innerText().catch(()=>""); await loc.click().catch(()=>undefined); clicked=true; break;} }
  await page.waitForTimeout(7000);
  // Try likely direct detail URLs if the list does not expose the internal ID visibly.
  if(!clicked){
    for(const url of ["https://app.koper.com.br/financeiro/contas_pagar/view/15955","https://app.koper.com.br/financeiro/contas_pagar/15955"]){
      await page.goto(url,{waitUntil:"domcontentloaded",timeout:12000}).catch(()=>undefined); await page.waitForTimeout(4000);
      if(page.url().includes("15955")){clicked=true;break;}
    }
  }
  page.off("response",onResponse); await Promise.allSettled(pending);
  return {ok:true,readOnly:true,blockedWrites,clicked,locatorText,initialBody:body0.slice(0,5000),finalUrl:page.url(),finalBody:(await page.locator("body").innerText().catch(()=>"")).replace(/\s+/g," ").slice(0,7000),calls:[...new Map(calls.map(c=>[`${c.path}|${JSON.stringify(c.query)}`,c])).values()]};
 },{sessionTimeoutMs:58_000});
 console.log("KOPER_PAYABLE_15955_NETWORK",JSON.stringify(result));
}catch(error:unknown){console.error("KOPER_PAYABLE_15955_NETWORK_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1200):"unknown"}));}
await import("./index.js");
