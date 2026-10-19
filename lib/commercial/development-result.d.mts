import type { UnifiedForecastResult } from "../forecast/engine.mjs";
import type { DevelopmentCostSummary } from "../development-costs/summary.mjs";

export type DevelopmentBaselineMetrics = {
  available_vgv?: number | string | null;
  available_units?: number | string | null;
  profit?: number | string | null;
  margin_pct?: number | string | null;
  total_cost?: number | string | null;
  construction_cost?: number | string | null;
  contingency_cost?: number | string | null;
  commission_cost?: number | string | null;
  tax_cost?: number | string | null;
};

export type DevelopmentBaselineStudy = {
  commission_pct?: number | string | null;
  tax_rate_pct?: number | string | null;
};

export type DevelopmentProject = {
  total_units?: number | string | null;
};

export type DevelopmentSale = {
  status?: string | null;
  unit_id?: string | null;
  total_amount?: number | string | null;
  commission_pct?: number | string | null;
  commission_amount?: number | string | null;
};

export type DevelopmentUnit = {
  status?: string | null;
  list_price?: number | string | null;
};

export type DevelopmentReceivable = {
  status?: string | null;
  due_date?: string | null;
  amount?: number | string | null;
  adjusted_amount?: number | string | null;
  paid_amount?: number | string | null;
};

export type DevelopmentPayable = {
  status?: string | null;
  amount?: number | string | null;
  paid_amount?: number | string | null;
};

export type DevelopmentResult = {
  baseline: {
    vgv:number; units:number; totalCost:number; engineeringCost:number; profit:number; marginPct:number;
    commission:number; taxes:number; otherCost:number; averageTicket:number;
  };
  commercial: {
    soldVgv:number; inventoryVgv:number; projectedVgv:number; vgvDeviation:number; soldUnits:number;
    availableUnits:number; salesProgressPct:number; averageSoldTicket:number;
  };
  cash: {
    received:number; receivableOpen:number; overdue:number; overdueCount:number; paidOut:number;
    payableOpen:number; cashBalance:number;
  };
  cost: {
    engineeringBudget:number; engineeringActual:number; engineeringCommitted:number; engineeringToCommit:number;
    engineeringProjected:number; unallocatedActual:number; unallocatedCommitted:number; unallocatedSourceProjected:number;
    unallocatedProjected:number; unallocatedExcess:number; projectedOtherCost:number; rateCommission:number; rateTaxes:number;
    developmentCentersBudget:number; developmentCentersAppropriated:number; developmentCentersProjected:number;
    baselineOtherRemainder:number; projectedCommission:number;
    projectedTaxes:number; projectedTotalCost:number;
  };
  result: {
    projectedProfit:number; projectedMarginPct:number; profitDeviation:number; marginDeviationPct:number;
    health:"above"|"attention"|"below";
  };
  rates: { commissionRate:number; taxRate:number };
  warnings:string[];
};

export function calculateDevelopmentResult(input?: {
  baselineMetrics?: DevelopmentBaselineMetrics;
  baselineStudy?: DevelopmentBaselineStudy;
  project?: DevelopmentProject;
  sales?: DevelopmentSale[];
  units?: DevelopmentUnit[];
  receivables?: DevelopmentReceivable[];
  payables?: DevelopmentPayable[];
  forecast?: UnifiedForecastResult | null;
  developmentCosts?: Pick<DevelopmentCostSummary, "rows"> | null;
  today?: string;
}): DevelopmentResult;
