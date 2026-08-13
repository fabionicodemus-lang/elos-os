import type { APIRequestContext, Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { saveKoperStagingBatch } from "./elos/koper-staging-repository.js";
import { createKoperStagingRecord } from "./sync/staging-record.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
type ExistingPayable = { source_id: string | null };
type Capture = { bills: Json[]; headers: Record<string,string>; request: APIRequestContext; blockedWrites: number };

const obj=(v:unknown):Json|null=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as Json:null;
const txt=(v:unknown):string|null=>v===null||v===undefined?null:(String(v).trim()||null);
const num=(v:unknown):number|null=>v===null||v===undefined||v===""?null:(Number.isFinite(Number(v))?Number(v):null);
async function all<T>(table:string,query:Record<string,string>):Promise<T[]>{const out:T[]=[];for(let offset=0;;offset+=1000){const page=await requestSupabase<T[]>(table,{query:new URLSearchParams({...query,limit:"1000",offset:String(offset)})});out.push(...page);if(page.length<1000)return out;}}

async function capture():Promise<Capture>{
  return withBrowserless(async({page})=>{
    const login=await performKoperLogin(page);if(!login.authenticated)throw new Error(login.message??"KOPER_AUTH_FAILED");
    let blockedWrites=0;
    await page.route("**/*",async route=>{const r=route.request();try{const u=new URL(r.url());const koper=u.hostname==="koper.com.br"||u.hostname.endsWith(".koper.com.br");if(koper&&!["GET","HEAD","OPTIONS"].includes(r.method())&&!isAllowedFlowSwitch(u,r.method(),r.postData())){blockedWrites++;await route.abort("blockedbyclient");return;}}catch{}await route.continue();});
    if(!await selectFlow(page))throw new Error("FLOW_NOT_SELECTED");
    const seedPromise=page.waitForResponse((r:Response)=>{try{const u=new URL(r.url());return r.request().method()==="GET"&&u.hostname==="api.koper.com.br"&&u.pathname==="/financial/v1/bills_to_pay"&&!u.searchParams.has("billId");}catch{return false;}},{timeout:20000}).catch(()=>null);
    await page.goto("https://app.koper.com.br/financeiro/contas_pagar",{waitUntil:"domcontentloaded",timeout:12000}).catch(()=>undefined);
    const seed=await seedPromise;if(!seed)throw new Error("PAYABLE_SEED_NOT_FOUND");
    const sh=seed.request().headers();const headers:Record<string,string>={};for(const k of["accept","origin","referer","x-accesstoken","x-koper"])if(sh[k])headers[k]=sh[k];
    const base=new URL(seed.url());const bills:Json[]=[];let expected=0;
    for(let offset=0;offset<10000;offset+=500){const u=new URL(base);for(const[k,v]of Object.entries({allBills:"yes",initialDate:"",finalDate:"",limit:"500",offset:String(offset),orderFlag:"asc",orderby:"dueDate",typeDate:"dueDate",cb:String(Date.now())}))u.searchParams.set(k,v);const response=await page.request.get(u.toString(),{headers,timeout:8000});if(!response.ok())throw new Error(`PAGE_${response.status()}_${offset}`);const body=obj(await response.json().catch(()=>null));if(!body)throw new Error(`BODY_${offset}`);if(offset===0)expected=num(body.billsAmount)??0;const rows=Array.isArray(body.bills)?body.bills.map(obj).filter((x):x is Json=>Boolean(x)):[];bills.push(...rows);if(!rows.length||bills.length>=expected||rows.length<500)break;}
    const unique=new Map<string,Json>();for(const row of bills){const id=txt(row.billId);if(!id)throw new Error("BILL_WITHOUT_ID");if(unique.has(id))throw new Error(`DUPLICATE_BILL_${id}`);unique.set(id,row);}if(unique.size!==expected)throw new Error(`COUNT_${unique.size}_${expected}`);
    return{bills:[...unique.values()],headers,request:page.request,blockedWrites};
  },{sessionTimeoutMs:58_000});
}

async function fetchDetails(request:APIRequestContext,headers:Record<string,string>,rows:Json[]):Promise<Array<{billId:string,parentId:string|null,payload:Json}>>{
  const out:Array<{billId:string,parentId:string|null,payload:Json}>=[];const errors:string[]=[];let cursor=0;
  const concurrency=Math.min(40,Math.max(1,Number.parseInt(process.env.KOPER_PAYABLE_DETAIL_CONCURRENCY??"20",10)||20));
  const worker=async()=>{while(true){const index=cursor++;if(index>=rows.length)return;const row=rows[index]!;const billId=txt(row.billId)!;try{const u=new URL("https://api.koper.com.br/financial/v1/bills_to_pay");u.searchParams.set("billId",billId);u.searchParams.set("cb",`${Date.now()}-${index}`);const response=await request.get(u.toString(),{headers,timeout:10000});if(!response.ok())throw new Error(`HTTP_${response.status()}`);const body=obj(await response.json().catch(()=>null));if(!body)throw new Error("INVALID_BODY");const cc=obj(body.cost_center);out.push({billId,parentId:txt(row.billToPayId),payload:{billId,billToPayId:txt(row.billToPayId),supplierId:txt(body.supplier_id),costCenter:cc?{id:txt(cc.id),name:txt(cc.name)}:null,chartAccountId:txt(body.chart_account_id),chartAccountName:txt(body.chart_account_name),itemChartAccountId:txt(body.item_chart_account_id),itemChartAccountName:txt(body.item_chart_account_name),originId:txt(body.origin_id),originName:txt(body.origin_name),recTypeId:txt(body.rec_type_id),recTypeName:txt(body.rec_type_name)}});}catch(e){errors.push(`${billId}:${e instanceof Error?e.message:String(e)}`);}}};
  await Promise.all(Array.from({length:concurrency},()=>worker()));if(errors.length)throw new Error(`DETAIL_ERRORS_${errors.length}_${errors.slice(0,8).join("|")}`);return out;
}

if(process.env.KOPER_PAYABLE_DETAIL_STAGING_WRITE_ENABLED!=="true")throw new Error("Koper payable detail staging write is not explicitly enabled");

const existing=await all<ExistingPayable>("payables",{select:"source_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source_system:"eq.koper_flow",order:"source_id.asc"});
const direct=new Set(existing.flatMap(row=>{const match=row.source_id?.match(/^koper_bill:(\d+)$/);return match?[match[1]!]:[];}));
const source=await capture();
const missing=source.bills.filter(row=>{const id=txt(row.billId);return Boolean(id&&!direct.has(id));});
const offset=Math.max(0,Number.parseInt(process.env.KOPER_PAYABLE_DETAIL_OFFSET??"0",10)||0);
const size=Math.min(750,Math.max(1,Number.parseInt(process.env.KOPER_PAYABLE_DETAIL_SIZE??"400",10)||400));
const selected=missing.slice(offset,offset+size);
const details=await fetchDetails(source.request,source.headers,selected);
const seenAt=new Date();
const records=details.map(detail=>createKoperStagingRecord({companyId:env.BOSSA_COMPANY_ID,entity:"bill_to_pay_detail",koperId:detail.billId,koperParentId:detail.parentId,sanitizedPayload:detail.payload,koperCreatedAt:null,koperUpdatedAt:null,mappingVersion:1,seenAt}));
const saved=records.length?await saveKoperStagingBatch(records):{inserted:0,updated:0,unchanged:0};
console.log("KOPER_PAYABLE_DETAIL_STAGING_RESULT",JSON.stringify({ok:true,koperReadOnly:true,blockedKoperWrites:source.blockedWrites,liveRows:source.bills.length,existingDirect:direct.size,missingTotal:missing.length,batch:{offset,size,selected:selected.length,nextOffset:offset+selected.length,complete:offset+selected.length>=missing.length},details:details.length,staging:saved}));
