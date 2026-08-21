import { fetchAllRows } from "@/lib/supabase-pagination";

const UNALLOCATED_TRACEABILITY_ID = "__unallocated_traceability__";

type SupabaseClientLike = Awaited<ReturnType<(typeof import("@/lib/workspace"))["requireCompanyPermission"]>>["supabase"];

type Service = {
  id: string;
  code: string;
  description: string;
};

type MaterialReceipt = {
  id: string;
  status: "approved";
};

type MaterialReceiptItem = {
  receipt_id: string;
  cost_center_service_id: string | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
  accepted_amount: number;
};

type ElectronicInvoice = {
  id: string;
  status: "approved";
};

type ElectronicInvoiceItem = {
  invoice_id: string;
  cost_center_service_id: string | null;
  description: string;
  total_amount: number;
};

type ElectronicInvoiceInstallment = {
  invoice_id: string;
  payable_id: string | null;
  amount: number;
};

type Payable = {
  id: string;
  status: "open" | "paid" | "cancelled";
  amount: number;
  paid_amount: number | null;
};

type WorkingRow = {
  id: string;
  serviceId: string | null;
  code: string;
  name: string;
  receivedAmount: number;
  invoicedAmount: number;
  paidAmount: number;
};

export type CostTraceabilityStatus = "allocated" | "unallocated";

export type CostTraceabilityRow = WorkingRow & {
  status: CostTraceabilityStatus;
};

export type CostTraceabilityTotals = {
  received: number;
  invoiced: number;
  paid: number;
  unallocatedReceived: number;
  unallocatedInvoiced: number;
  unallocatedPaid: number;
};

export type CostTraceabilityContext = {
  rows: CostTraceabilityRow[];
  totals: CostTraceabilityTotals;
  errors: string[];
};

function number(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyTotals(): CostTraceabilityTotals {
  return {
    received: 0,
    invoiced: 0,
    paid: 0,
    unallocatedReceived: 0,
    unallocatedInvoiced: 0,
    unallocatedPaid: 0,
  };
}

export async function loadCostTraceability({
  supabase,
  companyId,
  projectId,
}: {
  supabase: SupabaseClientLike;
  companyId: string;
  projectId: string | null;
}): Promise<CostTraceabilityContext> {
  if (!projectId) return { rows: [], totals: emptyTotals(), errors: [] };

  const [
    servicesResult,
    receiptsResult,
    receiptItemsResult,
    invoicesResult,
    invoiceItemsResult,
    installmentsResult,
    payablesResult,
  ] = await Promise.all([
    fetchAllRows<Service>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_services")
        .select("id, code, description")
        .eq("company_id", companyId)
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as Service[], error };
    }),
    fetchAllRows<MaterialReceipt>(async (from, to) => {
      const { data, error } = await supabase
        .from("procurement_material_receipts")
        .select("id, status")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("status", "approved")
        .range(from, to);
      return { data: (data ?? []) as MaterialReceipt[], error };
    }),
    fetchAllRows<MaterialReceiptItem>(async (from, to) => {
      const { data, error } = await supabase
        .from("procurement_material_receipt_items")
        .select("receipt_id, cost_center_service_id, cost_center_code, cost_center_name, accepted_amount")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .range(from, to);
      return { data: (data ?? []) as MaterialReceiptItem[], error };
    }),
    fetchAllRows<ElectronicInvoice>(async (from, to) => {
      const { data, error } = await supabase
        .from("finance_electronic_invoices")
        .select("id, status")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("status", "approved")
        .range(from, to);
      return { data: (data ?? []) as ElectronicInvoice[], error };
    }),
    fetchAllRows<ElectronicInvoiceItem>(async (from, to) => {
      const { data, error } = await supabase
        .from("finance_electronic_invoice_items")
        .select("invoice_id, cost_center_service_id, description, total_amount")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .range(from, to);
      return { data: (data ?? []) as ElectronicInvoiceItem[], error };
    }),
    fetchAllRows<ElectronicInvoiceInstallment>(async (from, to) => {
      const { data, error } = await supabase
        .from("finance_electronic_invoice_installments")
        .select("invoice_id, payable_id, amount")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .range(from, to);
      return { data: (data ?? []) as ElectronicInvoiceInstallment[], error };
    }),
    fetchAllRows<Payable>(async (from, to) => {
      const { data, error } = await supabase
        .from("payables")
        .select("id, status, amount, paid_amount")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .range(from, to);
      return { data: (data ?? []) as Payable[], error };
    }),
  ]);

  const errors = [
    servicesResult.error?.message,
    receiptsResult.error?.message,
    receiptItemsResult.error?.message,
    invoicesResult.error?.message,
    invoiceItemsResult.error?.message,
    installmentsResult.error?.message,
    payablesResult.error?.message,
  ].filter(Boolean) as string[];

  const serviceById = new Map(servicesResult.data.map((service) => [service.id, service]));
  const rows = new Map<string, WorkingRow>();
  const ensureRow = (id: string, serviceId: string | null, fallbackCode: string, fallbackName: string) => {
    const current = rows.get(id);
    if (current) return current;
    const service = serviceId ? serviceById.get(serviceId) : null;
    const next: WorkingRow = {
      id,
      serviceId,
      code: service?.code || fallbackCode || "—",
      name: service?.description || fallbackName || "Centro de custo não identificado",
      receivedAmount: 0,
      invoicedAmount: 0,
      paidAmount: 0,
    };
    rows.set(id, next);
    return next;
  };

  const approvedReceiptIds = new Set(receiptsResult.data.map((receipt) => receipt.id));
  for (const item of receiptItemsResult.data) {
    if (!approvedReceiptIds.has(item.receipt_id)) continue;
    const id = item.cost_center_service_id ?? UNALLOCATED_TRACEABILITY_ID;
    const row = ensureRow(
      id,
      item.cost_center_service_id,
      item.cost_center_code ?? "SEM-APROPRIAÇÃO",
      item.cost_center_name ?? "Recebimentos sem centro de custo",
    );
    row.receivedAmount += number(item.accepted_amount);
  }

  const approvedInvoiceIds = new Set(invoicesResult.data.map((invoice) => invoice.id));
  const invoiceServiceAmounts = new Map<string, Map<string, { serviceId: string | null; code: string; name: string; amount: number }>>();
  for (const item of invoiceItemsResult.data) {
    if (!approvedInvoiceIds.has(item.invoice_id)) continue;
    const id = item.cost_center_service_id ?? UNALLOCATED_TRACEABILITY_ID;
    const code = item.cost_center_service_id ? serviceById.get(item.cost_center_service_id)?.code ?? "—" : "SEM-APROPRIAÇÃO";
    const name = item.cost_center_service_id
      ? serviceById.get(item.cost_center_service_id)?.description ?? item.description
      : "Notas fiscais sem centro de custo";
    const amount = Math.max(0, number(item.total_amount));
    ensureRow(id, item.cost_center_service_id, code, name).invoicedAmount += amount;

    const serviceAmounts = invoiceServiceAmounts.get(item.invoice_id) ?? new Map();
    const current = serviceAmounts.get(id);
    if (current) current.amount += amount;
    else serviceAmounts.set(id, { serviceId: item.cost_center_service_id, code, name, amount });
    invoiceServiceAmounts.set(item.invoice_id, serviceAmounts);
  }

  const payableById = new Map(payablesResult.data.map((payable) => [payable.id, payable]));
  const paidByInvoice = new Map<string, number>();
  for (const installment of installmentsResult.data) {
    if (!approvedInvoiceIds.has(installment.invoice_id) || !installment.payable_id) continue;
    const payable = payableById.get(installment.payable_id);
    if (!payable || payable.status !== "paid") continue;
    const paidAmount = Math.max(0, number(payable.paid_amount ?? payable.amount ?? installment.amount));
    paidByInvoice.set(installment.invoice_id, (paidByInvoice.get(installment.invoice_id) ?? 0) + paidAmount);
  }

  for (const [invoiceId, paidAmount] of paidByInvoice) {
    const serviceAmounts = invoiceServiceAmounts.get(invoiceId);
    const invoiceItemsTotal = serviceAmounts
      ? [...serviceAmounts.values()].reduce((sum, item) => sum + item.amount, 0)
      : 0;
    if (!serviceAmounts || invoiceItemsTotal <= 0) {
      ensureRow(
        UNALLOCATED_TRACEABILITY_ID,
        null,
        "SEM-APROPRIAÇÃO",
        "Pagamentos sem itens apropriados",
      ).paidAmount += paidAmount;
      continue;
    }
    for (const [id, item] of serviceAmounts) {
      const allocatedPaidAmount = paidAmount * item.amount / invoiceItemsTotal;
      ensureRow(id, item.serviceId, item.code, item.name).paidAmount += allocatedPaidAmount;
    }
  }

  const resultRows = [...rows.values()]
    .map<CostTraceabilityRow>((row) => ({
      ...row,
      status: row.id === UNALLOCATED_TRACEABILITY_ID ? "unallocated" : "allocated",
    }))
    .filter((row) => row.receivedAmount > 0.01 || row.invoicedAmount > 0.01 || row.paidAmount > 0.01)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "unallocated" ? -1 : 1;
      return a.code.localeCompare(b.code, "pt-BR", { numeric: true });
    });

  const totals = resultRows.reduce<CostTraceabilityTotals>((summary, row) => {
    summary.received += row.receivedAmount;
    summary.invoiced += row.invoicedAmount;
    summary.paid += row.paidAmount;
    if (row.status === "unallocated") {
      summary.unallocatedReceived += row.receivedAmount;
      summary.unallocatedInvoiced += row.invoicedAmount;
      summary.unallocatedPaid += row.paidAmount;
    }
    return summary;
  }, emptyTotals());

  return { rows: resultRows, totals, errors };
}
