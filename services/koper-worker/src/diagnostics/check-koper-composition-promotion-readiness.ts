import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";

type StagingRow = {
  koper_id: string;
  payload: unknown;
};

type CatalogRow = {
  id: string;
  source_id: string | null;
};

type SourceItem = {
  compositionId: string;
  serviceId: string | null;
  itemId: string | null;
  itemType: string;
  coefficient: number | null;
};

function identifier(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function payloadObject(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function scalarPayload(payload: unknown): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(payloadObject(payload)).filter(([, value]) =>
      value === null
      || typeof value === "string"
      || typeof value === "number"
      || typeof value === "boolean"
    ),
  ) as Record<string, string | number | boolean | null>;
}

async function readStaging(entity: "budget_composition_detail" | "budget_input"): Promise<StagingRow[]> {
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

async function readCatalog(table: "engineering_services" | "engineering_inputs"): Promise<CatalogRow[]> {
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

function sourceItems(rows: StagingRow[]): SourceItem[] {
  return rows.flatMap((row) => {
    const payload = payloadObject(row.payload);
    const items = Array.isArray(payload.items) ? payload.items : [];
    const compositionId = identifier(payload.compositionId) ?? row.koper_id;
    const serviceId = identifier(payload.serviceId);

    return items.map((value) => {
      const item = payloadObject(value);
      return {
        compositionId,
        serviceId,
        itemId: identifier(item.itemId),
        itemType: identifier(item.itemType) ?? "(ausente)",
        coefficient: numberValue(item.coefficient),
      };
    });
  });
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))].sort(
    (left, right) => left.localeCompare(right, "pt-BR", { numeric: true }),
  );
}

export async function checkKoperCompositionPromotionReadiness(): Promise<{
  ok: true;
  ready: boolean;
  stagedCompositions: number;
  stagedItems: number;
  itemTypes: Record<string, number>;
  catalogServices: number;
  catalogInputs: number;
  referencedServices: number;
  referencedInputs: number;
  missingServiceIds: string[];
  missingInputIds: string[];
  unsupportedItemTypes: string[];
  missingInputDetails: Array<{
    inputId: string;
    payload: Record<string, string | number | boolean | null> | null;
  }>;
  invalidItems: Array<{
    compositionId: string;
    serviceId: string | null;
    itemId: string | null;
    coefficient: number | null;
  }>;
}> {
  const [details, budgetInputs, services, inputs] = await Promise.all([
    readStaging("budget_composition_detail"),
    readStaging("budget_input"),
    readCatalog("engineering_services"),
    readCatalog("engineering_inputs"),
  ]);
  const items = sourceItems(details);
  const serviceIds = new Set(services.map((row) => row.source_id).filter(Boolean));
  const inputIds = new Set(inputs.map((row) => row.source_id).filter(Boolean));
  const referencedServices = unique(details.map((row) => identifier(payloadObject(row.payload).serviceId)));
  const referencedInputs = unique(items.map((item) => item.itemId));
  const missingServiceIds = referencedServices.filter((id) => !serviceIds.has(id));
  const missingInputIds = referencedInputs.filter((id) => !inputIds.has(id));
  const budgetInputById = new Map(budgetInputs.map((row) => [row.koper_id, row]));
  const itemTypes = items.reduce<Record<string, number>>((counts, item) => {
    counts[item.itemType] = (counts[item.itemType] ?? 0) + 1;
    return counts;
  }, {});
  const supportedItemType = "Insumo";
  const unsupportedItemTypes = Object.keys(itemTypes).filter((type) => type !== supportedItemType);
  const invalidItems = items
    .filter((item) => !item.serviceId || !item.itemId || item.coefficient === null || item.coefficient <= 0)
    .map(({ compositionId, serviceId, itemId, coefficient }) => ({
      compositionId,
      serviceId,
      itemId,
      coefficient,
    }));

  return {
    ok: true,
    ready:
      details.length > 0
      && items.length > 0
      && missingServiceIds.length === 0
      && missingInputIds.length === 0
      && unsupportedItemTypes.length === 0
      && invalidItems.length === 0,
    stagedCompositions: details.length,
    stagedItems: items.length,
    itemTypes,
    catalogServices: services.length,
    catalogInputs: inputs.length,
    referencedServices: referencedServices.length,
    referencedInputs: referencedInputs.length,
    missingServiceIds,
    missingInputIds,
    missingInputDetails: missingInputIds.map((inputId) => ({
      inputId,
      payload: budgetInputById.has(inputId)
        ? scalarPayload(budgetInputById.get(inputId)?.payload)
        : null,
    })),
    unsupportedItemTypes,
    invalidItems,
  };
}
