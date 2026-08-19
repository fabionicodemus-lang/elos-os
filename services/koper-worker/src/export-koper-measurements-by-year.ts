import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
type Row=Record<string,unknown>;

function isList(resp:Response){try{const r=resp.request(),u=new URL(resp.url());return r.method()==="GET"&&u.hostname==="api.koper.com.br"&&u.pathname==="/engineering/v1/build_measurement"&&u.searchParams.get("open")==="no";}catch{return false;}}

try{
 console.log("KOPER_MEASUREMENTS_BY_YEAR_START");
 const result=await withBrowserless(async({page})=>{
  const login=await performKoperLogin(page);if(!login.authenticated)return{ok:false,message:login.message};
  let blockedWrites=0;
  await page.route("**/*",async route=>{const req=route.request();try{const u=new URL(req.url());const isK=u.hostname==="koper.com.br"||u.hostname.endsWith(".koper.com.br");if(isK&&!["GET","HEAD","OPTIONS"].includes(req.method())&&!isAllowedFlowSwitch(u,req.method(),req.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
  if(!await selectFlow(page))return{ok:false,message:"FLOW_NOT_SELECTED",blockedWrites};
  await page.goto("https://app.koper.com.br/engenharia/medicoes/finalizadas",{waitUntil:"domcontentloaded",timeout:20000});await sleep(4000);
  const dropdowns=page.locator("div.input-default.dropdown-toggle");let dateDrop=-1;for(let i=0;i<await dropdowns.count();i++){const b=await dropdowns.nth(i).boundingBox();if(b&&b.x>=480&&b.x<=680&&b.y>=130&&b.y<=190)dateDrop=i;}
  if(dateDrop<0)return{ok:false,message:"DATE_DROPDOWN_NOT_FOUND",blockedWrites};
  await dropdowns.nth(dateDrop).click();await sleep(400);
  const clicked=await page.evaluate(()=>{const els=Array.from(document.querySelectorAll<HTMLAnchorElement>("ul.dropdown-menu a"));const el=els.find(a=>/Período específico/.test((a.textContent||"").trim())&&a.getBoundingClientRect().width>0&&a.getBoundingClientRect().height>0);if(!el)return false;el.click();return true;});
  if(!clicked)return{ok:false,message:"SPECIFIC_NOT_OPENED",blockedWrites};
  await sleep(500);

  const years=[2024,2025,2026];
  const allByYear:Record<string,Row[]>={};
  const metas:Array<Record<string,unknown>>=[];
  for(const year of years){
    const from=page.locator("input[id^='dateFilterFrom_']:visible").first();
    const to=page.locator("input[id^='dateFilterTo_']:visible").first();
    await from.fill(`${year}-01-01`);await to.fill(`${year}-12-31`);
    const seedPromise=page.waitForResponse(isList,{timeout:15000}).catch(()=>null);
    const applied=await page.evaluate(()=>{const els=Array.from(document.querySelectorAll<HTMLElement>("a,button,span"));const el=els.find(e=>(e.innerText||e.textContent||"").replace(/\s+/g," ").trim()==="Aplicar"&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0);if(!el)return false;el.click();return true;});
    if(!applied){metas.push({year,error:"VISIBLE_APPLY_NOT_FOUND"});continue;}
    const seed=await seedPromise;
    if(!seed){metas.push({year,error:"FILTER_RESPONSE_NOT_FOUND"});continue;}
    const sr=seed.request();const sh=sr.headers();const headers:Record<string,string>={};for(const k of ["accept","origin","referer","x-accesstoken","x-koper"])if(sh[k])headers[k]=sh[k];
    const seedBody=await seed.json().catch(()=>null) as any;
    const seedUrl=new URL(seed.url());
    const safeParams:Record<string,string>={};seedUrl.searchParams.forEach((v,k)=>{if(!["accessToken","cb"].includes(k))safeParams[k]=v;});
    const expected=Number(seedBody?.itemsAmount??0);
    const rows:Row[]=[];
    const batch=100;
    const base=new URL(seed.url());base.searchParams.delete("accessToken");base.searchParams.delete("cb");base.searchParams.delete("appVersion");base.searchParams.delete("visited-page");base.searchParams.set("orderFlag","asc");base.searchParams.set("orderby","measurementDate");
    for(let offset=0;;offset+=batch){const u=new URL(base);u.searchParams.set("limit",String(batch));u.searchParams.set("offset",String(offset));u.searchParams.set("cb",String(Date.now()));const r=await page.request.get(u.toString(),{headers,timeout:20000});if(!r.ok())throw new Error(`YEAR_${year}_HTTP_${r.status()}`);const b=await r.json() as any;const chunk=Array.isArray(b?.measurements)?b.measurements:[];rows.push(...chunk);if(chunk.length<batch||(expected&&rows.length>=expected))break;if(offset>5000)throw new Error(`YEAR_${year}_GUARD`);}
    const uniq=new Map<string,Row>();for(const row of rows){const id=String(row.measurementId??"");if(id)uniq.set(id,row);}allByYear[String(year)]=Array.from(uniq.values());
    metas.push({year,seedParams:safeParams,expected,fetched:rows.length,unique:uniq.size,minDate:rows[0]?.measurementDate??null,maxDate:rows.at(-1)?.measurementDate??null});
    console.log("KOPER_MEASUREMENTS_YEAR_META",JSON.stringify(metas.at(-1)));
  }
  const all=new Map<string,Row>();for(const rows of Object.values(allByYear))for(const row of rows){const id=String(row.measurementId??"");if(id)all.set(id,row);}
  return{ok:true,readOnly:true,blockedWrites,metas,rows:Array.from(all.values()).sort((a,b)=>String(a.measurementDate??"").localeCompare(String(b.measurementDate??"")))};
 },{sessionTimeoutMs:150000});
 const rows=Array.isArray((result as any).rows)?(result as any).rows as Row[]:[];console.log("KOPER_MEASUREMENTS_BY_YEAR_META",JSON.stringify({...result,rows:undefined,totalUnique:rows.length}));for(let i=0;i<rows.length;i+=50)console.log("KOPER_MEASUREMENTS_BY_YEAR_CHUNK",JSON.stringify({index:i/50,rows:rows.slice(i,i+50)}));console.log("KOPER_MEASUREMENTS_BY_YEAR_COMPLETE",JSON.stringify({ok:(result as any).ok??false,totalUnique:rows.length}));
}catch(error:unknown){console.error("KOPER_MEASUREMENTS_BY_YEAR_FAILED",JSON.stringify({message:error instanceof Error?error.message.slice(0,1500):String(error).slice(0,1500)}));}
await import("./index.js");
