import assert from "node:assert/strict";
import { test } from "node:test";
import { createKoperStagingRecord } from "./staging-record.js";

const companyId = "6d3b4724-5880-11ee-827d-1219c832db49";
const seenAt = new Date("2026-07-31T23:00:00.000Z");

test("builds a complete pending staging record", () => {
  const record = createKoperStagingRecord({
    companyId,
    entity: "purchase_order",
    koperId: 10455,
    sanitizedPayload: { status: "Finalizada", _traceId: "volatile" },
    mappingVersion: 1,
    seenAt,
  });

  assert.equal(record.source, "koper");
  assert.equal(record.company_id, companyId);
  assert.equal(record.koper_id, "10455");
  assert.deepEqual(record.payload, { status: "Finalizada" });
  assert.match(record.payload_hash, /^[a-f0-9]{64}$/);
  assert.equal(record.processing_status, "pending");
  assert.equal(record.first_seen_at, seenAt.toISOString());
  assert.equal(record.last_seen_at, seenAt.toISOString());
});

test("rejects missing company identity", () => {
  assert.throws(
    () => createKoperStagingRecord({
      companyId: "bossa",
      entity: "purchase_order",
      koperId: 10455,
      sanitizedPayload: {},
      mappingVersion: 1,
    }),
    /companyId must be a UUID/,
  );
});

test("rejects an empty immutable Koper identifier", () => {
  assert.throws(
    () => createKoperStagingRecord({
      companyId,
      entity: "purchase_order",
      koperId: " ",
      sanitizedPayload: {},
      mappingVersion: 1,
    }),
    /koperId is required/,
  );
});
