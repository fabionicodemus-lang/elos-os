export type MoneyItem = { total_value?: number | string | null };
export type AmendmentItem = { value_change?: number | string | null };
export type MeasurementItem = {
  status: string;
  gross_amount?: number | string | null;
  contractual_retention_amount?: number | string | null;
  guarantee_retention_amount?: number | string | null;
};
export function roundMoney(value: number | string | null | undefined): number;
export function sumContractItems(items: MoneyItem[]): number;
export function contractCurrentValue(originalValue: number | string | null | undefined, amendments: AmendmentItem[]): number;
export function contractBalance(currentValue: number | string | null | undefined, measurements: MeasurementItem[]): number;
export function retainedBalance(measurements: MeasurementItem[]): number;
export function dueDateFromApproval(approvalDate: string, paymentDays: number): string;
export function requiresOverContractConfirmation(currentValue: number, measuredValue: number, nextGross: number): boolean;
export function serviceDeviation(budgetedValue: number, committedValue: number): { deviation: number; overBudget: boolean };
export function contractItemsMatchOriginal(originalValue: number, items: MoneyItem[], tolerance?: number): boolean;
