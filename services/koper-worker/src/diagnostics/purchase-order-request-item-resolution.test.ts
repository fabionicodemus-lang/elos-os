import test from "node:test";
import assert from "node:assert/strict";
import { groupRequestItemsByProductId, resolvePurchaseRequestItem } from "./purchase-order-request-item-resolution.js";

type Candidate = {
  id: string;
  request_id: string;
  cost_center_service_id: string | null;
  productIds: string[];
};

const serviceSources = new Map<string, string | null>([
  ["svc-a", "283"],
  ["svc-b", "227"],
]);

test("groups every request item candidate instead of overwriting duplicate productRequestId", () => {
  const candidates: Candidate[] = [
    { id: "item-a", request_id: "req", cost_center_service_id: "svc-a", productIds: ["630"] },
    { id: "item-b", request_id: "req", cost_center_service_id: "svc-b", productIds: ["630"] },
  ];
  const grouped = groupRequestItemsByProductId(candidates, (row) => row.productIds);
  assert.deepEqual(grouped.get("630")?.map((row) => row.id), ["item-a", "item-b"]);
});

test("selects a single candidate without needing a cost center", () => {
  const grouped = new Map<string, Candidate[]>([["10", [
    { id: "item-a", request_id: "req", cost_center_service_id: "svc-a", productIds: ["10"] },
  ]]]);
  const result = resolvePurchaseRequestItem("10", null, grouped, serviceSources);
  assert.equal(result.status, "matched");
  if (result.status === "matched") {
    assert.equal(result.item.id, "item-a");
    assert.equal(result.reason, "single-candidate");
  }
});

test("uses the purchase costCenterId to disambiguate multiple request items", () => {
  const grouped = new Map<string, Candidate[]>([["630", [
    { id: "item-a", request_id: "req", cost_center_service_id: "svc-a", productIds: ["630"] },
    { id: "item-b", request_id: "req", cost_center_service_id: "svc-b", productIds: ["630"] },
  ]]]);
  const result = resolvePurchaseRequestItem("630", "227", grouped, serviceSources);
  assert.equal(result.status, "matched");
  if (result.status === "matched") {
    assert.equal(result.item.id, "item-b");
    assert.equal(result.reason, "purchase-cost-center");
  }
});

test("fails closed when multiple candidates cannot be disambiguated", () => {
  const grouped = new Map<string, Candidate[]>([["630", [
    { id: "item-a", request_id: "req", cost_center_service_id: "svc-a", productIds: ["630"] },
    { id: "item-b", request_id: "req", cost_center_service_id: "svc-b", productIds: ["630"] },
  ]]]);
  const result = resolvePurchaseRequestItem("630", "999", grouped, serviceSources);
  assert.deepEqual(result, {
    status: "ambiguous",
    candidateIds: ["item-a", "item-b"],
    candidateServiceSourceIds: ["283", "227"],
  });
});

test("reports missing when productRequestId has no request item", () => {
  const result = resolvePurchaseRequestItem("404", "283", new Map(), serviceSources);
  assert.deepEqual(result, { status: "missing" });
});
