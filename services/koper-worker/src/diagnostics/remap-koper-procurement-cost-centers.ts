import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";

type Row = Record<string, unknown>;
const PROJECT_ID = "ffe8b7ec-1f01-4f6c-8a03-2bd6d3ae94fc";
const COMPANY_ID = env.BOSSA_COMPANY_ID;
const WRITE = process.env.KOPER_PROCUREMENT_REMAP_WRITE_ENABLED === "true";

const s = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => typeof v === "number" ? v : Number(v ?? 0);
const normalize = (v: unknown) => s(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const q = (params: Record<string,string>) => new URLSearchParams(params);

async function selectAll(resource: string, params: Record<string,string>): Promise<Row[]> {
  const out: Row[] = [];
  for (let offset=0;;offset+=1000) {
    const rows = await requestSupabase<Row[]>(resource,{query:q({...params,limit:"1000",offset:String(offset)}),timeoutMs:120000});
    out.push(...rows);
    if (rows.length<1000) return out;
  }
}
async function patch(resource:string, params:Record<string,string>, body:Row) {
  await requestSupabase(resource,{method:"PATCH",query:q(params),body,prefer:"return=minimal",timeoutMs:120000});
}
async function inChunks<T>(rows:T[],size:number,fn:(row:T)=>Promise<void>) { for(let i=0;i<rows.length;i+=size) await Promise.all(rows.slice(i,i+size).map(fn)); }

// Apropriações cujo nome mudou/consolidou no orçamento FLOW atual.
const MANUAL_TARGET_BY_OLD_CODE: Record<string,string> = {
  "KOPER-S192":"01.10","KOPER-S193":"01.21","KOPER-S259":"01.14","KOPER-S260":"01.15","KOPER-S266":"01.32",
  "KOPER-S225":"03.10","KOPER-S226":"03.10","KOPER-S227":"03.16","KOPER-S278":"03.16.06",
  "KOPER-S268":"02.01","KOPER-S269":"02.02","KOPER-S273":"02.08","KOPER-S283":"04.04","KOPER-S286":"05.18",
  "KOPER-S287":"06.01","KOPER-S289":"06.05","KOPER-S292":"07.02","KOPER-S59":"08.02","KOPER-S298":"09.02",
  "KOPER-S299":"09.03","KOPER-S306":"11.01","KOPER-S73":"12.03","KOPER-S310":"12.14","KOPER-S324":"14.03",
  "KOPER-S326":"14.04","KOPER-S331":"14.18","KOPER-S334":"15.01","KOPER-S335":"15.02","KOPER-S337":"15.05",
  "KOPER-S338":"15.06","KOPER-S339":"15.07","KOPER-S342":"16.03","KOPER-S343":"16.05","KOPER-S346":"17.08",
  "KOPER-S349":"18.02","KOPER-S351":"19.03","KOPER-S352":"19.04","KOPER-S353":"19.05","KOPER-S354":"19.06",
  "KOPER-S355":"20.01","KOPER-S358":"22.02","KOPER-S365":"24.04","KOPER-S433":"26.03","KOPER-S434":"06.01",
  "KOPER-S435":"04.14","KOPER-S437":"08.01","KOPER-S438":"06.02","KOPER-S373":"26.21","KOPER-S379":"FLOW.S3071"
};

const services = await selectAll("engineering_services",{select:"id,code,description,status,source_system",company_id:`eq.${COMPANY_ID}`,status:"eq.active"});
const oldServices = services.filter(r=>s(r.source_system)==="koper" && s(r.code).startsWith("KOPER-S"));
const currentServices = services.filter(r=>s(r.source_system)==="elos_os");
const currentByCode = new Map(currentServices.map(r=>[s(r.code),r]));
const currentByName = new Map<string,Row[]>();
for(const r of currentServices){const k=normalize(r.description);currentByName.set(k,[...(currentByName.get(k)??[]),r]);}

const mappings = new Map<string,{oldId:string;oldCode:string;oldName:string;targetId:string;targetCode:string;targetName:string;method:string}>();
for(const old of oldServices){
  const oldCode=s(old.code); let target:Row|undefined; let method="";
  const manual=MANUAL_TARGET_BY_OLD_CODE[oldCode];
  if(manual){target=currentByCode.get(manual);method="manual";}
  else {const c=currentByName.get(normalize(old.description))??[]; if(c.length===1){target=c[0];method="exact_name";}}
  if(target?.id) mappings.set(oldCode,{oldId:s(old.id),oldCode,oldName:s(old.description),targetId:s(target.id),targetCode:s(target.code),targetName:s(target.code)==="07.02"?"Sistema de Exaustão Mecânica":s(target.description),method});
}

const requestItems = await selectAll("execution_material_request_items",{select:"id,project_id,cost_center_service_id,cost_center_code,cost_center_name,requested_quantity,ordered_quantity",company_id:`eq.${COMPANY_ID}`,project_id:`eq.${PROJECT_ID}`});
const orderItems = await selectAll("procurement_purchase_order_items",{select:"id,project_id,cost_center_service_id,cost_center_code,cost_center_name,total_amount,ordered_quantity,received_quantity,source_system",company_id:`eq.${COMPANY_ID}`,project_id:`eq.${PROJECT_ID}`});

const reqToChange=requestItems.filter(r=>mappings.has(s(r.cost_center_code)));
const ordToChange=orderItems.filter(r=>s(r.source_system)==="koper" && mappings.has(s(r.cost_center_code)));
const reqQtyBefore=reqToChange.reduce((a,r)=>a+n(r.requested_quantity),0);
const orderAmountBefore=ordToChange.reduce((a,r)=>a+n(r.total_amount),0);
const orderQtyBefore=ordToChange.reduce((a,r)=>a+n(r.ordered_quantity),0);

const examples=["KOPER-S336","KOPER-S351","KOPER-S352","KOPER-S334","KOPER-S343","KOPER-S309","KOPER-S328","KOPER-S331"]
  .map(code=>({code,mapping:mappings.get(code),requestRows:reqToChange.filter(r=>s(r.cost_center_code)===code).length,orderRows:ordToChange.filter(r=>s(r.cost_center_code)===code).length,orderAmount:ordToChange.filter(r=>s(r.cost_center_code)===code).reduce((a,r)=>a+n(r.total_amount),0)}));

if(!WRITE){
 console.log("KOPER_PROCUREMENT_REMAP_DRY_RUN",JSON.stringify({ok:true,mappedOldCodes:mappings.size,requestItemsTotal:requestItems.length,requestItemsToChange:reqToChange.length,orderItemsTotal:orderItems.length,orderItemsToChange:ordToChange.length,reqQtyBefore,orderAmountBefore,orderQtyBefore,examples}));
 process.exit(0);
}

await inChunks(reqToChange,20,async row=>{const m=mappings.get(s(row.cost_center_code))!;await patch("execution_material_request_items",{id:`eq.${s(row.id)}`},{cost_center_service_id:m.targetId,cost_center_code:m.targetCode,cost_center_name:m.targetName});});
await inChunks(ordToChange,20,async row=>{const m=mappings.get(s(row.cost_center_code))!;await patch("procurement_purchase_order_items",{id:`eq.${s(row.id)}`},{cost_center_service_id:m.targetId,cost_center_code:m.targetCode,cost_center_name:m.targetName});});

const reqAfter=await selectAll("execution_material_request_items",{select:"id,cost_center_service_id,cost_center_code,cost_center_name,requested_quantity",company_id:`eq.${COMPANY_ID}`,project_id:`eq.${PROJECT_ID}`});
const ordAfter=await selectAll("procurement_purchase_order_items",{select:"id,cost_center_service_id,cost_center_code,cost_center_name,total_amount,ordered_quantity,source_system",company_id:`eq.${COMPANY_ID}`,project_id:`eq.${PROJECT_ID}`});
const oldCodes=new Set(mappings.keys());
const reqStillOld=reqAfter.filter(r=>oldCodes.has(s(r.cost_center_code))).length;
const ordStillOld=ordAfter.filter(r=>s(r.source_system)==="koper"&&oldCodes.has(s(r.cost_center_code))).length;
const reqQtyAfter=reqAfter.reduce((a,r)=>a+(mappings.has(s(r.cost_center_code))?0:0),0); // values audited through changed-row IDs below
const changedReqIds=new Set(reqToChange.map(r=>s(r.id))); const changedOrdIds=new Set(ordToChange.map(r=>s(r.id)));
const changedReqAfter=reqAfter.filter(r=>changedReqIds.has(s(r.id)));
const changedOrdAfter=ordAfter.filter(r=>changedOrdIds.has(s(r.id)));
const reqQtyChangedAfter=changedReqAfter.reduce((a,r)=>a+n(r.requested_quantity),0);
const orderAmountAfter=changedOrdAfter.reduce((a,r)=>a+n(r.total_amount),0);
const orderQtyAfter=changedOrdAfter.reduce((a,r)=>a+n(r.ordered_quantity),0);
if(Math.abs(reqQtyChangedAfter-reqQtyBefore)>1e-6) throw new Error("Quantidade solicitada mudou");
if(Math.abs(orderAmountAfter-orderAmountBefore)>0.001) throw new Error("Valor dos pedidos mudou");
if(Math.abs(orderQtyAfter-orderQtyBefore)>1e-6) throw new Error("Quantidade pedida mudou");
if(reqStillOld||ordStillOld) throw new Error(`Ainda restaram refs antigas: requests=${reqStillOld}, orders=${ordStillOld}`);
console.log("KOPER_PROCUREMENT_REMAP_RESULT",JSON.stringify({ok:true,mappedOldCodes:mappings.size,requestItemsChanged:reqToChange.length,orderItemsChanged:ordToChange.length,reqQtyBefore,reqQtyChangedAfter,orderAmountBefore,orderAmountAfter,orderQtyBefore,orderQtyAfter,reqStillOld,ordStillOld,examples}));
