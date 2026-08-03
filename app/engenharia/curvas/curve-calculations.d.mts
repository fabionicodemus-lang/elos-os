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

export type CurveRow = {
  key: string;
  label: string;
  physicalMonth: number;
  physicalAccumulated: number;
  financialMonth: number;
  financialAccumulated: number;
  financialPercent: number;
};

export type BuildCurvesResult = {
  rows: CurveRow[];
  usesEqualPhysicalWeights: boolean;
  zeroWorkdayActivityIds: string[];
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

export function detectIntegrityAlerts(
  activities: CurveActivity[],
  items: CurveBudgetItem[],
  services: CurveService[],
): IntegrityAlerts;
