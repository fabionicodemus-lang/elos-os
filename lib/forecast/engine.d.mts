export const UNALLOCATED_SERVICE_ID: "__unallocated__";

export type ForecastBudgetService = {
  id: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  budgetAmount?: number | string | null;
  budget_amount?: number | string | null;
};

export type ForecastActivity = {
  id: string;
  serviceId?: string | null;
  service_id?: string | null;
  plannedStart?: string | null;
  planned_start?: string | null;
  plannedFinish?: string | null;
  planned_finish?: string | null;
  currentStart?: string | null;
  current_start?: string | null;
  currentFinish?: string | null;
  current_finish?: string | null;
  actualStart?: string | null;
  actual_start?: string | null;
  actualFinish?: string | null;
  actual_finish?: string | null;
  progressPercent?: number | string | null;
  progress_percent?: number | string | null;
  assignedCost?: number | string | null;
  assigned_cost?: number | string | null;
};

export type ForecastDatedSource = {
  id: string;
  serviceId?: string | null;
  service_id?: string | null;
  amount: number | string;
  paidAt?: string | null;
  dueDate?: string | null;
  date?: string | null;
};

export type ForecastCommitmentSource = {
  id: string;
  kind: "contract" | "purchase_order" | string;
  serviceId?: string | null;
  service_id?: string | null;
  amount: number | string;
  paymentDays?: number | string | null;
  payment_days?: number | string | null;
  dueDate?: string | null;
  due_date?: string | null;
  fallbackDate?: string | null;
  fallback_date?: string | null;
};

export type ForecastMonth = {
  key: string;
  actual: number;
  committedPayable: number;
  committedFuture: number;
  committed: number;
  toCommit: number;
  projected: number;
  engineeringProjected: number;
  cumulativeActual: number;
  cumulativeCommitted: number;
  cumulativeToCommit: number;
  cumulativeProjected: number;
  cumulativeEngineeringProjected: number;
};

export type ForecastServiceRow = {
  id: string;
  code: string;
  name: string;
  budgetAmount: number;
  actual: number;
  committedPayable: number;
  committedFuture: number;
  committed: number;
  toCommit: number;
  projectedCost: number;
  deviation: number;
  deviationPercent: number;
  monthly: Array<Pick<ForecastMonth, "key" | "actual" | "committedPayable" | "committedFuture" | "committed" | "toCommit" | "projected" | "engineeringProjected">>;
};

export type UnifiedForecastResult = {
  asOfDate: string;
  defaultPaymentDays: number;
  services: ForecastServiceRow[];
  months: ForecastMonth[];
  totals: {
    budget: number;
    actual: number;
    committedPayable: number;
    committedFuture: number;
    committed: number;
    toCommit: number;
    projectedCost: number;
    deviation: number;
    deviationPercent: number;
    engineeringProjected: number;
  };
  warnings: Array<{ code: string; serviceId: string; message: string }>;
  profiles: Map<string, Map<string, number>>;
  boundaries: {
    openPayablesIncludedInCommitted: true;
    openPayablesExcludedFromEngineeringProjected: true;
    engineeringProjectedFormula: "committedFuture + toCommit";
  };
};

export function buildServiceScheduleProfiles(
  activities: ForecastActivity[],
  asOfDate: string,
  workOnSaturday?: boolean,
): Map<string, Map<string, number>>;

export function buildUnifiedForecast(input: {
  asOfDate: string;
  defaultPaymentDays?: number;
  workOnSaturday?: boolean;
  services: ForecastBudgetService[];
  activities?: ForecastActivity[];
  actualPayments?: ForecastDatedSource[];
  openPayables?: ForecastDatedSource[];
  commitments?: ForecastCommitmentSource[];
}): UnifiedForecastResult;
