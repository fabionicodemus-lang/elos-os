import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
import { checkKoperCompositionPromotionReadiness } from "./check-koper-composition-promotion-readiness.js";

type StagingRow = { koper_id: string; payload: unknown };
type CatalogRow = { id: string; source_id: string | null };
type CompositionRow = { id: string; service_id: string };
type CompositionItemRow = {
  id: string;
  composition_id: string;
  input_id: string;
  coefficient: number | string;
  notes: string | null;
  status: string;
};

function payloadObject(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identifier(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function readStaging(entity: "budget_input" | "budget_composition_detail"): Promise<StagingRow[]> {
  const rows: StagingRow[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await requestSupabase<StagingRow[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "koper_id,payload",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: `eq.${entity}`,
        sync_state: "eq.present",
        order: "koper_id.asc",
        limit: String(pageSize),
        offset: String(offset),
      }),
    });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function readCatalog(table: "engineering_inputs" | "engineering_services"): Promise<CatalogRow[]> {
  const rows: CatalogRow[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await requestSupabase<CatalogRow[]>(table, {
      query: new URLSearchParams({
        select: "id,source_id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper",
        limit: String(pageSize),
        offset: String(offset),
      }),
    });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function isLabor(payload: Record<string, unknown>): boolean {
  const type = normalize(text(payload.inputType) ?? "");
  const name = normalize(text(payload.inputName) ?? "");
  return type.includes("mao de obra") || name.includes("mao de obra");
}

export async function promoteKoperBudgetInputs(): Promise<{
  ok: true;
  stagedBudgetInputs: number;
  inserted: number;
  verifiedCatalogInputs: number;
}> {
  if (
    process.env.KOPER_ENGINEERING_INPUTS_WRITE_ENABLED !== "true"
    || process.env.KOPER_BUDGET_INPUT_PROMOTION_ENABLED !== "true"
  ) throw new Error("Koper budget input promotion is not explicitly enabled");

  const [staged, existing] = await Promise.all([
    readStaging("budget_input"),
    readCatalog("engineering_inputs"),
  ]);
  const existingIds = new Set(existing.map((row) => row.source_id).filter(Boolean));
  const missing = staged.filter((row) => !existingIds.has(row.koper_id));
  const now = new Date().toISOString();
  const payloads = missing.map((row) => {
    const payload = payloadObject(row.payload);
    const referenceCost = Math.max(0, numberValue(payload.inputRefValue) ?? 0);
    return {
      company_id: env.BOSSA_COMPANY_ID,
      code: `KOPER-${row.koper_id}`,
      description: text(payload.inputName) ?? `Insumo Koper ${row.koper_id}`,
      unit: (text(payload.inputUnit) ?? "un").toLocaleLowerCase("pt-BR"),
      category: isLabor(payload) ? "labor" : "material",
      family_code: "KOPER-BUDGET",
      family_label: "Insumos próprios do orçamento Koper",
      source_system: "koper",
      source_code: row.koper_id,
      source_id: row.koper_id,
      notes: `Criado no orçamento Koper 100 · custo de referência R$ ${referenceCost.toFixed(6)}`,
      status: "active",
      updated_at: now,
    };
  });

  let inserted = 0;
  for (const batch of chunks(payloads, 100)) {
    const rows = await requestSupabase<Array<{ id: string }>>("engineering_inputs", {
      method: "POST",
      body: batch,
      prefer: "resolution=merge-duplicates,return=representation",
      query: new URLSearchParams({
        on_conflict: "company_id,source_system,source_id",
        select: "id",
      }),
    });
    inserted += rows.length;
  }

  const verifiedCatalogInputs = (await readCatalog("engineering_inputs")).length;
  if (verifiedCatalogInputs !== existing.length + missing.length) {
    throw new Error("Koper budget input verification count does not match expected catalog total");
  }

  return { ok: true, stagedBudgetInputs: staged.length, inserted, verifiedCatalogInputs };
}

type DesiredItem = {
  compositionId: string;
  serviceSourceId: string;
  inputSourceId: string;
  coefficient: number;
  sortOrder: number;
  costValue: number | null;
};

function desiredItems(details: StagingRow[]): DesiredItem[] {
  return details.flatMap((row) => {
    const payload = payloadObject(row.payload);
    const compositionId = identifier(payload.compositionId) ?? row.koper_id;
    const serviceSourceId = identifier(payload.serviceId);
    if (!serviceSourceId) throw new Error(`Koper composition ${compositionId} has no service`);
    const items = Array.isArray(payload.items) ? payload.items : [];
    return items.map((value, sortOrder) => {
      const item = payloadObject(value);
      const inputSourceId = identifier(item.itemId);
      const coefficient = numberValue(item.coefficient);
      if (!inputSourceId || coefficient === null || coefficient <= 0) {
        throw new Error(`Koper composition ${compositionId} contains an invalid item`);
      }
      return {
        compositionId,
        serviceSourceId,
        inputSourceId,
        coefficient,
        sortOrder,
        costValue: numberValue(item.itemCostValue),
      };
    });
  });
}

function inFilter(values: string[]): string {
  return `in.(${values.join(",")})`;
}

export async function promoteKoperBudgetCompositions(): Promise<{
  ok: true;
  compositions: number;
  items: number;
  deactivatedAutomaticLaborItems: number;
  deactivatedStaleKoperItems: number;
  verifiedActiveKoperItems: number;
  verifiedActiveAutomaticLaborItems: number;
}> {
  if (
    process.env.KOPER_ENGINEERING_COMPOSITIONS_WRITE_ENABLED !== "true"
    || process.env.KOPER_COMPOSITION_PROMOTION_ENABLED !== "true"
  ) throw new Error("Koper composition promotion is not explicitly enabled");

  const readiness = await checkKoperCompositionPromotionReadiness();
  if (!readiness.ready) throw new Error("Koper composition promotion readiness failed");

  const [details, services, inputs] = await Promise.all([
    readStaging("budget_composition_detail"),
    readCatalog("engineering_services"),
    readCatalog("engineering_inputs"),
  ]);
  const sourceItems = desiredItems(details);
  const serviceIdBySource = new Map(services.map((row) => [row.source_id, row.id]));
  const inputIdBySource = new Map(inputs.map((row) => [row.source_id, row.id]));
  const now = new Date().toISOString();

  const compositionSources = details.map((row) => {
    const payload = payloadObject(row.payload);
    const sourceId = identifier(payload.compositionId) ?? row.koper_id;
    const serviceSourceId = identifier(payload.serviceId);
    const serviceId = serviceSourceId ? serviceIdBySource.get(serviceSourceId) : null;
    if (!serviceSourceId || !serviceId) throw new Error(`Service missing for Koper composition ${sourceId}`);
    return { sourceId, serviceSourceId, serviceId };
  });

  const promotedCompositions: CompositionRow[] = [];
  for (const batch of chunks(compositionSources, 100)) {
    const rows = await requestSupabase<CompositionRow[]>("engineering_service_compositions", {
      method: "POST",
      body: batch.map((source) => ({
        company_id: env.BOSSA_COMPANY_ID,
        service_id: source.serviceId,
        notes: `Importado do Koper · compositionId=${source.sourceId} · serviceId=${source.serviceSourceId}`,
        status: "active",
        updated_at: now,
      })),
      prefer: "resolution=merge-duplicates,return=representation",
      query: new URLSearchParams({
        on_conflict: "company_id,service_id",
        select: "id,service_id",
      }),
    });
    promotedCompositions.push(...rows);
  }
  const compositionIdByService = new Map(promotedCompositions.map((row) => [row.service_id, row.id]));
  const expectedKeys = new Set<string>();
  const itemPayloads = sourceItems.map((item) => {
    const serviceId = serviceIdBySource.get(item.serviceSourceId);
    const inputId = inputIdBySource.get(item.inputSourceId);
    const compositionId = serviceId ? compositionIdByService.get(serviceId) : null;
    if (!serviceId || !inputId || !compositionId) throw new Error("Koper composition mapping became incomplete");
    const key = `${compositionId}:${inputId}`;
    if (expectedKeys.has(key)) throw new Error(`Duplicate input ${item.inputSourceId} in composition ${item.compositionId}`);
    expectedKeys.add(key);
    return {
      company_id: env.BOSSA_COMPANY_ID,
      composition_id: compositionId,
      input_id: inputId,
      coefficient: item.coefficient,
      waste_percentage: 0,
      sort_order: item.sortOrder,
      notes: `Koper compositionId=${item.compositionId} · itemId=${item.inputSourceId} · itemCostValue=${item.costValue ?? "n/a"}`,
      status: "active",
      updated_at: now,
    };
  });

  for (const batch of chunks(itemPayloads, 100)) {
    await requestSupabase<Array<{ id: string }>>("engineering_service_composition_items", {
      method: "POST",
      body: batch,
      prefer: "resolution=merge-duplicates,return=representation",
      query: new URLSearchParams({
        on_conflict: "composition_id,input_id",
        select: "id",
      }),
    });
  }

  const compositionIds = promotedCompositions.map((row) => row.id);
  const allCurrentItems: CompositionItemRow[] = [];
  for (const batch of chunks(compositionIds, 20)) {
    const rows = await requestSupabase<CompositionItemRow[]>("engineering_service_composition_items", {
      query: new URLSearchParams({
        select: "id,composition_id,input_id,coefficient,notes,status",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        composition_id: inFilter(batch),
        limit: "1000",
      }),
    });
    allCurrentItems.push(...rows);
  }

  const staleKoperIds = allCurrentItems
    .filter((row) => row.status === "active" && row.notes?.startsWith("Koper compositionId=") && !expectedKeys.has(`${row.composition_id}:${row.input_id}`))
    .map((row) => row.id);
  let deactivatedStaleKoperItems = 0;
  for (const batch of chunks(staleKoperIds, 100)) {
    const rows = await requestSupabase<Array<{ id: string }>>("engineering_service_composition_items", {
      method: "PATCH",
      body: { status: "inactive", updated_at: now },
      prefer: "return=representation",
      query: new URLSearchParams({ id: inFilter(batch), select: "id" }),
    });
    deactivatedStaleKoperItems += rows.length;
  }

  const automaticInputs = await requestSupabase<Array<{ id: string }>>("engineering_inputs", {
    query: new URLSearchParams({
      select: "id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.elos_os",
      source_id: "like.outsourced-labor:*",
      limit: "1000",
    }),
  });
  const automaticInputIds = new Set(automaticInputs.map((row) => row.id));
  const automaticItemIds = allCurrentItems
    .filter((row) => row.status === "active" && automaticInputIds.has(row.input_id))
    .map((row) => row.id);
  let deactivatedAutomaticLaborItems = 0;
  for (const batch of chunks(automaticItemIds, 100)) {
    const rows = await requestSupabase<Array<{ id: string }>>("engineering_service_composition_items", {
      method: "PATCH",
      body: {
        status: "inactive",
        notes: "Empreitada automática desativada: composição exata importada do Koper",
        updated_at: now,
      },
      prefer: "return=representation",
      query: new URLSearchParams({ id: inFilter(batch), select: "id" }),
    });
    deactivatedAutomaticLaborItems += rows.length;
  }

  const verified: CompositionItemRow[] = [];
  for (const batch of chunks(compositionIds, 20)) {
    verified.push(...await requestSupabase<CompositionItemRow[]>("engineering_service_composition_items", {
      query: new URLSearchParams({
        select: "id,composition_id,input_id,coefficient,notes,status",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        composition_id: inFilter(batch),
        limit: "1000",
      }),
    }));
  }
  const verifiedKoper = verified.filter((row) => row.status === "active" && expectedKeys.has(`${row.composition_id}:${row.input_id}`));
  const verifiedActiveAutomaticLaborItems = verified.filter((row) => row.status === "active" && automaticInputIds.has(row.input_id)).length;
  if (verifiedKoper.length !== itemPayloads.length || verifiedActiveAutomaticLaborItems !== 0) {
    throw new Error("Koper composition verification failed");
  }

  return {
    ok: true,
    compositions: promotedCompositions.length,
    items: itemPayloads.length,
    deactivatedAutomaticLaborItems,
    deactivatedStaleKoperItems,
    verifiedActiveKoperItems: verifiedKoper.length,
    verifiedActiveAutomaticLaborItems,
  };
}
