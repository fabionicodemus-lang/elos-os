import type { DevelopmentResult, calculateDevelopmentResult } from "../commercial/development-result.mjs";

export type CommercialPaymentItem = {
  installment_count: number | string;
  first_due_date: string;
  interval_months: number | string;
  amount_per_installment: number | string;
  total_amount?: number | string | null;
  adjustment_index?: string | null;
  interest_rate_monthly?: number | string | null;
};

export type CommercialScenarioAnalysis = {
  label: string;
  nominal: number | null;
  presentValue: number | null;
  marginPct: null;
  installmentCount: number;
  planned: number | null;
  assumptions: string[];
  warnings: string[];
};

export function isCommercialIsoDate(value: unknown): value is string;
export function effectiveAnnualDiscount(ratePct: unknown, period: unknown): number | null;
export function expandCommercialPayments(items: CommercialPaymentItem[]): Array<{ date: string; amount: number }>;
export function analyzeCommercialScenario(input: {
  label: string;
  nominalAmount?: number | string | null;
  paymentItems?: CommercialPaymentItem[];
  discountAnnualPct?: number | null;
  valuationDate?: string | null;
}): CommercialScenarioAnalysis;
export function analyzeDevelopmentResult(input: {
  input: NonNullable<Parameters<typeof calculateDevelopmentResult>[0]>;
  baselineApproved: boolean;
  sourceErrors?: string[];
}): {
  resultado: DevelopmentResult | null;
  baseline_disponivel: boolean;
  projecao_disponivel: boolean;
  avisos: string[];
};
