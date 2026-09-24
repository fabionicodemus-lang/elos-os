import { createHash } from "node:crypto";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type Stage = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Invoice = { id: string; registry_number: string; project_id: string | null };
const object = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};
const string = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function all<T>(table: string, query: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await requestSupabase<T[]>(table, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
      timeoutMs: 30_000,
    });
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const [rows, invoices, projects] = await Promise.all([
  all<Stage>("koper_staging_records", {
    select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper", entity: "eq.bill_resolution", sync_state: "eq.present", order: "koper_id.asc",
  }),
  all<Invoice>("finance_electronic_invoices", {
    select: "id,registry_number,project_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc",
  }),
  all<{ id: string }>("projects", {
    select: "id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc",
  }),
]);
const invoiceById = new Map(invoices.map(invoice => [invoice.id, invoice]));
const projectIds = new Set(projects.map(project => project.id));
const candidates = rows.filter(row => {
  const payload = object(row.payload);
  return payload.route === "invoice" &&
    (payload.status === "unresolved" || (payload.status === "project_only" && payload.version === 8));
});
const eligible = candidates.filter(row => !!string(object(object(row.payload).projectEvidence).projectId));
const total = Math.round(eligible.reduce((sum, row) => sum + Number(object(row.payload).billValue ?? 0), 0) * 100) / 100;
if (eligible.length !== 362 || Math.abs(total - 946153.11) > 0.01) {
  throw new Error(`INVOICE_PROJECT_ONLY_GUARD count=${eligible.length} total=${total}`);
}
for (const row of eligible) {
  const payload = object(row.payload);
  const ids = object(payload.ids);
  const invoice = invoiceById.get(string(ids.elosInvoiceId) ?? "");
  const sourceId = string(ids.invoiceId);
  const projectId = string(object(payload.projectEvidence).projectId);
  if (!invoice || !sourceId || invoice.registry_number !== `KOPER-NFE-${sourceId}` ||
      invoice.project_id !== projectId || !projectId || !projectIds.has(projectId) ||
      !Number.isFinite(Number(payload.billValue)) || Number(payload.billValue) <= 0 ||
      (Array.isArray(payload.allocations) && payload.allocations.length > 0)) {
    throw new Error(`INVOICE_PROJECT_ONLY_EVIDENCE_GUARD bill=${row.koper_id}`);
  }
}
let updated = 0;
for (const row of eligible) {
  const payload = object(row.payload);
  if (payload.status === "project_only") continue;
  const next = { ...payload, version: 8, status: "project_only",
    projectEvidence: { ...object(payload.projectEvidence), invoiceFallback: "invoice_project_only" },
    serviceSourceIds: [], wbsCodes: [], allocations: [] };
  const now = new Date().toISOString();
  await requestSupabase("koper_staging_records", {
    method: "POST", body: [{ company_id: env.BOSSA_COMPANY_ID, source: "koper", entity: "bill_resolution",
      koper_id: row.koper_id, koper_parent_id: row.koper_parent_id, payload: next, payload_hash: hash(next),
      first_seen_at: now, last_seen_at: now, processing_status: "processed", processing_error: null,
      mapping_version: 8, sync_state: "present", elos_id: null, updated_at: now }],
    prefer: "resolution=merge-duplicates,return=minimal",
    query: new URLSearchParams({ on_conflict: "company_id,source,entity,koper_id" }),
  });
  updated++;
}
console.log("KOPER_INVOICE_PROJECT_ONLY", JSON.stringify({ eligible: eligible.length, total, updated,
  method: "invoice_project_only" }));
