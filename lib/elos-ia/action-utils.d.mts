export function normalizeActionText(value: unknown): string;
export function matchUniqueCandidate<T>(
  requested: unknown,
  candidates: T[],
  keySelector: (candidate: T) => Array<string | null | undefined>,
): { match: T | null; reason: "empty" | "not_found" | "ambiguous" | "ok"; candidates?: T[] };
export function allocateSharedAmount(total: unknown, weights: unknown[]): number[];
export type MeasurementPreviewItem = Record<string, unknown> & {
  currentQuantity:number; previousQuantity:number; accumulatedQuantity:number; contractedQuantity:number;
  unitPrice:number; currentAmount:number; overContract:boolean;
};
export function buildMeasurementPreview(input: {
  contract?: Record<string, unknown> | null;
  items?: Array<Record<string, unknown>>;
  taxWithholding?: unknown;
  advanceDeduction?: unknown;
  otherDiscount?: unknown;
}): {
  rows:MeasurementPreviewItem[]; gross:number; contractualRetention:number; guaranteeRetention:number;
  deductions:number; net:number; overContract:boolean; overItem:boolean; overValue:boolean;
};
