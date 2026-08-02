import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";

type StagingServiceRow = {
  koper_id: string;
  payload: unknown;
};

type EngineeringServicePayload = {
  company_id: string;
  code: string;
  description: string;
  unit: string;
  group_code: string | null;
  default_method: "unit" | "count" | "length" | "area" | "volume" | "weight" | "custom";
  takeoff_rule: string | null;
  measurement_rule: string | null;
  notes: string | null;
  status: "active" | "inactive";
  source_system: "koper";
  source_id: string;
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

function normalizeUnit(value: unknown): string {
  return (text(value) ?? "un")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

function inferMethod(unit: string): EngineeringServicePayload["default_method"] {
  const normalized = unit
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (/^(m|metro|metros)$/.test(normalized)) return "length";
  if (/m2|m²|metro quadrado/.test(normalized)) return "area";
  if (/m3|m³|metro cubico/.test(normalized)) return "volume";
  if (/^(kg|quilo|quilograma|ton|t)$/.test(normalized)) return "weight";
  if (/^(un|und|unidade|peca|pc)$/.test(normalized)) return "count";
  return "unit";
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function readAllStagingServices(): Promise<StagingServiceRow[]> {
  const rows: StagingServiceRow[] = [];
  const pageSize = 1_000;

  for (let offset = 0; ; offset += pageSize) {
    const page = await requestSupabase<StagingServiceRow[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "koper_id,payload",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: "eq.service",
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

function mapService(
  row: StagingServiceRow,
  updatedAt: string,
): EngineeringServicePayload {
  const payload =
    typeof row.payload === "object" && row.payload !== null
      ? (row.payload as Record<string, unknown>)
      : {};
  const categoryId = identifier(payload.categoryId);
  const categoryName = text(payload.categoryName);
  const subcategoryName = text(payload.subcategoryName);
  const unit = normalizeUnit(payload.unitMeasureName);

  return {
    company_id: env.BOSSA_COMPANY_ID,
    code: `KOPER-S${row.koper_id}`,
    description: text(payload.serviceName) ?? `Serviço Koper ${row.koper_id}`,
    unit,
    group_code: categoryId ? `KOPER-C${categoryId}` : null,
    default_method: inferMethod(unit),
    takeoff_rule: null,
    measurement_rule: null,
    notes: [categoryName, subcategoryName].filter(Boolean).join(" · ") || null,
    status: payload.status === false ? "inactive" : "active",
    source_system: "koper",
    source_id: row.koper_id,
    updated_at: updatedAt,
  };
}

async function countPromotedServices(): Promise<number> {
  let count = 0;
  const pageSize = 1_000;

  for (let offset = 0; ; offset += pageSize) {
    const page = await requestSupabase<Array<{ id: string }>>("engineering_services", {
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

export async function promoteKoperServices(): Promise<{
  ok: true;
  stagingServices: number;
  promoted: number;
  verifiedInCatalog: number;
}> {
  if (
    process.env.KOPER_ENGINEERING_SERVICES_WRITE_ENABLED !== "true"
    || process.env.KOPER_SERVICE_PROMOTION_ENABLED !== "true"
  ) {
    throw new Error("Koper service promotion is not explicitly enabled");
  }

  await requestSupabase<Array<{ id: string }>>("engineering_services", {
    query: new URLSearchParams({ select: "id", limit: "1" }),
  });

  const staging = await readAllStagingServices();
  const updatedAt = new Date().toISOString();
  const services = staging.map((row) => mapService(row, updatedAt));
  let promoted = 0;

  for (const batch of chunks(services, 50)) {
    const rows = await requestSupabase<Array<{ id: string }>>("engineering_services", {
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

  const verifiedInCatalog = await countPromotedServices();
  if (verifiedInCatalog !== services.length) {
    throw new Error("Engineering services verification count does not match staging");
  }

  return {
    ok: true,
    stagingServices: staging.length,
    promoted,
    verifiedInCatalog,
  };
}
