import { createHash } from "node:crypto";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type Stage = { koper_id: string; payload: unknown };
type NativeInvoice = { id: string; project_id: string; supplier_id: string; registry_number: string; invoice_number: string; invoice_total: number; issue_date: string };

const object = (value: unknown): Json => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};
const rows = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : [];
const text = (value: unknown): string | null => (typeof value === "string" || typeof value === "number") && String(value).trim() ? String(value).trim() : null;
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const date = (value: unknown): string | null => {
  const raw = text(value); if (!raw) return null;
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  return Number.isNaN(parsed.valueOf()) ? (/^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null) : parsed.toISOString().slice(0, 10);
};
const stableUuid = (seed: string): string => {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0, 32), "hex");
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex"); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
async function readAll<T>(table: string, query: Record<string,string>): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0;; offset += 1000) {
    const page = await requestSupabase<T[]>(table, { query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }) });
    result.push(...page); if (page.length < 1000) return result;
  }
}

await import("./index.js");

try {
  const [stages, invoices, existing] = await Promise.all([
    readAll<Stage>("koper_staging_records", { select: "koper_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`, source: "eq.koper", entity: "eq.xml_invoice", sync_state: "eq.present", order: "koper_id.asc" }),
    readAll<NativeInvoice>("finance_electronic_invoices", { select: "id,project_id,supplier_id,registry_number,invoice_number,invoice_total,issue_date", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "registry_number.asc" }),
    readAll<{ id: string; source_id: string | null }>("payables", { select: "id,source_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
  ]);
  const nativeBySource = new Map(invoices.map((invoice) => [invoice.registry_number.replace(/^KOPER-NFE-/, ""), invoice]));
  const existingSourceIds = new Set(existing.flatMap((row) => row.source_id ? [row.source_id] : []));
  const exclusions: Record<string,number> = {};
  const plans: Array<Record<string,unknown>> = [];
  let installmentCount = 0, paidCount = 0, openCount = 0, paidAmount = 0, openAmount = 0, balancedInvoices = 0, unbalancedInvoices = 0;
  for (const stage of stages) {
    const invoice = nativeBySource.get(stage.koper_id); if (!invoice) { exclusions.missing_native_invoice = (exclusions.missing_native_invoice ?? 0) + 1; continue; }
    const payload = object(stage.payload); const bill = object(payload.bill); const duplicates = rows(bill.duplicates);
    if (!duplicates.length) { exclusions.missing_duplicates = (exclusions.missing_duplicates ?? 0) + 1; continue; }
    const parsed = duplicates.map((duplicate, index) => {
      const billId = text(duplicate.billId); const dueDate = date(duplicate.dueDate); const amount = number(duplicate.billValue);
      const isPaid = duplicate.isPaid === true; const paymentDate = date(duplicate.paymentDate); const paymentValue = number(duplicate.paymentValue);
      const duplicateNumber = text(duplicate.duplicateNumber) ?? String(index + 1);
      return { billId, dueDate, amount, isPaid, paymentDate, paymentValue, duplicateNumber };
    });
    if (parsed.some((item) => !item.billId || !item.dueDate || item.amount === null || item.amount <= 0 || (item.isPaid && !item.paymentDate))) {
      exclusions.invalid_duplicate = (exclusions.invalid_duplicate ?? 0) + 1; continue;
    }
    const sum = parsed.reduce((total,item) => total + (item.amount ?? 0), 0);
    const difference = Math.abs(sum - Number(invoice.invoice_total));
    const balanced = difference <= Math.max(0.02, Math.abs(Number(invoice.invoice_total)) * 0.00001);
    if (balanced) balancedInvoices += 1; else unbalancedInvoices += 1;
    installmentCount += parsed.length;
    for (const item of parsed) {
      if (item.isPaid) { paidCount += 1; paidAmount += item.paymentValue ?? item.amount ?? 0; }
      else { openCount += 1; openAmount += item.amount ?? 0; }
    }
    plans.push({ sourceInvoiceId: stage.koper_id, nativeInvoiceId: invoice.id, invoiceNumber: invoice.invoice_number, invoiceTotal: invoice.invoice_total, installmentTotal: sum, difference, balanced, installments: parsed.map((item) => ({ ...item, payableId: stableUuid(`elos:koper:payable:${item.billId}`), sourceId: `koper_bill:${item.billId}`, alreadyExists: existingSourceIds.has(`koper_bill:${item.billId}`) })) });
  }
  console.log("KOPER_PAYABLE_PLAN", JSON.stringify({ ok: true, sourceInvoices: stages.length, nativeInvoices: invoices.length, eligibleInvoices: plans.length, exclusions, installments: { total: installmentCount, paid: paidCount, open: openCount, paidAmount, openAmount }, reconciliation: { balancedInvoices, unbalancedInvoices }, idempotency: { existingPayables: existing.length, alreadyExistingPlanned: plans.flatMap((plan) => plan.installments as Array<{alreadyExists:boolean}>).filter((row) => row.alreadyExists).length }, examples: plans.slice(0,5) }));
} catch (error) {
  console.error("KOPER_PAYABLE_PLAN_ERROR", error instanceof Error ? error.message : String(error)); process.exitCode = 1;
}
