import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Row = {
  koper_id: string;
  payload: Record<string, unknown> | null;
  sync_state: string;
  payload_hash: string;
};

const rows: Row[] = [];
const pageSize = 1000;
for (let offset = 0; ; offset += pageSize) {
  const page = await requestSupabase<Row[]>("koper_staging_records", {
    query: new URLSearchParams({
      select: "koper_id,payload,sync_state,payload_hash",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.bill_to_pay",
      order: "koper_id.asc",
      limit: String(pageSize),
      offset: String(offset),
    }),
  });
  rows.push(...page);
  if (page.length < pageSize) break;
}

const ids = new Set<string>();
let duplicateIds = 0;
let totalBillValue = 0;
let paid = 0;
let open = 0;
let missingBillValue = 0;
let missingDueDate = 0;
let withInvoiceNumber = 0;
let withReceiptNumber = 0;
for (const row of rows) {
  if (ids.has(row.koper_id)) duplicateIds += 1;
  ids.add(row.koper_id);
  const payload = row.payload ?? {};
  const amount = Number(payload.billValue);
  if (Number.isFinite(amount)) totalBillValue += amount;
  else missingBillValue += 1;
  if (payload.isPaid === true) paid += 1;
  else open += 1;
  if (!payload.dueDate) missingDueDate += 1;
  if (payload.invoiceNumber) withInvoiceNumber += 1;
  if (payload.receiptNumber) withReceiptNumber += 1;
}

console.log("KOPER_STAGED_FULL_PAYABLE_AUDIT", JSON.stringify({
  ok: rows.length > 0 && duplicateIds === 0,
  rows: rows.length,
  uniqueBillIds: ids.size,
  duplicateIds,
  totalBillValue: Math.round(totalBillValue * 100) / 100,
  paid,
  open,
  missingBillValue,
  missingDueDate,
  withInvoiceNumber,
  withReceiptNumber,
  syncStates: [...new Set(rows.map((row) => row.sync_state))].sort(),
}));

await import("./index.js");
