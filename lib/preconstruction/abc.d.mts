export type AbcInputRow = { id: string; label: string; value: number; [key: string]: unknown };
export type AbcClassifiedRow<T extends AbcInputRow = AbcInputRow> = T & {
  rank: number;
  percentage: number;
  accumulatedPercentage: number;
  classification: "A" | "B" | "C";
};
export function classifyAbc<T extends AbcInputRow>(rows: T[], options?: { classALimit?: number; classBLimit?: number }): AbcClassifiedRow<T>[];
export function abcSummary(rows: AbcClassifiedRow[]): Record<"A" | "B" | "C", { count: number; value: number }>;