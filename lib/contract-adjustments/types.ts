export type ContractAdjustment = {
  id: string; mode: "pending" | "none" | "phased"; base_month: string; keys_month: string | null;
  start_month: number; limit_rule: "current_month" | "due_month";
  pre_index_id: string | null; post_index_id: string | null;
  pre_interval: number; post_interval: number; pre_lag: number; post_lag: number;
  reason: string; created_at: string;
};
export type AdjustmentCalculation = {
  ready: boolean; reason?: string; target_month?: string; factor?: number;
  pre?: { code?: string; base_month?: string; target_month?: string; factor?: number; reason?: string };
  post?: { code?: string; base_month?: string; target_month?: string; factor?: number; reason?: string };
};
