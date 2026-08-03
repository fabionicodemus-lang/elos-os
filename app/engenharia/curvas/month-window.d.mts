export const MAX_CURVE_MONTHS: 240;

export function buildSafeMonthWindow(
  keys: string[],
  asOfKey: string,
  maxMonths?: number,
): {
  keys: string[];
  truncated: boolean;
  sourceSpanMonths: number;
};
