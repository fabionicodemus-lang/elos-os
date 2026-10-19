export type DevelopmentCostCategory =
  | "land" | "onerous_grant" | "design" | "commission" | "marketing" | "taxes" | "central_office" | "financial" | "cancellations";

export type DevelopmentCostStatus = "ok" | "attention" | "over" | "no_budget";

export type DevelopmentCostRow = {
  serviceId: string;
  code: string;
  name: string;
  category: DevelopmentCostCategory;
  rateBased: boolean;
  budget: number;
  budgetSource: "feasibility" | "manual" | null;
  paid: number;
  open: number;
  appropriated: number;
  balance: number;
  consumptionPct: number;
  titleCount: number;
  status: DevelopmentCostStatus;
};

export type DevelopmentCostSummary = {
  rows: DevelopmentCostRow[];
  totals: { budget: number; paid: number; open: number; appropriated: number; balance: number };
  hasBudget: boolean;
};

export const DEVELOPMENT_CATEGORY_LABELS: Record<DevelopmentCostCategory, string>;
export const RATE_BASED_CATEGORIES: Set<string>;

export function classifyDevelopmentCost(budget: number, appropriated: number): DevelopmentCostStatus;

export function buildDevelopmentCostSummary(input?: {
  centers?: Array<{ id: string; code: string; description: string; development_cost_category: string }>;
  budgets?: Array<{ service_id: string; budget_amount: number | string; source?: string | null }>;
  allocations?: Array<{ payable_id: string; service_id: string | null; allocation_amount: number | string }>;
  payables?: Array<{ id: string; status: string; amount: number | string; paid_amount?: number | string | null }>;
}): DevelopmentCostSummary;
