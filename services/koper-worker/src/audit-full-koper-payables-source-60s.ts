import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type ElosPayable = { source_id: string | null; amount: number; status: string; due_date: string | null; paid_at: string | null; paid_amount: number | null };
const obj = (v: unknown): Json | null => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Json : null;
const num = (v: unknown): number => Number.isFinite(Number(v)) ? Number(v) : 0;
const has = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== "";
const toCents = (v: unknown): number => Math.round((num(v) + Number.EPSILON) * 100);

async function readAll<T>(table: string, query: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await requestSupabase<T[]>(table, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
      timeoutMs: 30_000,
    });
    out.push(...page);
    if (page.length < 1000) return out;
  }
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
    for (const key of ["accept", "origin", "referer", "x-accesstoken", "x-koper"]) if (seedHeaders[key]) headers[key] = seedHeaders[key];

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
      if (pages === 0) { expectedCount = num(body.billsAmount); expectedTotalCents = toCents(body.totalBills); }
      rows.push(...pageRows);
      pages += 1;
      offset += pageRows.length;
      if (!pageRows.length || offset >= expectedCount || pageRows.length < 200) break;
    }

    const unique = new Map<string, Json>();
    for (const row of rows) if (has(row.billId) && !unique.has(String(row.billId))) unique.set(String(row.billId), row);
    const bills = [...unique.values()];

    const elos = await readAll<ElosPayable>("payables", {
      select: "source_id,amount,status,due_date,paid_at,paid_amount",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper_flow",
      order: "source_id.asc",
    });

    const directElos = new Map<string, ElosPayable>();
    const syntheticElos: ElosPayable[] = [];
    for (const payable of elos) {
      const match = String(payable.source_id ?? "").match(/^koper_bill:(\d+)$/);
      if (match) directElos.set(match[1]!, payable);
      else syntheticElos.push(payable);
    }

    let koperSum = 0;
    let paidCount = 0;
    let openCount = 0;
    let paidAmount = 0;
    let openAmount = 0;
    let matched = 0;
    let amountMismatch = 0;
    const missing: Json[] = [];
    const statusMismatchBills: Array<Record<string, unknown>> = [];

    for (const bill of bills) {
      const id = String(bill.billId);
      const cents = toCents(bill.billValue);
      koperSum += cents;
      if (bill.isPaid === true) { paidCount += 1; paidAmount += cents; } else { openCount += 1; openAmount += cents; }
      const imported = directElos.get(id);
      if (!imported) { missing.push(bill); continue; }
      matched += 1;
      if (toCents(imported.amount) !== cents) amountMismatch += 1;
      if ((imported.status === "paid") !== (bill.isPaid === true)) {
        statusMismatchBills.push({
          billId: bill.billId ?? null,
          billToPayId: bill.billToPayId ?? null,
          koperIsPaid: bill.isPaid === true,
          koperPaymentDate: bill.paymentDate ?? null,
          koperPaymentValue: bill.paymentValue ?? null,
          elosStatus: imported.status,
          elosPaidAt: imported.paid_at,
          elosPaidAmount: imported.paid_amount,
          amount: num(bill.billValue),
          dueDate: bill.dueDate ?? null,
        });
      }
    }

    const liveIds = new Set(bills.map((bill) => String(bill.billId)));
    const directElosNotInKoper = [...directElos.keys()].filter((id) => !liveIds.has(id));

    const classify = (items: Json[]) => {
      let sum = 0, paid = 0, open = 0, invoiceOnly = 0, receiptOnly = 0, invoiceAndReceipt = 0, neither = 0;
      for (const row of items) {
        sum += toCents(row.billValue);
        if (row.isPaid === true) paid += 1; else open += 1;
        const inv = has(row.invoiceNumber), rec = has(row.receiptNumber);
        if (inv && rec) invoiceAndReceipt += 1; else if (inv) invoiceOnly += 1; else if (rec) receiptOnly += 1; else neither += 1;
      }
      return { count: items.length, amount: sum / 100, paid, open, invoiceOnly, receiptOnly, invoiceAndReceipt, neither };
    };

    const missingParents = new Map<string, Json[]>();
    for (const bill of missing) {
      const parentId = has(bill.billToPayId) ? String(bill.billToPayId) : `missing-parent:${String(bill.billId)}`;
      const group = missingParents.get(parentId) ?? [];
      group.push(bill);
      missingParents.set(parentId, group);
    }
    const parentSizeHistogram: Record<string, number> = {};
    for (const group of missingParents.values()) {
      const size = String(group.length);
      parentSizeHistogram[size] = (parentSizeHistogram[size] ?? 0) + 1;
    }
    const largestMissingParents = [...missingParents.entries()]
      .sort((a, b) => b[1].length - a[1].length || num(b[0]) - num(a[0]))
      .slice(0, 20)
      .map(([billToPayId, group]) => ({
        billToPayId,
        installments: group.length,
        billIds: group.map((row) => row.billId),
        amount: group.reduce((sum, row) => sum + toCents(row.billValue), 0) / 100,
        paid: group.filter((row) => row.isPaid === true).length,
        open: group.filter((row) => row.isPaid !== true).length,
      }));

    const missingSorted = [...missing].sort((a, b) => num(b.billId) - num(a.billId));

    return {
      ok: bills.length === expectedCount && rows.length === bills.length,
      readOnly: true,
      blockedWrites,
      koper: {
        pages,
        rows: bills.length,
        headerRows: expectedCount,
        rowSum: koperSum / 100,
        headerTotal: expectedTotalCents / 100,
        headerVsRowsDifference: (koperSum - expectedTotalCents) / 100,
        paidCount,
        openCount,
        paidAmount: paidAmount / 100,
        openAmount: openAmount / 100,
      },
      elos: {
        totalRows: elos.length,
        directBillIds: directElos.size,
        syntheticRows: syntheticElos.length,
      },
      reconciliation: {
        matched,
        missing: classify(missing),
        missingParents: {
          count: missingParents.size,
          sizeHistogram: parentSizeHistogram,
          largest: largestMissingParents,
        },
        amountMismatch,
        statusMismatch: statusMismatchBills.length,
        statusMismatchBills: statusMismatchBills.slice(0, 50),
        directElosNotInKoper: directElosNotInKoper.length,
        sampleDirectElosNotInKoper: directElosNotInKoper.slice(0, 20),
        syntheticSourceIdsSample: syntheticElos.slice(0, 20).map((row) => row.source_id),
        newestMissing: missingSorted.slice(0, 20).map((row) => ({
          billId: row.billId ?? null,
          billToPayId: row.billToPayId ?? null,
          billValue: num(row.billValue),
          dueDate: row.dueDate ?? null,
          isPaid: row.isPaid ?? null,
          invoiceNumber: row.invoiceNumber ?? null,
          receiptNumber: row.receiptNumber ?? null,
          recTypeId: row.recTypeId ?? null,
        })),
      },
    };
  }, { sessionTimeoutMs: 58_000 });

  console.log("KOPER_PAYABLE_LIVE_VS_ELOS", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_PAYABLE_LIVE_VS_ELOS_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1_000) : "unknown" }));
}
