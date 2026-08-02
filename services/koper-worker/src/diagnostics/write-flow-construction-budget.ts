import { env } from "../config/env.js";
import { saveKoperStagingBatch } from "../elos/koper-staging-repository.js";
import { createKoperStagingRecord } from "../sync/staging-record.js";
import type { KoperStagingRecord } from "../sync/staging-record.js";
import { inspectKoperEngineering } from "./inspect-koper-engineering.js";

const FLOW_ENTERPRISE_ID = "6d3b4724-5880-11ee-827d-1219c832db49";
const FLOW_BUDGET_ID = 100;

function identifier(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

export function buildConstructionBudgetStagingRecord(
  budget: Record<string, unknown>,
): KoperStagingRecord {
  const budgetId = identifier(budget.engBudgetId);
  if (budgetId === null) throw new Error("Construction budget has no identifier");

  return createKoperStagingRecord({
    companyId: env.BOSSA_COMPANY_ID,
    entity: "construction_budget",
    koperId: budgetId,
    koperParentId: identifier(budget.buildingId),
    sanitizedPayload: {
      enterpriseId: FLOW_ENTERPRISE_ID,
      ...budget,
    },
    koperCreatedAt:
      typeof budget.engBudgetDate === "string" ? budget.engBudgetDate : null,
    mappingVersion: 1,
  });
}

export function buildBudgetItemStagingRecords(
  items: Array<Record<string, unknown>>,
): KoperStagingRecord[] {
  const unique = new Map<string, Record<string, unknown>>();

  for (const item of items) {
    const itemBudgetId = identifier(item.itemBudgetId);
    if (itemBudgetId === null) continue;
    unique.set(String(itemBudgetId), item);
  }

  return [...unique.values()].map((item) => {
    const itemBudgetId = identifier(item.itemBudgetId);
    if (itemBudgetId === null) {
      throw new Error("Budget item has no identifier");
    }

    return createKoperStagingRecord({
      companyId: env.BOSSA_COMPANY_ID,
      entity: "budget_item",
      koperId: itemBudgetId,
      koperParentId: FLOW_BUDGET_ID,
      sanitizedPayload: {
        enterpriseId: FLOW_ENTERPRISE_ID,
        engBudgetId: FLOW_BUDGET_ID,
        ...item,
      },
      mappingVersion: 1,
    });
  });
}

export function buildBudgetChildStagingRecords(
  entity: "budget_composition" | "budget_input",
  idField: "compositionId" | "inputId",
  records: Array<Record<string, unknown>>,
): KoperStagingRecord[] {
  const unique = new Map<string, Record<string, unknown>>();

  for (const record of records) {
    const koperId = identifier(record[idField]);
    if (koperId === null) continue;
    unique.set(String(koperId), record);
  }

  return [...unique.entries()].map(([key, record]) =>
    createKoperStagingRecord({
      companyId: env.BOSSA_COMPANY_ID,
      entity,
      koperId: key,
      koperParentId: FLOW_BUDGET_ID,
      sanitizedPayload: {
        enterpriseId: FLOW_ENTERPRISE_ID,
        engBudgetId: FLOW_BUDGET_ID,
        ...record,
      },
      mappingVersion: 1,
    }),
  );
}

export async function writeFlowConstructionBudget(): Promise<{
  ok: true;
  budgetId: number;
  extractedItems: number;
  budget: { inserted: number; unchanged: number; updated: number };
  items: { inserted: number; unchanged: number; updated: number };
  extractedCompositions: number;
  compositions: { inserted: number; unchanged: number; updated: number };
  extractedInputs: number;
  inputs: { inserted: number; unchanged: number; updated: number };
}> {
  if (
    process.env.KOPER_STAGING_WRITE_ENABLED !== "true" ||
    process.env.KOPER_BUDGET_STAGING_WRITE_ENABLED !== "true" ||
    process.env.KOPER_BUDGET_FULL_STAGING_WRITE_ENABLED !== "true"
  ) {
    throw new Error("Full Koper budget staging write is not explicitly enabled");
  }

  const diagnostic = await inspectKoperEngineering({
    collectFullBudget: true,
  });

  if (!diagnostic.authenticated || !diagnostic.flowSelected) {
    throw new Error("Flow context was not established");
  }
  if (
    !diagnostic.fullConstructionBudget ||
    !diagnostic.fullBudgetItems ||
    !diagnostic.fullBudgetCompositions ||
    !diagnostic.fullBudgetInputs
  ) {
    throw new Error("Full Koper construction budget was not captured");
  }

  const budgetRecord = buildConstructionBudgetStagingRecord(
    diagnostic.fullConstructionBudget,
  );
  const itemRecords = buildBudgetItemStagingRecords(
    diagnostic.fullBudgetItems,
  );
  const compositionRecords = buildBudgetChildStagingRecords(
    "budget_composition",
    "compositionId",
    diagnostic.fullBudgetCompositions,
  );
  const inputRecords = buildBudgetChildStagingRecords(
    "budget_input",
    "inputId",
    diagnostic.fullBudgetInputs,
  );

  const budget = await saveKoperStagingBatch([budgetRecord]);
  const items = await saveKoperStagingBatch(itemRecords);
  const compositions = await saveKoperStagingBatch(compositionRecords);
  const inputs = await saveKoperStagingBatch(inputRecords);

  return {
    ok: true,
    budgetId: FLOW_BUDGET_ID,
    extractedItems: itemRecords.length,
    budget,
    items,
    extractedCompositions: compositionRecords.length,
    compositions,
    extractedInputs: inputRecords.length,
    inputs,
  };
}
