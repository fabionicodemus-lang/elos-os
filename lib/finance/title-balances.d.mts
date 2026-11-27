export type FinancialTitle = {
  id?: string;
  amount: number | string;
  adjusted_amount?: number | string | null;
  paid_amount?: number | string | null;
  status: string;
  due_date?: string;
  source_system?: string | null;
};
export type TitleFinancialValues = {
  original: number; updated: number; paid: number; remaining: number; historical_balance: number;
  original_amount: string; updated_amount: string; paid_amount: string; remaining_amount: string; historical_balance_amount: string;
  partial: boolean;
};
export type FinancialPaymentEvent = {
  event_id: string;
  title_kind: "receivable" | "payable";
  title_id: string;
  project_id: string;
  occurred_on: string;
  amount: string | number;
  kind: "payment" | "reversal" | "voided_payment";
  medium: string | null;
  account_name: string | null;
  source_system: string;
  history_dates_complete?: boolean;
};
export type TitleFinancialEntry = {
  id: string; situation: "realized" | "forecast"; date: string; amount: number;
  kind: "payment" | "reversal" | "remaining"; medium: string | null; account_name: string | null; source_system: string | null;
};
export function titleFinancialValues(row: FinancialTitle): TitleFinancialValues;
export function titleFinancialTimeline(row: FinancialTitle & { id: string }, events?: readonly FinancialPaymentEvent[]): TitleFinancialValues & {
  entries: TitleFinancialEntry[]; history_complete: boolean; history_dates_complete: boolean; errors: string[];
};
