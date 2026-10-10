/**
 * Inspeção (somente leitura) da base usada para apropriar títulos por serviço no Elos OS.
 *
 * Responde, sem gravar nada:
 *   - que obras, orçamentos, itens e serviços (centros de custo) existem no Elos OS;
 *   - como estão gravados os rateios (`payable_cost_allocations`) e os títulos por origem;
 *   - que estrutura a staging `mirror.*` traz para orçamento / acompanhamento do Koper;
 *   - quantos serviços do Koper citados na cadeia já existem no catálogo do Elos OS.
 *
 *   node dist/inspect-elos-allocation-base.js
 *   KOPER_INSPECT_COMPANIES=alma,bossa   (padrão: alma,bossa)
 */
import { pathToFileURL } from "node:url";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { collectByKeys, fieldPaths } from "./audit-mirror-appropriation-chain.js";

type Json = Record<string, unknown>;
type Requester = typeof requestSupabase;

const asObject = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const cents = (value: unknown): number => Math.round(Number(value ?? 0) * 100);
const money = (value: number): number => Math.round(value) / 100;
const short = (value: unknown, size = 60): string => String(value ?? "").slice(0, size);

async function all<T>(request: Requester, table: string, query: Record<string, string>, maxPages = 60): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await request<T[]>(table, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(page * 1000) }),
      timeoutMs: 60_000,
    });
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function safe<T>(label: string, task: () => Promise<T>): Promise<T | null> {
  try {
    return await task();
  } catch (error: unknown) {
    console.log("KOPER_INSPECT_ERROR", JSON.stringify({ label, message: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) }));
    return null;
  }
}

type Bucket = { count: number; cents: number };
function group<T>(rows: T[], key: (row: T) => string, value: (row: T) => number = () => 0) {
  const map = new Map<string, Bucket>();
  for (const row of rows) {
    const bucket = map.get(key(row)) ?? { count: 0, cents: 0 };
    bucket.count += 1;
    bucket.cents += value(row);
    map.set(key(row), bucket);
  }
  return Object.fromEntries([...map].sort((a, b) => b[1].count - a[1].count).map(([name, bucket]) => [name, { count: bucket.count, total: money(bucket.cents) }]));
}

async function stage(request: Requester, entity: string, company: string): Promise<Map<string, Json>> {
  const out = new Map<string, Json>();
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const rows = await request<Array<{ koper_id: string; payload: Json }>>("koper_staging_records", {
      query: new URLSearchParams({
        select: "koper_id,payload",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: `eq.${entity}`,
        koper_id: `like.${company}:*`,
        sync_state: "eq.present",
        order: "koper_id.asc",
        limit: String(pageSize),
        offset: String(offset),
      }),
      timeoutMs: 110_000,
    });
    for (const row of rows) out.set(row.koper_id.slice(company.length + 1), asObject(asObject(row.payload).data));
    if (rows.length < pageSize) return out;
  }
}

/** Para cada lista dentro do registro: tamanho e campos do primeiro elemento. */
function arraysOf(row: Json, limit = 45): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(row)) {
    if (Array.isArray(value)) out[key] = { length: value.length, fields: [...fieldPaths(value)].slice(0, limit) };
  }
  return out;
}

const scalars = (row: Json, size = 50): Json =>
  Object.fromEntries(Object.entries(row).filter(([, value]) => typeof value !== "object" || value === null).map(([key, value]) => [key, typeof value === "string" ? short(value, size) : value]));

function firstFilled(map: Map<string, Json>, pick: (row: Json) => unknown): string[] {
  for (const row of map.values()) {
    const value = pick(row);
    if (Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== "") return [...fieldPaths(value)].slice(0, 70);
  }
  return [];
}

export async function inspectElos(request: Requester = requestSupabase) {
  const company = `eq.${env.BOSSA_COMPANY_ID}`;

  const projects = await all<Json>(request, "projects", { select: "id,name,code,status", company_id: company, order: "created_at.asc" });
  const projectName = new Map(projects.map((project) => [String(project.id), String(project.name)]));
  const pname = (id: unknown) => projectName.get(String(id)) ?? String(id);
  console.log("KOPER_INSPECT_PROJECTS", JSON.stringify(projects));

  const budgets = await safe("budgets", () => all<Json>(request, "engineering_budgets", { select: "*", company_id: company, order: "created_at.asc" }));
  console.log("KOPER_INSPECT_BUDGETS", JSON.stringify((budgets ?? []).map((budget) => ({ ...scalars(budget, 40), project: pname(budget.project_id) }))));

  const itemSample = await safe("budget item columns", () => request<Json[]>("engineering_budget_items", { query: new URLSearchParams({ select: "*", company_id: company, limit: "2" }) }));
  console.log("KOPER_INSPECT_BUDGET_ITEM_COLUMNS", JSON.stringify({ columns: Object.keys(itemSample?.[0] ?? {}), sample: (itemSample ?? []).map((row) => scalars(row, 50)) }));
  const items = await safe("budget items", () => all<Json>(request, "engineering_budget_items", { select: "id,budget_id,project_id,service_id,code,description,total_direct_cost,status", company_id: company, order: "id.asc" })) ?? [];
  const byBudget = new Map<string, { items: number; withService: number; services: Set<string>; cents: number }>();
  for (const item of items) {
    const entry = byBudget.get(String(item.budget_id)) ?? { items: 0, withService: 0, services: new Set<string>(), cents: 0 };
    entry.items += 1;
    if (item.service_id) { entry.withService += 1; entry.services.add(String(item.service_id)); }
    entry.cents += cents(item.total_direct_cost);
    byBudget.set(String(item.budget_id), entry);
  }
  console.log("KOPER_INSPECT_BUDGET_ITEMS", JSON.stringify({
    total: items.length,
    byBudget: Object.fromEntries([...byBudget].map(([id, entry]) => [id, { items: entry.items, withService: entry.withService, distinctServices: entry.services.size, total: money(entry.cents) }])),
    sample: items.slice(0, 6).map((item) => ({ code: item.code, description: short(item.description), service_id: item.service_id, total: item.total_direct_cost })),
  }));

  const serviceColumns = await safe("service columns", () => request<Json[]>("engineering_services", { query: new URLSearchParams({ select: "*", company_id: company, limit: "1" }) }));
  const services = await safe("services", () => all<Json>(request, "engineering_services", { select: "id,code,description,unit,group_code,source_system,source_id,status", company_id: company, order: "code.asc" })) ?? [];
  console.log("KOPER_INSPECT_SERVICES", JSON.stringify({
    columns: Object.keys(serviceColumns?.[0] ?? {}),
    total: services.length,
    bySource: group(services, (service) => `${service.source_system}|sourceId:${service.source_id ? (/^\d+$/.test(String(service.source_id)) ? "numérico" : "texto") : "vazio"}|${service.status}`),
    sample: [...services.slice(0, 6), ...services.slice(-4)].map((service) => ({ code: service.code, description: short(service.description, 45), unit: service.unit, group: service.group_code, source: service.source_system, source_id: service.source_id })),
  }));

  const allocations = await safe("allocations", () => all<Json>(request, "payable_cost_allocations", { select: "id,project_id,payable_id,service_id,budget_item_id,wbs_code_snapshot,allocation_amount,resolution_method,source_system,source_id", company_id: company, order: "id.asc" })) ?? [];
  console.log("KOPER_INSPECT_ALLOCATIONS", JSON.stringify({
    total: allocations.length,
    payables: new Set(allocations.map((row) => row.payable_id)).size,
    byProjectSourceMethod: group(allocations, (row) => `${pname(row.project_id)}|${row.source_system}|${row.resolution_method}`, (row) => cents(row.allocation_amount)),
    targets: group(allocations, (row) => `service:${row.service_id ? "sim" : "não"}|item:${row.budget_item_id ? "sim" : "não"}|wbs:${row.wbs_code_snapshot ? "sim" : "não"}`, (row) => cents(row.allocation_amount)),
    sourceIdShapes: group(allocations, (row) => String(row.source_id ?? "").replace(/\d+/g, "N")),
  }));
  const allocationSample = await safe("allocation sample", () => request<Json[]>("payable_cost_allocations", { query: new URLSearchParams({ select: "*", company_id: company, source_system: "eq.koper_native_resolution", limit: "3" }) }));
  console.log("KOPER_INSPECT_ALLOCATION_SAMPLE", JSON.stringify((allocationSample ?? []).map((row) => ({ ...scalars(row, 60), evidence: JSON.stringify(row.evidence).slice(0, 700) }))));

  const payables = await safe("payables", () => all<Json>(request, "payables", { select: "id,project_id,source_system,status,amount", company_id: company, order: "id.asc" })) ?? [];
  const allocatedPayables = new Set(allocations.map((row) => String(row.payable_id)));
  console.log("KOPER_INSPECT_PAYABLES", JSON.stringify({
    total: payables.length,
    byProjectSourceStatus: group(payables, (row) => `${pname(row.project_id)}|${row.source_system}|${row.status}`, (row) => cents(row.amount)),
    withAllocation: group(payables.filter((row) => allocatedPayables.has(String(row.id))), (row) => `${pname(row.project_id)}|${row.source_system}`, (row) => cents(row.amount)),
  }));

  const mappings = await safe("mappings", () => all<Json>(request, "engineering_cost_center_mappings", { select: "project_id,source_system,source_code,source_name,service_id", company_id: company, order: "source_code.asc" })) ?? [];
  console.log("KOPER_INSPECT_MAPPINGS", JSON.stringify({
    total: mappings.length,
    byProjectSource: group(mappings, (row) => `${pname(row.project_id)}|${row.source_system}|código:${/^\d+$/.test(String(row.source_code)) ? "numérico" : "texto"}`),
    sample: mappings.slice(0, 5).map((row) => ({ code: row.source_code, name: short(row.source_name, 40) })),
  }));

  const legacy = await safe("legacy entities", () => all<Json>(request, "koper_staging_records", { select: "entity,sync_state", company_id: company, source: "eq.koper", entity: "not.like.mirror.*", order: "id.asc" }, 150)) ?? [];
  console.log("KOPER_INSPECT_LEGACY_STAGING", JSON.stringify({ rowsRead: legacy.length, byEntity: group(legacy, (row) => `${row.entity}|${row.sync_state}`) }));

  const koperServiceBySource = new Map(services.filter((service) => service.source_id).map((service) => [String(service.source_id), service]));
  const serviceByCode = new Map(services.map((service) => [String(service.code).trim().toLowerCase(), service]));

  const wanted = (process.env.KOPER_INSPECT_COMPANIES ?? "alma,bossa").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  for (const koperCompany of wanted) {
    const monitoringList = await stage(request, "mirror.building_monitoring", koperCompany);
    const monitoringDetail = await stage(request, "mirror.building_monitoring_detail", koperCompany);
    const monitoringItems = await stage(request, "mirror.monitoring_items", koperCompany);
    const budgetList = await stage(request, "mirror.construction_budget", koperCompany);
    const budgetDetail = await stage(request, "mirror.construction_budget_detail", koperCompany);
    const budgetItems = await stage(request, "mirror.construction_budget_items", koperCompany);
    console.log("KOPER_INSPECT_KOPER_ENGINEERING", JSON.stringify({
      company: koperCompany,
      monitorings: [...monitoringList].map(([id, row]) => ({ id, ...scalars(row, 40) })).slice(0, 12),
      budgets: [...budgetList].map(([id, row]) => ({ id, ...scalars(row, 40) })).slice(0, 12),
    }).slice(0, 9000));
    for (const [id, row] of monitoringItems) {
      const arrays = arraysOf(row);
      console.log("KOPER_INSPECT_MONITORING_ITEMS", JSON.stringify({ company: koperCompany, id, top: scalars(row, 40), arrays }).slice(0, 9000));
      for (const [key, value] of Object.entries(row)) {
        if (!Array.isArray(value) || value.length === 0) continue;
        const sample = value.slice(0, 3).map((item) => JSON.stringify(scalars(asObject(item), 45)).slice(0, 900));
        const depth = group(value.map(asObject), (item) => `nível:${String(item.itemReference ?? item.reference ?? "").split(".").length}|serviço:${item.serviceId ? "sim" : "não"}`);
        console.log("KOPER_INSPECT_MONITORING_SAMPLE", JSON.stringify({ company: koperCompany, id, list: key, length: value.length, depth, sample }).slice(0, 9000));
      }
    }
    for (const [id, row] of budgetItems) {
      console.log("KOPER_INSPECT_BUDGET_ITEMS_KOPER", JSON.stringify({ company: koperCompany, id, top: scalars(row, 40), arrays: arraysOf(row) }).slice(0, 9000));
      for (const [key, value] of Object.entries(row)) {
        if (!Array.isArray(value) || value.length === 0) continue;
        console.log("KOPER_INSPECT_BUDGET_ITEMS_KOPER_SAMPLE", JSON.stringify({ company: koperCompany, id, list: key, length: value.length, sample: value.slice(0, 3).map((item) => JSON.stringify(scalars(asObject(item), 45)).slice(0, 900)) }).slice(0, 9000));
      }
    }
    console.log("KOPER_INSPECT_DETAIL_SHAPES", JSON.stringify({
      company: koperCompany,
      monitoringDetail: firstFilled(monitoringDetail, (row) => row),
      budgetDetail: firstFilled(budgetDetail, (row) => row),
    }).slice(0, 9000));

    const requests = await stage(request, "mirror.stock_request_detail", koperCompany);
    const purchases = await stage(request, "mirror.purchase_detail", koperCompany);
    const receipts = await stage(request, "mirror.receipt", koperCompany);
    const invoices = await stage(request, "mirror.xml_invoice", koperCompany);
    const purchaseOrders = await stage(request, "mirror.purchase_order_detail", koperCompany);
    const serviceOrders = await stage(request, "mirror.service_order_detail", koperCompany);
    const contracts = await stage(request, "mirror.engineering_contract_detail", koperCompany);
    console.log("KOPER_INSPECT_CHAIN_SHAPES", JSON.stringify({
      company: koperCompany,
      requestTop: firstFilled(requests, (row) => ({ ...row, products: undefined })),
      requestProducts: firstFilled(requests, (row) => row.products),
      requestProductServices: firstFilled(requests, (row) => asArray(row.products).flatMap((product) => asArray(asObject(product).services))),
      purchaseTop: firstFilled(purchases, (row) => scalars(row)),
      purchaseServices: firstFilled(purchases, (row) => row.services),
      purchaseProducts: firstFilled(purchases, (row) => row.products),
    }).slice(0, 9000));
    console.log("KOPER_INSPECT_CHAIN_SHAPES_2", JSON.stringify({
      company: koperCompany,
      receiptTop: firstFilled(receipts, (row) => scalars(row)),
      receiptProducts: firstFilled(receipts, (row) => row.products),
      receiptServices: firstFilled(receipts, (row) => row.services),
      invoiceTop: firstFilled(invoices, (row) => scalars(row)),
      invoiceProducts: firstFilled(invoices, (row) => row.products),
      purchaseOrderProducts: firstFilled(purchaseOrders, (row) => row.products),
    }).slice(0, 9000));

    // Serviços do Koper citados na cadeia × catálogo do Elos OS.
    const cited = new Map<string, string>();
    const remember = (value: unknown) => {
      for (const item of asArray(value)) {
        const row = asObject(item);
        const id = row.serviceId === null || row.serviceId === undefined ? "" : String(row.serviceId);
        if (id && id !== "0" && !cited.has(id)) cited.set(id, short(row.serviceName ?? row.description ?? "", 45));
      }
    };
    for (const row of receipts.values()) remember(row.services);
    for (const row of purchases.values()) remember(row.services);
    for (const row of serviceOrders.values()) remember(row.services);
    for (const row of contracts.values()) remember(row.services);
    for (const row of requests.values()) for (const product of asArray(row.products)) remember(asObject(product).services);
    for (const row of monitoringItems.values()) for (const value of Object.values(row)) remember(value);
    const missing = [...cited].filter(([id]) => !koperServiceBySource.has(id));
    const inputIds = collectByKeys([...purchaseOrders.values(), ...requests.values()], new Set(["itemMonitInputId"]));
    console.log("KOPER_INSPECT_SERVICE_COVERAGE", JSON.stringify({
      company: koperCompany,
      citedServices: cited.size,
      foundBySourceId: cited.size - missing.length,
      missing: missing.length,
      missingAlsoNotByCode: missing.filter(([id]) => !serviceByCode.has(id)).length,
      foundSample: [...cited].filter(([id]) => koperServiceBySource.has(id)).slice(0, 6).map(([id, name]) => ({ id, koper: name, elos: short(koperServiceBySource.get(id)?.description, 45), elosCode: koperServiceBySource.get(id)?.code })),
      missingSample: missing.slice(0, 10).map(([id, name]) => ({ id, name })),
      distinctItemMonitInputIds: inputIds.size,
    }).slice(0, 9000));
  }
  console.log("KOPER_INSPECT_DONE", JSON.stringify({ companies: wanted }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  inspectElos().catch((error: unknown) => {
    console.error("KOPER_INSPECT_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }));
    process.exitCode = 1;
  });
}
