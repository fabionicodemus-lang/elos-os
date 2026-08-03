export type ForecastSnapshotRowInput = {
  serviceId?: string | null;
  service_id?: string | null;
  serviceKey?: string | null;
  service_key?: string | null;
  serviceCode?: string | null;
  service_code?: string | null;
  serviceName?: string | null;
  service_name?: string | null;
  serviceBudgetAmount?: number | string | null;
  service_budget_amount?: number | string | null;
  month?: string | null;
  monthKey?: string | null;
  month_key?: string | null;
  layer?: "actual" | "committed" | "to_commit" | string;
  amount?: number | string | null;
};

export type SnapshotServiceSummary = {
  serviceKey: string;
  serviceId: string | null;
  code: string;
  name: string;
  budget: number;
  actual: number;
  committed: number;
  toCommit: number;
  projected: number;
  deviation: number;
};

export type SnapshotComparisonRow = {
  serviceKey: string;
  code: string;
  name: string;
  a: SnapshotServiceSummary;
  b: SnapshotServiceSummary;
  delta: {
    budget: number;
    actual: number;
    committed: number;
    toCommit: number;
    projected: number;
    deviation: number;
  };
};

export type SnapshotActualComparison = {
  month: string;
  predicted: number;
  actual: number;
  deviation: number;
  deviationPercent: number | null;
  closed: boolean;
  current: boolean;
};

export function summarizeSnapshotRows(rows?: ForecastSnapshotRowInput[]): SnapshotServiceSummary[];
export function compareSnapshots(rowsA?: ForecastSnapshotRowInput[], rowsB?: ForecastSnapshotRowInput[]): SnapshotComparisonRow[];
export function compareSnapshotToActual(
  snapshotRows?: ForecastSnapshotRowInput[],
  actualMonths?: Array<{ key?: string; month?: string; actual?: number | string | null }>,
  currentMonthKey?: string,
): SnapshotActualComparison[];
export function buildProjectionEvolution(snapshots?: Array<Record<string, unknown>>): Array<{
  id: string;
  capturedAt: string;
  referenceMonth: string;
  budget: number;
  projected: number;
  deviation: number;
}>;
