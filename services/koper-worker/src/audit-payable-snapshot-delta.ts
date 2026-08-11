import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Row = {
  koper_id: string;
  payload: Record<string, unknown> | null;
};

const rows: Row[] = [];
const pageSize = 1000;
for (let offset = 0; ; offset += pageSize) {
  const page = await requestSupabase<Row[]>("koper_staging_records", {
    query: new URLSearchParams({
      select: "koper_id,payload",
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

const money = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};
const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result || null;
};

const normalized = rows.map((row) => {
  const payload = row.payload ?? {};
  return {
    billId: row.koper_id,
    numericId: Number(row.koper_id),
    cents: money(payload.billValue),
    billValue: money(payload.billValue) / 100,
    issueDate: text(payload.issueDate),
    dueDate: text(payload.dueDate),
    paymentDate: text(payload.paymentDate),
    isPaid: payload.isPaid === true,
    invoiceNumber: text(payload.invoiceNumber),
    receiptNumber: text(payload.receiptNumber),
    originName: text(payload.originName),
  };
}).sort((a, b) => (Number.isFinite(b.numericId) ? b.numericId : -1) - (Number.isFinite(a.numericId) ? a.numericId : -1));

const manualCount = 3833;
const currentCount = normalized.length;
const targetDeltaCents = Math.round((18427714.81 - 18415121.40) * 100);
const countDelta = currentCount - manualCount;
const newestById = normalized.slice(0, Math.max(20, countDelta));
const newestFive = normalized.slice(0, 5);
const newestFiveCents = newestFive.reduce((sum, row) => sum + row.cents, 0);

// Look for an exact 5-title combination in the newest 60 bill IDs. This is diagnostic only:
// it does not prove creation time, but it can identify a compact candidate set for detail inspection.
const searchPool = normalized.slice(0, 60);
const candidates: typeof normalized[] = [];
outer:
for (let a = 0; a < searchPool.length - 4; a += 1) {
  for (let b = a + 1; b < searchPool.length - 3; b += 1) {
    for (let c = b + 1; c < searchPool.length - 2; c += 1) {
      for (let d = c + 1; d < searchPool.length - 1; d += 1) {
        const partial = searchPool[a].cents + searchPool[b].cents + searchPool[c].cents + searchPool[d].cents;
        for (let e = d + 1; e < searchPool.length; e += 1) {
          if (partial + searchPool[e].cents === targetDeltaCents) {
            candidates.push([searchPool[a], searchPool[b], searchPool[c], searchPool[d], searchPool[e]]);
            if (candidates.length >= 5) break outer;
          }
        }
      }
    }
  }
}

console.log("KOPER_PAYABLE_SNAPSHOT_DELTA_AUDIT", JSON.stringify({
  manual: { rows: manualCount, total: 18415121.40 },
  current: { rows: currentCount, total: 18427714.81 },
  delta: { rows: countDelta, total: targetDeltaCents / 100 },
  newestFive: {
    total: newestFiveCents / 100,
    exactDelta: newestFiveCents === targetDeltaCents,
    rows: newestFive,
  },
  newest20: newestById.slice(0, 20),
  exactFiveTitleCandidatesInNewest60: candidates.map((set) => ({
    total: set.reduce((sum, row) => sum + row.cents, 0) / 100,
    rows: set,
  })),
}));

await import("./index.js");
