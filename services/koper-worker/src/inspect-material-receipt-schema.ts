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
  const paths = Object.keys(objectValue(api.paths))
    .filter((path) => /(material_receipt|receipt|stock_movement|inventory.*movement|purchase_order)/i.test(path))
    .sort();

  console.log("KOPER_MATERIAL_RECEIPT_SCHEMA_PATHS", JSON.stringify(paths));

  for (const [name, rawDefinition] of Object.entries(definitions)) {
    if (!/(material_receipt|receipt|stock_movement|inventory.*movement|purchase_order)/i.test(name)) continue;
    const definition = objectValue(rawDefinition);
    const properties = objectValue(definition.properties);
    const compactProperties = Object.fromEntries(Object.entries(properties).map(([key, raw]) => {
      const property = objectValue(raw);
      return [key, [property.type ?? null, property.format ?? null]];
    }));
    console.log("KOPER_MATERIAL_RECEIPT_SCHEMA_TABLE", JSON.stringify({
      table: name,
      required: stringArray(definition.required),
      properties: compactProperties,
    }));
  }

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

  for (const table of targetTables) {
    try {
      const rows = await requestSupabase<UnknownRecord[]>(table, {
        query: new URLSearchParams({ select: "*", company_id: `eq.${env.BOSSA_COMPANY_ID}`, limit: "1" }),
      });
      console.log("KOPER_MATERIAL_RECEIPT_SCHEMA_SAMPLE", JSON.stringify({
        table,
        reachable: true,
        sampledRows: rows.length,
        keys: Object.keys(rows[0] ?? {}).sort(),
      }));
    } catch (error: unknown) {
      console.log("KOPER_MATERIAL_RECEIPT_SCHEMA_SAMPLE", JSON.stringify({
        table,
        reachable: false,
        error: error instanceof Error ? error.message.slice(0, 220) : "unknown",
      }));
    }
  }

  console.log("KOPER_MATERIAL_RECEIPT_SCHEMA_DONE", JSON.stringify({ ok: true }));
} catch (error: unknown) {
  console.error("KOPER_MATERIAL_RECEIPT_SCHEMA_FAILED", {
    message: error instanceof Error ? error.message.slice(0, 500) : "unknown",
  });
}
