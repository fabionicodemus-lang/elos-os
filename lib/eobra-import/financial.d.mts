export type FinancialStatus = "open" | "partial" | "paid" | "cancelled" | "unknown";
export type CorrectionPolicy =
  | { mode: "none" }
  | {
      mode: "index_number";
      /** Explicit source competencies (YYYY-MM), independent of the sale date. */
      base_month: string;
      reference_month: string;
      /** Exact decimal strings, up to six decimal places, strictly positive. */
      base_value: string;
      reference_value: string;
      /** Omitted means unknown/not applied, never an implicit zero-month lag. */
      lag_months?: number;
      /** Required only when checking an explicitly supplied lag. */
      calculation_month?: string;
      /** Omission does not assert a contractual policy for negative variation. */
      negative_variation_policy?: "use_negative" | "maximum_of_period";
      /** For maximum_of_period, every competency from base through reference. */
      index_values?: ReadonlyArray<{ reference_month: string; value: string }>;
    };

export type MonetaryComponents = {
  interest_amount: string;
  penalty_amount: string;
  other_accrual_amount: string;
  discount_amount: string;
};

export type InstallmentCorrectionInput = MonetaryComponents & {
  original_amount: string;
  status: FinancialStatus;
  correction_locked?: boolean;
  /** Required for an unlocked open/partial installment; never inferred. */
  correction?: CorrectionPolicy | null;
  /** Both snapshot values are required when paid, cancelled or locked. */
  current_amount?: string;
  correction_amount?: string;
};

export type InstallmentCorrectionResult = {
  ok: boolean;
  preserved: boolean;
  original_amount: string | null;
  current_amount: string | null;
  correction_amount: string | null;
  effective_reference_month: string | null;
  effective_reference_value: string | null;
  interest_amount: string | null;
  penalty_amount: string | null;
  other_accrual_amount: string | null;
  discount_amount: string | null;
  rounding: "half_up" | null;
  errors: string[];
  warnings: string[];
};

export type PaymentEvent = {
  /** Scoped by the caller to the source instance/tenant and this installment. */
  source_id: string;
  kind: "payment" | "reversal" | "voided_payment";
  /** Positive exact decimal; kind determines the sign. */
  amount: string;
  occurred_on: string;
  /** Required for reversal; must identify a payment in this complete history. */
  reverses_source_id?: string;
  /** For an explicitly voided source payment; archive/link evidence is external. */
  voided_by_source_id?: string;
  voided_date_unknown?: true;
  medium?: "bank" | "cash" | "non_cash" | "unknown";
  account_source_id?: string;
};

export type PaymentReconciliationInput = {
  paid_amount: string;
  events: readonly PaymentEvent[];
  /** Evidence from snapshot completeness, not merely a client acknowledgement. */
  events_complete: boolean;
};

export type PaymentReconciliationResult = {
  ok: boolean;
  /** Totals can be complete even when they disagree with paid_amount. */
  totals_complete: boolean;
  history_dates_complete: boolean;
  source_event_count: number;
  event_count: number;
  duplicate_event_count: number;
  voided_event_count: number;
  voided_amount: string | null;
  payment_amount: string | null;
  reversal_amount: string | null;
  net_amount: string | null;
  events: PaymentEvent[];
  errors: string[];
  warnings: string[];
};

export type InstallmentFinancialInput = InstallmentCorrectionInput & PaymentReconciliationInput & {
  current_amount: string;
  correction_amount: string;
  balance_amount: string;
};

export type InstallmentFinancialResult<T extends InstallmentFinancialInput = InstallmentFinancialInput> = {
  /** Mathematical/source reconciliation only; does not authorize DB promotion. */
  ok: boolean;
  source_snapshot: T;
  expected_current_amount: string | null;
  expected_correction_amount: string | null;
  effective_reference_month: string | null;
  effective_reference_value: string | null;
  computed_balance_amount: string | null;
  /** Historical current minus paid remains above; cancelled has no collectible balance. */
  collectible_balance_amount: string | null;
  canonical_status: "open" | "paid" | "cancelled" | null;
  settlement_state: "open" | "partial" | "paid" | "cancelled" | null;
  requires_partial_support: boolean;
  correction_preserved: boolean;
  payments: PaymentReconciliationResult;
  errors: string[];
  warnings: string[];
};

/** Throws on invalid decimals, nonpositive indices or numeric(16,2) overflow. */
export function calculateIndexNumberAmount(input: {
  original_amount: string;
  base_value: string;
  reference_value: string;
}): { original_amount: string; adjusted_principal_amount: string; correction_amount: string; rounding: "half_up" };
export function calculateInstallmentCorrection(input: InstallmentCorrectionInput): InstallmentCorrectionResult;
export function reconcilePaymentEvents(input: PaymentReconciliationInput): PaymentReconciliationResult;
export function reconcileInstallmentFinancials<T extends InstallmentFinancialInput>(input: T): InstallmentFinancialResult<T>;
