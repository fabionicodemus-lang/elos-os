export function normalizedServiceName(value: unknown): string;
export function normalizedServiceUnit(value: unknown): string;
export function compatibleService(item: {description: string; unit: string | null}, service: {description: string; unit: string | null}): boolean;
