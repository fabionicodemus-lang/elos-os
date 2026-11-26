import type { ImportRow, EntityKind } from "./parser.mjs";
export function isUuid(value: unknown): boolean;
export function normalizeSourceHost(value: unknown): string;
export function validateReferenceDate(value: unknown): string;
export function buildProjectBinding(rows: ImportRow[], projectId: string, confirmed: boolean, sourceProjectMapped: boolean): {source_reference: string | null; project_id: string; confirmed: boolean};
export function resolveFinancialRows(rows: ImportRow[], options: {
  companyId: string; projectId: string; sourceHost: string; entityKind: EntityKind;
  suppliers?: Array<Record<string, unknown>>; supplierLinks?: Array<Record<string, unknown>>;
  sales?: Array<Record<string, unknown>>; clients?: Array<Record<string, unknown>>; units?: Array<Record<string, unknown>>;
}): ImportRow[];
