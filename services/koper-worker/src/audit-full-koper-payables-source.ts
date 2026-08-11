import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;

type Bill = {
  billId?: number | string | null;
  billToPayId?: number | string | null;
  fatherBillId?: number | string | null;
  joinBillId?: number | string | null;
  billValue?: number | string | null;
  paymentValue?: number | string | null;
  dueDate?: string | null;
  paymentDate?: string | null;
  isPaid?: boolean | null;
  invoiceNumber?: string | number | null;
  receiptNumber?: string | number | null;
  billReceiptNumber?: string | number | null;
  recTypeId?: number | string | null;
  recTypeName?: string | null;
  installmentAmount?: number | string | null;
  duplicateNumber?: string | number | null;
  billOrder?: number | string | null;
  splitted?: boolean | null;
  hasRecurrence?: boolean | null;
  taxId?: number | string | null;
};

const object = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : null;

const number = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const cents = (value: number): number => Math.round((value + Number.EPSILON) * 100);
const money = (valueInCents: number): number => valueInCents / 100;
const present = (value: unknown): boolean => value !== null && value !== undefined && String(value).trim() !== "";

function safeSample(bill: Bill): Json {
  return {
    billId: bill.billId ?? null,
    billToPayId: bill.billToPayId ?? null,
    fatherBillId: bill.fatherBillId ?? null,
    joinBillId: bill.joinBillId ?? null,
    billValue: number(bill.billValue),
    dueDate: bill.dueDate ?? null,
    isPaid: bill.isPaid ?? null,
    invoiceNumber: bill.invoiceNumber ?? null,
    receiptNumber: bill.receiptNumber ?? null,
    billReceiptNumber: bill.billReceiptNumber ?? null,
    recTypeId: bill.recTypeId ?? null,
    installmentAmount: bill.installmentAmount ?? null,
    duplicateNumber: bill.duplicateNumber ?? null,
    billOrder: bill.billOrder ?? null,
    splitted: bill.splitted ?? null,
    hasRecurrence: bill.hasRecurrence ?? null,
    taxId: bill.taxId ?? null,
  };
}

try {
  const result = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ok: false, message: login.message };

    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (isKoper && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !isAllowedFlowSwitch(url, request.method(), request.postData())) {
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {}
      await route.continue();
    });

    const flowSelected = await selectFlow(page);
    if (!flowSelected) return { ok: false, message: "KOPER_FLOW_COMPANY_NOT_SELECTED", blockedWrites };

    const seedPromise = page.waitForResponse((response: Response) => {
      try {
        const url = new URL(response.url());
        return response.request().method() === "GET"
          && url.hostname === "api.koper.com.br"
          && url.pathname === "/financial/v1/bills_to_pay";
      } catch {
        return false;
      }
    }, { timeout: 25_000 }).catch(() => null);

    await page.goto("https://app.koper.com.br/financeiro/contas_pagar", {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    }).catch(() => undefined);

    const seed = await seedPromise;
    if (!seed) return { ok: false, message: "KOPER_PAYABLE_SEED_REQUEST_NOT_FOUND", blockedWrites };

    const template = new URL(seed.url());
    template.searchParams.set("allBills", "yes");
    template.searchParams.set("initialDate", "");
    template.searchParams.set("finalDate", "");
    template.searchParams.set("limit", "200");
    template.searchParams.set("offset", "0");
    template.searchParams.set("orderFlag", "asc");
    template.searchParams.set("orderby", "dueDate");
    template.searchParams.set("typeDate", "dueDate");

    const allBills: Bill[] = [];
    let expectedRows: number | null = null;
    let expectedTotalCents: number | null = null;
    let offset = 0;
    let pages = 0;
    const pageSize = 200;

    while (pages < 100) {
      const url = new URL(template);
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(offset));

      const response = await page.request.get(url.toString(), { timeout: 25_000 });
      if (!response.ok()) {
        return {
          ok: false,
          message: "KOPER_PAYABLE_PAGE_FAILED",
          status: response.status(),
          offset,
          pages,
          blockedWrites,
        };
      }

      const body = object(await response.json().catch(() => null));
      if (!body) return { ok: false, message: "KOPER_PAYABLE_INVALID_BODY", offset, pages, blockedWrites };
      const rows = Array.isArray(body.bills) ? body.bills.filter((item): item is Bill => Boolean(object(item))) : [];

      if (expectedRows === null) expectedRows = number(body.billsAmount);
      if (expectedTotalCents === null) expectedTotalCents = cents(number(body.totalBills));

      allBills.push(...rows);
      pages += 1;
      offset += rows.length;

      if (!rows.length || (expectedRows !== null && offset >= expectedRows) || rows.length < pageSize) break;
    }

    const byId = new Map<string, Bill>();
    for (const bill of allBills) {
      const id = present(bill.billId) ? String(bill.billId) : "";
      if (id && !byId.has(id)) byId.set(id, bill);
    }
    const unique = [...byId.values()];

    let sumCents = 0;
    let paidCents = 0;
    let openCents = 0;
    let paidCount = 0;
    let openCount = 0;
    const references = {
      invoiceOnly: 0,
      receiptOnly: 0,
      invoiceAndReceipt: 0,
      neitherInvoiceNorReceipt: 0,
      withFatherBillId: 0,
      withJoinBillId: 0,
      withBillReceiptNumber: 0,
      withTaxId: 0,
      splitted: 0,
      recurring: 0,
    };

    for (const bill of unique) {
      const valueCents = cents(number(bill.billValue));
      sumCents += valueCents;
      if (bill.isPaid) {
        paidCount += 1;
        paidCents += valueCents;
      } else {
        openCount += 1;
        openCents += valueCents;
      }

      const invoice = present(bill.invoiceNumber);
      const receipt = present(bill.receiptNumber);
      if (invoice && receipt) references.invoiceAndReceipt += 1;
      else if (invoice) references.invoiceOnly += 1;
      else if (receipt) references.receiptOnly += 1;
      else references.neitherInvoiceNorReceipt += 1;
      if (present(bill.fatherBillId)) references.withFatherBillId += 1;
      if (present(bill.joinBillId)) references.withJoinBillId += 1;
      if (present(bill.billReceiptNumber)) references.withBillReceiptNumber += 1;
      if (present(bill.taxId)) references.withTaxId += 1;
      if (bill.splitted) references.splitted += 1;
      if (bill.hasRecurrence) references.recurring += 1;
    }

    const expectedRowsValue = expectedRows ?? 0;
    const expectedTotal = money(expectedTotalCents ?? 0);
    const sum = money(sumCents);

    return {
      ok: expectedRowsValue === unique.length && (expectedTotalCents ?? 0) === sumCents,
      readOnly: true,
      flowSelected: true,
      blockedWrites,
      source: {
        endpoint: "/financial/v1/bills_to_pay",
        filter: "allBills=yes; sem período",
        pages,
        fetchedRows: allBills.length,
        uniqueBillIds: unique.length,
        duplicateBillIds: allBills.length - unique.length,
        headerRows: expectedRowsValue,
        headerTotal: expectedTotal,
        summedBillValue: sum,
        amountDifference: money(sumCents - (expectedTotalCents ?? 0)),
      },
      status: {
        paidCount,
        openCount,
        paidAmount: money(paidCents),
        openAmount: money(openCents),
      },
      references,
      sample: unique.slice(0, 8).map(safeSample),
    };
  }, { sessionTimeoutMs: 110_000 });

  console.log("KOPER_FULL_PAYABLE_SOURCE_AUDIT", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_FULL_PAYABLE_SOURCE_AUDIT_FAILED", JSON.stringify({
    message: error instanceof Error ? error.message.slice(0, 1_000) : "unknown",
  }));
}

await import("./index.js");
