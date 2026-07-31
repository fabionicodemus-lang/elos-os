import { createHash } from "node:crypto";

const DEFAULT_VOLATILE_FIELDS = new Set(["_responseAt", "_traceId"]);

export function normalizeKoperPayload(
  value: unknown,
  volatileFields: ReadonlySet<string> = DEFAULT_VOLATILE_FIELDS,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeKoperPayload(item, volatileFields));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !volatileFields.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeKoperPayload(item, volatileFields)]),
  );
}

export function hashKoperPayload(payload: unknown): string {
  const normalized = normalizeKoperPayload(payload);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
