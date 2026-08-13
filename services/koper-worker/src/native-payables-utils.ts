import { createHash } from "node:crypto";

export type Json = Record<string, unknown>;

export const objectValue = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};

export const textValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

export const numberValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const centsValue = (value: unknown): number | null => {
  const parsed = numberValue(value);
  return parsed === null ? null : Math.round((parsed + Number.EPSILON) * 100);
};

export const dateOnly = (value: unknown): string | null => {
  const text = textValue(value);
  if (!text) return null;
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
};

export const isPaid = (value: unknown): boolean =>
  value === true || value === 1 || value === "1" || String(value ?? "").toUpperCase() === "S";

export function stablePayableUuid(billId: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(`elos:koper:payable:${billId}`).digest("hex").slice(0, 32),
    "hex",
  );
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export async function readAll<T>(
  request: <R>(resource: string, options?: any) => Promise<R>,
  table: string,
  query: Record<string, string>,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await request<T[]>(table, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
    });
    out.push(...page);
    if (page.length < 1000) return out;
  }
}
