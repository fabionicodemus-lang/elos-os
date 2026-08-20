import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";

type J = Record<string, unknown>;
const COMPANY_ID = env.BOSSA_COMPANY_ID;
const PROJECT_ID = "ffe8b7ec-1f01-4f6c-8a03-2bd6d3ae94fc";
const TARGET_CODE = "FLOW-REV03-V4";
const WRITE = process.env.FLOW_IMPORT_WRITE_ENABLED === "true";
const s = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => typeof v === "number" ? v : Number(v ?? 0);
const q = (o: Record<string, string>) => new URLSearchParams(o);
const partsOf = <T>(rows: T[], size = 200) => Array.from({length: Math.ceil(rows.length / size)}, (_, i) => rows.slice(i * size, (i + 1) * size));
const inFilter = (ids: string[]) => `in.(${ids.join(",")})`;

async function get(resource: string, params: Record<string, string>): Promise<J[]> {
  return requestSupabase<J[]>(resource, {query: q(params)});
}
async function post(resource: string, body: J[], prefer = "return=representation", params?: Record<string, string>): Promise<J[]> {
  const out: J[] = [];
  for (const batch of partsOf(body)) {
    const rows = await requestSupabase<J[]>(resource, {method: "POST", query: params ? q(params) : undefined, body: batch, prefer});
    if (Array.isArray(rows)) out.push(...rows);
  }
  return out;
}
async function upsert(resource: string, body: J[], conflict: string): Promise<void> {
  for (const batch of partsOf(body)) {
    await requestSupabase(resource, {method: "POST", query: q({on_conflict: conflict}), body: batch, prefer: "resolution=merge-duplicates,return=minimal"});
  }
}
async function patch(resource: string, params: Record<string, string>, body: J): Promise<void> {
  await requestSupabase(resource, {method: "PATCH", query: q(params), body, prefer: "return=minimal"});
}
async function remove(resource: string, params: Record<string, string>): Promise<void> {
  await requestSupabase(resource, {method: "DELETE", query: q(params), prefer: "return=minimal"});
}

function readPlan(): J {
  const count = Number(process.env.FLOW_IMPORT_PLAN_PARTS ?? "0");
  if (!Number.isInteger(count) || count !== 15) throw new Error(`Plano FLOW deve ter 15 partes; recebeu ${count}`);
  const encoded = Array.from({length: count}, (_, i) => process.env[`FLOW_IMPORT_PLAN_${String(i).padStart(2, "0")}`] ?? "").join("");
  const json = gunzipSync(Buffer.from(encoded, "base64"));
  const sha = createHash("sha256").update(json).digest("hex");
  const expected = process.env.FLOW_IMPORT_PLAN_SHA256 ?? "";
  if (sha !== expected) throw new Error(`Hash do plano FLOW divergente: ${sha} != ${expected}`);
  return JSON.parse(json.toString("utf8")) as J;
}

const plan = readPlan();
const arr = (key: string): J[] => Array.isArray(plan[key]) ? plan[key] as J[] : [];
const budget = plan.budget && typeof plan.budget === "object" ? plan.budget as J : {};
const groups = arr("groups");
const services = arr("services");
const inputs = arr("inputs");
const compositions = arr("compositions");
const budgetItems = arr("budget_items");
const adjustments = arr("adjustments").filter(r => s(r.status || "active") === "active");
const activePlanItems = budgetItems.filter(r => s(r.status || "active") === "active");
const targetTotal = n(budget.target_total);
const planTotal = [...activePlanItems, ...adjustments].reduce((a, r) => a + n(r.row_total), 0);
const groupTotal = groups.reduce((a, r) => a + n(r.total), 0);
if (groups.length !== 34 || services.length !== 161 || inputs.length !== 242 || compositions.length !== 102 || budgetItems.length !== 161 || adjustments.length !== 6) throw new Error("Contagens do pacote FLOW divergentes");
if (Math.abs(planTotal - targetTotal) > 0.02 || Math.abs(groupTotal - targetTotal) > 0.02) throw new Error(`Total FLOW inválido: plano=${planTotal}, grupos=${groupTotal}, alvo=${targetTotal}`);

const compItems: J[] = compositions.flatMap((c): J[] => Array.isArray(c.items)
  ? (c.items as J[]).map((i): J => ({service_code: s(c.service_code), ...i}))
  : []);
if (compItems.some(i => n(i.coefficient) <= 0)) throw new Error("Há coeficiente <= 0 nas composições seguras");
const inputCodes = new Set(inputs.map(i => s(i.code)));
const serviceCodes = new Set(services.map(i => s(i.code)));
if (compItems.some(i => !inputCodes.has(s(i.input_code)))) throw new Error("Composição referencia insumo ausente do pacote");
if (compositions.some(c => !serviceCodes.has(s(c.service_code)))) throw new Error("Composição referencia serviço ausente do pacote");

async function snapshot(code: string) {
  const bs = await get("engineering_budgets", {select: "id,code,name,version,status,is_base", company_id: `eq.${COMPANY_ID}`, project_id: `eq.${PROJECT_ID}`, code: `eq.${code}`, limit: "5"});
  const b = bs[0];
  if (!b?.id) return {id: null, count: 0, total: 0, is_base: false};
  const rows = await get("engineering_budget_items", {select: "id,total_direct_cost,status", budget_id: `eq.${String(b.id)}`, limit: "2000"});
  const active = rows.filter(r => s(r.status) === "active");
  return {id: String(b.id), count: active.length, total: active.reduce((a, r) => a + n(r.total_direct_cost), 0), is_base: Boolean(b.is_base)};
}

const koperBefore = await snapshot("KOPER-100");
if (!koperBefore.id || koperBefore.count !== 108) throw new Error(`KOPER-100 fora da linha de base: ${JSON.stringify(koperBefore)}`);
if (!WRITE) {
  console.log("FLOW_IMPORT_DRY_RUN", JSON.stringify({ok: true, targetTotal, planTotal, groupTotal, counts: {groups: groups.length, services: services.length, inputs: inputs.length, compositions: compositions.length, compositionItems: compItems.length, budgetItems: budgetItems.length, activeBudgetItems: activePlanItems.length, inactiveBudgetItems: budgetItems.length - activePlanItems.length, adjustments: adjustments.length}, koperBefore}));
  process.exit(0);
}

await upsert("engineering_services", services.map(r => ({company_id: COMPANY_ID, code: s(r.code), description: s(r.description), unit: s(r.unit) || "un", group_code: s(r.group_code) || null, notes: s(r.notes) || null, status: "active"})), "company_id,code");
await upsert("engineering_inputs", inputs.map(r => ({company_id: COMPANY_ID, code: s(r.code), description: s(r.description), unit: s(r.unit) || "un", category: s(r.category) || "material", notes: "Base padrão FLOW Rev.03 V4", status: "active"})), "company_id,code");

const serviceRows = await get("engineering_services", {select: "id,code", company_id: `eq.${COMPANY_ID}`, code: inFilter([...serviceCodes]), limit: "1000"});
const inputRows = await get("engineering_inputs", {select: "id,code", company_id: `eq.${COMPANY_ID}`, code: inFilter([...inputCodes]), limit: "2000"});
const serviceByCode = new Map(serviceRows.map(r => [s(r.code), String(r.id)]));
const inputByCode = new Map(inputRows.map(r => [s(r.code), String(r.id)]));
if (serviceByCode.size !== 161 || inputByCode.size !== 242) throw new Error(`Catálogo incompleto após upsert: serviços=${serviceByCode.size}, insumos=${inputByCode.size}`);

await upsert("engineering_service_compositions", compositions.map(c => ({company_id: COMPANY_ID, service_id: serviceByCode.get(s(c.service_code)), notes: "Composição padrão FLOW Rev.03 V4", status: "active"})), "company_id,service_id");
const compServiceIds = compositions.map(c => serviceByCode.get(s(c.service_code))!).filter(Boolean);
const compRows = await get("engineering_service_compositions", {select: "id,service_id", company_id: `eq.${COMPANY_ID}`, service_id: inFilter(compServiceIds), limit: "1000"});
const compByService = new Map(compRows.map(r => [String(r.service_id), String(r.id)]));
if (compByService.size !== 102) throw new Error(`Cabeçalhos de composição resolvidos: ${compByService.size}/102`);
const compIds = [...compByService.values()];
await patch("engineering_service_composition_items", {composition_id: inFilter(compIds), status: "eq.active"}, {status: "inactive", notes: "Substituído pela composição padrão FLOW Rev.03 V4"});
const masterItems: J[] = [];
for (const c of compositions) {
  const serviceId = serviceByCode.get(s(c.service_code))!;
  const compositionId = compByService.get(serviceId)!;
  for (const i of (Array.isArray(c.items) ? c.items as J[] : [])) {
    masterItems.push({company_id: COMPANY_ID, composition_id: compositionId, input_id: inputByCode.get(s(i.input_code)), coefficient: n(i.coefficient), waste_percentage: n(i.waste_percentage), sort_order: n(i.sort_order), notes: s(i.notes) || null, status: "active"});
  }
}
await upsert("engineering_service_composition_items", masterItems, "composition_id,input_id");

const pricesByCode = new Map<string, {price: number; source: string}>();
for (const i of compItems) {
  const code = s(i.input_code), price = n(i.unit_price);
  if (price <= 0) continue;
  const old = pricesByCode.get(code);
  if (old && Math.abs(old.price - price) > 0.02) throw new Error(`Preço conflitante para ${code}: ${old.price} x ${price}`);
  pricesByCode.set(code, {price, source: s(i.price_source) || "Orçamento FLOW"});
}
const pricedIds = [...pricesByCode.keys()].map(c => inputByCode.get(c)!).filter(Boolean);
if (pricedIds.length) {
  await patch("engineering_input_prices", {company_id: `eq.${COMPANY_ID}`, project_id: `eq.${PROJECT_ID}`, input_id: inFilter(pricedIds), is_adopted: "eq.true", status: "eq.active"}, {is_adopted: false});
  await post("engineering_input_prices", [...pricesByCode.entries()].map(([code, p]) => ({company_id: COMPANY_ID, project_id: PROJECT_ID, input_id: inputByCode.get(code), price_date: s(budget.reference_date) || "2026-08-20", unit_price: p.price, freight_unit_cost: 0, other_unit_cost: 0, discount_percentage: 0, currency: "BRL", is_adopted: true, source: p.source, notes: "Preço adotado na revisão FLOW Rev.03 V4", status: "active"})));
}

const oldTargets = await get("engineering_budgets", {select: "id,is_base", company_id: `eq.${COMPANY_ID}`, project_id: `eq.${PROJECT_ID}`, code: `eq.${TARGET_CODE}`, version: `eq.${s(budget.version)}`, limit: "5"});
for (const old of oldTargets) {
  if (old.is_base) throw new Error("FLOW-REV03-V4 existente está marcado como base; abortado por segurança");
  await remove("engineering_budgets", {id: `eq.${String(old.id)}`});
}
const createdBudget = await post("engineering_budgets", [{company_id: COMPANY_ID, project_id: PROJECT_ID, code: TARGET_CODE, name: s(budget.name), version: s(budget.version), status: "review", reference_date: s(budget.reference_date), area_m2: 0, bdi_percentage: 0, notes: `Orçamento oficial FLOW Rev.03 V4. Total-alvo R$ ${targetTotal.toFixed(2)}.`, source_system: "elos_os", source_id: "flow-rev03-v4-2026-08-20"}]);
const budgetId = String(createdBudget[0]?.id ?? "");
if (!budgetId) throw new Error("Falha ao criar orçamento FLOW-REV03-V4");

const groupRows = await post("engineering_budget_groups", groups.map(g => ({company_id: COMPANY_ID, project_id: PROJECT_ID, budget_id: budgetId, code: s(g.code), name: s(g.name), sort_order: n(g.sort), notes: `Subtotal oficial: ${n(g.total).toFixed(6)}`, status: "active"})));
const groupByCode = new Map(groupRows.map(g => [s(g.code), String(g.id)]));
if (groupByCode.size !== 34) throw new Error(`Grupos criados: ${groupByCode.size}/34`);

function costs(r: J) {
  const unit = n(r.unit_cost), nature = s(r.nature).toLowerCase();
  if (nature.includes("material")) return {material_unit_cost: unit, labor_unit_cost: 0, equipment_unit_cost: 0, other_unit_cost: 0};
  if (nature.includes("mão") || nature.includes("mao") || nature.includes("labor")) return {material_unit_cost: 0, labor_unit_cost: unit, equipment_unit_cost: 0, other_unit_cost: 0};
  if (nature.includes("equip")) return {material_unit_cost: 0, labor_unit_cost: 0, equipment_unit_cost: unit, other_unit_cost: 0};
  return {material_unit_cost: 0, labor_unit_cost: 0, equipment_unit_cost: 0, other_unit_cost: unit};
}
const payload: J[] = budgetItems.map(r => ({company_id: COMPANY_ID, project_id: PROJECT_ID, budget_id: budgetId, group_id: groupByCode.get(s(r.group)) || null, code: s(r.code), description: s(r.description), unit: s(r.unit) || "un", quantity: n(r.quantity), ...costs(r), sort_order: n(r.sort_order), notes: `FLOW Rev.03 V4 · linha ${s(r.source_line) || "-"}${s(r.parent) ? ` · pai ${s(r.parent)}` : ""}${s(r.status) === "inactive" ? " · referência fora do subtotal oficial" : ""}`, status: s(r.status) || "active", service_id: serviceByCode.get(s(r.code)) || null}));
for (const a of adjustments) payload.push({company_id: COMPANY_ID, project_id: PROJECT_ID, budget_id: budgetId, group_id: groupByCode.get(s(a.group)) || null, code: s(a.code), description: s(a.description), unit: s(a.unit) || "vb", quantity: n(a.quantity), material_unit_cost: 0, labor_unit_cost: 0, equipment_unit_cost: 0, other_unit_cost: n(a.unit_cost), sort_order: n(a.sort_order), notes: s(a.notes), status: "active", service_id: null});
await post("engineering_budget_items", payload);

const target = await snapshot(TARGET_CODE);
const koperAfter = await snapshot("KOPER-100");
const createdItems = await get("engineering_budget_items", {select: "id,code,status,total_direct_cost", budget_id: `eq.${budgetId}`, limit: "2000"});
const activeCreated = createdItems.filter(r => s(r.status) === "active");
const inactiveCreated = createdItems.filter(r => s(r.status) !== "active");
const finalTotal = activeCreated.reduce((a, r) => a + n(r.total_direct_cost), 0);
const activeMasterItems = await get("engineering_service_composition_items", {select: "id,composition_id,status", composition_id: inFilter(compIds), status: "eq.active", limit: "2000"});
const ok = target.id === budgetId && activeCreated.length === 156 && inactiveCreated.length === 11 && Math.abs(finalTotal - targetTotal) < 0.02 && koperAfter.id === koperBefore.id && koperAfter.count === koperBefore.count && Math.abs(koperAfter.total - koperBefore.total) < 0.02 && activeMasterItems.length === masterItems.length;
console.log("FLOW_IMPORT_RESULT", JSON.stringify({ok, budgetId, targetTotal, finalTotal, activeItems: activeCreated.length, inactiveItems: inactiveCreated.length, groups: groupRows.length, servicesResolved: serviceByCode.size, inputsResolved: inputByCode.size, serviceCompositions: compRows.length, compositionItems: activeMasterItems.length, adoptedProjectPrices: pricesByCode.size, koperBefore, koperAfter}));
if (!ok) throw new Error("Verificação pós-carga do FLOW falhou; consulte FLOW_IMPORT_RESULT");
