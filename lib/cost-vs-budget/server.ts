import { fetchAllRows } from "@/lib/supabase-pagination";

const UNALLOCATED_COST_ID = "__unallocated_cost__";
const BUDGET_WITHOUT_SERVICE_ID = "__budget_without_service__";

type SupabaseClientLike = Awaited<ReturnType<(typeof import("@/lib/workspace"))["requireCompanyPermission"]>>["supabase"];

type Project = {
  id: string;
  code: string | null;
  name: string;
};

export type CostVsBudgetBudget = {
  id: string;
  code: string;
  name: string;
  version: string;
  status: "draft" | "in_progress" | "review" | "approved" | "archived";
  is_base: boolean;
  updated_at: string;
};

type BudgetItem = {
  id: string;
  service_id: string | null;
  code: string | null;
  description: string;
  total_direct_cost: number;
};

type Service = {
  id: string;
  code: string;
  description: string;
};

type InventoryMovement = {
  cost_center_service_id: string | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
  movement_type: "issue" | "adjustment_out" | "return_to_stock";
  total_value: number;
};

type PurchaseOrder = {
  id: string;
  status: "confirmed" | "partially_received" | "received" | "closed";
  source_system: string | null;
  source_id: string | null;
};

type PurchaseOrderItem = {
  order_id: string;
  cost_center_service_id: string | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
  ordered_quantity: number;
  cancelled_quantity: number;
  delivered_unit_cost: number;
  total_amount: number;
};

type ContractMeasurement = {
  id: string;
  status: "approved" | "invoiced" | "paid";
};

type ContractMeasurementItem = {
  measurement_id: string;
  service_id: string;
  service_code: string;
  service_name: string;
  current_amount: number;
};

type ManualInvoice = {
  id: string;
  status: "approved";
  measurement_id: string | null;
};

type ManualInvoiceItem = {
  invoice_id: string;
  service_id: string;
  service_code: string;
  service_name: string;
  total_amount: number;
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
  order_item_id: string | null;
  receipt_item_id: string | null;
};

type KoperPayable = {
  id: string;
  status: "open" | "paid";
  source_id: string | null;
  amount: number;
};

type PayableCostAllocation = {
  payable_id: string;
  service_id: string | null;
  budget_item_id: string | null;
  wbs_code_snapshot: string | null;
  service_name_snapshot: string | null;
  allocation_amount: number;
  evidence: unknown;
};

type WorkingRow = {
  id: string;
  serviceId: string | null;
  code: string;
  name: string;
  budgetAmount: number;
  materialCost: number;
  serviceCost: number;
  directCost: number;
  purchaseOrderCost: number;
  coveredPurchaseOrderCost: number;
  payablePaidCost: number;
  payableOpenCost: number;
};

export type CostVsBudgetStatus = "ok" | "attention" | "over" | "no_budget" | "unallocated";

export type CostVsBudgetRow = WorkingRow & {
  allocatedCost: number;
  openCommitment: number;
  forecastCost: number;
  balance: number;
  consumptionPercent: number;
  status: CostVsBudgetStatus;
};

export type CostVsBudgetTotals = {
  budget: number;
  allocated: number;
  committed: number;
  forecast: number;
  unallocated: number;
  recognized: number;
  balance: number;
  consumptionPercent: number;
  overBudgetCount: number;
  attentionCount: number;
  withoutBudgetCount: number;
  budgetWithoutService: number;
  payableAllocated: number;
  payablePaid: number;
  payableOpen: number;
  payableUnallocated: number;
};

export type CostVsBudgetContext = {
  project: Project | null;
  budgets: CostVsBudgetBudget[];
  budget: CostVsBudgetBudget | null;
  rows: CostVsBudgetRow[];
  totals: CostVsBudgetTotals;
  errors: string[];
};

function number(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function activeOrderItemValue(item: PurchaseOrderItem) {
  const orderedQuantity = Math.max(0, number(item.ordered_quantity));
  const cancelledQuantity = Math.min(orderedQuantity, Math.max(0, number(item.cancelled_quantity)));
  const activeQuantity = Math.max(0, orderedQuantity - cancelledQuantity);
  const totalAmount = Math.max(0, number(item.total_amount));
  if (orderedQuantity > 0 && totalAmount > 0) return totalAmount * activeQuantity / orderedQuantity;
  return activeQuantity * Math.max(0, number(item.delivered_unit_cost));
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nativeOrderSourceIds(evidence: unknown) {
  const nativeEvidence = object(object(evidence).nativeEvidence);
  const values = [
    ...(Array.isArray(nativeEvidence.purchaseIds) ? nativeEvidence.purchaseIds : []),
    ...(Array.isArray(nativeEvidence.orderSourceIds) ? nativeEvidence.orderSourceIds : []),
  ];
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function emptyTotals(): CostVsBudgetTotals {
  return {
    budget: 0,
    allocated: 0,
    committed: 0,
    forecast: 0,
    unallocated: 0,
    recognized: 0,
    balance: 0,
    consumptionPercent: 0,
    overBudgetCount: 0,
    attentionCount: 0,
    withoutBudgetCount: 0,
    budgetWithoutService: 0,
    payableAllocated: 0,
    payablePaid: 0,
    payableOpen: 0,
    payableUnallocated: 0,
  };
}

function classifyRow(row: WorkingRow, forecastCost: number): CostVsBudgetStatus {
  if (row.id === UNALLOCATED_COST_ID || row.id === BUDGET_WITHOUT_SERVICE_ID) return "unallocated";
  if (row.budgetAmount <= 0 && forecastCost > 0.01) return "no_budget";
  if (forecastCost > row.budgetAmount + 0.01) return "over";
  if (row.budgetAmount > 0 && forecastCost / row.budgetAmount >= 0.9) return "attention";
  return "ok";
}

export async function loadCostVsBudget({
  supabase,
  companyId,
  projectId,
  budgetId,
}: {
  supabase: SupabaseClientLike;
  companyId: string;
  projectId: string | null;
  budgetId?: string | null;
}): Promise<CostVsBudgetContext> {
  if (!projectId) {
    return {
      project: null,
      budgets: [],
      budget: null,
      rows: [],
      totals: emptyTotals(),
      errors: [],
    };
  }

  const [projectResult, budgetsResult, servicesResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, code, name")
      .eq("company_id", companyId)
      .eq("id", projectId)
      .maybeSingle(),
    fetchAllRows<CostVsBudgetBudget>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_budgets")
        .select("id, code, name, version, status, is_base, updated_at")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .range(from, to);
      return { data: (data ?? []) as CostVsBudgetBudget[], error };
    }),
    fetchAllRows<Service>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_services")
        .select("id, code, description")
        .eq("company_id", companyId)
        .order("code")
        .range(from, to);
      return { data: (data ?? []) as Service[], error };
    }),
  ]);

  const budgets = budgetsResult.data;
  const budget = budgets.find((item) => item.id === budgetId)
    ?? budgets.find((item) => item.is_base)
    ?? budgets.find((item) => item.status === "approved")
    ?? budgets[0]
    ?? null;
  const initialErrors = [projectResult.error?.message, budgetsResult.error?.message, servicesResult.error?.message]
    .filter(Boolean) as string[];

  if (!budget) {
    return {
      project: projectResult.data as Project | null,
      budgets,
      budget: null,
      rows: [],
      totals: emptyTotals(),
      errors: initialErrors,
    };
  }

  const [
    budgetItemsResult,
    movementsResult,
    purchaseOrdersResult,
    purchaseOrderItemsResult,
    measurementsResult,
    measurementItemsResult,
    manualInvoicesResult,
    manualInvoiceItemsResult,
    electronicInvoicesResult,
    electronicInvoiceItemsResult,
    koperPayablesResult,
    payableAllocationsResult,
  ] = await Promise.all([
    fetchAllRows<BudgetItem>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_budget_items")
        .select("id, service_id, code, description, total_direct_cost")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("budget_id", budget.id)
        .eq("status", "active")
        .range(from, to);
      return { data: (data ?? []) as BudgetItem[], error };
    }),
    fetchAllRows<InventoryMovement>(async (from, to) => {
      const { data, error } = await supabase
        .from("procurement_inventory_movements")
        .select("cost_center_service_id, cost_center_code, cost_center_name, movement_type, total_value")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .in("movement_type", ["issue", "adjustment_out", "return_to_stock"])
        .range(from, to);
      return { data: (data ?? []) as InventoryMovement[], error };
    }),
    fetchAllRows<PurchaseOrder>(async (from, to) => {
      const { data, error } = await supabase
        .from("procurement_purchase_orders")
        .select("id, status, source_system, source_id")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .in("status", ["confirmed", "partially_received", "received", "closed"])
        .range(from, to);
      return { data: (data ?? []) as PurchaseOrder[], error };
    }),
    fetchAllRows<PurchaseOrderItem>(async (from, to) => {
      const { data, error } = await supabase
        .from("procurement_purchase_order_items")
        .select("order_id, cost_center_service_id, cost_center_code, cost_center_name, ordered_quantity, cancelled_quantity, delivered_unit_cost, total_amount")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .range(from, to);
      return { data: (data ?? []) as PurchaseOrderItem[], error };
    }),
    fetchAllRows<ContractMeasurement>(async (from, to) => {
      const { data, error } = await supabase
        .from("execution_contract_measurements")
        .select("id, status")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .in("status", ["approved", "invoiced", "paid"])
        .range(from, to);
      return { data: (data ?? []) as ContractMeasurement[], error };
    }),
    fetchAllRows<ContractMeasurementItem>(async (from, to) => {
      const { data, error } = await supabase
        .from("execution_contract_measurement_items")
        .select("measurement_id, service_id, service_code, service_name, current_amount")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .range(from, to);
      return { data: (data ?? []) as ContractMeasurementItem[], error };
    }),
    fetchAllRows<ManualInvoice>(async (from, to) => {
      const { data, error } = await supabase
        .from("finance_manual_invoices")
        .select("id, status, measurement_id")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("status", "approved")
        .range(from, to);
      return { data: (data ?? []) as ManualInvoice[], error };
    }),
    fetchAllRows<ManualInvoiceItem>(async (from, to) => {
      const { data, error } = await supabase
        .from("finance_manual_invoice_items")
        .select("invoice_id, service_id, service_code, service_name, total_amount")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .range(from, to);
      return { data: (data ?? []) as ManualInvoiceItem[], error };
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
        .select("invoice_id, cost_center_service_id, description, total_amount, order_item_id, receipt_item_id")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .range(from, to);
      return { data: (data ?? []) as ElectronicInvoiceItem[], error };
    }),
    fetchAllRows<KoperPayable>(async (from, to) => {
      const { data, error } = await supabase
        .from("payables")
        .select("id, status, source_id, amount")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("source_system", "koper_flow")
        .in("status", ["open", "paid"])
        .range(from, to);
      return { data: (data ?? []) as KoperPayable[], error };
    }),
    fetchAllRows<PayableCostAllocation>(async (from, to) => {
      const { data, error } = await supabase
        .from("payable_cost_allocations")
        .select("payable_id, service_id, budget_item_id, wbs_code_snapshot, service_name_snapshot, allocation_amount, evidence")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("source_system", "koper_native_resolution")
        .range(from, to);
      return { data: (data ?? []) as PayableCostAllocation[], error };
    }),
  ]);

  const errors = [
    ...initialErrors,
    budgetItemsResult.error?.message,
    movementsResult.error?.message,
    purchaseOrdersResult.error?.message,
    purchaseOrderItemsResult.error?.message,
    measurementsResult.error?.message,
    measurementItemsResult.error?.message,
    manualInvoicesResult.error?.message,
    manualInvoiceItemsResult.error?.message,
    electronicInvoicesResult.error?.message,
    electronicInvoiceItemsResult.error?.message,
    koperPayablesResult.error?.message,
    payableAllocationsResult.error?.message,
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
      budgetAmount: 0,
      materialCost: 0,
      serviceCost: 0,
      directCost: 0,
      purchaseOrderCost: 0,
      coveredPurchaseOrderCost: 0,
      payablePaidCost: 0,
      payableOpenCost: 0,
    };
    rows.set(id, next);
    return next;
  };

  for (const item of budgetItemsResult.data) {
    const id = item.service_id ?? BUDGET_WITHOUT_SERVICE_ID;
    const row = ensureRow(
      id,
      item.service_id,
      item.service_id ? item.code ?? "—" : "SEM-CENTRO",
      item.service_id ? item.description : "Itens do orçamento sem serviço vinculado",
    );
    row.budgetAmount += number(item.total_direct_cost);
  }

  for (const movement of movementsResult.data) {
    const id = movement.cost_center_service_id ?? UNALLOCATED_COST_ID;
    const row = ensureRow(
      id,
      movement.cost_center_service_id,
      movement.cost_center_code ?? "SEM-APROPRIAÇÃO",
      movement.cost_center_name ?? "Materiais consumidos sem centro de custo",
    );
    const sign = movement.movement_type === "return_to_stock" ? -1 : 1;
    row.materialCost += sign * number(movement.total_value);
  }

  const activePurchaseOrderIds = new Set(purchaseOrdersResult.data.map((order) => order.id));
  const activePurchaseOrderBySource = new Map(
    purchaseOrdersResult.data
      .filter((order) => order.source_system === "koper" && order.source_id)
      .map((order) => [order.source_id!, order.id]),
  );
  const payableById = new Map(
    koperPayablesResult.data
      .filter((payable) => !payable.source_id?.startsWith("koper_bill:missing-"))
      .map((payable) => [payable.id, payable]),
  );
  const budgetItemById = new Map(budgetItemsResult.data.map((item) => [item.id, item]));
  const allocatedPayableIds = new Set<string>();
  const coveredAmountByOrder = new Map<string, number>();

  for (const allocation of payableAllocationsResult.data) {
    const payable = payableById.get(allocation.payable_id);
    if (!payable) continue;
    allocatedPayableIds.add(payable.id);
    const budgetItem = allocation.budget_item_id ? budgetItemById.get(allocation.budget_item_id) : null;
    const serviceId = allocation.service_id ?? budgetItem?.service_id ?? null;
    const id = serviceId ?? UNALLOCATED_COST_ID;
    const row = ensureRow(
      id,
      serviceId,
      allocation.wbs_code_snapshot ?? "SEM-APROPRIAÇÃO",
      allocation.service_name_snapshot ?? "Título financeiro sem serviço identificado",
    );
    const amount = Math.max(0, number(allocation.allocation_amount));
    if (payable.status === "paid") row.payablePaidCost += amount;
    else row.payableOpenCost += amount;

    const linkedOrderIds = nativeOrderSourceIds(allocation.evidence)
      .map((sourceId) => activePurchaseOrderBySource.get(sourceId))
      .filter((orderId): orderId is string => Boolean(orderId));
    if (linkedOrderIds.length === 1) {
      const orderId = linkedOrderIds[0]!;
      coveredAmountByOrder.set(orderId, (coveredAmountByOrder.get(orderId) ?? 0) + amount);
    }
  }

  const purchaseOrderItemsByOrder = new Map<string, PurchaseOrderItem[]>();
  for (const item of purchaseOrderItemsResult.data) {
    if (!activePurchaseOrderIds.has(item.order_id)) continue;
    purchaseOrderItemsByOrder.set(item.order_id, [
      ...(purchaseOrderItemsByOrder.get(item.order_id) ?? []),
      item,
    ]);
  }
  for (const [orderId, items] of purchaseOrderItemsByOrder) {
    const orderTotal = items.reduce((sum, item) => sum + activeOrderItemValue(item), 0);
    const coveredRatio = orderTotal > 0
      ? Math.min(1, Math.max(0, coveredAmountByOrder.get(orderId) ?? 0) / orderTotal)
      : 0;
    for (const item of items) {
    const id = item.cost_center_service_id ?? UNALLOCATED_COST_ID;
    const row = ensureRow(
      id,
      item.cost_center_service_id,
      item.cost_center_code ?? "SEM-APROPRIAÇÃO",
      item.cost_center_name ?? "Pedidos de compra sem centro de custo",
    );
      const itemValue = activeOrderItemValue(item);
      row.purchaseOrderCost += itemValue;
      row.coveredPurchaseOrderCost += itemValue * coveredRatio;
    }
  }

  const approvedMeasurementIds = new Set(measurementsResult.data.map((measurement) => measurement.id));
  for (const item of measurementItemsResult.data) {
    if (!approvedMeasurementIds.has(item.measurement_id)) continue;
    const row = ensureRow(item.service_id, item.service_id, item.service_code, item.service_name);
    row.serviceCost += number(item.current_amount);
  }

  const approvedDirectManualInvoices = new Set(
    manualInvoicesResult.data
      .filter((invoice) => !invoice.measurement_id)
      .map((invoice) => invoice.id),
  );
  for (const item of manualInvoiceItemsResult.data) {
    if (!approvedDirectManualInvoices.has(item.invoice_id)) continue;
    const row = ensureRow(item.service_id, item.service_id, item.service_code, item.service_name);
    row.directCost += number(item.total_amount);
  }

  const approvedElectronicInvoiceIds = new Set(electronicInvoicesResult.data.map((invoice) => invoice.id));
  for (const item of electronicInvoiceItemsResult.data) {
    if (!approvedElectronicInvoiceIds.has(item.invoice_id)) continue;
    if (item.order_item_id || item.receipt_item_id) continue;
    const id = item.cost_center_service_id ?? UNALLOCATED_COST_ID;
    const row = ensureRow(
      id,
      item.cost_center_service_id,
      item.cost_center_service_id ? "—" : "SEM-APROPRIAÇÃO",
      item.cost_center_service_id ? item.description : "Notas diretas sem centro de custo",
    );
    row.directCost += number(item.total_amount);
  }

  const statusOrder: Record<CostVsBudgetStatus, number> = {
    over: 0,
    no_budget: 1,
    attention: 2,
    unallocated: 3,
    ok: 4,
  };

  const resultRows = [...rows.values()]
    .map<CostVsBudgetRow>((row) => {
      const allocatedCost = row.materialCost + row.serviceCost + row.directCost + row.payablePaidCost;
      const residualPurchaseOrder = Math.max(
        0,
        row.purchaseOrderCost - row.coveredPurchaseOrderCost - Math.max(0, row.materialCost),
      );
      const openCommitment = row.payableOpenCost + residualPurchaseOrder;
      const forecastCost = allocatedCost + openCommitment;
      const balance = row.budgetAmount - forecastCost;
      const consumptionPercent = row.budgetAmount > 0
        ? forecastCost / row.budgetAmount * 100
        : forecastCost > 0 ? 100 : 0;
      return {
        ...row,
        allocatedCost,
        openCommitment,
        forecastCost,
        balance,
        consumptionPercent,
        status: classifyRow(row, forecastCost),
      };
    })
    .filter((row) => Math.abs(row.budgetAmount) > 0.01 || Math.abs(row.forecastCost) > 0.01)
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status]
      || a.code.localeCompare(b.code, "pt-BR", { numeric: true }));

  const totals = resultRows.reduce<CostVsBudgetTotals>((summary, row) => {
    summary.budget += row.budgetAmount;
    summary.recognized += row.allocatedCost;
    if (row.id === UNALLOCATED_COST_ID) {
      summary.unallocated += row.forecastCost;
    } else {
      summary.allocated += row.allocatedCost;
      summary.committed += row.openCommitment;
    }
    if (row.id === BUDGET_WITHOUT_SERVICE_ID) summary.budgetWithoutService += row.budgetAmount;
    if (row.status === "over") summary.overBudgetCount += 1;
    if (row.status === "attention") summary.attentionCount += 1;
    if (row.status === "no_budget") summary.withoutBudgetCount += 1;
    return summary;
  }, emptyTotals());

  totals.payablePaid = resultRows.reduce((sum, row) => sum + row.payablePaidCost, 0);
  totals.payableOpen = resultRows.reduce((sum, row) => sum + row.payableOpenCost, 0);
  totals.payableAllocated = totals.payablePaid + totals.payableOpen;
  totals.payableUnallocated = [...payableById.values()]
    .filter((payable) => !allocatedPayableIds.has(payable.id))
    .reduce((sum, payable) => sum + Math.max(0, number(payable.amount)), 0);

  totals.forecast = totals.allocated + totals.committed;
  totals.balance = totals.budget - totals.forecast;
  totals.consumptionPercent = totals.budget > 0 ? totals.forecast / totals.budget * 100 : 0;

  return {
    project: projectResult.data as Project | null,
    budgets,
    budget,
    rows: resultRows,
    totals,
    errors,
  };
}
