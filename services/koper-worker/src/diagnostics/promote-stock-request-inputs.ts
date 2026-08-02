import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";

type StagingRow = { koper_id: string; payload: unknown };
type CatalogRow = { id: string; source_id: string | null };

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function identifier(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function readItems(): Promise<StagingRow[]> {
  const rows: StagingRow[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<StagingRow[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "koper_id,payload",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: "eq.stock_request_item",
        sync_state: "eq.present",
        limit: "1000",
        offset: String(offset),
      }),
    });
    rows.push(...page);
    if (page.length < 1_000) break;
  }
  return rows;
}

async function readCatalog(): Promise<CatalogRow[]> {
  const rows: CatalogRow[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<CatalogRow[]>("engineering_inputs", {
      query: new URLSearchParams({
        select: "id,source_id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper",
        limit: "1000",
        offset: String(offset),
      }),
    });
    rows.push(...page);
    if (page.length < 1_000) break;
  }
  return rows;
}

export async function promoteStockRequestInputs(): Promise<{
  ok: true;
  stagedItems: number;
  historicalInputs: number;
  promoted: number;
  verifiedCatalogInputs: number;
}> {
  if (
    process.env.KOPER_ENGINEERING_INPUTS_WRITE_ENABLED !== "true"
    || process.env.KOPER_STOCK_REQUEST_INPUT_PROMOTION_ENABLED !== "true"
  ) throw new Error("Koper stock request input promotion is not explicitly enabled");

  const [items, catalog] = await Promise.all([readItems(), readCatalog()]);
  const existing = new Set(catalog.map((row) => row.source_id).filter(Boolean));
  const missingByProductId = new Map<string, Record<string, unknown>>();

  for (const row of items) {
    const payload = objectValue(row.payload);
    const productId = identifier(payload.productId);
    const inputId = identifier(payload.inputId);
    if (!productId || existing.has(productId) || (inputId && existing.has(inputId))) continue;
    missingByProductId.set(productId, payload);
  }

  const now = new Date().toISOString();
  const payloads = [...missingByProductId.entries()].map(([productId, payload]) => ({
    company_id: env.BOSSA_COMPANY_ID,
    code: `KOPER-${productId}`,
    description: text(payload.productFullName) ?? text(payload.productName) ?? `Produto histórico Koper ${productId}`,
    unit: (text(payload.symbol) ?? text(payload.inputUnit) ?? "un").toLocaleLowerCase("pt-BR"),
    category: "material",
    family_code: "KOPER-REQUEST-HISTORY",
    family_label: "Produtos históricos das solicitações Koper",
    source_system: "koper",
    source_code: productId,
    source_id: productId,
    notes: "Produto histórico referenciado por solicitação de estoque do Flow Aptos.",
    status: "active",
    updated_at: now,
  }));

  let promoted = 0;
  for (const batch of chunks(payloads, 100)) {
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

  const verifiedCatalogInputs = (await readCatalog()).length;
  if (verifiedCatalogInputs !== catalog.length + payloads.length) {
    throw new Error("Historical stock request input verification failed");
  }
  return {
    ok: true,
    stagedItems: items.length,
    historicalInputs: payloads.length,
    promoted,
    verifiedCatalogInputs,
  };
}
