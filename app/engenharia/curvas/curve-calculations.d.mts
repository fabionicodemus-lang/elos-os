export type CurveActivity = {
  id: string;
  service_id: string | null;
  code: string;
  name: string;
  quantity_snapshot: number;
  planned_start: string;
  planned_finish: string;
  planned_cost: number;
};

export type CurveBudgetItem = {
  id: string;
  service_id: string | null;
  code?: string | null;
  description?: string | null;
  total_direct_cost: number;
  status: "active" | "inactive";
};

export type CurveService = {
  id: string;
  code: string;
  description: string;
};

export type CurveMeasurement = {
  id?: string;
  activity_id: string;
  measurement_date: string;
  progress_percent: number | string;
  actual_cost: number | string;
  current_start: string;
  current_finish: string;
  actual_start: string | null;
  actual_finish: string | null;
  created_at?: string;
};

export type CurveRow = {
  key: string;
  label: string;
  physicalMonth: number;
  physicalAccumulated: number;
  financialMonth: number;
  financialAccumulated: number;
  financialPercent: number;
  currentPhysicalMonth?: number;
  currentPhysicalAccumulated?: number;
  actualPhysicalMonth?: number;
  actualPhysicalAccumulated?: number;
  currentFinancialMonth?: number;
  currentFinancialAccumulated?: number;
  currentFinancialPercent?: number;
  actualFinancialMonth?: number;
  actualFinancialAccumulated?: number;
  actualFinancialPercent?: number;
};

export type BuildCurvesResult = {
  rows: CurveRow[];
  usesEqualPhysicalWeights: boolean;
  zeroWorkdayActivityIds: string[];
};

export type BuildLiveCurvesResult = BuildCurvesResult & {
  hasExecutionData: boolean;
  lateActualCostWarnings: Array<{
    activityId: string;
    measurementDate: string;
  }>;
};

export type CurveDeviations = {
  delayAt50Months: number | null;
  finishDelayMonths: number | null;
  baselineFinancialToDate: number;
  actualFinancialToDate: number;
  financialDeviationToDate: number;
};

export type IntegrityAlerts = {
  servicesWithoutActivities: Array<{
    serviceId: string;
    serviceLabel: string;
    budgetValue: number;
  }>;
  overprogrammedServices: Array<{
    serviceId: string;
    serviceLabel: string;
    budgetValue: number;
    programmedValue: number;
    excessValue: number;
  }>;
  activitiesWithoutBudgetService: Array<{
    activityId: string;
    activityLabel: string;
    serviceId: string;
    serviceLabel: string;
  }>;
  budgetItemsWithoutService: Array<{
    itemId: string;
    itemLabel: string;
    budgetValue: number;
  }>;
};

export function assignActivityCosts(
  activities: CurveActivity[],
  items: CurveBudgetItem[],
): Map<string, number>;

export function buildCurves(
  activities: CurveActivity[],
  assignedCosts: Map<string, number>,
  budgetTotal: number,
  workOnSaturday: boolean,
): BuildCurvesResult;

export function buildLiveCurves(
  activities: CurveActivity[],
  assignedCosts: Map<string, number>,
  budgetTotal: number,
  workOnSaturday: boolean,
  measurements: CurveMeasurement[],
  asOfDate: string,
): BuildLiveCurvesResult;

export function calculateCurveDeviations(
  rows: CurveRow[],
  currentMonthKey: string,
): CurveDeviations;

export function detectIntegrityAlerts(
  activities: CurveActivity[],
  items: CurveBudgetItem[],
  services: CurveService[],
): IntegrityAlerts;
