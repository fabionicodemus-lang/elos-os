export type FlowSnapshotTask = {
  id: string;
  code: string;
  name: string;
  location: string;
  start: string;
  baselineStart: string;
  durationDays: number;
  actualPercent: number;
  actualStart?: string;
  actualEnd?: string;
  actualNotes?: string;
  worksSaturday?: boolean;
  worksHolidays?: boolean;
  worksRecesses?: boolean;
  milestone?: boolean;
  measurements: { date: string; percent: number; notes?: string }[];
};
export type FlowSnapshot = {
  project: { name: string; sourceFile: string; baselineName: string; scheduleRevision: { date: string } };
  tasks: FlowSnapshotTask[];
};
export type ElosFlowActivity = {
  id: string;
  code: string;
  name?: string;
  sort_order: number;
  quantity_snapshot: number | string | null;
  planned_start: string;
  planned_finish: string;
  duration_days: number;
};
export type ElosExistingMeasurement = {
  activity_id: string;
  measurement_date: string;
  voided_at?: string | null;
  progress_percent?: number | string;
  actual_quantity?: number | string;
  actual_cost?: number | string;
  team_count?: number | null;
  actual_start?: string | null;
  actual_finish?: string | null;
};
export type FlowPreparedMeasurement = {
  activity_id: string;
  measurement_date: string;
  progress_percent: number;
  actual_quantity: number;
  actual_cost: number;
  team_count: null;
  current_start: string;
  current_finish: string;
  actual_start: string | null;
  actual_finish: string | null;
  notes: string;
};
export function extractFlowSnapshot(html: string): FlowSnapshot;
export function finishWorkday(start: string, durationDays: number, options?: {
  milestone?: boolean;
  worksSaturday?: boolean;
  worksHolidays?: boolean;
  worksRecesses?: boolean;
  globalSaturday?: boolean;
  globalHolidays?: boolean;
  globalRecesses?: boolean;
  holidays?: { date: string }[];
  recesses?: { start: string; end: string }[];
}): string;
export function prepareFlowImport(
  state: FlowSnapshot,
  activities: ElosFlowActivity[],
  existingMeasurements: ElosExistingMeasurement[]
): {
  rows: FlowPreparedMeasurement[];
  summary: {
    matchedActivities: number;
    importedMeasurements: number;
    newReplans: number;
    existingPreserved: number;
    correctedProgress: number;
    sourceMeasuredThrough: string;
  };
};
