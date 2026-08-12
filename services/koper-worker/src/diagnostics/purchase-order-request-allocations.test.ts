import test from "node:test";
import assert from "node:assert/strict";
import { resolvePurchaseRequestAllocations } from "./purchase-order-request-allocations.js";

type Candidate = {
  id: string;
  request_id: string;
  cost_center_service_id: string | null;
  requested_quantity: number;
  notes?: string | null;
};

const serviceSources = new Map<string, string | null>([
  ["svc-a", "281"],
  ["svc-b", "282"],
]);

test("keeps a single candidate as a direct request item link", () => {
  const candidate: Candidate = { id: "a", request_id: "req", cost_center_service_id: "svc-a", requested_quantity: 10 };
  const result = resolvePurchaseRequestAllocations("10", 8, null, new Map([["10", [candidate]]]), serviceSources);
  assert.equal(result.status, "direct");
  if (result.status === "direct") {
    assert.equal(result.item.id, "a");
    assert.deepEqual(result.allocations.map((row) => [row.item.id, row.quantity]), [["a", 8]]);
  }
});

test("uses a unique purchase cost center when it exists", () => {
  const candidates: Candidate[] = [
    { id: "a", request_id: "req", cost_center_service_id: "svc-a", requested_quantity: 2 },
    { id: "b", request_id: "req", cost_center_service_id: "svc-b", requested_quantity: 3 },
  ];
  const result = resolvePurchaseRequestAllocations("20", 5, "282", new Map([["20", candidates]]), serviceSources);
  assert.equal(result.status, "direct");
  if (result.status === "direct") {
    assert.equal(result.item.id, "b");
    assert.equal(result.reason, "purchase-cost-center");
  }
});

test("allocates an aggregate purchase line proportionally across service request items", () => {
  const candidates: Candidate[] = [
    { id: "a", request_id: "req", cost_center_service_id: "svc-a", requested_quantity: 2000 },
    { id: "b", request_id: "req", cost_center_service_id: "svc-b", requested_quantity: 3000 },
  ];
  const result = resolvePurchaseRequestAllocations("8493", 5000, null, new Map([["8493", candidates]]), serviceSources);
  assert.equal(result.status, "multi");
  if (result.status === "multi") {
    assert.equal(result.requestId, "req");
    assert.deepEqual(result.allocations.map((row) => [row.item.id, row.quantity]), [["a", 2000], ["b", 3000]]);
    assert.equal(result.allocations.reduce((sum, row) => sum + row.quantity, 0), 5000);
  }
});

test("uses product-specific evidence when a v2 request row aggregates multiple productRequestIds", () => {
  const candidates: Candidate[] = [
    {
      id: "a",
      request_id: "req",
      cost_center_service_id: "svc-a",
      requested_quantity: 120,
      notes: "Koper productRequestIds=100,200 · resolution=v2 · reason=official,itemMonitInputId=1,inputAmount=20;reason=official,itemMonitInputId=2,inputAmount=100",
    },
    {
      id: "b",
      request_id: "req",
      cost_center_service_id: "svc-b",
      requested_quantity: 80,
      notes: "Koper productRequestIds=100,200 · resolution=v2 · reason=official,itemMonitInputId=3,inputAmount=30;reason=official,itemMonitInputId=4,inputAmount=50",
    },
  ];
  const result = resolvePurchaseRequestAllocations("100", 50, null, new Map([["100", candidates]]), serviceSources);
  assert.equal(result.status, "multi");
  if (result.status === "multi") {
    assert.deepEqual(result.allocations.map((row) => [row.item.id, row.quantity]), [["a", 20], ["b", 30]]);
  }
});

test("preserves the ordered total when proportional allocation requires rounding", () => {
  const candidates: Candidate[] = [
    { id: "a", request_id: "req", cost_center_service_id: "svc-a", requested_quantity: 1 },
    { id: "b", request_id: "req", cost_center_service_id: "svc-b", requested_quantity: 2 },
  ];
  const result = resolvePurchaseRequestAllocations("30", 1, null, new Map([["30", candidates]]), serviceSources);
  assert.equal(result.status, "multi");
  if (result.status === "multi") {
    assert.deepEqual(result.allocations.map((row) => row.quantity), [0.333333, 0.666667]);
    assert.equal(result.allocations.reduce((sum, row) => sum + row.quantity, 0), 1);
  }
});

test("fails closed if candidates for one product request belong to different material requests", () => {
  const candidates: Candidate[] = [
    { id: "a", request_id: "req-a", cost_center_service_id: "svc-a", requested_quantity: 1 },
    { id: "b", request_id: "req-b", cost_center_service_id: "svc-b", requested_quantity: 1 },
  ];
  const result = resolvePurchaseRequestAllocations("40", 2, null, new Map([["40", candidates]]), serviceSources);
  assert.equal(result.status, "invalid");
});

test("leaves an orphan product request unlinked", () => {
  const result = resolvePurchaseRequestAllocations("199", 30, null, new Map(), serviceSources);
  assert.deepEqual(result, { status: "missing" });
});
