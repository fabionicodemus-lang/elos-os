export type CascadeActivity = {
  id: string;
  planned_start: string;
  planned_finish: string;
  duration_days: number;
};

export type CascadeDependency = {
  predecessor_id: string;
  successor_id: string;
  relation_type: "FS" | "SS" | "FF" | "SF";
  lag_days: number;
};

export type CascadeResultActivity = {
  id: string;
  plannedStart: string;
  plannedFinish: string;
  durationDays: number;
};

export type CascadeResult = {
  activities: CascadeResultActivity[];
  changed: string[];
};

export function finishFromStart(start: string | Date, duration: number, saturday: boolean): Date;

export function rescheduleFromMove(input: {
  activities: CascadeActivity[];
  dependencies?: CascadeDependency[];
  movedId: string;
  newStart: string;
  workOnSaturday?: boolean;
  cascade?: boolean;
}): CascadeResult;
