import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Invoice = {
  id: string;
  registry_number: string;
  access_key: string;
  status: string;
  validation_status: string;
  three_way_status: string;
  order_id: string | null;
  receipt_id: string | null;
  item_count: number;
  mapped_item_count: number;
  divergence_count: number;
  invoice_total: number;
  xml_storage_path: string;
};

type Item = {
  id: string;
  invoice_id: string;
  mapping_status: string;
  three_way_status: string;
  input_id: string | null;
  order_item_id: string | null;
  receipt_item_id: string | null;
  total_amount: number;
};

const PAGE_SIZE = 500;
const MAX_PAGES = 10_000;

async function readAll<T>(
  table: string,
  query: Record<string, string>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  console.log("KOPER_INVOICE_AUDIT_READ_START", JSON.stringify({
    label,
    table,
    pageSize: PAGE_SIZE,
  }));

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

    rows.push(...page);
    console.log("KOPER_INVOICE_AUDIT_READ_PAGE", JSON.stringify({
      label,
      page: pageIndex + 1,
      offset,
      rows: page.length,
      accumulated: rows.length,
      elapsedMs: Date.now() - startedAt,
    }));

    if (page.length < PAGE_SIZE) {
      console.log("KOPER_INVOICE_AUDIT_READ_DONE", JSON.stringify({
        label,
        total: rows.length,
      }));
      return rows;
    }
  }

  throw new Error(`Invoice audit pagination exceeded ${MAX_PAGES} pages for ${label}`);
}

function summarize(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function duplicates(values: string[]): number {
  return values.length - new Set(values).size;
}

async function run(): Promise<void> {
  console.log("KOPER_ELECTRONIC_INVOICE_FINAL_AUDIT_START", JSON.stringify({
    companyId: env.BOSSA_COMPANY_ID,
    startedAt: new Date().toISOString(),
  }));

  const invoices = await readAll<Invoice>(
    "finance_electronic_invoices",
    {
      select: "id,registry_number,access_key,status,validation_status,three_way_status,order_id,receipt_id,item_count,mapped_item_count,divergence_count,invoice_total,xml_storage_path",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      registry_number: "like.KOPER-NFE-*",
      order: "sequence_no.asc",
    },
    "koper_invoices",
  );

  const invoiceIds = new Set(invoices.map((invoice) => invoice.id));

  const [items, divergences, installments, koperOrders] = await Promise.all([
    readAll<Item>(
      "finance_electronic_invoice_items",
      {
        select: "id,invoice_id,mapping_status,three_way_status,input_id,order_item_id,receipt_item_id,total_amount",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        order: "invoice_id.asc,line_number.asc",
      },
      "invoice_items",
    ),
    readAll<{ id: string; invoice_id: string; status: string; rule_key: string }>(
      "finance_electronic_invoice_divergences",
      {
        select: "id,invoice_id,status,rule_key",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        order: "invoice_id.asc,id.asc",
      },
      "invoice_divergences",
    ),
    readAll<{ id: string; invoice_id: string }>(
      "finance_electronic_invoice_installments",
      {
        select: "id,invoice_id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        order: "id.asc",
      },
      "invoice_installments",
    ),
    readAll<{ id: string; invoiced_amount: number }>(
      "procurement_purchase_orders",
      {
        select: "id,invoiced_amount",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper",
        order: "id.asc",
      },
      "koper_purchase_orders",
    ),
  ]);

  const koperItems = items.filter((item) => invoiceIds.has(item.invoice_id));
  const koperDivergences = divergences.filter((row) => invoiceIds.has(row.invoice_id));
  const koperInstallments = installments.filter((row) => invoiceIds.has(row.invoice_id));

  const invalidAccessKeys = invoices.filter(
    (invoice) => !/^\d{44}$/.test(invoice.access_key),
  ).length;
  const invalidStoragePaths = invoices.filter(
    (invoice) => !invoice.xml_storage_path.startsWith("koper/xml-invoice/"),
  ).length;
  const headerItemCount = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.item_count ?? 0),
    0,
  );
  const headerMappedCount = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.mapped_item_count ?? 0),
    0,
  );
  const headerDivergenceCount = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.divergence_count ?? 0),
    0,
  );

  console.log("KOPER_ELECTRONIC_INVOICE_FINAL_AUDIT", JSON.stringify({
    ok: true,
    invoices: {
      total: invoices.length,
      statuses: summarize(invoices.map((invoice) => invoice.status)),
      validationStatuses: summarize(
        invoices.map((invoice) => invoice.validation_status),
      ),
      threeWayStatuses: summarize(
        invoices.map((invoice) => invoice.three_way_status),
      ),
      linkedOrders: invoices.filter((invoice) => Boolean(invoice.order_id)).length,
      linkedReceipts: invoices.filter((invoice) => Boolean(invoice.receipt_id)).length,
      invalidAccessKeys,
      invalidStoragePaths,
      duplicateIds: duplicates(invoices.map((invoice) => invoice.id)),
      duplicateAccessKeys: duplicates(invoices.map((invoice) => invoice.access_key)),
      duplicateRegistryNumbers: duplicates(
        invoices.map((invoice) => invoice.registry_number),
      ),
      totalAmount: invoices.reduce(
        (sum, invoice) => sum + Number(invoice.invoice_total ?? 0),
        0,
      ),
    },
    items: {
      total: koperItems.length,
      mappingStatuses: summarize(koperItems.map((item) => item.mapping_status)),
      threeWayStatuses: summarize(koperItems.map((item) => item.three_way_status)),
      linkedInputs: koperItems.filter((item) => Boolean(item.input_id)).length,
      linkedOrderItems: koperItems.filter((item) => Boolean(item.order_item_id)).length,
      linkedReceiptItems: koperItems.filter((item) => Boolean(item.receipt_item_id)).length,
      duplicateIds: duplicates(koperItems.map((item) => item.id)),
      totalAmount: koperItems.reduce(
        (sum, item) => sum + Number(item.total_amount ?? 0),
        0,
      ),
    },
    reconciliation: {
      headerItemCount,
      headerMappedCount,
      actualItems: koperItems.length,
      headerDivergenceCount,
      actualDivergences: koperDivergences.length,
      divergenceStatuses: summarize(koperDivergences.map((row) => row.status)),
      divergenceRules: summarize(koperDivergences.map((row) => row.rule_key)),
    },
    financialSafety: {
      installmentsForImportedInvoices: koperInstallments.length,
      koperOrdersWithNonzeroInvoicedAmount: koperOrders.filter(
        (order) => Math.abs(Number(order.invoiced_amount ?? 0)) > 0.000001,
      ).length,
    },
    finishedAt: new Date().toISOString(),
  }));
}

run().catch((error: unknown) => {
  console.error(
    "KOPER_ELECTRONIC_INVOICE_FINAL_AUDIT_FAILED",
    error instanceof Error ? error.message.slice(0, 1_200) : "unknown",
  );
  process.exitCode = 1;
});
