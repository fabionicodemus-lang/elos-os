import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type Stage = {
  koper_id: string;
  koper_parent_id: string | null;
  payload: unknown;
};
type ExistingPayable = {
  id: string;
  source_id: string | null;
  source_system: string | null;
  source_category: string | null;
  amount: number;
  status: string;
};

type NativeBill = {
  billId: string;
  billToPayId: string | null;
  fatherBillId: string | null;
  joinBillId: string | null;
  billValue: number;
  paymentValue: number | null;
  dueDate: string | null;
  paymentDate: string | null;
  isPaid: boolean;
  originName: string | null;
  invoiceNumber: string | null;
  receiptNumber: string | null;
  recTypeId: string | null;
  recTypeName: string | null;
  hasRecurrence: boolean;
  splitted: boolean;
  installmentAmount: number | null;
  billOrder: string | null;
  taxId: string | null;
  checkId: string | null;
};

const object = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};

const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const number = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const nullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const boolean = (value: unknown): boolean =>
  value === true || value === 1 || value === "1" || String(value ?? "").toUpperCase() === "S";

async function readAll<T>(table: string, query: Record<string, string>): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(table, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
    });
    result.push(...page);
    if (page.length < 1_000) return result;
  }
}

function nativeBill(stage: Stage): NativeBill {
  const payload = object(stage.payload);
  return {
    billId: text(payload.billId) ?? stage.koper_id,
    billToPayId: text(payload.billToPayId) ?? stage.koper_parent_id,
    fatherBillId: text(payload.fatherBillId),
    joinBillId: text(payload.joinBillId),
    billValue: number(payload.billValue),
    paymentValue: nullableNumber(payload.paymentValue),
    dueDate: text(payload.dueDate),
    paymentDate: text(payload.paymentDate),
    isPaid: boolean(payload.isPaid),
    originName: text(payload.originName),
    invoiceNumber: text(payload.invoiceNumber),
    receiptNumber: text(payload.receiptNumber),
    recTypeId: text(payload.recTypeId),
    recTypeName: text(payload.recTypeName),
    hasRecurrence: boolean(payload.hasRecurrence),
    splitted: boolean(payload.splitted),
    installmentAmount: nullableNumber(payload.installmentAmount),
    billOrder: text(payload.billOrder),
    taxId: text(payload.taxId),
    checkId: text(payload.checkId),
  };
}

function counter(values: Array<string | null>): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value ?? "(null)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function money(rows: NativeBill[]): number {
  return Math.round(rows.reduce((sum, row) => sum + row.billValue, 0) * 100) / 100;
}

await import("./index.js");

try {
  const [stages, existingPayables] = await Promise.all([
    readAll<Stage>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.bill_to_pay",
      sync_state: "eq.present",
      order: "koper_id.asc",
    }),
    readAll<ExistingPayable>("payables", {
      select: "id,source_id,source_system,source_category,amount,status",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      order: "id.asc",
    }),
  ]);

  const bills = stages.map(nativeBill);
  const byId = new Map(bills.map((bill) => [bill.billId, bill]));
  const childrenByFather = new Map<string, NativeBill[]>();
  const rowsByTitle = new Map<string, NativeBill[]>();

  for (const bill of bills) {
    if (bill.fatherBillId) {
      const children = childrenByFather.get(bill.fatherBillId) ?? [];
      children.push(bill);
      childrenByFather.set(bill.fatherBillId, children);
    }
    if (bill.billToPayId) {
      const titleRows = rowsByTitle.get(bill.billToPayId) ?? [];
      titleRows.push(bill);
      rowsByTitle.set(bill.billToPayId, titleRows);
    }
  }

  const existingKoperSourceIds = new Set(
    existingPayables.flatMap((row) =>
      row.source_id && String(row.source_system ?? "").includes("koper") ? [row.source_id] : [],
    ),
  );

  const directImported = bills.filter((bill) => existingKoperSourceIds.has(`koper_bill:${bill.billId}`));
  const withFather = bills.filter((bill) => bill.fatherBillId !== null);
  const parentRows = bills.filter((bill) => childrenByFather.has(bill.billId));
  const selfTitleRows = bills.filter((bill) => bill.billToPayId === bill.billId);
  const joined = bills.filter((bill) => bill.joinBillId !== null);
  const withInvoice = bills.filter((bill) => bill.invoiceNumber !== null);
  const withReceipt = bills.filter((bill) => bill.receiptNumber !== null);
  const invoiceAndReceipt = bills.filter((bill) => bill.invoiceNumber !== null && bill.receiptNumber !== null);
  const neither = bills.filter((bill) => bill.invoiceNumber === null && bill.receiptNumber === null);
  const recurring = bills.filter((bill) => bill.hasRecurrence);
  const splitFlag = bills.filter((bill) => bill.splitted);
  const tax = bills.filter((bill) => bill.taxId !== null);
  const check = bills.filter((bill) => bill.checkId !== null);

  const groupedTitles = [...rowsByTitle.entries()].map(([billToPayId, rows]) => {
    const fathers = rows.filter((row) => row.fatherBillId !== null);
    const parents = rows.filter((row) => childrenByFather.has(row.billId));
    return {
      billToPayId,
      rows: rows.length,
      value: money(rows),
      parentRows: parents.length,
      childRows: fathers.length,
      invoiceRows: rows.filter((row) => row.invoiceNumber !== null).length,
      receiptRows: rows.filter((row) => row.receiptNumber !== null).length,
      recurringRows: rows.filter((row) => row.hasRecurrence).length,
      billIds: rows.map((row) => row.billId),
    };
  });

  const suspiciousParentChildGroups = groupedTitles.filter((group) => group.parentRows > 0 || group.childRows > 0);
  const multiRowTitles = groupedTitles.filter((group) => group.rows > 1);

  const missingFatherTargets = [...childrenByFather.keys()].filter((fatherId) => !byId.has(fatherId));
  const parentValueChecks = parentRows.map((parent) => {
    const children = childrenByFather.get(parent.billId) ?? [];
    const childValue = money(children);
    return {
      parentBillId: parent.billId,
      billToPayId: parent.billToPayId,
      parentValue: parent.billValue,
      childCount: children.length,
      childValue,
      difference: Math.round((childValue - parent.billValue) * 100) / 100,
    };
  });

  const result = {
    ok: true,
    readOnly: true,
    source: {
      stagedBills: bills.length,
      stagedValue: money(bills),
      paid: { count: bills.filter((bill) => bill.isPaid).length, value: money(bills.filter((bill) => bill.isPaid)) },
      open: { count: bills.filter((bill) => !bill.isPaid).length, value: money(bills.filter((bill) => !bill.isPaid)) },
    },
    relationships: {
      titles: groupedTitles.length,
      multiRowTitles: multiRowTitles.length,
      withFather: withFather.length,
      parentRows: parentRows.length,
      selfTitleRows: selfTitleRows.length,
      withJoin: joined.length,
      splitFlag: splitFlag.length,
      missingFatherTargets: missingFatherTargets.length,
      suspiciousParentChildGroups: suspiciousParentChildGroups.length,
    },
    references: {
      invoice: withInvoice.length,
      receipt: withReceipt.length,
      invoiceAndReceipt: invoiceAndReceipt.length,
      neitherInvoiceNorReceipt: neither.length,
      recurring: recurring.length,
      tax: tax.length,
      check: check.length,
    },
    importedCoverage: {
      existingPayables: existingPayables.length,
      existingKoperSourceIds: existingKoperSourceIds.size,
      exactBillIdsAlreadyImported: directImported.length,
      exactBillValueAlreadyImported: money(directImported),
      stagedBillIdsNotImported: bills.length - directImported.length,
    },
    recTypes: counter(bills.map((bill) => bill.recTypeId ? `${bill.recTypeId}|${bill.recTypeName ?? ""}` : null)).slice(0, 40),
    origins: counter(bills.map((bill) => bill.originName)).slice(0, 80),
    samples: {
      parentValueChecks: parentValueChecks.slice(0, 40),
      multiRowTitles: multiRowTitles.slice(0, 40),
      missingFatherTargets: missingFatherTargets.slice(0, 40),
      neitherInvoiceNorReceipt: neither.slice(0, 40),
      recurring: recurring.slice(0, 40),
    },
  };

  console.log("KOPER_NATIVE_PAYABLE_PREVIEW", JSON.stringify(result));
} catch (error) {
  console.error("KOPER_NATIVE_PAYABLE_PREVIEW_ERROR", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
