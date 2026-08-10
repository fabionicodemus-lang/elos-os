import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
const objectValue = (value: unknown): Json => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};
const identifier = (value: unknown): string | null => (typeof value === "string" || typeof value === "number") && String(value).trim() ? String(value).trim() : null;
const numberValue = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const receiptIds = (payload: Json): string[] => (Array.isArray(payload.receipts) ? payload.receipts : []).flatMap((raw) => {
  const id = identifier(objectValue(raw).receiptId);
  return id ? [id] : [];
});
const identity = (payload: Json) => ({
  productId: identifier(payload.productId),
  mainProductId: identifier(payload.mainProductId),
  genericProdSeq: identifier(payload.genericProdSeq),
  inputId: identifier(payload.inputId),
});
const targetIdentity = { productId: "8639", mainProductId: null, genericProdSeq: "1007", inputId: null };
const matchesIdentity = (candidate: ReturnType<typeof identity>): boolean => Boolean(
  candidate.productId === targetIdentity.productId
  || candidate.mainProductId === targetIdentity.productId
  || candidate.genericProdSeq === targetIdentity.genericProdSeq
);

const pages = await Promise.all([0, 1000, 2000, 3000, 4000].map((offset) =>
  requestSupabase<StagingRow[]>("koper_staging_records", {
    query: new URLSearchParams({
      select: "koper_id,koper_parent_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.stock_entry_item",
      sync_state: "eq.present",
      order: "koper_id.asc",
      limit: "1000",
      offset: String(offset),
    }),
  }),
));
const allItems = pages.flat();
const related = allItems.filter((row) => {
  if (row.koper_id === "4601") return false;
  const payload = objectValue(row.payload);
  return receiptIds(payload).includes("3829") && matchesIdentity(identity(payload));
}).map((row) => ({
  itemId: row.koper_id,
  entryId: row.koper_parent_id,
  productAmount: numberValue(objectValue(row.payload).productAmount),
  productValue: numberValue(objectValue(row.payload).productValue),
  totalProductValue: numberValue(objectValue(row.payload).totalProductValue),
  receiptIds: receiptIds(objectValue(row.payload)),
  identity: identity(objectValue(row.payload)),
  payload: objectValue(row.payload),
}));

const productRelated = allItems.filter((row) => row.koper_id !== "4601" && matchesIdentity(identity(objectValue(row.payload)))).map((row) => ({
  itemId: row.koper_id,
  entryId: row.koper_parent_id,
  productAmount: numberValue(objectValue(row.payload).productAmount),
  receiptIds: receiptIds(objectValue(row.payload)),
  identity: identity(objectValue(row.payload)),
}));
const relatedEntryIds = [...new Set(related.flatMap((row) => row.entryId ? [row.entryId] : []))];
const relatedEntries = relatedEntryIds.length ? await requestSupabase<StagingRow[]>("koper_staging_records", {
  query: new URLSearchParams({
    select: "koper_id,koper_parent_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: "eq.stock_entry",
    koper_id: `in.(${relatedEntryIds.map((id) => `\"${id}\"`).join(",")})`,
    limit: "1000",
  }),
}) : [];

console.log("KOPER_ZERO_3606_PAGINATED", JSON.stringify({
  ok: true,
  readOnly: true,
  pageSizes: pages.map((page) => page.length),
  allItems: allItems.length,
  exactSameReceiptAndProduct: related,
  sameProductAnywhere: productRelated,
  relatedEntries: relatedEntries.map((row) => ({ entryId: row.koper_id, payload: objectValue(row.payload) })),
}));
