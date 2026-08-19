import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type Stage = { entity: string; koper_id: string; payload: unknown };

const obj = (v: unknown): Json => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Json : {};
const id = (v: unknown): string | null => (typeof v === "string" || typeof v === "number") ? (String(v).trim() || null) : null;
const uniq = <T>(a: T[]): T[] => [...new Set(a)];

async function all<T>(table: string, query: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await requestSupabase<T[]>(table, { query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }), timeoutMs: 30_000 });
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const SERVICE_KEYS = ["serviceId", "service_id"];
const WBS_KEYS = ["monItemReference", "itemReference", "item_reference", "mon_item_reference"];
const MON_KEYS = ["itemMonitoringId", "item_monitoring_id", "itemMonitContractId"];

function first(row: Json, keys: string[]): string | null {
  for (const key of keys) {
    const value = id(row[key]);
    if (value) return value;
  }
  return null;
}

type Pair = { serviceId: string | null; monitoringId: string | null; wbs: string | null; entity: string; koperId: string };

function walk(value: unknown, entity: string, koperId: string, depth = 0): Pair[] {
  if (depth > 12 || value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((x) => walk(x, entity, koperId, depth + 1));
  if (typeof value !== "object") return [];
  const row = obj(value);
  const pair: Pair = {
    serviceId: first(row, SERVICE_KEYS),
    monitoringId: first(row, MON_KEYS),
    wbs: first(row, WBS_KEYS),
    entity,
    koperId,
  };
  const out: Pair[] = [];
  if ((pair.serviceId || pair.monitoringId) && pair.wbs) out.push(pair);
  for (const child of Object.values(row)) if (child && typeof child === "object") out.push(...walk(child, entity, koperId, depth + 1));
  return out;
}

function mapSets(pairs: Pair[], key: "serviceId" | "monitoringId") {
  const map = new Map<string, Set<string>>();
  for (const pair of pairs) {
    const k = pair[key];
    if (!k || !pair.wbs) continue;
    const set = map.get(k) ?? new Set<string>();
    set.add(pair.wbs);
    map.set(k, set);
  }
  return map;
}

const rows = await all<Stage>("koper_staging_records", {
  select: "entity,koper_id,payload",
  company_id: `eq.${env.BOSSA_COMPANY_ID}`,
  source: "eq.koper",
  sync_state: "eq.present",
  order: "entity.asc,koper_id.asc",
});

const pairs = rows.flatMap((row) => walk(row.payload, row.entity, row.koper_id));
const serviceMap = mapSets(pairs, "serviceId");
const monitoringMap = mapSets(pairs, "monitoringId");
const safeServices = [...serviceMap.entries()].filter(([, refs]) => refs.size === 1);
const ambiguousServices = [...serviceMap.entries()].filter(([, refs]) => refs.size > 1);
const safeMonitoring = [...monitoringMap.entries()].filter(([, refs]) => refs.size === 1);
const ambiguousMonitoring = [...monitoringMap.entries()].filter(([, refs]) => refs.size > 1);
const byEntity: Record<string, number> = {};
for (const pair of pairs) byEntity[pair.entity] = (byEntity[pair.entity] ?? 0) + 1;

console.log("KOPER_SAFE_WBS_CROSSWALK", JSON.stringify({
  ok: true,
  readOnly: true,
  stagedRows: rows.length,
  pairEvidence: pairs.length,
  entitiesWithEvidence: Object.entries(byEntity).sort((a,b) => b[1] - a[1]).slice(0, 20),
  serviceIds: {
    total: serviceMap.size,
    safeUniqueWbs: safeServices.length,
    ambiguous: ambiguousServices.length,
  },
  monitoringIds: {
    total: monitoringMap.size,
    safeUniqueWbs: safeMonitoring.length,
    ambiguous: ambiguousMonitoring.length,
  },
  ambiguousServiceSample: ambiguousServices.slice(0, 30).map(([serviceId, refs]) => ({ serviceId, refs: [...refs] })),
  safeServiceSample: safeServices.slice(0, 40).map(([serviceId, refs]) => ({ serviceId, wbs: [...refs][0] })),
  duplicatePairsRemoved: pairs.length - uniq(pairs.map(p => `${p.serviceId ?? ""}|${p.monitoringId ?? ""}|${p.wbs ?? ""}|${p.entity}|${p.koperId}`)).length,
}));
