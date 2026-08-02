import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type UnknownRecord = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };

function objectValue(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function identifier(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

async function readRows(entity: string, filterKey: "koper_id" | "koper_parent_id", ids: string[]): Promise<StagingRow[]> {
  return await requestSupabase<StagingRow[]>("koper_staging_records", {
    query: new URLSearchParams({
      select: "koper_id,koper_parent_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: `eq.${entity}`,
      sync_state: "eq.present",
      [filterKey]: `in.(${ids.join(",")})`,
      order: "koper_id.asc",
      limit: "1000",
    }),
  });
}

async function readOpenApi(): Promise<UnknownRecord> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase não configurado");
  }
  const response = await fetch(new URL("/rest/v1/", env.SUPABASE_URL), {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/openapi+json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Supabase OpenAPI failed (HTTP ${response.status})`);
  return objectValue(await response.json()) ?? {};
}

const ORDER_IDS = ["10440", "10455", "10456"];
const [openApi, orders, items] = await Promise.all([
  readOpenApi(),
  readRows("purchase_order", "koper_id", ORDER_IDS),
  readRows("purchase_order_item", "koper_parent_id", ORDER_IDS),
]);

const definitions = objectValue(openApi.definitions) ?? objectValue(openApi.components)?.schemas;
const schemaCandidates = Object.entries(definitions ?? {})
  .filter(([name]) => /receipt|receiv|stock|inventory|warehouse|entry|movement|purchase_order|invoice/i.test(name))
  .map(([name, definition]) => {
    const object = objectValue(definition) ?? {};
    const properties = objectValue(object.properties) ?? {};
    return {
      name,
      fields: Object.keys(properties).sort(),
      required: Array.isArray(object.required)
        ? object.required.filter((item): item is string => typeof item === "string")
        : [],
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const orderSummaries = orders.map((row) => {
  const payload = objectValue(row.payload) ?? {};
  return {
    orderId: row.koper_id,
    status: identifier(payload.status) ?? identifier(payload.orderStatus),
    supplierId: identifier(payload.supplierId),
    productsCount: Array.isArray(payload.products) ? payload.products.length : null,
  };
});

const itemSummaries = items.map((row) => {
  const payload = objectValue(row.payload) ?? {};
  return {
    koperId: row.koper_id,
    orderId: row.koper_parent_id,
    orderProductId: identifier(payload.orderProductId) ?? identifier(payload.id),
    productId: identifier(payload.productId),
    mainProductId: identifier(payload.mainProductId),
    genericProdSeq: identifier(payload.genericProdSeq),
    amount: numeric(payload.amount) ?? numeric(payload.productAmount),
    unitPrice: numeric(payload.finalPrice) ?? numeric(payload.price) ?? numeric(payload.productValue),
    totalValue: numeric(payload.totalValue) ?? numeric(payload.finalValue),
  };
});

console.log("KOPER_RECEIPT_SCHEMA_AND_STAGING_RESULT", JSON.stringify({
  schemaCandidates,
  ordersRequested: ORDER_IDS,
  ordersFound: orders.length,
  orderSummaries,
  itemsFound: items.length,
  itemSummaries,
}));

await import("./index.js");
