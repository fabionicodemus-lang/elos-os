import { requestSupabase } from "./supabase.js";
import type { KoperStagingRecord } from "../sync/staging-record.js";

type ExistingRecord = {
  id: string;
  payload_hash: string;
};

export type SaveKoperStagingResult = {
  action: "inserted" | "unchanged" | "updated";
  id: string;
};

type SupabaseRequester = typeof requestSupabase;

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
