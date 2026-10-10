export type PayableSummaryRow = {
  id: string;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  amount: number | string | null;
  paidAmount: number | string | null;
  supplier: string | null;
  document: string | null;
  installment: string | null;
};

export type ReceivableSummaryRow = {
  id: string;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  amount: number | string | null;
  adjustedAmount: number | string | null;
  paidAmount: number | string | null;
  category: string;
  client: string | null;
  unit: string | null;
  sequenceNumber: number | null;
  sequenceTotal: number | null;
};

export type ScheduleActivityRow = {
  id: string;
  service_id: string | null;
  location_id: string | null;
  code: string;
  name: string;
  planned_start: string;
  planned_finish: string;
  planned_cost?: number | string | null;
  duration_days?: number | string | null;
  quantity_snapshot?: number | string | null;
  record_status: string;
};

export type ScheduleMeasurementRow = {
  activity_id: string;
  measurement_date: string;
  progress_percent: number | string;
  current_start: string | null;
  current_finish: string | null;
  created_at?: string | null;
};

export type ScheduleServiceWeightRow = {
  service_id: string | null;
  physical_weight_percent: number | string | null;
};

export type JsonSummary = Record<string, unknown>;

export function round2(value: unknown): number;
export function addDaysIso(value: string, days: number): string;
export function addMonthsKey(monthKey: string, months: number): string;

export function summarizePayables(
  rows: PayableSummaryRow[],
  options?: { today: string; from?: string | null; to?: string | null; situation?: string | null; supplierText?: string | null; limit?: number | null },
): JsonSummary;

export function summarizeReceivables(
  rows: ReceivableSummaryRow[],
  options?: { today: string; from?: string | null; to?: string | null; situation?: string | null; clientText?: string | null; limit?: number | null },
): JsonSummary;

export function buildCashflowMonths(input: {
  payables?: PayableSummaryRow[];
  receivables?: ReceivableSummaryRow[];
  engineeringMonths?: Array<{ key: string; engineeringProjected: number }>;
  today: string;
  monthsBack?: number | null;
  monthsAhead?: number | null;
}): JsonSummary;

export function summarizeSchedule(input: {
  activities?: ScheduleActivityRow[];
  measurements?: ScheduleMeasurementRow[];
  serviceWeights?: ScheduleServiceWeightRow[];
  serviceNames?: Map<string, string>;
  locationNames?: Map<string, string>;
  today: string;
  limit?: number | null;
  searchText?: string | null;
}): JsonSummary;
