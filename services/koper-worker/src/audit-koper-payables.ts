import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Payable = {
  id: string;
  project_id: string;
  supplier_id: string;
  document: string | null;
  due_date: string;
  amount: number;
  status: string;
  source_system: string | null;
  source_id: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  paid_account_name: string | null;
};

type BankTransaction = {
  id: string;
  description: string | null;
};

const PAGE_SIZE = 500;
const MAX_PAGES = 10_000;

async function readAll<T>(
  table: string,
  query: Record<string, string>,
  label: string,
): Promise<T[]> {
  const result: T[] = [];
  console.log("KOPER_AUDIT_READ_START", JSON.stringify({ label, table, pageSize: PAGE_SIZE }));

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    const offset = pageIndex * PAGE_SIZE;
    const startedAt = Date.now();
    const page = await requestSupabase<T[]>(table, {
      query: new URLSearchParams({
        ...query,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      }),
      timeoutMs: 30_000,
    });

    result.push(...page);
    console.log("KOPER_AUDIT_READ_PAGE", JSON.stringify({
      label,
      page: pageIndex + 1,
      offset,
      rows: page.length,
      accumulated: result.length,
      elapsedMs: Date.now() - startedAt,
    }));

    if (page.length < PAGE_SIZE) {
      console.log("KOPER_AUDIT_READ_DONE", JSON.stringify({ label, total: result.length }));
      return result;
    }
  }

  throw new Error(`Audit pagination exceeded ${MAX_PAGES} pages for ${label}`);
}

async function run(): Promise<void> {
  console.log("KOPER_PAYABLE_FINAL_AUDIT_START", JSON.stringify({
    companyId: env.BOSSA_COMPANY_ID,
    startedAt: new Date().toISOString(),
  }));

  const payables = await readAll<Payable>(
    "payables",
    {
      select: "id,project_id,supplier_id,document,due_date,amount,status,source_system,source_id,paid_at,paid_amount,paid_account_name",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper_flow",
      order: "id.asc",
    },
    "koper_payables",
  );

  const historicalBankTransactions = await readAll<BankTransaction>(
    "finance_bank_transactions",
    {
      select: "id,description",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      or: "(description.ilike.*koper*,description.ilike.*histórico*)",
      order: "id.asc",
    },
    "koper_historical_bank_transactions",
  ).catch((error: unknown) => {
    console.warn(
      "KOPER_AUDIT_BANK_SAFETY_SKIPPED",
      error instanceof Error ? error.message : String(error),
    );
    return [];
  });

  const ids = new Set<string>();
  const sources = new Set<string>();
  let duplicateIds = 0;
  let duplicateSources = 0;

  for (const row of payables) {
    if (ids.has(row.id)) duplicateIds += 1;
    ids.add(row.id);

    if (row.source_id) {
      if (sources.has(row.source_id)) duplicateSources += 1;
      sources.add(row.source_id);
    }
  }

  const paid = payables.filter((row) => row.status === "paid");
  const open = payables.filter((row) => row.status === "open");

  console.log("KOPER_PAYABLE_FINAL_AUDIT", JSON.stringify({
    ok: true,
    total: payables.length,
    statuses: {
      paid: paid.length,
      open: open.length,
      other: payables.length - paid.length - open.length,
    },
    amounts: {
      total: payables.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      paid: paid.reduce(
        (sum, row) => sum + Number(row.paid_amount ?? row.amount ?? 0),
        0,
      ),
      open: open.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    },
    integrity: {
      duplicateIds,
      duplicateSources,
      missingProject: payables.filter((row) => !row.project_id).length,
      missingSupplier: payables.filter((row) => !row.supplier_id).length,
      missingDueDate: payables.filter((row) => !row.due_date).length,
      invalidAmount: payables.filter((row) => !(Number(row.amount) > 0)).length,
      paidWithoutDate: paid.filter((row) => !row.paid_at).length,
      paidWithoutAmount: paid.filter((row) => !(Number(row.paid_amount) > 0)).length,
      openWithPaidDate: open.filter((row) => row.paid_at).length,
      invalidSource: payables.filter(
        (row) => !String(row.source_id ?? "").startsWith("koper_bill:"),
      ).length,
    },
    bankSafety: {
      koperHistoricalBankTransactions: historicalBankTransactions.length,
    },
    finishedAt: new Date().toISOString(),
  }));
}

run().catch((error: unknown) => {
  console.error(
    "KOPER_PAYABLE_FINAL_AUDIT_ERROR",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
