export type EntityKind = "supplier" | "client" | "payable" | "receivable";
export const ENTITY_KINDS: readonly EntityKind[];
export const MAX_FILE_BYTES: number;
export const MAX_ROWS: number;
export type FieldDefinition = { readonly key: string; readonly label: string; readonly required?: boolean; readonly aliases: readonly string[] };
export const FIELD_DEFINITIONS: Readonly<Record<EntityKind, readonly FieldDefinition[]>>;
export type ImportRow = {
  source_row: number;
  external_id: string | null;
  raw_data: Record<string, unknown>;
  normalized_data: Record<string, unknown>;
  errors: string[];
  warnings: string[];
};
export type FileInspection = {
  sheets: Array<{ name: string; headers: string[]; rowCount: number; samples: Record<string, string>[] }>;
};
export type ImportSummary = {
  rows: number;
  valid: number;
  blocked: number;
  /** Exact sums of parsed source values, including blocked rows; not promoted totals. */
  original_amount: string;
  paid_amount: string;
  balance_amount: string;
  totals_complete: boolean;
};
export type ParsedImport = { sheetName: string; headers: string[]; rows: ImportRow[]; summary: ImportSummary };
export function inspectImportFile(bytes: Uint8Array | ArrayBuffer, fileName: string, options?: { headerRow?: number }): Promise<FileInspection>;
export function suggestColumnMapping(headers: readonly string[], kind: EntityKind): Record<string, string>;
export function parseImportFile(bytes: Uint8Array | ArrayBuffer, fileName: string, options: {
  entityKind: EntityKind;
  sheetName?: string;
  headerRow?: number;
  columnMapping: Record<string, string>;
}): Promise<ParsedImport>;
