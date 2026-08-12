import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";

type Row = {
  entity: string;
  koper_id: string;
  koper_parent_id: string | null;
  payload: unknown;
};

type Match = {
  entity: string;
  koperId: string;
  koperParentId: string | null;
  matchedPaths: string[];
  technical: Record<string, string | number | boolean | null>;
};

const entities = [
  "service",
  "budget_item",
  "budget_input",
  "budget_composition",
  "budget_composition_detail",
  "construction_budget",
  "stock_request_item",
] as const;

const targets = new Set(["449", "101", "465", "117", "450", "102", "466", "118"]);

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function findTargetPaths(value: unknown, prefix = "", out: string[] = [], depth = 0): string[] {
  if (depth > 7) return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 30); i += 1) {
      findTargetPaths(value[i], `${prefix}[${i}]`, out, depth + 1);
    }
    return out;
  }
  const record = obj(value);
  if (!record) return out;
  for (const [key, child] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if ((typeof child === "string" || typeof child === "number") && targets.has(String(child))) {
      out.push(path);
    }
    if (typeof child === "object" && child !== null) findTargetPaths(child, path, out, depth + 1);
  }
  return out;
}

function technical(value: unknown, prefix = "", out: Record<string, string | number | boolean | null> = {}, depth = 0): Record<string, string | number | boolean | null> {
  if (depth > 6 || Object.keys(out).length >= 120) return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 5); i += 1) technical(value[i], `${prefix}[${i}]`, out, depth + 1);
    return out;
  }
  const record = obj(value);
  if (!record) return out;
  for (const [key, child] of Object.entries(record)) {
    const lower = key.toLowerCase();
    const path = prefix ? `${prefix}.${key}` : key;
    if (child === null || typeof child === "number" || typeof child === "boolean" || typeof child === "string") {
      if (/id$|service|input|budget|composition|monitor|monit|planning|item|stage|reference|amount|quantity|type/.test(lower)
        && !/name|description|user|customer|email|phone|document|token|cookie|address/.test(lower)) {
        out[path] = typeof child === "string" ? child.slice(0, 120) : child;
      }
    } else technical(child, path, out, depth + 1);
  }
  return out;
}

async function readEntity(entity: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await requestSupabase<Row[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "entity,koper_id,koper_parent_id,payload",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: `eq.${entity}`,
        sync_state: "eq.present",
        limit: "1000",
        offset: String(offset),
      }),
      timeoutMs: 30_000,
    });
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

export async function inspectBuildMonitoringRoutes(): Promise<{
  ok: true;
  targets: string[];
  entityCounts: Record<string, number>;
  matches: Match[];
  directKoperIdMatches: Match[];
}> {
  const matches: Match[] = [];
  const entityCounts: Record<string, number> = {};

  for (const entity of entities) {
    const rows = await readEntity(entity);
    entityCounts[entity] = rows.length;
    for (const row of rows) {
      const matchedPaths = findTargetPaths(row.payload);
      if (targets.has(row.koper_id)) matchedPaths.unshift("$koper_id");
      if (row.koper_parent_id && targets.has(row.koper_parent_id)) matchedPaths.unshift("$koper_parent_id");
      if (matchedPaths.length === 0) continue;
      matches.push({
        entity: row.entity,
        koperId: row.koper_id,
        koperParentId: row.koper_parent_id,
        matchedPaths: [...new Set(matchedPaths)],
        technical: technical(row.payload),
      });
    }
  }

  return {
    ok: true,
    targets: [...targets],
    entityCounts,
    matches: matches.slice(0, 120),
    directKoperIdMatches: matches.filter((match) => match.matchedPaths.includes("$koper_id")).slice(0, 80),
  };
}
