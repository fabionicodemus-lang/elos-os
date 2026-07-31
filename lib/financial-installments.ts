export type FinancialInstallmentDraft = {
  id: string;
  label: string;
  due_date: string;
  amount: number;
  payment_method: string;
};

export type FinancialInstallmentInput = {
  label?: unknown;
  number?: unknown;
  due_date?: unknown;
  dueDate?: unknown;
  amount?: unknown;
  payment_method?: unknown;
  paymentMethod?: unknown;
};

function isoParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function isoDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function localTodayIso(reference = new Date()) {
  return isoDate(reference.getFullYear(), reference.getMonth() + 1, reference.getDate());
}

export function addDaysIso(value: string, days: number) {
  const parts = isoParts(value);
  if (!parts) return value;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addMonthsClampedIso(value: string, months: number) {
  const parts = isoParts(value);
  if (!parts) return value;
  const absoluteMonth = parts.year * 12 + (parts.month - 1) + months;
  const year = Math.floor(absoluteMonth / 12);
  const monthIndex = ((absoluteMonth % 12) + 12) % 12;
  const month = monthIndex + 1;
  return isoDate(year, month, Math.min(parts.day, daysInMonth(year, month)));
}

export function suggestedFirstDueDate(baseDate = localTodayIso()) {
  return addDaysIso(baseDate, 15);
}

export function moneyToCents(value: number) {
  return Math.round((Number.isFinite(Number(value)) ? Number(value) : 0) * 100);
}

export function centsToMoney(value: number) {
  return value / 100;
}

export function distributeMoney(total: number, count: number) {
  const safeCount = Math.max(1, Math.min(240, Math.trunc(Number(count) || 1)));
  const totalCents = moneyToCents(total);
  const base = Math.floor(totalCents / safeCount);
  const remainder = totalCents - base * safeCount;
  return Array.from({ length: safeCount }, (_, index) => centsToMoney(base + (index === safeCount - 1 ? remainder : 0)));
}

export function buildFinancialInstallments({
  total,
  count,
  firstDueDate = suggestedFirstDueDate(),
  paymentMethod = "Boleto",
  idPrefix = "parcela",
}: {
  total: number;
  count: number;
  firstDueDate?: string;
  paymentMethod?: string;
  idPrefix?: string;
}): FinancialInstallmentDraft[] {
  const amounts = distributeMoney(total, count);
  return amounts.map((amount, index) => ({
    id: `${idPrefix}-${firstDueDate}-${index + 1}-${amount.toFixed(2)}`,
    label: `${index + 1} / ${amounts.length}`,
    due_date: addMonthsClampedIso(firstDueDate, index),
    amount,
    payment_method: paymentMethod,
  }));
}

export function normalizeFinancialInstallments(
  raw: FinancialInstallmentInput[],
  fallbackTotal: number,
  fallbackDate = suggestedFirstDueDate(),
  fallbackMethod = "Boleto",
) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return buildFinancialInstallments({ total: fallbackTotal, count: 1, firstDueDate: fallbackDate, paymentMethod: fallbackMethod });
  }

  return raw.map((item, index) => ({
    id: `parcela-importada-${index + 1}`,
    label: String(item.label ?? item.number ?? `${index + 1} / ${raw.length}`),
    due_date: String(item.due_date ?? item.dueDate ?? addMonthsClampedIso(fallbackDate, index)),
    amount: Number(item.amount ?? 0),
    payment_method: String(item.payment_method ?? item.paymentMethod ?? fallbackMethod),
  }));
}

export function financialInstallmentSummary(total: number, installments: Array<Pick<FinancialInstallmentDraft, "due_date" | "amount">>) {
  const totalCents = moneyToCents(total);
  const installmentCents = installments.reduce((sum, installment) => sum + moneyToCents(Number(installment.amount || 0)), 0);
  const invalidDate = installments.some((installment) => !isoParts(String(installment.due_date || "")));
  const invalidAmount = installments.some((installment) => !Number.isFinite(Number(installment.amount)) || moneyToCents(Number(installment.amount)) <= 0);
  return {
    totalCents,
    installmentCents,
    differenceCents: installmentCents - totalCents,
    total: centsToMoney(totalCents),
    installmentTotal: centsToMoney(installmentCents),
    difference: centsToMoney(installmentCents - totalCents),
    valid: installments.length > 0 && totalCents > 0 && !invalidDate && !invalidAmount && installmentCents === totalCents,
  };
}

export function installmentsForPayload(installments: FinancialInstallmentDraft[]) {
  return installments.map(({ label, due_date, amount, payment_method }) => ({ label, number: label, due_date, amount, payment_method }));
}
