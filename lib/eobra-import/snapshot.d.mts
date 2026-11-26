export type EobraSnapshotEntity = "project" | "person" | "unit" | "sale" | "receivable" | "payable" | "settlement" | "bank_account" | "bank_transaction" | "correction_index" | "index_value" | "raw_archive";
export type EobraPriorityEntity = Exclude<EobraSnapshotEntity, "raw_archive">;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const EOBRA_SNAPSHOT_FORMAT: "elos.eobra.snapshot.v1";
export const EOBRA_PRIORITY_ENTITIES: readonly EobraPriorityEntity[];
export const EOBRA_SNAPSHOT_ENTITIES: readonly EobraSnapshotEntity[];
export const MAX_SNAPSHOT_BYTES: number;
export const MAX_SNAPSHOT_RECORDS: number;
export const MAX_SNAPSHOT_DEPTH: number;

export interface EobraSnapshotSource {
  host: string;
  capturedAt: string;
  referenceDate: string;
  [key: string]: JsonValue;
}

export interface EobraSnapshotScope {
  projectIds: string[];
  allProjects: boolean;
  [key: string]: JsonValue;
}

export interface EobraSnapshotLink {
  entity: EobraSnapshotEntity;
  sourceId: string;
  role: string;
  archiveType?: string;
  /** Only a value observed in the source; never inferred from list order. */
  primary?: boolean;
  allocated_amount?: string | null;
  ownership_percent?: string | null;
  source_relation_id?: string;
  [key: string]: JsonValue | undefined;
}

export interface EobraSnapshotRecord {
  entity: EobraSnapshotEntity;
  sourceId: string;
  sourceProjectId?: string | null;
  parentSourceId?: string | null;
  archiveType?: string;
  links: EobraSnapshotLink[];
  raw: Record<string, JsonValue>;
  normalized: Record<string, JsonValue>;
}

export interface EobraCoverage {
  entity: EobraSnapshotEntity;
  sourceProjectId: string | null;
  archiveType?: string;
  expectedCount: number | null;
  /** Optional allegation; the inspector always derives the effective count. */
  collectedCount?: number;
  expectedPages: number | null;
  collectedPages: number[];
  detailsExpected: number | null;
  detailsCollected: string[];
  complete: boolean;
  filters: Record<string, JsonValue>;
}

export interface EobraSnapshot {
  format: typeof EOBRA_SNAPSHOT_FORMAT;
  source: EobraSnapshotSource;
  scope: EobraSnapshotScope;
  archiveTypes?: Array<{ key: string; description: string }>;
  coverage: EobraCoverage[];
  records: EobraSnapshotRecord[];
}

export interface InspectedEobraRecord extends EobraSnapshotRecord {
  sourceProjectId: string | null;
  parentSourceId: string | null;
  identity: string | null;
  recordHash: string | null;
  errors: string[];
  warnings: string[];
  promotionBlockers: string[];
  /** A candidate is still subject to database validation and user confirmation. */
  disposition: "candidate" | "archived" | "blocked";
}

export interface InspectedEobraCoverage extends EobraCoverage {
  collectedCount: number;
  /** Derived from count, page and detail evidence, never copied blindly. */
  complete: boolean;
  errors: string[];
  warnings: string[];
}

export interface EobraFinancialTotals {
  rows: number;
  totalsComplete: boolean;
  original_amount: string;
  current_amount: string;
  paid_amount: string;
  balance_amount: string;
  collectible_balance_amount: string;
}

export interface EobraSnapshotSummary {
  records: number;
  uniqueRecords: number;
  validRecords: number;
  blockedRecords: number;
  archivedRecords: number;
  promotionBlockedRecords: number;
  /** False for undated source reversals, independently of monetary reconciliation. */
  history_dates_complete: boolean;
  byEntity: Partial<Record<EobraSnapshotEntity | "invalid", { records: number; uniqueRecords: number; valid: number; blocked: number; archived: number; promotionBlocked: number }>>;
  coverage: { declared: number; complete: number; incomplete: number; missing: number };
  financial: { receivable: EobraFinancialTotals; payable: EobraFinancialTotals };
  settlements: { rows: number; totalsComplete: boolean; history_dates_complete: boolean; payment_amount: string; reversal_amount: string; net_amount: string; voided_amount: string; voided_count: number };
}

export interface InspectedEobraSnapshot {
  format: typeof EOBRA_SNAPSHOT_FORMAT;
  source: Partial<EobraSnapshotSource>;
  scope: EobraSnapshotScope;
  archiveTypes: Array<{ key: string; description: string }>;
  records: InspectedEobraRecord[];
  coverage: InspectedEobraCoverage[];
  /** No structural, reference, coverage-claim or financial error. */
  ok: boolean;
  /** Only the explicitly declared scope; does not mean canonical promotion. */
  complete: boolean;
  allProjectsComplete: boolean;
  snapshotHash: string | null;
  summary: EobraSnapshotSummary;
  errors: string[];
  warnings: string[];
}

/** Strict deterministic JSON; throws for unsafe/non-JSON input or limits. */
export function canonicalEobraJson(value: unknown): string;
/** Lowercase hexadecimal SHA-256 of canonicalEobraJson(value). */
export function hashEobraValue(value: unknown): string;
/** Pure inspection; invalid input is returned with Portuguese errors, not posted. */
export function inspectEobraSnapshot(input: unknown): InspectedEobraSnapshot;

export type EobraSnapshotInspection = InspectedEobraSnapshot;
