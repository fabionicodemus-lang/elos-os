import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";

type StagingRow = {
  koper_id: string;
  payload: unknown;
};

type ProjectRow = {
  id: string;
  name: string;
  status: string | null;
};

type BudgetItemSource = {
  koperId: string;
  payload: Record<string, unknown>;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identifier(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function readStaging(entity: string): Promise<StagingRow[]> {
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

async function resolveFlowProject(): Promise<ProjectRow> {
  const projects = await requestSupabase<ProjectRow[]>("projects", {
    query: new URLSearchParams({
      select: "id,name,status",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      order: "name.asc",
      limit: "200",
    }),
  });

  const active = projects.filter((project) => project.status !== "archived");
  const exact = active.find((project) => normalize(project.name) === "flow aptos");
  const fallback = active.find((project) => normalize(project.name).includes("flow"));

  if (!exact && !fallback) {
    throw new Error("Flow Aptos project was not found in Elos OS");
  }

  return exact ?? fallback as ProjectRow;
}

function payloadObject(row: StagingRow): Record<string, unknown> {
  return typeof row.payload === "object" && row.payload !== null
    ? row.payload as Record<string, unknown>
    : {};
}

function isStructuralItem(item: BudgetItemSource): boolean {
  return (
    identifier(item.payload.serviceId) === null
    && identifier(item.payload.inputId) === null
    && identifier(item.payload.compositionId) === null
    && text(item.payload.itemUnit) === null
    && numberValue(item.payload.itemAmount) === 0
  );
}

function importedItemToken(koperId: string): string {
  return `Koper itemBudgetId=${koperId}`;
}

export async function promoteKoperConstructionBudget(): Promise<{
  ok: true;
  projectId: string;
  budgetId: string;
  groups: number;
  items: number;
  insertedItems: number;
  updatedItems: number;
  verifiedItems: number;
}> {
  if (
    process.env.KOPER_ENGINEERING_BUDGET_WRITE_ENABLED !== "true"
    || process.env.KOPER_BUDGET_PROMOTION_ENABLED !== "true"
  ) {
    throw new Error("Koper budget promotion is not explicitly enabled");
  }

  const [budgetRows, itemRows, project] = await Promise.all([
    readStaging("construction_budget"),
    readStaging("budget_item"),
    resolveFlowProject(),
  ]);

  if (budgetRows.length !== 1) {
    throw new Error("Expected exactly one staged Flow construction budget");
  }

  const sourceBudget = payloadObject(budgetRows[0]);
  const sourceBudgetId = budgetRows[0].koper_id;
  const sourceStatus = normalize(text(sourceBudget.engBudgetStatus) ?? "");
  const status =
    sourceStatus.includes("aprov")
      ? "approved"
      : sourceStatus.includes("aberto")
        ? "in_progress"
        : "draft";
  const sourceDate = text(sourceBudget.engBudgetDate);
  const now = new Date().toISOString();

  const budgets = await requestSupabase<Array<{ id: string }>>("engineering_budgets", {
    method: "POST",
    body: [{
      company_id: env.BOSSA_COMPANY_ID,
      project_id: project.id,
      code: `KOPER-${sourceBudgetId}`,
      name: text(sourceBudget.engBudgetName) ?? "Flow Aptos - OBRA",
      version: "KOPER",
      status,
      reference_date: sourceDate ? sourceDate.slice(0, 10) : null,
      area_m2: 0,
      bdi_percentage: 0,
      notes: `Importado do Koper · buildingId=${identifier(sourceBudget.buildingId) ?? "n/a"}`,
      source_system: "koper",
      source_id: sourceBudgetId,
      updated_at: now,
    }],
    prefer: "resolution=merge-duplicates,return=representation",
    query: new URLSearchParams({
      on_conflict: "company_id,source_system,source_id",
      select: "id",
    }),
  });

  if (budgets.length !== 1) throw new Error("Flow budget upsert did not return one row");
  const budgetId = budgets[0].id;

  const sourceItems: BudgetItemSource[] = itemRows.map((row) => ({
    koperId: row.koper_id,
    payload: payloadObject(row),
  }));
  const sourceById = new Map(sourceItems.map((item) => [item.koperId, item]));
  const structural = sourceItems.filter(isStructuralItem);

  const groupPayloads = structural.map((item, index) => ({
    company_id: env.BOSSA_COMPANY_ID,
    project_id: project.id,
    budget_id: budgetId,
    code: text(item.payload.itemReference) ?? `KOPER-G-${item.koperId}`,
    name: text(item.payload.itemName) ?? `Grupo Koper ${item.koperId}`,
    sort_order: index,
    notes: `Koper itemBudgetId=${item.koperId} · fatherItemId=${identifier(item.payload.fatherItemId) ?? "root"}`,
    status: "active",
    updated_at: now,
  }));

  const promotedGroups: Array<{ id: string; code: string }> = [];
  for (const batch of chunks(groupPayloads, 100)) {
    const rows = await requestSupabase<Array<{ id: string; code: string }>>(
      "engineering_budget_groups",
      {
        method: "POST",
        body: batch,
        prefer: "resolution=merge-duplicates,return=representation",
        query: new URLSearchParams({
          on_conflict: "budget_id,code",
          select: "id,code",
        }),
      },
    );
    promotedGroups.push(...rows);
  }

  const groupIdBySource = new Map<string, string>();
  const groupIdByCode = new Map(promotedGroups.map((group) => [group.code, group.id]));
  for (const item of structural) {
    const code = text(item.payload.itemReference) ?? `KOPER-G-${item.koperId}`;
    const groupId = groupIdByCode.get(code);
    if (groupId) groupIdBySource.set(item.koperId, groupId);
  }

  const serviceRows = await requestSupabase<Array<{ id: string; source_id: string }>>(
    "engineering_services",
    {
      query: new URLSearchParams({
        select: "id,source_id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper",
        limit: "1000",
      }),
    },
  );
  const serviceIdByKoper = new Map(
    serviceRows
      .filter((service) => service.source_id)
      .map((service) => [service.source_id, service.id]),
  );

  function resolveGroupId(item: BudgetItemSource): string | null {
    let parentId = identifier(item.payload.fatherItemId);
    const visited = new Set<string>();

    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const groupId = groupIdBySource.get(parentId);
      if (groupId) return groupId;
      parentId = identifier(sourceById.get(parentId)?.payload.fatherItemId);
    }

    return null;
  }

  const leafItems = sourceItems.filter((item) => !isStructuralItem(item));
  const desired = leafItems.map((item, index) => {
    const koperServiceId = identifier(item.payload.serviceId);
    const compositionId = identifier(item.payload.compositionId);
    const inputId = identifier(item.payload.inputId);
    const fatherItemId = identifier(item.payload.fatherItemId);

    return {
      company_id: env.BOSSA_COMPANY_ID,
      project_id: project.id,
      budget_id: budgetId,
      group_id: resolveGroupId(item),
      service_id: koperServiceId ? serviceIdByKoper.get(koperServiceId) ?? null : null,
      code: text(item.payload.itemReference),
      description: text(item.payload.itemName) ?? `Item Koper ${item.koperId}`,
      unit: (text(item.payload.itemUnit) ?? "un").toLocaleLowerCase("pt-BR"),
      quantity: Math.max(0, numberValue(item.payload.itemAmount)),
      material_unit_cost: 0,
      labor_unit_cost: 0,
      equipment_unit_cost: 0,
      other_unit_cost: Math.max(0, numberValue(item.payload.itemCost)),
      sort_order: index,
      notes: [
        importedItemToken(item.koperId),
        `fatherItemId=${fatherItemId ?? "root"}`,
        `serviceId=${koperServiceId ?? "none"}`,
        `compositionId=${compositionId ?? "none"}`,
        `inputId=${inputId ?? "none"}`,
      ].join(" · "),
      status: "active",
      updated_at: now,
    };
  });

  const existing = await requestSupabase<Array<{ id: string; notes: string | null }>>(
    "engineering_budget_items",
    {
      query: new URLSearchParams({
        select: "id,notes",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        budget_id: `eq.${budgetId}`,
        limit: "1000",
      }),
    },
  );

  const existingByKoperId = new Map<string, string>();
  for (const row of existing) {
    const match = row.notes?.match(/Koper itemBudgetId=([^ ·]+)/);
    if (match?.[1]) existingByKoperId.set(match[1], row.id);
  }

  const inserts: typeof desired = [];
  const updates: Array<{ id: string; payload: (typeof desired)[number] }> = [];

  for (let index = 0; index < desired.length; index += 1) {
    const item = desired[index];
    const koperId = leafItems[index].koperId;
    const existingId = existingByKoperId.get(koperId);
    if (existingId) updates.push({ id: existingId, payload: item });
    else inserts.push(item);
  }

  let insertedItems = 0;
  for (const batch of chunks(inserts, 100)) {
    const rows = await requestSupabase<Array<{ id: string }>>("engineering_budget_items", {
      method: "POST",
      body: batch,
      prefer: "return=representation",
      query: new URLSearchParams({ select: "id" }),
    });
    insertedItems += rows.length;
  }

  let updatedItems = 0;
  for (const update of updates) {
    const rows = await requestSupabase<Array<{ id: string }>>("engineering_budget_items", {
      method: "PATCH",
      body: update.payload,
      prefer: "return=representation",
      query: new URLSearchParams({
        id: `eq.${update.id}`,
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        budget_id: `eq.${budgetId}`,
        select: "id",
      }),
    });
    updatedItems += rows.length;
  }

  const verified = await requestSupabase<Array<{ notes: string | null }>>(
    "engineering_budget_items",
    {
      query: new URLSearchParams({
        select: "notes",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        budget_id: `eq.${budgetId}`,
        limit: "1000",
      }),
    },
  );
  const verifiedItems = verified.filter((row) =>
    row.notes?.includes("Koper itemBudgetId="),
  ).length;

  if (verifiedItems !== desired.length) {
    throw new Error("Engineering budget item verification count does not match staging");
  }

  return {
    ok: true,
    projectId: project.id,
    budgetId,
    groups: groupPayloads.length,
    items: desired.length,
    insertedItems,
    updatedItems,
    verifiedItems,
  };
}
