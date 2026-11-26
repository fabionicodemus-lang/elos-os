import type { EobraSnapshot, InspectedEobraSnapshot, EobraSnapshotEntity, JsonValue } from "./snapshot.mjs";

export const EOBRA_CHECKPOINT_SCHEMA: "eobra.ui-checkpoint.v1";
export const EOBRA_CHECKPOINT_REPORT_FORMAT: "elos.eobra.checkpoint-review.v1";

export interface CheckpointConversionOptions {
  /** Actual capture closing time, never synthesized from a date-only field. */
  capturedAt?: string;
  referenceDate?: string;
  /** Explicit collector scope; missing values never mean all source projects. */
  allProjects?: boolean;
}

export interface CheckpointPendingDetail {
  entity: EobraSnapshotEntity;
  sourceId: string;
  sourceProjectId: string | null;
  captureKind: string;
  reasons: string[];
  fields: string[];
}

export interface CheckpointInventory {
  capture: string;
  observations: number;
  uniqueIds: number;
  expectedCount: number | null;
  expectedPages: number | null;
  collectedPages: number[];
  rowsComplete: boolean;
  filters: JsonValue[];
  issues: string[];
  baseUniqueIds?: number;
  supplementalUniqueIds?: number;
  supplementalCaptures?: string[];
}

export interface CheckpointReview {
  format: typeof EOBRA_CHECKPOINT_REPORT_FORMAT;
  sourceHash: string;
  sourceHost: string;
  capturedAt: string | null;
  referenceDate: string | null;
  preserved: { documents: number; fragments: number; sourceHash: string; lossless: boolean };
  inventory: CheckpointInventory[];
  candidates: number;
  nativeRecords: number;
  pendingRecords: number;
  pendingDetails: CheckpointPendingDetail[];
  gaps: Array<{ code: string; message: string; count: number }>;
  errors: string[];
  warnings: string[];
  inspection: { ok: boolean; complete: boolean; allProjectsComplete: boolean; errors: string[]; warnings: string[] };
  /** This is conversion readiness, never a claim that anything was imported. */
  readyForReview: boolean;
  complete: boolean;
  history_dates_complete: boolean;
}

export interface ConvertedEobraCheckpoint {
  snapshot: EobraSnapshot;
  inspection: InspectedEobraSnapshot;
  report: CheckpointReview;
}

/** Read-only conversion. Arrays retain multiple checkpoint observations without overwriting conflicts. */
export function convertEobraCheckpoint(input: unknown, options?: CheckpointConversionOptions): ConvertedEobraCheckpoint;
/** Reconstruct the exact JSON values of the input, including ToolResult text and duplicate pages. */
export function reconstructEobraCheckpoint(snapshot: EobraSnapshot): unknown;
/** Markdown for the private review; never includes credentials or raw HTML. */
export function formatEobraCheckpointReview(report: CheckpointReview): string;
