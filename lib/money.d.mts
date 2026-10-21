export function decimalToCents(value: number | string | null | undefined, options: {rounding: 'half-away-from-zero'}): number | null;
export function allocateCents(totalCents: number, rows: Array<{id?: string | number; weight: number | string}>): number[];
