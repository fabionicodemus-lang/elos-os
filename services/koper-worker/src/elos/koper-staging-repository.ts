import { requestSupabase } from "./supabase.js";
import type { KoperStagingRecord } from "../sync/staging-record.js";

type ExistingRecord = {
  id: string;
  koper_id: string;
  payload_hash: string;
};

export type SaveKoperStagingResult = {
  action: "inserted" | "unchanged" | "updated";
  id: string;
};

export type SaveKoperStagingBatchResult = {
  inserted: number;
  unchanged: number;
  updated: number;
};

type SupabaseRequester = typeof requestSupabase;

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function saveKoperStagingBatch(
  records: KoperStagingRecord[],
  request: SupabaseRequester = requestSupabase,
): Promise<SaveKoperStagingBatchResult> {
  if (records.length === 0) return { inserted: 0, unchanged: 0, updated: 0 };

  const first = records[0];
  if (!first) return { inserted: 0, unchanged: 0, updated: 0 };
  if (records.some((record) =>
    record.company_id !== first.company_id
    || record.source !== first.source
    || record.entity !== first.entity
  )) throw new Error("A staging batch must share company, source and entity");

  const existing: ExistingRecord[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await request<ExistingRecord[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "id,koper_id,payload_hash",
        company_id: `eq.${first.company_id}`,
        source: `eq.${first.source}`,
        entity: `eq.${first.entity}`,
        limit: String(pageSize),
        offset: String(offset),
      }),
    });
    existing.push(...page);
    if (page.length < pageSize) break;
  }

  const byKoperId = new Map(existing.map((row) => [row.koper_id, row]));
  const inserted = records.filter((record) => !byKoperId.has(record.koper_id));
  const changed = records.filter((record) => {
    const row = byKoperId.get(record.koper_id);
    return row !== undefined && row.payload_hash !== record.payload_hash;
  });
  const unchanged = records.filter((record) => {
    const row = byKoperId.get(record.koper_id);
    return row !== undefined && row.payload_hash === record.payload_hash;
  });

  for (const batch of chunks(inserted, 100)) {
    await request<Array<{ id: string }>>("koper_staging_records", {
      method: "POST",
      body: batch.map((record) => ({ ...record, sync_state: "present" })),
      prefer: "return=representation",
      query: new URLSearchParams({ select: "id" }),
    });
  }

  for (const batch of chunks(unchanged, 100)) {
    const ids = batch.flatMap((record) => {
      const id = byKoperId.get(record.koper_id)?.id;
      return id ? [id] : [];
    });
    const seenAt = batch[0]?.last_seen_at;
    if (!seenAt || ids.length === 0) continue;
    await request<Array<{ id: string }>>("koper_staging_records", {
      method: "PATCH",
      body: { last_seen_at: seenAt, sync_state: "present", updated_at: seenAt },
      prefer: "return=representation",
      query: new URLSearchParams({ id: `in.(${ids.join(",")})`, select: "id" }),
    });
  }

  for (const record of changed) {
    const id = byKoperId.get(record.koper_id)?.id;
    if (!id) continue;
    await request<Array<{ id: string }>>("koper_staging_records", {
      method: "PATCH",
      body: {
        koper_parent_id: record.koper_parent_id,
        payload: record.payload,
        payload_hash: record.payload_hash,
        koper_created_at: record.koper_created_at,
        koper_updated_at: record.koper_updated_at,
        last_seen_at: record.last_seen_at,
        processing_status: "pending",
        processing_error: null,
        mapping_version: record.mapping_version,
        sync_state: "present",
        updated_at: record.last_seen_at,
      },
      prefer: "return=representation",
      query: new URLSearchParams({ id: `eq.${id}`, select: "id" }),
    });
  }

  return {
    inserted: inserted.length,
    unchanged: unchanged.length,
    updated: changed.length,
  };
}

export async function saveKoperStagingRecord(
  record: KoperStagingRecord,
  request: SupabaseRequester = requestSupabase,
): Promise<SaveKoperStagingResult> {
  const identity = new URLSearchParams({
    select: "id,payload_hash",
    company_id: `eq.${record.company_id}`,
    source: `eq.${record.source}`,
    entity: `eq.${record.entity}`,
    koper_id: `eq.${record.koper_id}`,
    limit: "1",
  });
  const existing = await request<ExistingRecord[]>("koper_staging_records", {
    query: identity,
  });

  if (existing.length === 0) {
    const inserted = await request<Array<{ id: string }>>("koper_staging_records", {
      method: "POST",
      body: { ...record, sync_state: "present" },
      prefer: "return=representation",
      query: new URLSearchParams({ select: "id" }),
    });
    const row = inserted[0];
    if (!row) throw new Error("Supabase did not return the inserted staging record");
    return { action: "inserted", id: row.id };
  }

  const current = existing[0];
  if (!current) throw new Error("Invalid Supabase staging lookup response");

  const changed = current.payload_hash !== record.payload_hash;
  const body = changed
    ? {
        koper_parent_id: record.koper_parent_id,
        payload: record.payload,
        payload_hash: record.payload_hash,
        koper_created_at: record.koper_created_at,
        koper_updated_at: record.koper_updated_at,
        last_seen_at: record.last_seen_at,
        processing_status: "pending",
        processing_error: null,
        mapping_version: record.mapping_version,
        sync_state: "present",
        updated_at: record.last_seen_at,
      }
    : {
        last_seen_at: record.last_seen_at,
        sync_state: "present",
        updated_at: record.last_seen_at,
      };

  const updated = await request<Array<{ id: string }>>("koper_staging_records", {
    method: "PATCH",
    body,
    prefer: "return=representation",
    query: new URLSearchParams({ id: `eq.${current.id}`, select: "id" }),
  });
  const row = updated[0];
  if (!row) throw new Error("Supabase did not return the updated staging record");

  return { action: changed ? "updated" : "unchanged", id: row.id };
}
