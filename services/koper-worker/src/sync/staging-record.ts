import { hashKoperPayload, normalizeKoperPayload } from "../koper/payload-hash.js";

export type KoperProcessingStatus = "pending" | "processed" | "error";

export type KoperStagingRecord = {
  company_id: string;
  source: "koper";
  entity: string;
  koper_id: string;
  koper_parent_id: string | null;
  payload: unknown;
  payload_hash: string;
  koper_created_at: string | null;
  koper_updated_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  processing_status: KoperProcessingStatus;
  processing_error: string | null;
  mapping_version: number;
  elos_id: string | null;
};

export type CreateKoperStagingRecordInput = {
  companyId: string;
  entity: string;
  koperId: string | number;
  koperParentId?: string | number | null;
  sanitizedPayload: unknown;
  koperCreatedAt?: string | null;
  koperUpdatedAt?: string | null;
  mappingVersion: number;
  seenAt?: Date;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createKoperStagingRecord(
  input: CreateKoperStagingRecordInput,
): KoperStagingRecord {
  if (!UUID_PATTERN.test(input.companyId)) throw new Error("companyId must be a UUID");
  if (!input.entity.trim()) throw new Error("entity is required");

  const koperId = String(input.koperId).trim();
  if (!koperId) throw new Error("koperId is required");
  if (!Number.isInteger(input.mappingVersion) || input.mappingVersion < 1) {
    throw new Error("mappingVersion must be a positive integer");
  }

  const payload = normalizeKoperPayload(input.sanitizedPayload);
  const seenAt = (input.seenAt ?? new Date()).toISOString();

  return {
    company_id: input.companyId,
    source: "koper",
    entity: input.entity.trim(),
    koper_id: koperId,
    koper_parent_id: input.koperParentId == null ? null : String(input.koperParentId),
    payload,
    payload_hash: hashKoperPayload(payload),
    koper_created_at: input.koperCreatedAt ?? null,
    koper_updated_at: input.koperUpdatedAt ?? null,
    first_seen_at: seenAt,
    last_seen_at: seenAt,
    processing_status: "pending",
    processing_error: null,
    mapping_version: input.mappingVersion,
    elos_id: null,
  };
}
