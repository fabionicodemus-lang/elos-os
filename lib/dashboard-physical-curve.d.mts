export type DashboardPhysicalActivity = {
  id: string;
  service_id?: string | null;
  record_status: string;
  planned_start: string;
  planned_finish: string;
  planned_cost?: number | string | null;
  duration_days?: number | string | null;
  quantity_snapshot?: number | string | null;
};
export type DashboardPhysicalMeasurement = {
  activity_id: string;
  measurement_date: string;
  progress_percent: number | string;
  created_at?: string | null;
  voided_at?: string | null;
};
export type DashboardPhysicalServiceWeight = {
  service_id: string | null;
  physical_weight_percent: number | string | null;
};
export type DashboardPhysicalMonth = {
  key: string;
  label: string;
  planned: number;
  actual: number | null;
  current: boolean;
};
export function calculateDashboardActivityWeights(
  activities: DashboardPhysicalActivity[],
  serviceWeights?: DashboardPhysicalServiceWeight[],
): Map<string, number>;
export function buildDashboardPhysicalMonths(input: {
  activities: DashboardPhysicalActivity[];
  measurements?: DashboardPhysicalMeasurement[];
  serviceWeights?: DashboardPhysicalServiceWeight[];
  today?: string;
  maxMonths?: number;
}): DashboardPhysicalMonth[];
