import type { EobraSnapshot, EobraSnapshotRecord, EobraSnapshotSource, EobraSnapshotScope, EobraCoverage } from "./snapshot.mjs";

export const EOBRA_PACKAGE_FORMAT: "elos.eobra.snapshot.parts.v1";
export const MAX_PACKAGE_PART_BYTES: number;
export const MAX_PACKAGE_MANIFEST_BYTES: number;
export const MAX_PACKAGE_PART_RECORDS: number;
export const MAX_PACKAGE_PARTS: number;
export const MAX_PACKAGE_BYTES: number;
export const MAX_PACKAGE_RECORDS: number;

export interface EobraPackagePartDescriptor {
  ordinal: number;
  firstRecord: number;
  recordCount: number;
  byteLength: number;
  sha256: string;
  /** Basename only; every file is beside manifest.json, with no subdirectories. */
  name: string;
}

export interface EobraPackageManifest {
  format: typeof EOBRA_PACKAGE_FORMAT;
  source: EobraSnapshotSource;
  scope: EobraSnapshotScope;
  archiveTypes: Array<{ key: string; description: string }>;
  coverage: EobraCoverage[];
  recordCount: number;
  parts: EobraPackagePartDescriptor[];
  /** Informative canonical full-snapshot hash. The database hashes its own manifest/records. */
  globalSnapshotHash?: string;
}

export interface EobraPackageManifestInspection {
  ok: boolean;
  errors: string[];
  manifest: EobraPackageManifest | null;
  byteLength: number;
  totalPartBytes: number;
  manifestHash: string | null;
}

export interface EobraPackagePartInspection {
  ok: boolean;
  errors: string[];
  records: EobraSnapshotRecord[] | null;
  byteLength: number;
  sha256: string | null;
}

export interface CreatedEobraPackage {
  manifest: EobraPackageManifest;
  manifestText: string;
  parts: Array<{ descriptor: EobraPackagePartDescriptor; name: string; text: string }>;
}

/** Server-side, bounded structural/transport validation. No claim of complete source coverage. */
export function inspectEobraPackageManifest(value: unknown): EobraPackageManifestInspection;
/** UTF-8 bytes or text, checked against the exact descriptor before use. Cross-record semantics remain server/database work. */
export function inspectEobraPackagePart(value: string | Uint8Array | ArrayBuffer, descriptor: EobraPackagePartDescriptor): EobraPackagePartInspection;
/** Pure deterministic packing; never writes files or posts records. Smaller part limits may be selected. */
export function createEobraPackage(snapshot: EobraSnapshot, options?: { maxPartBytes?: number; maxPartRecords?: number }): CreatedEobraPackage;
