import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";

type Row = Record<string, unknown>;

const PROJECT_ID = "ffe8b7ec-1f01-4f6c-8a03-2bd6d3ae94fc";
const COMPANY_ID = env.BOSSA_COMPANY_ID;
const WRITE = process.env.KOPER_APPROPRIATION_REMAP_WRITE_ENABLED === "true";

const normalize = (value: unknown): string => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const s = (value: unknown): string => String(value ?? "").trim();
const n = (value: unknown): number => typeof value === "number" ? value : Number(value ?? 0);
const q = (params: Record<string, string>) => new URLSearchParams(params);

async function selectAll(resource: string, params: Record<string, string>): Promise<Row[]> {
  const out: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await requestSupabase<Row[]>(resource, {
      query: q({ ...params, limit: "1000", offset: String(offset) }),
      timeoutMs: 120_000,
    });
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function patch(resource: string, params: Record<string, string>, body: Row): Promise<void> {
  await requestSupabase(resource, {
    method: "PATCH",
    query: q(params),
    body,
    prefer: "return=minimal",
    timeoutMs: 120_000,
  });
}

async function inChunks<T>(rows: T[], size: number, fn: (row: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await Promise.all(rows.slice(i, i + size).map(fn));
  }
}

// Casos em que o orçamento novo consolidou/renomeou a apropriação antiga do Koper.
const MANUAL_TARGET_BY_KOPER_ITEM_CODE: Record<string, string> = {
  "1.1": "01.10",
  "1.2": "01.21",
  "1.4": "01.14",
  "1.5": "01.15",
  "1.9": "01.32",
  "2.1.1": "03.10",
  "2.1.2": "03.10",
  "2.2.1": "03.16",
  "2.2.3": "03.16.06",
  "3.1": "02.01",
  "3.2": "02.02",
  "3.3": "02.08",
  "4.5": "04.04",
  "5.1.1": "05.18",
  "6.1": "06.01",
  "6.3": "06.05",
  "7.2": "07.02",
  "8.2": "08.02",
  "9.1": "09.02",
  "9.2": "09.03",
  "11.1": "11.01",
  "12.1": "12.03",
  "12.3": "12.14",
  "14.2": "14.03",
  "14.4": "14.04",
  "14.9": "14.18",
  "15.1": "15.01",
  "15.2": "15.02",
  "15.4": "15.05",
  "15.5": "15.06",
  "15.6": "15.07",
  "16.1": "16.03",
  "16.2": "16.05",
  "17.1": "17.08",
  "18.2": "18.02",
  "19.1": "19.03",
  "19.2": "19.04",
  "19.3": "19.05",
  "19.4": "19.06",
  "20.1": "20.01",
  "22.1": "22.02",
  "24.2": "24.04",
  "25.1": "26.03",
  "25.3": "06.01",
  "25.4": "04.14",
  "25.5": "08.01",
  "25.6": "06.02",
  "26.6": "26.21",
  "28.1": "FLOW.S3071",
};

const budgets = await selectAll("engineering_budgets", {
  select: "id,code,status",
  company_id: `eq.${COMPANY_ID}`,
  project_id: `eq.${PROJECT_ID}`,
  code: "in.(KOPER-100,FLOW-REV03-V4)",
});
const koperBudget = budgets.find((row) => s(row.code) === "KOPER-100");
const flowBudget = budgets.find((row) => s(row.code) === "FLOW-REV03-V4");
if (!koperBudget?.id || !flowBudget?.id) throw new Error("Orçamentos KOPER-100/FLOW-REV03-V4 não encontrados");

const koperItems = await selectAll("engineering_budget_items", {
  select: "id,service_id,code,description,status,total_direct_cost",
  budget_id: `eq.${s(koperBudget.id)}`,
  status: "eq.active",
});
if (koperItems.length !== 108) throw new Error(`KOPER-100 deveria ter 108 itens ativos; encontrado ${koperItems.length}`);

const flowItems = await selectAll("engineering_budget_items", {
  select: "id,service_id,code,description,status,total_direct_cost",
  budget_id: `eq.${s(flowBudget.id)}`,
});
const services = await selectAll("engineering_services", {
  select: "id,code,description,status,source_system,source_id",
  company_id: `eq.${COMPANY_ID}`,
  status: "eq.active",
});
const allocations = await selectAll("payable_cost_allocations", {
  select: "id,service_id,budget_item_id,wbs_code_snapshot,service_name_snapshot,allocation_amount,source_system,source_id",
  company_id: `eq.${COMPANY_ID}`,
  project_id: `eq.${PROJECT_ID}`,
  source_system: "eq.koper_native_resolution",
});

const serviceById = new Map(services.map((row) => [s(row.id), row]));
const currentServices = services.filter((row) => s(row.source_system) === "elos_os");
const currentByCode = new Map<string, Row>();
const currentByName = new Map<string, Row[]>();
for (const row of currentServices) {
  const code = s(row.code);
  if (currentByCode.has(code)) throw new Error(`Código atual duplicado: ${code}`);
  currentByCode.set(code, row);
  const key = normalize(row.description);
  currentByName.set(key, [...(currentByName.get(key) ?? []), row]);
}

const activeFlowItemByService = new Map<string, Row>();
for (const row of flowItems.filter((item) => s(item.status) === "active" && item.service_id)) {
  const key = s(row.service_id);
  if (activeFlowItemByService.has(key)) throw new Error(`Mais de um item FLOW ativo para service_id ${key}`);
  activeFlowItemByService.set(key, row);
}

const mappings: Array<{
  koperItemId: string;
  koperItemCode: string;
  koperItemDescription: string;
  oldServiceId: string;
  oldServiceCode: string;
  oldServiceName: string;
  targetServiceId: string;
  targetServiceCode: string;
  targetServiceName: string;
  targetBudgetItemId: string | null;
  targetBudgetItemStatus: string | null;
  method: "exact_name" | "manual_equivalence";
  itemTotal: number;
}> = [];

for (const item of koperItems) {
  const oldServiceId = s(item.service_id);
  const oldService = serviceById.get(oldServiceId);
  if (!oldService) throw new Error(`Serviço Koper não encontrado para item ${s(item.code)}`);
  const koperItemCode = s(item.code);
  const manualTargetCode = MANUAL_TARGET_BY_KOPER_ITEM_CODE[koperItemCode];
  let target: Row | undefined;
  let method: "exact_name" | "manual_equivalence";
  if (manualTargetCode) {
    target = currentByCode.get(manualTargetCode);
    method = "manual_equivalence";
  } else {
    const candidates = currentByName.get(normalize(oldService.description)) ?? [];
    if (candidates.length !== 1) {
      throw new Error(`De/para não resolvido para ${koperItemCode} · ${s(oldService.description)} · candidatos=${candidates.length}`);
    }
    target = candidates[0];
    method = "exact_name";
  }
  if (!target?.id) throw new Error(`Destino atual não encontrado para item ${koperItemCode} (${manualTargetCode ?? s(oldService.description)})`);
  const targetServiceId = s(target.id);
  const activeBudgetItem = activeFlowItemByService.get(targetServiceId);
  mappings.push({
    koperItemId: s(item.id),
    koperItemCode,
    koperItemDescription: s(item.description),
    oldServiceId,
    oldServiceCode: s(oldService.code),
    oldServiceName: s(oldService.description),
    targetServiceId,
    targetServiceCode: s(target.code),
    targetServiceName: s(target.code) === "07.02" ? "Sistema de Exaustão Mecânica" : s(target.description),
    targetBudgetItemId: activeBudgetItem?.id ? s(activeBudgetItem.id) : null,
    targetBudgetItemStatus: activeBudgetItem ? s(activeBudgetItem.status) : null,
    method,
    itemTotal: n(item.total_direct_cost),
  });
}

if (mappings.length !== 108) throw new Error(`Mapa incompleto: ${mappings.length}/108`);
const exactCount = mappings.filter((row) => row.method === "exact_name").length;
const manualCount = mappings.filter((row) => row.method === "manual_equivalence").length;
if (exactCount !== 59 || manualCount !== 49) throw new Error(`Contagem de métodos divergente: exato=${exactCount}, manual=${manualCount}`);

const oldToTarget = new Map(mappings.map((row) => [row.oldServiceId, row]));
const allocationsToChange = allocations.filter((row) => oldToTarget.has(s(row.service_id)));
const allocationAmountBefore = allocations.reduce((sum, row) => sum + n(row.allocation_amount), 0);
const affectedAllocationAmount = allocationsToChange.reduce((sum, row) => sum + n(row.allocation_amount), 0);
const koperTotalBefore = koperItems.reduce((sum, row) => sum + n(row.total_direct_cost), 0);
const flowTotalBefore = flowItems.filter((row) => s(row.status) === "active").reduce((sum, row) => sum + n(row.total_direct_cost), 0);

if (!WRITE) {
  console.log("KOPER_APPROPRIATION_REMAP_DRY_RUN", JSON.stringify({
    ok: true,
    mappings: mappings.length,
    exactName: exactCount,
    manualEquivalence: manualCount,
    allocationsTotal: allocations.length,
    allocationsAffected: allocationsToChange.length,
    allocationAmountBefore,
    affectedAllocationAmount,
    koperTotalBefore,
    flowTotalBefore,
    targetsWithoutActiveFlowItem: mappings.filter((row) => !row.targetBudgetItemId).map((row) => ({koperItemCode: row.koperItemCode, targetServiceCode: row.targetServiceCode, targetServiceName: row.targetServiceName})),
    special: {
      exaustao: mappings.find((row) => row.koperItemCode === "7.2"),
      maoObraPropria: mappings.find((row) => row.koperItemCode === "25.1"),
    },
  }));
  process.exit(0);
}

// Corrige a descrição truncada do serviço 07.02, confirmada pelo valor de R$ 150.000 no FLOW e no Koper.
const exhaustTarget = currentByCode.get("07.02");
if (!exhaustTarget?.id) throw new Error("Serviço 07.02 não encontrado");
await patch("engineering_services", { id: `eq.${s(exhaustTarget.id)}` }, { description: "Sistema de Exaustão Mecânica" });
await patch("engineering_budget_items", { budget_id: `eq.${s(flowBudget.id)}`, code: "eq.07.02" }, { description: "SISTEMA DE EXAUSTÃO MECÂNICA" });

// Atualiza apenas o vínculo de apropriação dos 108 itens Koper. Códigos, descrições, grupos, quantidades e valores ficam intactos.
await inChunks(mappings, 20, async (mapping) => {
  await patch("engineering_budget_items", { id: `eq.${mapping.koperItemId}` }, { service_id: mapping.targetServiceId });
});

// Propaga o mesmo de/para aos rateios financeiros já promovidos do Koper.
// O histórico de valor/source_id/evidence não é alterado.
await inChunks(mappings, 12, async (mapping) => {
  await patch("payable_cost_allocations", {
    company_id: `eq.${COMPANY_ID}`,
    project_id: `eq.${PROJECT_ID}`,
    source_system: "eq.koper_native_resolution",
    service_id: `eq.${mapping.oldServiceId}`,
  }, {
    service_id: mapping.targetServiceId,
    budget_item_id: mapping.targetBudgetItemId,
    wbs_code_snapshot: mapping.targetServiceCode,
    service_name_snapshot: mapping.targetServiceName,
  });
});

// Auditoria pós-escrita.
const koperAfter = await selectAll("engineering_budget_items", {
  select: "id,service_id,code,total_direct_cost,status",
  budget_id: `eq.${s(koperBudget.id)}`,
  status: "eq.active",
});
const allocationsAfter = await selectAll("payable_cost_allocations", {
  select: "id,service_id,budget_item_id,wbs_code_snapshot,service_name_snapshot,allocation_amount,source_system,source_id",
  company_id: `eq.${COMPANY_ID}`,
  project_id: `eq.${PROJECT_ID}`,
  source_system: "eq.koper_native_resolution",
});
const flowAfter = await selectAll("engineering_budget_items", {
  select: "id,code,description,status,total_direct_cost,service_id",
  budget_id: `eq.${s(flowBudget.id)}`,
});
const oldIds = new Set(mappings.map((row) => row.oldServiceId));
const targetIds = new Set(mappings.map((row) => row.targetServiceId));
const koperCurrentMapped = koperAfter.filter((row) => targetIds.has(s(row.service_id))).length;
const allocationsStillOld = allocationsAfter.filter((row) => oldIds.has(s(row.service_id))).length;
const allocationAmountAfter = allocationsAfter.reduce((sum, row) => sum + n(row.allocation_amount), 0);
const koperTotalAfter = koperAfter.reduce((sum, row) => sum + n(row.total_direct_cost), 0);
const flowTotalAfter = flowAfter.filter((row) => s(row.status) === "active").reduce((sum, row) => sum + n(row.total_direct_cost), 0);
const exhaustAfter = flowAfter.find((row) => s(row.code) === "07.02");

if (koperAfter.length !== 108 || Math.abs(koperTotalAfter - koperTotalBefore) > 0.001) throw new Error("KOPER-100 alterou contagem ou valor durante o de/para");
if (Math.abs(flowTotalAfter - flowTotalBefore) > 0.001) throw new Error("FLOW alterou valor durante o de/para");
if (Math.abs(allocationAmountAfter - allocationAmountBefore) > 0.001) throw new Error("Total dos rateios mudou durante o de/para");
if (koperCurrentMapped !== 108) throw new Error(`Nem todos os itens Koper apontam para o catálogo atual: ${koperCurrentMapped}/108`);
if (allocationsStillOld !== 0) throw new Error(`Ainda existem ${allocationsStillOld} rateios apontando para IDs antigos mapeados`);
if (s(exhaustAfter?.description) !== "SISTEMA DE EXAUSTÃO MECÂNICA") throw new Error("Descrição 07.02 não foi corrigida");

console.log("KOPER_APPROPRIATION_REMAP_RESULT", JSON.stringify({
  ok: true,
  mappings: mappings.length,
  exactName: exactCount,
  manualEquivalence: manualCount,
  koperItems: koperAfter.length,
  koperItemsMappedToCurrent: koperCurrentMapped,
  koperTotalBefore,
  koperTotalAfter,
  flowTotalBefore,
  flowTotalAfter,
  allocations: allocationsAfter.length,
  allocationsChanged: allocationsToChange.length,
  allocationsStillOld,
  allocationAmountBefore,
  allocationAmountAfter,
  exhaust07_02: { description: exhaustAfter?.description, total: exhaustAfter?.total_direct_cost },
}));
