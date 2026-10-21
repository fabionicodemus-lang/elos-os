import { createHash } from 'node:crypto';
import { decimalToCents } from '../money.mjs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const cents = value => decimalToCents(value, { rounding: 'half-away-from-zero' });
// API shape evidenced by clean-import waves. This adapter does not infer project,
// supplier or settlement components. Bindings must come from confirmed IDs.
export function normalizeBill(payload, binding = {}) {
  const d = payload.data ?? payload;
  const bindingKeys = new Set(['legal_entity_id','project_id','supplier_id','target_id','binding_evidence','effective_date','obligation_evidence','change_evidence','allocations','obligation_extinguished','cancellation_evidence']);
  if (Object.keys(binding).some(key => !bindingKeys.has(key))) throw Error('Vínculo não pode substituir valores ou identidade da origem');
  return {
    external_id: d.bill_id == null ? null : String(d.bill_id),
    installment: String(d.duplicate_number ?? 'bill'),
    document_id: d.origins?.invoice_id ?? d.origins?.receipt_id ?? null,
    document: d.bill_receipt_number ?? d.origins?.invoice_number ?? null,
    principal_cents: cents(d.bill_value),
    reported_paid_cents: cents(d.payment?.value ?? d.payment_value),
    source_status: d.status ?? null,
    source_origin: d.bill_origin?.origin_name ?? null,
    grouped_into_id: d.join_bill_id == null ? null : String(d.join_bill_id),
    is_grouping_parent: d.bill_origin?.origin_name === '-',
    due_date: typeof d.due_date === 'string' ? d.due_date.slice(0, 10) : null,
    ...binding,
  };
}

// fetchPage is a read-only transport adapter. No live URL/credential or default
// company is embedded here. Keep raw bytes separately from interpreted rows.
export async function collectFinancialPages({ fetchPage, expectedCount = null, expectedTotalCents = null, maxPages = 10000, retries = 0 }) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || !Number.isInteger(retries) || retries < 0 || retries > 3) throw Error('Limites inválidos');
  if (expectedCount !== null && (!Number.isSafeInteger(expectedCount) || expectedCount < 0)) throw Error('Universo inválido');
  const pages = [], rows = [], errors = [], seenCursors = new Set(), seenIds = new Set();
  let cursor = null, terminal = false;
  for (let i = 0; i < maxPages; i++) {
    const key = JSON.stringify(cursor);
    if (seenCursors.has(key)) { errors.push('repeated_cursor'); break; }
    seenCursors.add(key);
    let page;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try { page = await fetchPage(cursor); break; }
      catch { if (attempt === retries) errors.push(`page_failed:${i + 1}`); }
    }
    if (!page) break;
    if (!Array.isArray(page.rows) || !Object.hasOwn(page, 'nextCursor') || typeof page.raw !== 'string') { errors.push('invalid_page'); break; }
    pages.push({ request_cursor: cursor, next_cursor: page.nextCursor, raw: page.raw, sha256: sha256(page.raw) });
    for (const row of page.rows) {
      const id = row.external_id == null ? null : JSON.stringify([row.external_id, row.installment]);
      if (id === null) { errors.push('missing_identity'); rows.push(row); continue; }
      if (seenIds.has(id)) { errors.push(`duplicate_identity:${id}`); continue; }
      seenIds.add(id); rows.push(row);
    }
    if (page.nextCursor === null) { terminal = true; break; }
    cursor = page.nextCursor;
  }
  if (!terminal && !errors.length) errors.push('page_limit');
  const knownMoney = rows.every(r => Number.isSafeInteger(r.principal_cents) && r.principal_cents >= 0);
  const subtotal = knownMoney ? rows.reduce((sum, row) => sum + row.principal_cents, 0) : null;
  if (subtotal !== null && !Number.isSafeInteger(subtotal)) throw Error('Total fora do intervalo seguro');
  if (!knownMoney) errors.push('unknown_or_invalid_money');
  if (expectedCount === null) errors.push('unknown_universe');
  else if (seenIds.size !== expectedCount) errors.push('count_mismatch');
  if (expectedTotalCents !== null && subtotal !== expectedTotalCents) errors.push('total_mismatch');
  const complete = terminal && errors.length === 0;
  return { pages, records: rows, manifest: {
    expected_count: expectedCount, expected_total_cents: expectedTotalCents,
    unique_count: seenIds.size, row_count: rows.length, subtotal_cents: subtotal,
    coverage_percent: expectedCount > 0 ? (100 * seenIds.size / expectedCount).toFixed(2) : expectedCount === 0 && complete ? '100.00' : null,
    complete, certified_total_cents: complete ? subtotal : null, errors,
  } };
}
