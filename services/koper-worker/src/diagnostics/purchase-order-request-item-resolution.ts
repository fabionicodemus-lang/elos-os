export type PurchaseRequestItemCandidate = {
  id: string;
  request_id: string;
  cost_center_service_id: string | null;
};

export type PurchaseRequestItemResolution<T extends PurchaseRequestItemCandidate> =
  | { status: "matched"; item: T; reason: "single-candidate" | "purchase-cost-center" }
  | { status: "missing" }
  | { status: "ambiguous"; candidateIds: string[]; candidateServiceSourceIds: Array<string | null> };

function isV2Candidate(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("notes" in value)) return false;
  const notes = (value as { notes?: unknown }).notes;
  return typeof notes === "string" && notes.includes("resolution=v2");
}

export function groupRequestItemsByProductId<T extends PurchaseRequestItemCandidate>(
  rows: T[],
  productRequestIds: (row: T) => string[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    for (const productRequestId of new Set(productRequestIds(row))) {
      const existing = grouped.get(productRequestId) ?? [];
      existing.push(row);
      grouped.set(productRequestId, existing);
    }
  }

  for (const [productRequestId, candidates] of grouped) {
    const v2 = candidates.filter(isV2Candidate);
    if (v2.length) grouped.set(productRequestId, v2);
  }
  return grouped;
}

export function resolvePurchaseRequestItem<T extends PurchaseRequestItemCandidate>(
  productRequestId: string,
  purchaseCostCenterSourceId: string | null,
  candidatesByProductId: Map<string, T[]>,
  serviceSourceIdByServiceId: Map<string, string | null>,
): PurchaseRequestItemResolution<T> {
  const candidates = candidatesByProductId.get(productRequestId) ?? [];
  if (!candidates.length) return { status: "missing" };
  if (candidates.length === 1) {
    const item = candidates[0];
    if (!item) return { status: "missing" };
    return { status: "matched", item, reason: "single-candidate" };
  }

  if (purchaseCostCenterSourceId) {
    const matching = candidates.filter((candidate) => {
      if (!candidate.cost_center_service_id) return false;
      return serviceSourceIdByServiceId.get(candidate.cost_center_service_id) === purchaseCostCenterSourceId;
    });
    if (matching.length === 1) {
      const item = matching[0];
      if (item) return { status: "matched", item, reason: "purchase-cost-center" };
    }
  }

  return {
    status: "ambiguous",
    candidateIds: candidates.map((candidate) => candidate.id),
    candidateServiceSourceIds: candidates.map((candidate) => candidate.cost_center_service_id
      ? serviceSourceIdByServiceId.get(candidate.cost_center_service_id) ?? null
      : null),
  };
}
