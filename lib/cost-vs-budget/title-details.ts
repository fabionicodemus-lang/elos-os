import { fetchAllRows } from "@/lib/supabase-pagination";

const UNALLOCATED_COST_ID = "__unallocated_cost__";

type SupabaseClientLike = Awaited<ReturnType<(typeof import("@/lib/workspace"))["requireCompanyPermission"]>>["supabase"];

type Supplier = {
  legal_name: string;
  trade_name: string | null;
};

type Payable = {
  id: string;
  document: string | null;
  due_date: string;
  amount: number;
  status: "open" | "paid";
  installment_label: string | null;
  notes: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  source_id: string | null;
  beneficiary_name: string | null;
  suppliers: Supplier | Supplier[] | null;
};

type BudgetItem = {
  id: string;
  service_id: string | null;
};

type PayableCostAllocation = {
  payable_id: string;
  service_id: string | null;
  budget_item_id: string | null;
  allocation_amount: number;
  evidence: unknown;
};

export type CostVsBudgetTitle = {
  id: string;
  document: string;
  supplierName: string;
  dueDate: string;
  status: "open" | "paid";
  titleAmount: number;
  allocatedAmount: number;
  paidAllocatedAmount: number;
  openAllocatedAmount: number;
  paidAt: string | null;
  paidAmount: number | null;
  installmentLabel: string | null;
  notes: string | null;
  purchaseOrderRefs: string[];
};

export type CostVsBudgetTitleContext = {
  titlesByRow: Record<string, CostVsBudgetTitle[]>;
  errors: string[];
};

function number(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function relatedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function purchaseOrderRefs(evidence: unknown) {
  const nativeEvidence = object(object(evidence).nativeEvidence);
  const values = [
    ...(Array.isArray(nativeEvidence.purchaseIds) ? nativeEvidence.purchaseIds : []),
    ...(Array.isArray(nativeEvidence.orderSourceIds) ? nativeEvidence.orderSourceIds : []),
  ];
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function titleDocument(payable: Payable) {
  const sourceId = payable.source_id?.replace(/^koper_bill:/, "").trim();
  return payable.document?.trim() || sourceId || payable.id.slice(0, 8);
}

function supplierName(payable: Payable) {
  const supplier = relatedOne(payable.suppliers);
  return payable.beneficiary_name?.trim()
    || supplier?.trade_name?.trim()
    || supplier?.legal_name?.trim()
    || "Favorecido não identificado";
}

export async function loadCostVsBudgetTitles({
  supabase,
  companyId,
  projectId,
  budgetId,
}: {
  supabase: SupabaseClientLike;
  companyId: string;
  projectId: string;
  budgetId: string;
}): Promise<CostVsBudgetTitleContext> {
  const [payablesResult, allocationsResult, budgetItemsResult] = await Promise.all([
    fetchAllRows<Payable>(async (from, to) => {
      const { data, error } = await supabase
        .from("payables")
        .select("id, document, due_date, amount, status, installment_label, notes, paid_at, paid_amount, source_id, beneficiary_name, suppliers(legal_name, trade_name)")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("source_system", "koper_flow")
        .in("status", ["open", "paid"])
        .range(from, to);
      return { data: (data ?? []) as unknown as Payable[], error };
    }),
    fetchAllRows<PayableCostAllocation>(async (from, to) => {
      const { data, error } = await supabase
        .from("payable_cost_allocations")
        .select("payable_id, service_id, budget_item_id, allocation_amount, evidence")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("source_system", "koper_native_resolution")
        .range(from, to);
      return { data: (data ?? []) as PayableCostAllocation[], error };
    }),
    fetchAllRows<BudgetItem>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_budget_items")
        .select("id, service_id")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("budget_id", budgetId)
        .eq("status", "active")
        .range(from, to);
      return { data: (data ?? []) as BudgetItem[], error };
    }),
  ]);

  const errors = [
    payablesResult.error?.message,
    allocationsResult.error?.message,
    budgetItemsResult.error?.message,
  ].filter(Boolean) as string[];

  const payableById = new Map(
    payablesResult.data
      .filter((payable) => !payable.source_id?.startsWith("koper_bill:missing-"))
      .map((payable) => [payable.id, payable]),
  );
  const budgetItemById = new Map(budgetItemsResult.data.map((item) => [item.id, item]));
  const grouped = new Map<string, Map<string, CostVsBudgetTitle>>();

  for (const allocation of allocationsResult.data) {
    const payable = payableById.get(allocation.payable_id);
    if (!payable) continue;

    const budgetItem = allocation.budget_item_id ? budgetItemById.get(allocation.budget_item_id) : null;
    const rowId = allocation.service_id ?? budgetItem?.service_id ?? UNALLOCATED_COST_ID;
    const amount = Math.max(0, number(allocation.allocation_amount));
    const rowTitles = grouped.get(rowId) ?? new Map<string, CostVsBudgetTitle>();
    const current = rowTitles.get(payable.id) ?? {
      id: payable.id,
      document: titleDocument(payable),
      supplierName: supplierName(payable),
      dueDate: payable.due_date,
      status: payable.status,
      titleAmount: Math.max(0, number(payable.amount)),
      allocatedAmount: 0,
      paidAllocatedAmount: 0,
      openAllocatedAmount: 0,
      paidAt: payable.paid_at,
      paidAmount: payable.paid_amount === null ? null : Math.max(0, number(payable.paid_amount)),
      installmentLabel: payable.installment_label,
      notes: payable.notes,
      purchaseOrderRefs: [],
    };

    current.allocatedAmount += amount;
    if (payable.status === "paid") current.paidAllocatedAmount += amount;
    else current.openAllocatedAmount += amount;
    current.purchaseOrderRefs = [...new Set([
      ...current.purchaseOrderRefs,
      ...purchaseOrderRefs(allocation.evidence),
    ])];

    rowTitles.set(payable.id, current);
    grouped.set(rowId, rowTitles);
  }

  const titlesByRow = Object.fromEntries(
    [...grouped.entries()].map(([rowId, titles]) => [
      rowId,
      [...titles.values()].sort((left, right) =>
        left.dueDate.localeCompare(right.dueDate)
        || left.supplierName.localeCompare(right.supplierName, "pt-BR", { sensitivity: "base" })
        || left.document.localeCompare(right.document, "pt-BR", { numeric: true, sensitivity: "base" }),
      ),
    ]),
  );

  return { titlesByRow, errors };
}
