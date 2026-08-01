import assert from "node:assert/strict";
import { test } from "node:test";
import { hashKoperPayload, normalizeKoperPayload } from "./payload-hash.js";

test("hash stays stable when object keys arrive in another order", () => {
  const first = { requestId: 10556, product: { amount: 10, id: 14826 } };
  const second = { product: { id: 14826, amount: 10 }, requestId: 10556 };

  assert.equal(hashKoperPayload(first), hashKoperPayload(second));
});

test("normalization removes volatile fields at every depth", () => {
  const normalized = normalizeKoperPayload({
    _traceId: "request-a",
    data: { _responseAt: "now", id: 10455 },
  });

  assert.deepEqual(normalized, { data: { id: 10455 } });
});

test("hash changes when an operational value changes", () => {
  assert.notEqual(
    hashKoperPayload({ id: 10455, status: "Aberta" }),
    hashKoperPayload({ id: 10455, status: "Finalizada" }),
  );
});
