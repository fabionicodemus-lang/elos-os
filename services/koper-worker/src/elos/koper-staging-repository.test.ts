import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseRestOptions } from "./supabase.js";
import { saveKoperStagingRecord } from "./koper-staging-repository.js";
import { createKoperStagingRecord } from "../sync/staging-record.js";

const record = createKoperStagingRecord({
  companyId: "8be63d43-669c-4c6a-9b38-5f99b075d428",
  entity: "enterprise",
  koperId: "6d3b4724-5880-11ee-827d-1219c832db49",
  sanitizedPayload: { name: "Flow" },
  mappingVersion: 1,
  seenAt: new Date("2026-08-01T12:00:00.000Z"),
});

type Call = { resource: string; options: SupabaseRestOptions };

test("inserts a new record with present sync state", async () => {
  const calls: Call[] = [];
  const responses: unknown[] = [[], [{ id: "new-id" }]];
  const request = async <T>(resource: string, options: SupabaseRestOptions = {}) => {
    calls.push({ resource, options });
    return responses.shift() as T;
  };

  const result = await saveKoperStagingRecord(record, request);

  assert.deepEqual(result, { action: "inserted", id: "new-id" });
  assert.equal(calls[1]?.options.method, "POST");
  assert.equal((calls[1]?.options.body as { sync_state: string }).sync_state, "present");
});

test("refreshes timestamps without resetting processing when hash is unchanged", async () => {
  const calls: Call[] = [];
  const request = async <T>(resource: string, options: SupabaseRestOptions = {}) => {
    calls.push({ resource, options });
    return (calls.length === 1
      ? [{ id: "same-id", payload_hash: record.payload_hash }]
      : [{ id: "same-id" }]) as T;
  };

  const result = await saveKoperStagingRecord(record, request);
  const patch = calls[1]?.options.body as Record<string, unknown>;

  assert.deepEqual(result, { action: "unchanged", id: "same-id" });
  assert.equal(calls[1]?.options.method, "PATCH");
  assert.equal(patch.last_seen_at, record.last_seen_at);
  assert.equal(patch.sync_state, "present");
  assert.equal("first_seen_at" in patch, false);
  assert.equal("processing_status" in patch, false);
});

test("updates changed payload and resets processing without changing first_seen_at", async () => {
  const calls: Call[] = [];
  const request = async <T>(resource: string, options: SupabaseRestOptions = {}) => {
    calls.push({ resource, options });
    return (calls.length === 1
      ? [{ id: "changed-id", payload_hash: "0".repeat(64) }]
      : [{ id: "changed-id" }]) as T;
  };

  const result = await saveKoperStagingRecord(record, request);
  const patch = calls[1]?.options.body as Record<string, unknown>;

  assert.deepEqual(result, { action: "updated", id: "changed-id" });
  assert.equal(patch.payload_hash, record.payload_hash);
  assert.equal(patch.processing_status, "pending");
  assert.equal(patch.processing_error, null);
  assert.equal("first_seen_at" in patch, false);
});
