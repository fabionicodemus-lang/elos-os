import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { env } from "./config/env.js";
import { saveKoperStagingBatch } from "./elos/koper-staging-repository.js";
import { createKoperStagingRecord } from "./sync/staging-record.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;

type SourceCapture = {
  rows: Json[];
  headerCount: number;
  headerTotal: number;
  blockedWrites: number;
};

const objectValue = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : null;

const numeric = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const identifier = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const dateText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text === "-") return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : text;
};

function sanitizeBill(row: Json): Json {
  return {
    billId: identifier(row.billId),
    billToPayId: identifier(row.billToPayId),
    fatherBillId: identifier(row.fatherBillId),
    joinBillId: identifier(row.joinBillId),
    billValue: numeric(row.billValue),
    paymentValue: numeric(row.paymentValue),
    discount: numeric(row.discount),
    interest: numeric(row.interest),
    lateFee: numeric(row.lateFee),
    otherAccruals: numeric(row.otherAccruals),
    issueDate: dateText(row.issueDate),
    dueDate: dateText(row.dueDate),
    paymentDate: dateText(row.paymentDate),
    isPaid: row.isPaid === true,
    invoiceNumber: identifier(row.invoiceNumber),
    receiptNumber: identifier(row.receiptNumber),
    billReceiptNumber: identifier(row.billReceiptNumber),
    recTypeId: identifier(row.recTypeId),
    paymentType: identifier(row.paymentType),
    installmentAmount: numeric(row.installmentAmount),
    duplicateNumber: identifier(row.duplicateNumber),
    billOrder: identifier(row.billOrder),
    splitted: row.splitted === true,
    hasRecurrence: row.hasRecurrence === true,
    taxId: identifier(row.taxId),
    accountId: identifier(row.accountId),
    checkId: identifier(row.checkId),
    receiptDraft: row.receiptDraft === true,
    taxDraft: row.taxDraft === true,
    originName: identifier(row.originName),
  };
}

async function captureSource(): Promise<SourceCapture> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) throw new Error(login.message ?? "Koper authentication failed");

    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (
          isKoper
          && !["GET", "HEAD", "OPTIONS"].includes(request.method())
          && !isAllowedFlowSwitch(url, request.method(), request.postData())
        ) {
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {
        // Ignore malformed URLs.
      }
      await route.continue();
    });

    if (!await selectFlow(page)) throw new Error("KOPER_FLOW_COMPANY_NOT_SELECTED");

    const seedPromise = page.waitForResponse((response: Response) => {
      try {
        const url = new URL(response.url());
        return response.request().method() === "GET"
          && url.hostname === "api.koper.com.br"
          && url.pathname === "/financial/v1/bills_to_pay";
      } catch {
        return false;
      }
    }, { timeout: 20_000 }).catch(() => null);

    await page.goto("https://app.koper.com.br/financeiro/contas_pagar", {
      waitUntil: "domcontentloaded",
      timeout: 12_000,
    }).catch(() => undefined);

    const seed = await seedPromise;
    if (!seed) throw new Error("KOPER_PAYABLE_SEED_NOT_FOUND");

    const seedHeaders = seed.request().headers();
    const headers: Record<string, string> = {};
    for (const key of ["accept", "origin", "referer", "x-accesstoken", "x-koper"]) {
      if (seedHeaders[key]) headers[key] = seedHeaders[key];
    }

    const base = new URL(seed.url());
    const rows: Json[] = [];
    let headerCount = 0;
    let headerTotal = 0;
    const pageSize = 500;

    for (let offset = 0; offset < 10_000; offset += pageSize) {
      const url = new URL(base);
      for (const [key, value] of Object.entries({
        allBills: "yes",
        initialDate: "",
        finalDate: "",
        limit: String(pageSize),
        offset: String(offset),
        orderFlag: "asc",
        orderby: "dueDate",
        typeDate: "dueDate",
        cb: String(Date.now()),
      })) url.searchParams.set(key, value);

      const response = await page.request.get(url.toString(), { headers, timeout: 8_000 });
      if (!response.ok()) throw new Error(`KOPER_PAYABLE_PAGE_FAILED_${response.status()}_${offset}`);
      const body = objectValue(await response.json().catch(() => null));
      if (!body) throw new Error(`KOPER_PAYABLE_INVALID_BODY_${offset}`);

      const pageRows = Array.isArray(body.bills)
        ? body.bills.map(objectValue).filter((item): item is Json => Boolean(item))
        : [];
      if (offset === 0) {
        headerCount = numeric(body.billsAmount) ?? 0;
        headerTotal = numeric(body.totalBills) ?? 0;
      }
      rows.push(...pageRows);
      if (!pageRows.length || rows.length >= headerCount || pageRows.length < pageSize) break;
    }

    const unique = new Map<string, Json>();
    for (const row of rows) {
      const billId = identifier(row.billId);
      if (!billId) continue;
      if (unique.has(billId)) throw new Error(`KOPER_PAYABLE_DUPLICATE_BILL_ID_${billId}`);
      unique.set(billId, row);
    }
    if (unique.size !== headerCount) {
      throw new Error(`KOPER_PAYABLE_SOURCE_COUNT_MISMATCH_${unique.size}_${headerCount}`);
    }

    return {
      rows: [...unique.values()],
      headerCount,
      headerTotal,
      blockedWrites,
    };
  }, { sessionTimeoutMs: 58_000 });
}

if (process.env.KOPER_PAYABLE_SOURCE_STAGING_WRITE_ENABLED !== "true") {
  throw new Error("Koper payable source staging write is not explicitly enabled");
}

const captured = await captureSource();
const seenAt = new Date();
const records = captured.rows.map((row) => {
  const billId = identifier(row.billId);
  if (!billId) throw new Error("Koper payable without billId");
  return createKoperStagingRecord({
    companyId: env.BOSSA_COMPANY_ID,
    entity: "bill_to_pay",
    koperId: billId,
    sanitizedPayload: sanitizeBill(row),
    koperCreatedAt: dateText(row.issueDate),
    koperUpdatedAt: dateText(row.paymentDate) ?? dateText(row.issueDate),
    mappingVersion: 1,
    seenAt,
  });
});

const saved = await saveKoperStagingBatch(records);

console.log("KOPER_FULL_PAYABLE_STAGING_RESULT", JSON.stringify({
  ok: true,
  source: {
    rows: captured.headerCount,
    total: captured.headerTotal,
  },
  staging: {
    records: records.length,
    inserted: saved.inserted,
    updated: saved.updated,
    unchanged: saved.unchanged,
  },
  koperReadOnly: true,
  blockedKoperWrites: captured.blockedWrites,
}));

await import("./index.js");