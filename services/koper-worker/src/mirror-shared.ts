/**
 * Utilitários comuns das promoções que partem da staging `mirror.*`
 * (orçamento por acompanhamento e rateio de títulos por serviço).
 */
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

export type Json = Record<string, unknown>;
export type Requester = typeof requestSupabase;
export type KoperCompany = "bossa" | "flow" | "alma";

export const asObject = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {});
export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
/** Texto não vazio. */
export const text = (value: unknown): string | null => {
  if (value === null || value === undefined || typeof value === "object") return null;
  const out = String(value).trim();
  return out === "" ? null : out;
};
/** Identificador do Koper: texto não vazio e diferente de "0". */
export const idOf = (value: unknown): string | null => {
  const out = text(value);
  return out === null || out === "0" || out === "-" ? null : out;
};
export const num = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};
export const cents = (value: unknown): number => Math.round(num(value) * 100);
export const money = (value: number): number => Math.round(value) / 100;

export function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

export async function allRows<T>(request: Requester, table: string, query: Record<string, string>, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const rows = await request<T[]>(table, {
      query: new URLSearchParams({ ...query, limit: String(pageSize), offset: String(offset) }),
      timeoutMs: 60_000,
    });
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}

/** Registros presentes de uma entidade do espelho, por id do Koper (sem o prefixo da empresa). */
export async function loadMirror(request: Requester, entity: string, company: KoperCompany): Promise<Map<string, Json>> {
  const out = new Map<string, Json>();
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const rows = await request<Array<{ koper_id: string; payload: unknown }>>("koper_staging_records", {
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

// ---------------------------------------------------------------------------
// Obras alvo
// ---------------------------------------------------------------------------

export type TargetKey = "alma";

export type Target = {
  label: string;
  /** Como reconhecer a obra no Elos OS pelo nome. */
  projectMatch: RegExp;
  /** Empresas do Koper cujos acompanhamentos de obra viram o orçamento desta obra. */
  monitoringCompanies: KoperCompany[];
};

export const TARGETS: Record<TargetKey, Target> = {
  alma: { label: "Alma Seahouses", projectMatch: /\balma\b/i, monitoringCompanies: ["alma"] },
};

export function parseTarget(raw: string | undefined): TargetKey {
  const key = (raw ?? "alma").trim().toLowerCase();
  if (!(key in TARGETS)) throw new Error(`KOPER_TARGET_UNKNOWN_${key}`);
  return key as TargetKey;
}

/** Origem dos títulos no Elos OS → empresa do Koper. O Flow tem rotina própria e não entra aqui. */
export const PAYABLE_SOURCE_COMPANY: Record<string, KoperCompany> = { koper_alma: "alma", koper_bossa: "bossa" };

export type Project = { id: string; name: string; status: string };

export async function resolveProject(request: Requester, target: Target): Promise<Project> {
  const projects = await allRows<Project>(request, "projects", { select: "id,name,status", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "created_at.asc" });
  const matches = projects.filter((project) => !/homologa/i.test(project.name) && project.status !== "archived" && target.projectMatch.test(project.name));
  const project = matches[0];
  if (matches.length !== 1 || !project) throw new Error(`KOPER_TARGET_PROJECT_AMBIGUOUS_${matches.length}`);
  return project;
}

// ---------------------------------------------------------------------------
// Serviços (centros de custo) do Koper no catálogo do Elos OS
// ---------------------------------------------------------------------------

export type ElosService = { id: string; code: string; description: string; unit: string; source_id: string | null };
export type KoperServiceInfo = { name: string | null; unit: string | null; categoryId: string | null; categoryName: string | null };

function inferMethod(unit: string): "unit" | "count" | "length" | "area" | "volume" | "weight" {
  const normalized = unit.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/^(m|metro|metros)$/.test(normalized)) return "length";
  if (/m2|m²|metro quadrado/.test(normalized)) return "area";
  if (/m3|m³|metro cubico/.test(normalized)) return "volume";
  if (/^(kg|quilo|quilograma|ton|t)$/.test(normalized)) return "weight";
  if (/^(un|und|unidade|peca|pc)$/.test(normalized)) return "count";
  return "unit";
}

/**
 * Garante no catálogo do Elos OS os serviços do Koper pedidos (mesma convenção da carga
 * original: código `KOPER-S<id>`, `source_system = koper`, `source_id = <serviceId>`).
 * Nunca altera serviço existente. Serviço sem nome conhecido não é criado.
 */
export async function ensureKoperServices(
  request: Requester,
  needed: Map<string, KoperServiceInfo>,
  write: boolean,
): Promise<{ byKoperId: Map<string, ElosService>; created: string[]; wouldCreate: string[]; unnamed: string[] }> {
  const existing = await allRows<ElosService>(request, "engineering_services", {
    select: "id,code,description,unit,source_id",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source_system: "eq.koper",
    order: "code.asc",
  });
  const byKoperId = new Map(existing.filter((service) => service.source_id).map((service) => [String(service.source_id), service]));
  const missing = [...needed].filter(([id]) => !byKoperId.has(id));
  const unnamed = missing.filter(([, info]) => !info.name).map(([id]) => id);
  const creatable = missing.filter(([, info]) => info.name);
  const created: string[] = [];
  if (write && creatable.length) {
    const now = new Date().toISOString();
    const body = creatable.map(([id, info]) => {
      const unit = (info.unit ?? "un").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim() || "un";
      return {
        company_id: env.BOSSA_COMPANY_ID,
        code: `KOPER-S${id}`,
        description: info.name,
        unit,
        group_code: info.categoryId ? `KOPER-C${info.categoryId}` : null,
        default_method: inferMethod(unit),
        takeoff_rule: null,
        measurement_rule: null,
        notes: info.categoryName,
        status: "active",
        source_system: "koper",
        source_id: id,
        updated_at: now,
      };
    });
    for (const batch of chunks(body, 50)) {
      const rows = await request<ElosService[]>("engineering_services", {
        method: "POST",
        body: batch,
        prefer: "resolution=ignore-duplicates,return=representation",
        query: new URLSearchParams({ on_conflict: "company_id,source_system,source_id", select: "id,code,description,unit,source_id" }),
      });
      for (const row of rows) {
        if (!row.source_id) continue;
        byKoperId.set(String(row.source_id), row);
        created.push(String(row.source_id));
      }
    }
    const stillMissing = creatable.filter(([id]) => !byKoperId.has(id)).map(([id]) => id);
    if (stillMissing.length) throw new Error(`KOPER_SERVICES_NOT_CONFIRMED_${stillMissing.slice(0, 5).join("_")}`);
  }
  return { byKoperId, created, wouldCreate: write ? [] : creatable.map(([id]) => id), unnamed };
}

/** Nome, unidade e categoria de cada serviço, a partir do catálogo espelhado (quando já carregado). */
export function serviceInfoFromCatalog(catalog: Map<string, Json>, id: string): KoperServiceInfo | null {
  const row = catalog.get(id);
  if (!row) return null;
  return { name: text(row.serviceName), unit: text(row.unitName) ?? text(row.symbol), categoryId: idOf(row.categoryId), categoryName: text(row.categoryName) };
}
