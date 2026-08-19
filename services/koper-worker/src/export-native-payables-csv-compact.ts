import { gzipSync } from "node:zlib";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type J=Record<string,unknown>;
type Stage={koper_id:string;koper_parent_id:string|null;payload:unknown};
type Service={id:string;source_id:string|null;code:string|null;description:string|null;status:string|null};
const obj=(v:unknown):J=>typeof v==="object"&&v!==null&&!Array.isArray(v)?v as J:{};
const arr=(v:unknown):J[]=>Array.isArray(v)?v.map(obj):[];
const txt=(v:unknown)=>v===null||v===undefined?"":String(v);
const first=(...v:unknown[])=>v.find(x=>x!==undefined&&x!==null&&x!=="")??"";
const csv=(v:unknown)=>`"${txt(v).replaceAll('"','""').replace(/[\r\n]+/g,' ')}"`;
async function allStage(entity:string){const out:Stage[]=[];for(let o=0;;o+=1000){const rows=await requestSupabase<Stage[]>("koper_staging_records",{query:new URLSearchParams({select:"koper_id,koper_parent_id,payload",company_id:`eq.${env.BOSSA_COMPANY_ID}`,source:"eq.koper",entity:`eq.${entity}`,sync_state:"eq.present",order:"koper_id.asc",limit:"1000",offset:String(o)}),timeoutMs:30000});out.push(...rows);if(rows.length<1000)return out;}}
async function allServices(){const out:Service[]=[];for(let o=0;;o+=1000){const rows=await requestSupabase<Service[]>("engineering_services",{query:new URLSearchParams({select:"id,source_id,code,description,status",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"source_id.asc",limit:"1000",offset:String(o)}),timeoutMs:30000});out.push(...rows);if(rows.length<1000)return out;}}
const [bills,resolutions,details,services]=await Promise.all([allStage("bill_to_pay"),allStage("bill_resolution"),allStage("bill_detail_enrichment"),allServices()]);
const rmap=new Map(resolutions.map(x=>[x.koper_id,obj(x.payload)]));
const dmap=new Map(details.map(x=>[x.koper_id,obj(x.payload)]));
const smap=new Map(services.filter(s=>s.source_id).map(s=>[String(s.source_id),s]));
const headers=["Bill ID","BillToPay ID","Valor título","Valor parcela","Vencimento","Pago?","Data pagamento","Valor pago","Tipo pagamento","Desconto","Juros","Multa","Outros acréscimos","Conta ID","Conta","Origem","Nº NF","Nº Recibo","Comentário","Fornecedor ID","Fornecedor","Beneficiário fornecedor","Status detalhe","Cobertura detalhe","Rota resolução","Status resolução","Versão resolução","Método(s)","Serviço(s) Koper ID","Código(s) serviço","Serviço(s)","WBS","Build Monitoring ID","Recibo ID","Invoice ID","Release ID","Stage Release ID","Centro custo ID","Conta contábil ID","Evidência/observação"];
const lines=[headers.map(csv).join(",")];
for(const row of bills){
 const b=obj(row.payload),r=rmap.get(row.koper_id)??{},d=dmap.get(row.koper_id)??{};
 const ids=obj(r.ids); const allocations=arr(r.allocations);
 const serviceIds=(Array.isArray(r.serviceSourceIds)?r.serviceSourceIds:allocations.map(a=>a.serviceSourceId)).filter(x=>x!==null&&x!==undefined&&x!=="").map(String);
 const uniqueServices=[...new Set(serviceIds)];
 const serviceRows=uniqueServices.map(id=>smap.get(id)).filter(Boolean) as Service[];
 const methods=[...new Set(allocations.map(a=>txt(a.method)).filter(Boolean))];
 const wbs=[...new Set((Array.isArray(r.wbsCodes)?r.wbsCodes:allocations.map(a=>first(a.wbsCode,a.budgetItemCode,a.itemReference))).filter(x=>x!==null&&x!==undefined&&x!=="").map(String))];
 const evidence=first(r.note,r.reason,r.evidence,r.resolutionReason,r.unresolvedReason);
 const values=[
  row.koper_id,first(b.billToPayId,row.koper_parent_id),b.billValue,b.installmentAmount,b.dueDate,b.isPaid,b.paymentDate,b.paymentValue,b.paymentType,b.discountValue,b.interestValue,b.lateFeeValue,b.otherAccruals,b.accountId,b.accountName,b.originName,b.invoiceNumber,b.receiptNumber,b.billComments,
  d.supplierId,d.supplierName,first(d.beneficiarySupplierName,d.beneficiarySupplierId),first(d.status,d.paymentStatus,d.accountingStatus),dmap.has(row.koper_id)?"Enriquecido":"Pendente enriquecimento",
  r.route,r.status,r.version,methods.join(" | "),uniqueServices.join(" | "),serviceRows.map(s=>s.code??"").filter(Boolean).join(" | "),serviceRows.map(s=>s.description??"").filter(Boolean).join(" | "),wbs.join(" | "),
  first(ids.buildMonitoringId,d.buildMonitoringId),first(ids.receiptId,d.receiptId),first(ids.invoiceId,d.invoiceId),first(ids.releaseId,d.releaseId),first(ids.stageReleaseId,d.stageReleaseId),d.costCenterId,first(d.chartAccountId,d.itemChartAccountId,d.accountId),typeof evidence==="object"?JSON.stringify(evidence):evidence
 ];
 lines.push(values.map(csv).join(","));
}
const text="\uFEFF"+lines.join("\r\n");
const packed=gzipSync(Buffer.from(text,"utf8"),{level:9}).toString("base64");
const chunkSize=60000,total=Math.ceil(packed.length/chunkSize);
console.log("KOPER_COMPACT_CSV_META",JSON.stringify({bills:bills.length,resolutions:resolutions.length,details:details.length,services:services.length,csvBytes:Buffer.byteLength(text),gzipBase64Chars:packed.length,chunks:total}));
for(let i=0;i<total;i++) console.log(`KOPER_COMPACT_CSV_CHUNK ${i+1}/${total} ${packed.slice(i*chunkSize,(i+1)*chunkSize)}`);
await new Promise(r=>setTimeout(r,1000));
