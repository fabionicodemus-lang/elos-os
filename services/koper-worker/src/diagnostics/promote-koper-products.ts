import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";

type StagingProductRow = {
  koper_id: string;
  payload: unknown;
};

type EngineeringInputPayload = {
  company_id: string;
  code: string;
  description: string;
  unit: string;
  category: "material";
  family_code: string | null;
  family_label: string | null;
  source_system: "koper";
  source_code: string;
  source_id: string;
  status: "active" | "inactive";
  updated_at: string;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identifier(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

export function mapStagingProductToEngineeringInput(
  row: StagingProductRow,
  updatedAt = new Date().toISOString(),
): EngineeringInputPayload {
  const payload = typeof row.payload === "object" && row.payload !== null
    ? row.payload as Record<string, unknown>
    : {};
  const subgroupId = identifier(payload.subgroupId);
  const groupId = identifier(payload.groupId);

  return {
    company_id: env.BOSSA_COMPANY_ID,
    code: `KOPER-${row.koper_id}`,
    description:
      text(payload.productName)
      ?? text(payload.productFullName)
      ?? `Produto Koper ${row.koper_id}`,
    unit: (text(payload.symbol) ?? "un").toLowerCase(),
    category: "material",
    family_code: subgroupId
      ? `KOPER-S${subgroupId}`
      : groupId
        ? `KOPER-G${groupId}`
        : null,
    family_label: text(payload.subgroupName) ?? text(payload.groupName),
    source_system: "koper",
    source_code: row.koper_id,
    source_id: row.koper_id,
    status: payload.status === false ? "inactive" : "active",
    updated_at: updatedAt,
  };
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function readAllStagingProducts(): Promise<StagingProductRow[]> {
  const rows: StagingProductRow[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await requestSupabase<StagingProductRow[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "koper_id,payload",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: "eq.product",
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

async function countPromotedProducts(): Promise<number> {
  let count = 0;
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await requestSupabase<Array<{ id: string }>>("engineering_inputs", {
      query: new URLSearchParams({
        select: "id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper",
        limit: String(pageSize),
        offset: String(offset),
      }),
    });
    count += page.length;
    if (page.length < pageSize) break;
  }
  return count;
}

export async function promoteKoperProducts(): Promise<{
  ok: true;
  stagingProducts: number;
  promoted: number;
  verifiedInCatalog: number;
}> {
  if (
    process.env.KOPER_ENGINEERING_INPUTS_WRITE_ENABLED !== "true"
    || process.env.KOPER_PRODUCT_PROMOTION_ENABLED !== "true"
  ) throw new Error("Koper product promotion is not explicitly enabled");

  // Confirma que a tabela aplicada pela migration 0016 está acessível antes da escrita.
  await requestSupabase<Array<{ id: string }>>("engineering_inputs", {
    query: new URLSearchParams({ select: "id", limit: "1" }),
  });

  const staging = await readAllStagingProducts();
  const updatedAt = new Date().toISOString();
  const inputs = staging.map((row) => mapStagingProductToEngineeringInput(row, updatedAt));
  let promoted = 0;

  for (const batch of chunks(inputs, 100)) {
    const rows = await requestSupabase<Array<{ id: string }>>("engineering_inputs", {
      method: "POST",
      body: batch,
      prefer: "resolution=merge-duplicates,return=representation",
      query: new URLSearchParams({
        on_conflict: "company_id,source_system,source_id",
        select: "id",
      }),
    });
    promoted += rows.length;
  }

  const verifiedInCatalog = await countPromotedProducts();
  if (verifiedInCatalog !== inputs.length) {
    throw new Error("Engineering inputs verification count does not match staging");
  }

  return {
    ok: true,
    stagingProducts: staging.length,
    promoted,
    verifiedInCatalog,
  };
}
