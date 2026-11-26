export type SnapshotPartDescriptor = {
  ordinal: number; firstRecord: number; recordCount: number; byteLength: number; sha256: string; name: string;
};
export type SnapshotBundleManifest = {
  format: 'elos.eobra.snapshot.parts.v1'; recordCount: number; parts: SnapshotPartDescriptor[];
  [key: string]: unknown;
};
export type SnapshotUploadFile = {
  name: string; size: number; webkitRelativePath?: string; arrayBuffer(): Promise<ArrayBuffer>;
};
export type SnapshotBundleSelection<T extends SnapshotUploadFile = SnapshotUploadFile> = {
  manifest: SnapshotBundleManifest; manifestFile: T;
  parts: { descriptor: SnapshotPartDescriptor; file: T }[];
  totalBytes: number; folderName: string;
};
export function inspectSnapshotBundleFiles<T extends SnapshotUploadFile>(input: readonly T[]): Promise<SnapshotBundleSelection<T>>;
export function snapshotUploadFileHash(file: SnapshotUploadFile): Promise<string>;
export function verifySnapshotBundlePart(file: SnapshotUploadFile, descriptor: SnapshotPartDescriptor): Promise<void>;
