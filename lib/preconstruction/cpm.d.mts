export type CpmActivity = {
  id: string;
  code?: string | null;
  name?: string | null;
  duration_days: number;
  record_status?: string;
  [key: string]: unknown;
};
export type CpmDependency = {
  predecessor_id: string;
  successor_id: string;
  relation_type: "FS" | "SS" | "FF" | "SF";
  lag_days: number;
};
export type CpmRow<T extends CpmActivity = CpmActivity> = T & {
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloat: number;
  freeFloat: number;
  critical: boolean;
  predecessorCount: number;
  successorCount: number;
};
export function calculateCpm<T extends CpmActivity>(activities: T[], dependencies: CpmDependency[]): {
  rows: CpmRow<T>[];
  projectDuration: number;
  criticalCount: number;
  cycleDetected: boolean;
};