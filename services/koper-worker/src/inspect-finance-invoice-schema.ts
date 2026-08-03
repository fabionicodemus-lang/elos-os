import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;

const object = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

async function openApi(): Promise<Json> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase not configured");
  const response = await fetch(new URL("/rest/v1/", env.SUPABASE_URL), {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/openapi+json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Supabase OpenAPI failed HTTP ${response.status}`);
  return object(await response.json());
}

function resolved(raw: unknown, definitions: Json): Json {
  const schema = object(raw);
  const ref = typeof schema.$ref === "string" ? schema.$ref : null;
  if (!ref) return schema;
  const name = ref.split("/").at(-1);
  return name ? object(definitions[name]) : schema;
}

async function count(table: string, filters: Record<string, string> = {}): Promise<number> {
  const response = await requestSupabase<Array<{ id: string }>>(table, {
    query: new URLSearchParams({ select: "id", ...filters, limit: "1" }),
    prefer: "count=exact",
  });
  const rows = response as Array<{ id: string }> & { count?: number };
  return typeof rows.count === "number" ? rows.count : response.length;
}

await import("./index.js");

try {
  const api = await openApi();
  const definitions = object(api.definitions);
  const paths = object(api.paths);
  const matcher = /(electronic_invoice|invoice|accounts?_payable|bill|payable|material_receipt)/i;

  console.log("KOPER_FINANCE_INVOICE_PATHS", JSON.stringify(Object.keys(paths).filter((path) => matcher.test(path)).sort()));

  for (const [name, rawDefinition] of Object.entries(definitions)) {
    if (!matcher.test(name)) continue;
    const definition = object(rawDefinition);
    const properties = object(definition.properties);
    const compact = Object.fromEntries(Object.entries(properties).map(([key, raw]) => {
      const property = resolved(raw, definitions);
      return [key, {
        type: property.type ?? null,
        format: property.format ?? null,
        enum: Array.isArray(property.enum) ? property.enum : null,
        default: property.default ?? null,
      }];
    }));
    console.log("KOPER_FINANCE_INVOICE_TABLE", JSON.stringify({
      table: name,
      required: strings(definition.required),
      properties: compact,
    }));
  }

  const rpcTargets = Object.keys(paths).filter((path) => /\/rpc\//.test(path) && matcher.test(path)).sort();
  for (const path of rpcTargets) {
    const post = object(object(paths[path]).post);
    const parameters = Array.isArray(post.parameters) ? post.parameters.map(object) : [];
    const args = parameters.find((parameter) => parameter.name === "args");
    const schema = resolved(args?.schema, definitions);
    const properties = object(schema.properties);
    console.log("KOPER_FINANCE_INVOICE_RPC", JSON.stringify({
      path,
      required: strings(schema.required),
      properties: Object.fromEntries(Object.entries(properties).map(([key, raw]) => {
        const property = resolved(raw, definitions);
        return [key, {
          type: property.type ?? null,
          format: property.format ?? null,
          enum: Array.isArray(property.enum) ? property.enum : null,
          default: property.default ?? null,
        }];
      })),
    }));
  }

  const tables = [
    "finance_electronic_invoices",
    "finance_electronic_invoice_items",
    "finance_electronic_invoice_installments",
    "finance_electronic_invoice_divergences",
    "finance_electronic_invoice_audit",
    "finance_accounts_payable",
    "finance_accounts_payable_installments",
    "procurement_material_receipts",
    "procurement_material_receipt_items",
  ];

  for (const table of tables) {
    try {
      const sample = await requestSupabase<Json[]>(table, {
        query: new URLSearchParams({ select: "*", company_id: `eq.${env.BOSSA_COMPANY_ID}`, limit: "1" }),
      });
      const total = await count(table, { company_id: `eq.${env.BOSSA_COMPANY_ID}` });
      console.log("KOPER_FINANCE_INVOICE_SAMPLE", JSON.stringify({
        table,
        reachable: true,
        total,
        keys: Object.keys(sample[0] ?? {}).sort(),
      }));
    } catch (error: unknown) {
      console.log("KOPER_FINANCE_INVOICE_SAMPLE", JSON.stringify({
        table,
        reachable: false,
        error: error instanceof Error ? error.message.slice(0, 240) : "unknown",
      }));
    }
  }

  const stagedInvoices = await requestSupabase<Array<{ id: string }>>("koper_staging_records", {
    query: new URLSearchParams({
      select: "id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.xml_invoice",
      sync_state: "eq.present",
      limit: "1",
    }),
    prefer: "count=exact",
  });
  const stagedProducts = await requestSupabase<Array<{ id: string }>>("koper_staging_records", {
    query: new URLSearchParams({
      select: "id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.xml_invoice_product",
      sync_state: "eq.present",
      limit: "1",
    }),
    prefer: "count=exact",
  });
  console.log("KOPER_FINANCE_INVOICE_STAGING", JSON.stringify({
    invoices: (stagedInvoices as Array<{ id: string }> & { count?: number }).count ?? stagedInvoices.length,
    products: (stagedProducts as Array<{ id: string }> & { count?: number }).count ?? stagedProducts.length,
  }));
  console.log("KOPER_FINANCE_INVOICE_SCHEMA_DONE", JSON.stringify({ ok: true }));
} catch (error: unknown) {
  console.error("KOPER_FINANCE_INVOICE_SCHEMA_FAILED", {
    message: error instanceof Error ? error.message.slice(0, 1_000) : "unknown",
  });
}
