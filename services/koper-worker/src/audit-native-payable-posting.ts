import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type J = Record<string, unknown>;
type Stage = { koper_id: string; payload: J };
const o = (v: unknown): J => typeof v === "object" && v !== null && !Array.isArray(v) ? v as J : {};
const s = (v: unknown): string | null => v == null || String(v).trim() === "" ? null : String(v).trim();
async function all<T>(table: string, query: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await requestSupabase<T[]>(table, { query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }), timeoutMs: 30000 });
    out.push(...page);
    if (page.length < 1000) return out;
  }
}
const stage = (entity: string) => all<Stage>("koper_staging_records", { select: "koper_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: `eq.${entity}`, sync_state: "eq.present", order: "koper_id.asc" });
const [bills, resolutions, details, payables, allocations, suppliers, invoices, projects, members] = await Promise.all([
  stage("bill_to_pay"), stage("bill_resolution"), stage("bill_detail_enrichment"),
  all<{ id:string;source_id:string|null;amount:number;project_id:string;supplier_id:string;status:string }>("payables", {select:"id,source_id,amount,project_id,supplier_id,status",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
  all<{payable_id:string;source_id:string|null;allocation_amount:number}>("payable_cost_allocations", {select:"payable_id,source_id,allocation_amount",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
  all<{id:string;source_id:string|null;tax_id:string|null;legal_name:string}>("suppliers", {select:"id,source_id,tax_id,legal_name",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
  all<{id:string;registry_number:string;project_id:string;supplier_id:string}>("finance_electronic_invoices", {select:"id,registry_number,project_id,supplier_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
  all<{id:string;source_id:string|null;name:string}>("projects", {select:"id,source_id,name",company_id:`eq.${env.BOSSA_COMPANY_ID}`,order:"id.asc"}),
  all<{user_id:string}>("company_memberships", {select:"user_id",company_id:`eq.${env.BOSSA_COMPANY_ID}`,status:"eq.active",limit:"1"}),
]);
const rm = new Map(resolutions.map(x=>[x.koper_id,o(x.payload)]));
const dm = new Map(details.map(x=>[x.koper_id,o(x.payload)]));
const pm = new Map(payables.filter(x=>x.source_id).map(x=>[x.source_id!,x]));
const im = new Map(invoices.map(x=>[x.registry_number.replace(/^KOPER-NFE-/,""),x]));
const supplierSources = new Map(suppliers.filter(x=>x.source_id).map(x=>[x.source_id!,x]));
const supplierTax = new Map(suppliers.filter(x=>x.tax_id).map(x=>[x.tax_id!.replace(/\D/g, ""),x]));
const projectIds = new Set(projects.map(x=>x.id));
const grouped: Record<string,{count:number;value:number;existing:number;invoiceSupplier:number;sourceSupplier:number;taxSupplier:number;noSupplier:number;noProject:number;noDue:number;paidWithoutDate:number}> = {};
const samples: Record<string,unknown[]> = {};
for(const row of bills){
 const b=o(row.payload),r=rm.get(row.koper_id)??{},d=dm.get(row.koper_id)??{},ev=o(r.projectEvidence),ids=o(r.ids),inv=im.get(s(ids.invoiceId)??""),status=s(r.status)??"missing";
 const g=grouped[status]??{count:0,value:0,existing:0,invoiceSupplier:0,sourceSupplier:0,taxSupplier:0,noSupplier:0,noProject:0,noDue:0,paidWithoutDate:0}; grouped[status]=g;
 g.count++;g.value+=Number(b.billValue??0);
 if(pm.has(`koper_bill:${row.koper_id}`))g.existing++;
 const sourceSupplier=s(d.supplierId),tax=s(b.taxId)?.replace(/\D/g,"")??"";
 if(inv?.supplier_id)g.invoiceSupplier++;
 else if(sourceSupplier&&supplierSources.has(sourceSupplier))g.sourceSupplier++;
 else if(tax&&supplierTax.has(tax))g.taxSupplier++;
 else g.noSupplier++;
 const projectId=s(ev.projectId)??inv?.project_id;
 if(!projectId||!projectIds.has(projectId))g.noProject++;
 if(!s(b.dueDate))g.noDue++;
 if(b.isPaid===true&&!s(b.paymentDate))g.paidWithoutDate++;
 if((!projectId||!projectIds.has(projectId)||(!inv?.supplier_id&&!supplierSources.has(sourceSupplier??"")&&!supplierTax.has(tax)))&&(samples[status]??=[]).length<8) samples[status]!.push({billId:row.koper_id,projectId:projectId??null,supplierId:sourceSupplier,taxId:tax||null,invoiceId:s(ids.invoiceId),detailKeys:Object.keys(d)});
}
for(const g of Object.values(grouped))g.value=Math.round(g.value*100)/100;
console.log("KOPER_POSTING_AUDIT",JSON.stringify({bills:bills.length,resolutions:resolutions.length,details:details.length,payables:payables.length,existingNative:[...pm.keys()].filter(x=>x.startsWith("koper_bill:")).length,allocations:allocations.length,suppliers:suppliers.length,invoices:invoices.length,projects:projects.length,actor:members.length,grouped,samples}));
