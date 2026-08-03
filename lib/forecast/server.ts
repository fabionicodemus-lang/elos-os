import { fetchAllRows } from "@/lib/supabase-pagination";
import { assignActivityCosts } from "@/app/engenharia/curvas/curve-calculations.mjs";
import { buildUnifiedForecast, type UnifiedForecastResult } from "./engine.mjs";

const BUDGET_WITHOUT_SERVICE_ID = "__budget_without_service__";
const DAY_MS = 86_400_000;

type SupabaseClientLike = Awaited<ReturnType<(typeof import("@/lib/workspace"))["requireCompanyPermission"]>>["supabase"];

type Baseline = {
  id: string;
  budget_id: string;
  code: string;
  name: string;
  version: string;
  work_on_saturday: boolean;
  status: "draft" | "review" | "approved" | "archived";
};

type Project = {
  id: string;
  code: string | null;
  name: string;
  forecast_default_payment_days: number | null;
};

type Budget = {
  id: string;
  code: string;
  name: string;
  version: string;
  status: string;
  is_base: boolean;
  area_m2: number | null;
};

type BudgetItem = {
  id: string;
  service_id: string | null;
  code: string | null;
  description: string;
  total_direct_cost: number;
  status: "active" | "inactive";
};

type Service = { id: string; code: string; description: string };

type Activity = {
  id: string;
  baseline_id: string;
  service_id: string | null;
  code: string;
  name: string;
  quantity_snapshot: number;
  planned_start: string;
  planned_finish: string;
  planned_cost: number;
  record_status: "active" | "inactive";
};

type ProgressMeasurement = {
  id: string;
  activity_id: string;
  measurement_date: string;
  progress_percent: number;
  actual_cost: number;
  current_start: string;
  current_finish: string;
  actual_start: string | null;
  actual_finish: string | null;
  created_at: string;
};

type Contract = {
  id: string;
  status: string;
  payment_days: number;
  end_date: string;
};

type ContractItem = {
  id: string;
  contract_id: string;
  service_id: string;
  total_value: number;
};

type AmendmentItem = {
  contract_id: string;
  contract_item_id: string;
  service_id: string;
  value_change: number;
};

type ContractMeasurement = {
  id: string;
  contract_id: string;
  status: string;
  gross_amount: number;
  payable_id: string | null;
};

type ContractMeasurementItem = {
  measurement_id: string;
  contract_id: string;
  service_id: string;
  current_amount: number;
};

type Payable = {
  id: string;
  status: "open" | "paid" | "cancelled";
  due_date: string;
  amount: number;
  paid_at: string | null;
  paid_amount: number | null;
  source_system: string | null;
  source_id: string | null;
};

type AllocatedFinancialSource = {
  id: string;
  contractId: string | null;
  serviceId: string | null;
  amount: number;
  paidAt?: string;
  dueDate?: string;
};

export type ProjectForecastContext = {
  project: Project | null;
  baseline: Baseline | null;
  baselines: Baseline[];
  budget: Budget | null;
  budgetItems: BudgetItem[];
  services: Service[];
  activities: Activity[];
  progressMeasurements: ProgressMeasurement[];
  assignedCosts: Map<string, number>;
  forecast: UnifiedForecastResult | null;
  errors: string[];
};

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return new Date(date.getTime() + Math.max(0, days) * DAY_MS).toISOString().slice(0, 10);
}

function latestProgressByActivity(measurements: ProgressMeasurement[]) {
  const latest = new Map<string, ProgressMeasurement>();
  for (const measurement of measurements) {
    const previous = latest.get(measurement.activity_id);
    if (!previous || `${measurement.measurement_date}:${measurement.created_at}:${measurement.id}` > `${previous.measurement_date}:${previous.created_at}:${previous.id}`) {
      latest.set(measurement.activity_id, measurement);
    }
  }
  return latest;
}

function measurementFromPayable(
  payable: Payable,
  byPayableId: Map<string, ContractMeasurement>,
  bySourceId: Map<string, ContractMeasurement>,
) {
  return byPayableId.get(payable.id) ?? (payable.source_id ? bySourceId.get(payable.source_id) : null) ?? null;
}

function allocatePayable(
  payable: Payable,
  amount: number,
  measurement: ContractMeasurement | null,
  itemsByMeasurement: Map<string, ContractMeasurementItem[]>,
): AllocatedFinancialSource[] {
  if (!measurement) {
    return [{ id: payable.id, contractId: null, serviceId: null, amount }];
  }
  const items = itemsByMeasurement.get(measurement.id) ?? [];
  const itemTotal = items.reduce((sum, item) => sum + Math.max(0, number(item.current_amount)), 0);
  if (items.length === 0 || itemTotal <= 0) {
    return [{ id: payable.id, contractId: measurement.contract_id, serviceId: null, amount }];
  }
  let allocated = 0;
  return items.map((item, index) => {
    const itemAmount = index === items.length - 1
      ? amount - allocated
      : amount * Math.max(0, number(item.current_amount)) / itemTotal;
    allocated += itemAmount;
    return {
      id: `${payable.id}:${item.service_id}:${index}`,
      contractId: measurement.contract_id,
      serviceId: item.service_id,
      amount: itemAmount,
    };
  });
}

function sumByContractService(sources: AllocatedFinancialSource[]) {
  const map = new Map<string, number>();
  for (const source of sources) {
    if (!source.contractId || !source.serviceId) continue;
    const key = `${source.contractId}:${source.serviceId}`;
    map.set(key, number(map.get(key)) + source.amount);
  }
  return map;
}

export async function loadProjectForecast({
  supabase,
  companyId,
  projectId,
  baselineId,
  asOfDate,
}: {
  supabase: SupabaseClientLike;
  companyId: string;
  projectId: string | null;
  baselineId?: string | null;
  asOfDate: string;
}): Promise<ProjectForecastContext> {
  if (!projectId) {
    return {
      project: null,
      baseline: null,
      baselines: [],
      budget: null,
      budgetItems: [],
      services: [],
      activities: [],
      progressMeasurements: [],
      assignedCosts: new Map(),
      forecast: null,
      errors: [],
    };
  }

  const [projectResult, baselinesResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, code, name, forecast_default_payment_days")
      .eq("company_id", companyId)
      .eq("id", projectId)
      .maybeSingle(),
    fetchAllRows<Baseline>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_schedule_baselines")
        .select("id, budget_id, code, name, version, work_on_saturday, status")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false })
        .range(from, to);
      return { data: (data ?? []) as Baseline[], error };
    }),
  ]);

  const baselines = baselinesResult.data;
  const baseline = baselines.find((item) => item.id === baselineId)
    ?? baselines.find((item) => item.status === "approved")
    ?? baselines.find((item) => item.status !== "archived")
    ?? baselines[0]
    ?? null;
  const errors = [projectResult.error?.message, baselinesResult.error?.message].filter(Boolean) as string[];

  if (!baseline) {
    return {
      project: projectResult.data as Project | null,
      baseline: null,
      baselines,
      budget: null,
      budgetItems: [],
      services: [],
      activities: [],
      progressMeasurements: [],
      assignedCosts: new Map(),
      forecast: null,
      errors,
    };
  }

  const [budgetResult, budgetItemsResult, servicesResult, activitiesResult, progressResult, contractsResult, contractItemsResult, amendmentItemsResult, contractMeasurementsResult, measurementItemsResult, payablesResult] = await Promise.all([
    supabase
      .from("engineering_budgets")
      .select("id, code, name, version, status, is_base, area_m2")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .eq("id", baseline.budget_id)
      .maybeSingle(),
    fetchAllRows<BudgetItem>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_budget_items")
        .select("id, service_id, code, description, total_direct_cost, status")
        .eq("company_id", companyId)
        .eq("budget_id", baseline.budget_id)
        .range(from, to);
      return { data: (data ?? []) as BudgetItem[], error };
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
    fetchAllRows<Activity>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_schedule_activities")
        .select("id, baseline_id, service_id, code, name, quantity_snapshot, planned_start, planned_finish, planned_cost, record_status")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("baseline_id", baseline.id)
        .eq("record_status", "active")
        .order("planned_start")
        .range(from, to);
      return { data: (data ?? []) as Activity[], error };
    }),
    fetchAllRows<ProgressMeasurement>(async (from, to) => {
      const { data, error } = await supabase
        .from("engineering_schedule_progress_measurements")
        .select("id, activity_id, measurement_date, progress_percent, actual_cost, current_start, current_finish, actual_start, actual_finish, created_at")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .eq("baseline_id", baseline.id)
        .lte("measurement_date", asOfDate)
        .order("measurement_date")
        .order("created_at")
        .range(from, to);
      return { data: (data ?? []) as ProgressMeasurement[], error };
    }),
    fetchAllRows<Contract>(async (from, to) => {
      const { data, error } = await supabase
        .from("execution_service_contracts")
        .select("id, status, payment_days, end_date")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .in("status", ["active", "suspended", "finished"])
        .range(from, to);
      return { data: (data ?? []) as Contract[], error };
    }),
    fetchAllRows<ContractItem>(async (from, to) => {
      const { data, error } = await supabase
        .from("execution_service_contract_items")
        .select("id, contract_id, service_id, total_value")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .range(from, to);
      return { data: (data ?? []) as ContractItem[], error };
    }),
    fetchAllRows<AmendmentItem>(async (from, to) => {
      const { data, error } = await supabase
        .from("execution_service_contract_amendment_items")
        .select("contract_id, contract_item_id, service_id, value_change")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .range(from, to);
      return { data: (data ?? []) as AmendmentItem[], error };
    }),
    fetchAllRows<ContractMeasurement>(async (from, to) => {
      const { data, error } = await supabase
        .from("execution_contract_measurements")
        .select("id, contract_id, status, gross_amount, payable_id")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .in("status", ["approved", "invoiced", "paid"])
        .range(from, to);
      return { data: (data ?? []) as ContractMeasurement[], error };
    }),
    fetchAllRows<ContractMeasurementItem>(async (from, to) => {
      const { data, error } = await supabase
        .from("execution_contract_measurement_items")
        .select("measurement_id, contract_id, service_id, current_amount")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .range(from, to);
      return { data: (data ?? []) as ContractMeasurementItem[], error };
    }),
    fetchAllRows<Payable>(async (from, to) => {
      const { data, error } = await supabase
        .from("payables")
        .select("id, status, due_date, amount, paid_at, paid_amount, source_system, source_id")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .neq("status", "cancelled")
        .range(from, to);
      return { data: (data ?? []) as Payable[], error };
    }),
  ]);

  for (const result of [budgetResult, budgetItemsResult, servicesResult, activitiesResult, progressResult, contractsResult, contractItemsResult, amendmentItemsResult, contractMeasurementsResult, measurementItemsResult, payablesResult]) {
    if (result.error?.message) errors.push(result.error.message);
  }

  const project = projectResult.data as Project | null;
  const budget = budgetResult.data as Budget | null;
  const budgetItems = budgetItemsResult.data;
  const services = servicesResult.data;
  const activities = activitiesResult.data;
  const progressMeasurements = progressResult.data;
  const assignedCosts = assignActivityCosts(activities, budgetItems);
  const serviceMetadata = new Map(services.map((service) => [service.id, service]));
  const budgetByService = new Map<string, number>();
  let budgetWithoutService = 0;
  for (const item of budgetItems) {
    if (item.status !== "active") continue;
    if (!item.service_id) {
      budgetWithoutService += number(item.total_direct_cost);
      continue;
    }
    budgetByService.set(item.service_id, number(budgetByService.get(item.service_id)) + number(item.total_direct_cost));
  }
  const forecastServices = [...budgetByService.entries()].map(([serviceId, budgetAmount]) => {
    const metadata = serviceMetadata.get(serviceId);
    return { id: serviceId, code: metadata?.code ?? "", name: metadata?.description ?? "Serviço", budgetAmount };
  });
  if (budgetWithoutService > 0) {
    forecastServices.push({ id: BUDGET_WITHOUT_SERVICE_ID, code: "SEM-SERVIÇO", name: "Itens do orçamento sem serviço", budgetAmount: budgetWithoutService });
  }

  const latestByActivity = latestProgressByActivity(progressMeasurements);
  const forecastActivities = activities.map((activity) => {
    const latest = latestByActivity.get(activity.id);
    return {
      id: activity.id,
      serviceId: activity.service_id,
      plannedStart: activity.planned_start,
      plannedFinish: activity.planned_finish,
      currentStart: latest?.current_start ?? activity.planned_start,
      currentFinish: latest?.current_finish ?? activity.planned_finish,
      actualStart: latest?.actual_start ?? null,
      actualFinish: latest?.actual_finish ?? null,
      progressPercent: latest?.progress_percent ?? 0,
      assignedCost: assignedCosts.get(activity.id) ?? 0,
    };
  });

  const contractMeasurements = contractMeasurementsResult.data;
  const measurementByPayableId = new Map(contractMeasurements.filter((measurement) => measurement.payable_id).map((measurement) => [measurement.payable_id!, measurement]));
  const measurementBySourceId = new Map(contractMeasurements.map((measurement) => [`measurement:${measurement.id}`, measurement]));
  const itemsByMeasurement = new Map<string, ContractMeasurementItem[]>();
  for (const item of measurementItemsResult.data) {
    const rows = itemsByMeasurement.get(item.measurement_id) ?? [];
    rows.push(item);
    itemsByMeasurement.set(item.measurement_id, rows);
  }

  const actualPayments: AllocatedFinancialSource[] = [];
  const openPayables: AllocatedFinancialSource[] = [];
  for (const payable of payablesResult.data) {
    const measurement = measurementFromPayable(payable, measurementByPayableId, measurementBySourceId);
    if (payable.status === "paid" && payable.paid_at) {
      const allocated = allocatePayable(payable, number(payable.paid_amount ?? payable.amount), measurement, itemsByMeasurement);
      actualPayments.push(...allocated.map((source) => ({ ...source, paidAt: payable.paid_at!.slice(0, 10) })));
    } else if (payable.status === "open") {
      const allocated = allocatePayable(payable, number(payable.amount), measurement, itemsByMeasurement);
      openPayables.push(...allocated.map((source) => ({ ...source, dueDate: payable.due_date })));
    }
  }

  const approvedGrossByContractService = new Map<string, number>();
  const validMeasurementIds = new Set(contractMeasurements.map((measurement) => measurement.id));
  for (const item of measurementItemsResult.data) {
    if (!validMeasurementIds.has(item.measurement_id)) continue;
    const key = `${item.contract_id}:${item.service_id}`;
    approvedGrossByContractService.set(key, number(approvedGrossByContractService.get(key)) + number(item.current_amount));
  }

  const actualByContractService = sumByContractService(actualPayments);
  const openByContractService = sumByContractService(openPayables);
  const amendmentsByContractItem = new Map<string, number>();
  for (const amendment of amendmentItemsResult.data) {
    const key = `${amendment.contract_id}:${amendment.contract_item_id}`;
    amendmentsByContractItem.set(key, number(amendmentsByContractItem.get(key)) + number(amendment.value_change));
  }
  const contractValueByContractService = new Map<string, number>();
  for (const item of contractItemsResult.data) {
    const key = `${item.contract_id}:${item.service_id}`;
    const value = number(item.total_value) + number(amendmentsByContractItem.get(`${item.contract_id}:${item.id}`));
    contractValueByContractService.set(key, number(contractValueByContractService.get(key)) + value);
  }

  const contractsById = new Map(contractsResult.data.map((contract) => [contract.id, contract]));
  const commitments: Array<{ id: string; kind: "contract" | "purchase_order"; serviceId: string; amount: number; paymentDays?: number; dueDate?: string; fallbackDate?: string }> = [];
  for (const [key, contractValue] of contractValueByContractService.entries()) {
    const separator = key.indexOf(":");
    const contractId = key.slice(0, separator);
    const serviceId = key.slice(separator + 1);
    const contract = contractsById.get(contractId);
    if (!contract) continue;
    const approvedGross = number(approvedGrossByContractService.get(key));
    const actual = number(actualByContractService.get(key));
    const open = number(openByContractService.get(key));
    const unbilled = Math.max(0, contractValue - approvedGross);
    const approvedResidual = Math.max(0, approvedGross - actual - open);
    if (unbilled > 0) {
      commitments.push({
        id: `${contractId}:${serviceId}:unbilled`,
        kind: "contract",
        serviceId,
        amount: unbilled,
        paymentDays: contract.payment_days,
        fallbackDate: contract.end_date,
      });
    }
    if (approvedResidual > 0) {
      commitments.push({
        id: `${contractId}:${serviceId}:retained-or-deducted`,
        kind: "contract",
        serviceId,
        amount: approvedResidual,
        dueDate: addDays(contract.end_date, contract.payment_days),
      });
    }
  }

  const forecast = buildUnifiedForecast({
    asOfDate,
    defaultPaymentDays: number(project?.forecast_default_payment_days ?? 30),
    workOnSaturday: baseline.work_on_saturday,
    services: forecastServices,
    activities: forecastActivities,
    actualPayments: actualPayments.map((source) => ({ id: source.id, serviceId: source.serviceId, amount: source.amount, paidAt: source.paidAt! })),
    openPayables: openPayables.map((source) => ({ id: source.id, serviceId: source.serviceId, amount: source.amount, dueDate: source.dueDate! })),
    commitments,
  });

  return {
    project,
    baseline,
    baselines,
    budget,
    budgetItems,
    services,
    activities,
    progressMeasurements,
    assignedCosts,
    forecast,
    errors,
  };
}
