import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
import { collectFieldPaths } from "./discover-stock-route.js";
import { analyzeBudgetRelationships } from "./budget-relationships.js";
import type { BudgetRelationshipSummary } from "./budget-relationships.js";

type StagingRow = {
  entity: string;
  koper_id: string;
  koper_parent_id: string | null;
  payload: unknown;
};

const ENGINEERING_ENTITIES = [
  "service",
  "construction_budget",
  "budget_item",
  "budget_composition",
  "budget_composition_detail",
  "budget_input",
] as const;

function scalarPreview(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>)
      .filter(([, value]) =>
        value === null
        || typeof value === "string"
        || typeof value === "number"
        || typeof value === "boolean")
      .slice(0, 80)
      .map(([key, value]) => [
        key,
        typeof value === "string" ? value.slice(0, 160) : value,
      ]),
  );
}

async function readEntity(entity: string): Promise<StagingRow[]> {
  const rows: StagingRow[] = [];
  const pageSize = 1_000;

  for (let offset = 0; ; offset += pageSize) {
    const page = await requestSupabase<StagingRow[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "entity,koper_id,koper_parent_id,payload",
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

export async function inspectFlowEngineeringStaging(): Promise<{
  ok: true;
  relationships: BudgetRelationshipSummary;
  entities: Array<{
    entity: string;
    count: number;
    fieldPaths: string[];
    samples: Array<{
      koperId: string;
      koperParentId: string | null;
      payload: Record<string, unknown>;
    }>;
  }>;
}> {
  const entities = [];
  const rowsByEntity = new Map<string, StagingRow[]>();

  for (const entity of ENGINEERING_ENTITIES) {
    const rows = await readEntity(entity);
    rowsByEntity.set(entity, rows);
    const sampleRows = rows.slice(0, 3);

    entities.push({
      entity,
      count: rows.length,
      fieldPaths: [...new Set(
        sampleRows.flatMap((row) => collectFieldPaths(row.payload)),
      )].slice(0, 300),
      samples: sampleRows.map((row) => ({
        koperId: row.koper_id,
        koperParentId: row.koper_parent_id,
        payload: scalarPreview(row.payload),
      })),
    });
  }

  return {
    ok: true,
    relationships: analyzeBudgetRelationships(
      rowsByEntity.get("budget_item") ?? [],
      rowsByEntity.get("budget_composition") ?? [],
      rowsByEntity.get("budget_input") ?? [],
    ),
    entities,
  };
}
