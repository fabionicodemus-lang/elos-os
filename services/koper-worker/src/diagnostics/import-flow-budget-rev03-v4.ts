import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";

type J = Record<string, unknown>;
const PROJECT_ID = "ffe8b7ec-1f01-4f6c-8a03-2bd6d3ae94fc";
const COMPANY_ID = env.BOSSA_COMPANY_ID;
const WRITE = process.env.FLOW_IMPORT_WRITE_ENABLED === "true";
const TARGET_CODE = "FLOW-REV03-V4";

const n = (v: unknown) => typeof v === "number" ? v : Number(v ?? 0);
const s = (v: unknown) => String(v ?? "").trim();
const chunk = <T>(rows: T[], size = 250): T[][] => Array.from({length: Math.ceil(rows.length/size)}, (_,i)=>rows.slice(i*size,(i+1)*size));
const q = (o: Record<string,string>) => new URLSearchParams(o);

async function select(resource: string, params: Record<string,string>): Promise<J[]> {
  return requestSupabase<J[]>(resource, {query:q(params)});
}
async function insert(resource: string, rows: J[]): Promise<J[]> {
  if (!rows.length) return [];
  const out: J[] = [];
  for (const batch of chunk(rows)) {
    const r = await requestSupabase<J[]>(resource, {method:"POST", body:batch, prefer:"return=representation"});
    if (Array.isArray(r)) out.push(...r);
  }
  return out;
}
async function upsert(resource: string, rows: J[], conflict: string): Promise<void> {
  if (!rows.length) return;
  for (const batch of chunk(rows)) {
    await requestSupabase(resource, {method:"POST", query:q({on_conflict:conflict}), body:batch, prefer:"resolution=merge-duplicates,return=minimal"});
  }
}
async function patch(resource: string, params: Record<string,string>, body: J): Promise<void> {
  await requestSupabase(resource, {method:"PATCH", query:q(params), body, prefer:"return=minimal"});
}
async function del(resource: string, params: Record<string,string>): Promise<void> {
  await requestSupabase(resource, {method:"DELETE", query:q(params), prefer:"return=minimal"});
}
const inFilter = (ids: string[]) => `in.(${ids.join(",")})`;

function decodePlan(): J {
  const parts = Number(process.env.FLOW_IMPORT_PLAN_PARTS ?? "0");
  if (!Number.isInteger(parts) || parts <= 0) throw new Error("FLOW_IMPORT_PLAN_PARTS inválido");
  const encoded = Array.from({length:parts},(_,i)=>process.env[`FLOW_IMPORT_PLAN_${String(i).padStart(2,"0")}`] ?? "").join("");
  const jsonBuffer = gunzipSync(Buffer.from(encoded,"base64"));
  const sha = createHash("sha256").update(jsonBuffer).digest("hex");
  const expected = process.env.FLOW_IMPORT_PLAN_SHA256 ?? "";
  if (!expected || sha !== expected) throw new Error(`Hash do plano inválido (${sha} != ${expected || "ausente"})`);
  return JSON.parse(jsonBuffer.toString("utf8")) as J;
}

const plan = decodePlan();
const arr = (k:string): J[] => Array.isArray(plan[k]) ? plan[k] as J[] : [];
const budget = plan.budget && typeof plan.budget === "object" ? plan.budget as J : {};
const groups = arr("groups");
const services = arr("services");
const inputs = arr("inputs");
const compositions = arr("compositions");
const budgetItems = arr("budget_items");
const adjustments = arr("adjustments");
const activePlanItems = budgetItems.filter(r=>s(r.status||"active")==="active");
const activeAdjustments = adjustments.filter(r=>s(r.status||"active")==="active");
const targetTotal = n(budget.target_total);
const planTotal = [...activePlanItems,...activeAdjustments].reduce((a,r)=>a+n(r.row_total),0);
const groupTotal = groups.reduce((a,r)=>a+n(r.total),0);
if (groups.length !== 34 || services.length !== 161 || inputs.length !== 242 || compositions.length !== 102 || budgetItems.length !== 161 || adjustments.length !== 6) throw new Error("Contagens do pacote FLOW divergentes");
if (Math.abs(planTotal-targetTotal)>0.02 || Math.abs(groupTotal-targetTotal)>0.02) throw new Error(`Total do pacote divergente: plano=${planTotal} grupos=${groupTotal} alvo=${targetTotal}`);

async function budgetSnapshot(code: string) {
  const budgets = await select("engineering_budgets", {select:"id,code,name,version,status,is_base",company_id:`eq.${COMPANY_ID}`,project_id:`eq.${PROJECT_ID}`,code:`eq.${code}`,limit:"5"});
  const b = budgets[0];
  if (!b?.id) return {id:null,count:0,total:0};
  const rows = await select("engineering_budget_items", {select:"id,total_direct_cost,status",budget_id:`eq.${String(b.id)}`,limit:"2000"});
  const active = rows.filter(r=>s(r.status)==="active");
  return {id:String(b.id),count:active.length,total:active.reduce((a,r)=>a+n(r.total_direct_cost),0),is_base:Boolean(b.is_base)};
}

const koperBefore = await budgetSnapshot("KOPER-100");
if (!koperBefore.id || koperBefore.count !== 108) throw new Error(`KOPER-100 fora da linha de base esperada: ${JSON.stringify(koperBefore)}`);

// Verificações estruturais sem escrever.
const compItems = compositions.flatMap(c => Array.isArray(c.items) ? (c.items as J[]).map(i=>({service_code:s(c.service_code),...i})) : []);
const badCoefficients = compItems.filter(i=>n(i.coefficient)<=0);
if (badCoefficients.length) throw new Error(`Composição pronta contém coeficiente <= 0 (${badCoefficients.length})`);
const inputCodes = new Set(inputs.map(i=>s(i.code)));
const serviceCodes = new Set(services.map(i=>s(i.code)));
const missingCompInputs = compItems.filter(i=>!inputCodes.has(s(i.input_code)));
const missingCompServices = compositions.filter(c=>!serviceCodes.has(s(c.service_code)));
if (missingCompInputs.length || missingCompServices.length) throw new Error(`Referências ausentes no plano: inputs=${missingCompInputs.length} services=${missingCompServices.length}`);

if (!WRITE) {
  console.log("FLOW_IMPORT_DRY_RUN", JSON.stringify({ok:true,targetTotal,planTotal,groupTotal,counts:{groups:groups.length,services:services.length,inputs:inputs.length,compositions:compositions.length,compositionItems:compItems.length,budgetItems:budgetItems.length,activeBudgetItems:activePlanItems.length,inactiveBudgetItems:budgetItems.length-activePlanItems.length,adjustments:activeAdjustments.length},koperBefore}));
  process.exit(0);
}

// 1) Catálogo de serviços e insumos, por código. Não altera source_system/source_id existentes.
await upsert("engineering_services", services.map(r=>({
  company_id:COMPANY_ID,
  code:s(r.code),
  description:s(r.description),
  unit:s(r.unit)||"un",
  group_code:s(r.group_code)||null,
  notes:s(r.notes)||null,
  status:"active"
})), "company_id,code");

await upsert("engineering_inputs", inputs.map(r=>({
  company_id:COMPANY_ID,
  code:s(r.code),
  description:s(r.description),
  unit:s(r.unit)||"un",
  category:s(r.category)||"material",
  notes:"Base padrão FLOW Rev.03 V4",
  status:"active"
})), "company_id,code");

const serviceRows = await select("engineering_services", {select:"id,code,description,unit,group_code,status",company_id:`eq.${COMPANY_ID}`,code:inFilter([...serviceCodes]),limit:"1000"});
const inputRows = await select("engineering_inputs", {select:"id,code,description,unit,category,status",company_id:`eq.${COMPANY_ID}`,code:inFilter([...inputCodes]),limit:"2000"});
const serviceByCode = new Map(serviceRows.map(r=>[s(r.code),String(r.id)]));
const inputByCode = new Map(inputRows.map(r=>[s(r.code),String(r.id)]));
if (serviceByCode.size !== serviceCodes.size || inputByCode.size !== inputCodes.size) throw new Error(`Catálogo incompleto após upsert: services ${serviceByCode.size}/${serviceCodes.size}; inputs ${inputByCode.size}/${inputCodes.size}`);

// 2) Composições-mestre dos 102 serviços. Substitui somente os itens desses 102 serviços pelo pacote revisado.
await upsert("engineering_service_compositions", compositions.map(c=>({
  company_id:COMPANY_ID,
  service_id:serviceByCode.get(s(c.service_code)),
  notes:"Composição padrão FLOW Rev.03 V4",
  status:"active"
})), "company_id,service_id");
const compServiceIds = compositions.map(c=>serviceByCode.get(s(c.service_code))!).filter(Boolean);
const compRows = await select("engineering_service_compositions", {select:"id,service_id,status",company_id:`eq.${COMPANY_ID}`,service_id:inFilter(compServiceIds),limit:"1000"});
const compByServiceId = new Map(compRows.map(r=>[String(r.service_id),String(r.id)]));
const compIds = [...compByServiceId.values()];
if (compByServiceId.size !== compositions.length) throw new Error(`Composições-mestre incompletas: ${compByServiceId.size}/${compositions.length}`);
if (compIds.length) await del("engineering_service_composition_items", {composition_id:inFilter(compIds)});
const masterCompItems: J[] = [];
for (const c of compositions) {
  const serviceId = serviceByCode.get(s(c.service_code))!;
  const compositionId = compByServiceId.get(serviceId)!;
  for (const i of (Array.isArray(c.items)?c.items as J[]:[])) {
    masterCompItems.push({
      company_id:COMPANY_ID,
      composition_id:compositionId,
      input_id:inputByCode.get(s(i.input_code)),
      coefficient:n(i.coefficient),
      waste_percentage:n(i.waste_percentage),
      sort_order:n(i.sort_order),
      notes:s(i.notes)||null,
      status:"active"
    });
  }
}
await insert("engineering_service_composition_items", masterCompItems);

// 3) Preços adotados por obra, derivados das composições seguras. Se houver conflito, prioriza a maior data-base lógica do pacote e exige preço único por código.
const pricesByCode = new Map<string,{price:number,source:string}>();
for (const i of compItems) {
  const code=s(i.input_code), price=n(i.unit_price);
  if (price<=0) continue;
  const current=pricesByCode.get(code);
  if (current && Math.abs(current.price-price)>0.02) throw new Error(`Preços conflitantes para ${code}: ${current.price} x ${price}`);
  pricesByCode.set(code,{price,source:s(i.price_source)||"Orçamento FLOW"});
}
const pricedInputIds=[...pricesByCode.keys()].map(c=>inputByCode.get(c)!).filter(Boolean);
if (pricedInputIds.length) {
  await patch("engineering_input_prices", {company_id:`eq.${COMPANY_ID}`,project_id:`eq.${PROJECT_ID}`,input_id:inFilter(pricedInputIds),is_adopted:"eq.true",status:"eq.active"},{is_adopted:false});
  await insert("engineering_input_prices", [...pricesByCode.entries()].map(([code,p])=>({
    company_id:COMPANY_ID,project_id:PROJECT_ID,input_id:inputByCode.get(code),price_date:s(budget.reference_date)||"2026-08-20",unit_price:p.price,freight_unit_cost:0,other_unit_cost:0,discount_percentage:0,currency:"BRL",is_adopted:true,source:p.source,notes:"Preço adotado na revisão FLOW Rev.03 V4",status:"active"
  })));
}

// 4) Recria somente o orçamento FLOW-REV03-V4. KOPER-100 não é alterado.
const oldTargets = await select("engineering_budgets", {select:"id,is_base",company_id:`eq.${COMPANY_ID}`,project_id:`eq.${PROJECT_ID}`,code:`eq.${TARGET_CODE}`,version:`eq.${s(budget.version)}`,limit:"5"});
for (const old of oldTargets) {
  if (old.is_base) throw new Error("O orçamento FLOW alvo existente está marcado como base; importação abortada por segurança.");
  await del("engineering_budgets", {id:`eq.${String(old.id)}`});
}
const budgetRows = await insert("engineering_budgets", [{
  company_id:COMPANY_ID,project_id:PROJECT_ID,code:TARGET_CODE,name:s(budget.name)||"Flow Aptos - Orçamento FLOW Rev.03 V4",version:s(budget.version)||"Rev.03 V4",status:"review",reference_date:s(budget.reference_date)||"2026-08-20",area_m2:0,bdi_percentage:0,notes:`Orçamento oficial FLOW Rev.03 V4. Total-alvo R$ ${targetTotal.toFixed(2)}. Importado da base revisada em 20/08/2026.`,source_system:"elos_os",source_id:"flow-rev03-v4-2026-08-20"
}]);
const budgetId=String(budgetRows[0]?.id||"");
if (!budgetId) throw new Error("Falha ao criar orçamento FLOW");

const groupRows = await insert("engineering_budget_groups", groups.map(g=>({company_id:COMPANY_ID,project_id:PROJECT_ID,budget_id:budgetId,code:s(g.code),name:s(g.name),sort_order:n(g.sort),notes:`Subtotal oficial: ${n(g.total).toFixed(6)}`,status:"active"})));
const groupByCode=new Map(groupRows.map(g=>[s(g.code),String(g.id)]));
if (groupByCode.size!==34) throw new Error(`Grupos criados: ${groupByCode.size}/34`);

function costColumns(row:J){
  const unit=n(row.unit_cost); const nature=s(row.nature).toLowerCase();
  if (nature.includes("material")) return {material_unit_cost:unit,labor_unit_cost:0,equipment_unit_cost:0,other_unit_cost:0};
  if (nature.includes("mão")||nature.includes("mao")||nature.includes("labor")) return {material_unit_cost:0,labor_unit_cost:unit,equipment_unit_cost:0,other_unit_cost:0};
  if (nature.includes("equip")) return {material_unit_cost:0,labor_unit_cost:0,equipment_unit_cost:unit,other_unit_cost:0};
  return {material_unit_cost:0,labor_unit_cost:0,equipment_unit_cost:0,other_unit_cost:unit};
}
const itemPayload: J[] = budgetItems.map(r=>({
  company_id:COMPANY_ID,project_id:PROJECT_ID,budget_id:budgetId,group_id:groupByCode.get(s(r.group))||null,code:s(r.code),description:s(r.description),unit:s(r.unit)||"un",quantity:n(r.quantity),...costColumns(r),sort_order:n(r.sort_order),notes:`FLOW Rev.03 V4 · linha ${s(r.source_line)||"-"}${s(r.parent)?` · pai ${s(r.parent)}`:""}${s(r.status)==="inactive"?" · referência fora do subtotal oficial":""}`,status:s(r.status)||"active",service_id:serviceByCode.get(s(r.code))||null
}));
for (const a of activeAdjustments) itemPayload.push({company_id:COMPANY_ID,project_id:PROJECT_ID,budget_id:budgetId,group_id:groupByCode.get(s(a.group))||null,code:s(a.code),description:s(a.description),unit:s(a.unit)||"vb",quantity:n(a.quantity),material_unit_cost:0,labor_unit_cost:0,equipment_unit_cost:0,other_unit_cost:n(a.unit_cost),sort_order:n(a.sort_order),notes:s(a.notes)||"Reconciliação de SUBTOTAL do Excel original",status:"active",service_id:null});
await insert("engineering_budget_items", itemPayload);

// 5) Verificação de leitura pós-gravação.
const target = await budgetSnapshot(TARGET_CODE);
const koperAfter = await budgetSnapshot("KOPER-100");
const createdItems = await select("engineering_budget_items", {select:"id,code,status,total_direct_cost",budget_id:`eq.${budgetId}`,limit:"2000"});
const activeCreated = createdItems.filter(r=>s(r.status)==="active");
const inactiveCreated = createdItems.filter(r=>s(r.status)!=="active");
const finalTotal=activeCreated.reduce((a,r)=>a+n(r.total_direct_cost),0);
const postMasterCompItems = await select("engineering_service_composition_items", {select:"id,composition_id,status",composition_id:inFilter(compIds),status:"eq.active",limit:"2000"});
const ok = target.id===budgetId && activeCreated.length===156 && inactiveCreated.length===11 && Math.abs(finalTotal-targetTotal)<0.02 && koperAfter.id===koperBefore.id && koperAfter.count===koperBefore.count && Math.abs(koperAfter.total-koperBefore.total)<0.02 && postMasterCompItems.length===masterCompItems.length;
console.log("FLOW_IMPORT_RESULT", JSON.stringify({ok,budgetId,targetCode:TARGET_CODE,targetTotal,finalTotal,activeItems:activeCreated.length,inactiveItems:inactiveCreated.length,groups:groupRows.length,servicesResolved:serviceByCode.size,inputsResolved:inputByCode.size,serviceCompositions:compRows.length,compositionItems:postMasterCompItems.length,adoptedProjectPrices:pricesByCode.size,koperBefore,koperAfter}));
if (!ok) throw new Error("Verificação pós-carga do FLOW falhou; revisar FLOW_IMPORT_RESULT");
