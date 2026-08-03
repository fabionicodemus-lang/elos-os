import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type UnknownRecord = Record<string, unknown>;

function objectValue(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function schemaSummary(name: string, value: unknown): UnknownRecord {
  const schema = objectValue(value);
  const properties = objectValue(schema.properties);
  return {
    table: name,
    required: stringArray(schema.required),
    properties: Object.fromEntries(Object.entries(properties).map(([key, raw]) => {
      const property = objectValue(raw);
      return [key, {
        type: property.type ?? null,
        format: property.format ?? null,
        default: property.default ?? null,
        description: typeof property.description === "string" ? property.description.slice(0, 160) : null,
      }];
    })),
  };
}

async function openApi(): Promise<UnknownRecord> {
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
  return objectValue(await response.json());
}

await import("./index.js");

try {
  const api = await openApi();
  const definitions = objectValue(api.definitions);
  const matchingDefinitions = Object.entries(definitions)
    .filter(([name]) => /(material_receipt|receipt|stock_movement|inventory.*movement|purchase_order)/i.test(name))
    .map(([name, definition]) => schemaSummary(name, definition));

  const paths = Object.keys(objectValue(api.paths))
    .filter((path) => /(material_receipt|receipt|stock_movement|inventory.*movement|purchase_order)/i.test(path))
    .sort();

  const targetTables = [
    "procurement_material_receipts",
    "procurement_material_receipt_items",
    "procurement_material_receipt_divergences",
    "procurement_material_receipt_documents",
    "inventory_stock_movements",
    "stock_movements",
    "procurement_purchase_orders",
    "procurement_purchase_order_items",
  ];

  const samples: Record<string, unknown> = {};
  for (const table of targetTables) {
    try {
      const rows = await requestSupabase<UnknownRecord[]>(table, {
        query: new URLSearchParams({ select: "*", company_id: `eq.${env.BOSSA_COMPANY_ID}`, limit: "1" }),
      });
      samples[table] = { reachable: true, sampledRows: rows.length, keys: Object.keys(rows[0] ?? {}).sort() };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown";
      samples[table] = { reachable: false, error: message.slice(0, 300) };
    }
  }

  console.log("KOPER_MATERIAL_RECEIPT_SCHEMA_RESULT", JSON.stringify({
    ok: true,
    paths,
    definitions: matchingDefinitions,
    samples,
  }));
} catch (error: unknown) {
  console.error("KOPER_MATERIAL_RECEIPT_SCHEMA_FAILED", {
    message: error instanceof Error ? error.message.slice(0, 500) : "unknown",
  });
}
