import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Json : null;
const num = (v: unknown): number => Number.isFinite(Number(v)) ? Number(v) : 0;
const has = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== "";
const toCents = (v: unknown): number => Math.round((num(v) + Number.EPSILON) * 100);

try {
  const result = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ok: false, message: login.message };

    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const koper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (koper && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !isAllowedFlowSwitch(url, request.method(), request.postData())) {
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {}
      await route.continue();
    });

    if (!await selectFlow(page)) return { ok: false, message: "FLOW_NOT_SELECTED", blockedWrites };

    const seedPromise = page.waitForResponse((response: Response) => {
      try {
        const url = new URL(response.url());
        return response.request().method() === "GET" && url.hostname === "api.koper.com.br" && url.pathname === "/financial/v1/bills_to_pay";
      } catch { return false; }
    }, { timeout: 20_000 }).catch(() => null);

    await page.goto("https://app.koper.com.br/financeiro/contas_pagar", { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    const seed = await seedPromise;
    if (!seed) return { ok: false, message: "PAYABLE_SEED_NOT_FOUND", blockedWrites };

    const seedHeaders = seed.request().headers();
    const headers: Record<string, string> = {};
    for (const key of ["accept", "origin", "referer", "x-accesstoken", "x-koper"]) {
      if (seedHeaders[key]) headers[key] = seedHeaders[key];
    }

    const template = new URL(seed.url());
    for (const [key, value] of Object.entries({
      allBills: "yes", initialDate: "", finalDate: "", limit: "200", offset: "0",
      orderFlag: "asc", orderby: "dueDate", typeDate: "dueDate",
    })) template.searchParams.set(key, value);

    const rows: Json[] = [];
    let expectedCount = 0;
    let expectedTotalCents = 0;
    let offset = 0;
    let pages = 0;

    while (pages < 30) {
      const url = new URL(template);
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("cb", String(Date.now()));
      const response = await page.request.get(url.toString(), { headers, timeout: 8_000 });
      if (!response.ok()) return { ok: false, message: "PAGE_FAILED", status: response.status(), offset, pages, blockedWrites };
      const body = obj(await response.json().catch(() => null));
      if (!body) return { ok: false, message: "INVALID_BODY", offset, pages, blockedWrites };
      const pageRows = Array.isArray(body.bills) ? body.bills.map(obj).filter((v): v is Json => Boolean(v)) : [];
      if (pages === 0) {
        expectedCount = num(body.billsAmount);
        expectedTotalCents = toCents(body.totalBills);
      }
      rows.push(...pageRows);
      pages += 1;
      offset += pageRows.length;
      if (!pageRows.length || offset >= expectedCount || pageRows.length < 200) break;
    }

    const unique = new Map<string, Json>();
    for (const row of rows) if (has(row.billId) && !unique.has(String(row.billId))) unique.set(String(row.billId), row);
    const bills = [...unique.values()];
    const refs = { invoiceOnly: 0, receiptOnly: 0, invoiceAndReceipt: 0, neither: 0, father: 0, joined: 0, tax: 0, split: 0, recurring: 0 };
    let sumCents = 0, paidCents = 0, openCents = 0, paidCount = 0, openCount = 0;

    for (const row of bills) {
      const value = toCents(row.billValue);
      sumCents += value;
      if (row.isPaid === true) { paidCount += 1; paidCents += value; } else { openCount += 1; openCents += value; }
      const inv = has(row.invoiceNumber), rec = has(row.receiptNumber);
      if (inv && rec) refs.invoiceAndReceipt += 1; else if (inv) refs.invoiceOnly += 1; else if (rec) refs.receiptOnly += 1; else refs.neither += 1;
      if (has(row.fatherBillId)) refs.father += 1;
      if (has(row.joinBillId)) refs.joined += 1;
      if (has(row.taxId)) refs.tax += 1;
      if (row.splitted === true) refs.split += 1;
      if (row.hasRecurrence === true) refs.recurring += 1;
    }

    const sample = bills.slice(0, 8).map((row) => ({
      billId: row.billId ?? null, billToPayId: row.billToPayId ?? null, fatherBillId: row.fatherBillId ?? null,
      billValue: num(row.billValue), dueDate: row.dueDate ?? null, isPaid: row.isPaid ?? null,
      invoiceNumber: row.invoiceNumber ?? null, receiptNumber: row.receiptNumber ?? null,
      recTypeId: row.recTypeId ?? null, installmentAmount: row.installmentAmount ?? null,
      duplicateNumber: row.duplicateNumber ?? null, billOrder: row.billOrder ?? null,
    }));

    return {
      ok: bills.length === expectedCount && sumCents === expectedTotalCents,
      readOnly: true, blockedWrites,
      source: {
        endpoint: "/financial/v1/bills_to_pay", pages, fetchedRows: rows.length, uniqueBillIds: bills.length,
        duplicateBillIds: rows.length - bills.length, headerRows: expectedCount,
        headerTotal: expectedTotalCents / 100, summedBillValue: sumCents / 100,
        amountDifference: (sumCents - expectedTotalCents) / 100,
      },
      status: { paidCount, openCount, paidAmount: paidCents / 100, openAmount: openCents / 100 },
      references: refs,
      sample,
    };
  }, { sessionTimeoutMs: 58_000 });

  console.log("KOPER_FULL_PAYABLE_SOURCE_AUDIT", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_FULL_PAYABLE_SOURCE_AUDIT_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1_000) : "unknown" }));
}
