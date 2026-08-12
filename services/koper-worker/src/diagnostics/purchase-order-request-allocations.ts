export type PurchaseRequestAllocationCandidate = {
  id: string;
  request_id: string;
  cost_center_service_id: string | null;
  requested_quantity: number;
  notes?: string | null;
};

export type PurchaseRequestAllocation<T extends PurchaseRequestAllocationCandidate> = {
  item: T;
  quantity: number;
};

export type PurchaseRequestAllocationResolution<T extends PurchaseRequestAllocationCandidate> =
  | { status: "missing" }
  | { status: "direct"; item: T; allocations: PurchaseRequestAllocation<T>[]; reason: "single-candidate" | "purchase-cost-center" }
  | { status: "multi"; requestId: string; allocations: PurchaseRequestAllocation<T>[]; reason: "proportional-request-allocation" }
  | { status: "invalid"; reason: string };

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function sourceQuantityForCandidate(
  candidate: PurchaseRequestAllocationCandidate,
  productRequestId: string,
): number | null {
  const notes = candidate.notes ?? "";
  const idsMatch = notes.match(/Koper productRequestIds=([^·]+)/);
  const ids = idsMatch?.[1]?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  if (!ids.length) return candidate.requested_quantity;
  const index = ids.indexOf(productRequestId);
  if (index < 0) return null;
  if (ids.length === 1) return candidate.requested_quantity;

  const evidence = notes.split("resolution=v2 · ")[1]?.split(";") ?? [];
  const sourceEvidence = evidence[index];
  if (!sourceEvidence) return null;
  const quantityMatch = sourceEvidence.match(/(?:inputAmount|productAmount)=(-?\d+(?:\.\d+)?)/);
  if (!quantityMatch?.[1]) return null;
  const quantity = Number(quantityMatch[1]);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

export function resolvePurchaseRequestAllocations<T extends PurchaseRequestAllocationCandidate>(
  productRequestId: string,
  orderedQuantity: number,
  purchaseCostCenterSourceId: string | null,
  candidatesByProductId: Map<string, T[]>,
  serviceSourceIdByServiceId: Map<string, string | null>,
): PurchaseRequestAllocationResolution<T> {
  if (!Number.isFinite(orderedQuantity) || orderedQuantity <= 0) {
    return { status: "invalid", reason: `invalid ordered quantity for productRequestId=${productRequestId}` };
  }

  const candidates = candidatesByProductId.get(productRequestId) ?? [];
  if (!candidates.length) return { status: "missing" };

  if (candidates.length === 1) {
    const item = candidates[0];
    if (!item) return { status: "missing" };
    return {
      status: "direct",
      item,
      allocations: [{ item, quantity: round6(orderedQuantity) }],
      reason: "single-candidate",
    };
  }

  if (purchaseCostCenterSourceId) {
    const matching = candidates.filter((candidate) => candidate.cost_center_service_id
      && serviceSourceIdByServiceId.get(candidate.cost_center_service_id) === purchaseCostCenterSourceId);
    if (matching.length === 1) {
      const item = matching[0];
      if (item) {
        return {
          status: "direct",
          item,
          allocations: [{ item, quantity: round6(orderedQuantity) }],
          reason: "purchase-cost-center",
        };
      }
    }
  }

  const requestIds = new Set(candidates.map((candidate) => candidate.request_id));
  if (requestIds.size !== 1) {
    return { status: "invalid", reason: `multiple request ids for productRequestId=${productRequestId}` };
  }

  const sourceQuantities = candidates.map((candidate) => sourceQuantityForCandidate(candidate, productRequestId));
  if (sourceQuantities.some((quantity) => quantity === null || !Number.isFinite(quantity) || quantity <= 0)) {
    return { status: "invalid", reason: `missing product-specific quantity for productRequestId=${productRequestId}` };
  }
  const numericQuantities = sourceQuantities as number[];
  const totalRequested = numericQuantities.reduce((sum, quantity) => sum + quantity, 0);
  if (!Number.isFinite(totalRequested) || totalRequested <= 0) {
    return { status: "invalid", reason: `invalid requested total for productRequestId=${productRequestId}` };
  }

  let allocated = 0;
  const allocations = candidates.map((item, index) => {
    const sourceQuantity = numericQuantities[index];
    if (sourceQuantity === undefined) return { item, quantity: 0 };
    const quantity = index === candidates.length - 1
      ? round6(orderedQuantity - allocated)
      : round6(orderedQuantity * sourceQuantity / totalRequested);
    allocated = round6(allocated + quantity);
    return { item, quantity };
  });
  if (allocations.some((allocation) => allocation.quantity <= 0)) {
    return { status: "invalid", reason: `non-positive allocation for productRequestId=${productRequestId}` };
  }
  const finalTotal = round6(allocations.reduce((sum, allocation) => sum + allocation.quantity, 0));
  if (Math.abs(finalTotal - round6(orderedQuantity)) > 0.000001) {
    return { status: "invalid", reason: `allocation total mismatch for productRequestId=${productRequestId}` };
  }

  const requestId = candidates[0]?.request_id;
  if (!requestId) return { status: "invalid", reason: `request id missing for productRequestId=${productRequestId}` };
  return {
    status: "multi",
    requestId,
    allocations,
    reason: "proportional-request-allocation",
  };
}
