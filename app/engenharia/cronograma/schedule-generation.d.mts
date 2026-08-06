export type ScheduleGenService = {
  id: string;
  code: string;
  description: string;
  unit: string;
};

export type ScheduleGenBudgetItem = {
  service_id: string | null;
  total_direct_cost: number;
  status?: "active" | "inactive";
};

export type ScheduleGenTakeoffCell = {
  service_id: string;
  location_id: string | null;
  total_quantity: number;
  unit_snapshot?: string;
};

export type ScheduleGenLocation = {
  id: string;
  code: string;
  name: string;
  sort_order: number;
};

export type ScheduleGenActivity = {
  serviceId: string;
  locationId: string | null;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  plannedCost: number;
};

export type ScheduleGenDependency = {
  predecessorCode: string;
  successorCode: string;
};

export type ScheduleGenConservation = {
  serviceId: string;
  serviceCode: string | null;
  budgetValue: number;
  scheduledValue: number;
  delta: number;
  partCount: number;
};

export type ScheduleGenResult = {
  activities: ScheduleGenActivity[];
  dependencies: ScheduleGenDependency[];
  conservation: ScheduleGenConservation[];
  totals: {
    budgetValue: number;
    scheduledValue: number;
    serviceCount: number;
  };
};

export function distributeByQuantity(totalCents: number, quantities: number[]): number[];

export function planScheduleFromBudget(input: {
  services?: ScheduleGenService[];
  budgetItems?: ScheduleGenBudgetItem[];
  takeoffCells?: ScheduleGenTakeoffCell[];
  locations?: ScheduleGenLocation[];
}): ScheduleGenResult;
