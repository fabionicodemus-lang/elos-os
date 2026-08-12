import { checkStockRequestPromotionReadiness } from "./check-stock-request-promotion-readiness.js";
import { dryRunStockRequestPromotion } from "./dry-run-stock-request-promotion.js";

export async function checkStockRequestV2Readiness(): Promise<{
  ok: true;
  ready: boolean;
  sourceRequests: number;
  sourceItems: number;
  unresolvedServiceLinks: number;
  sourceQuantityMismatches: number;
  recoverableOrLegacyQuantityMismatches: number;
  quantityConservationMismatches: number;
  intendedRows: number;
  intendedRealServiceRows: number;
  intendedLegacyRows: number;
  intendedLegacyNoLinks: number;
  intendedLegacyQuantityMismatch: number;
  intendedTotalQuantity: number;
  blockers: string[];
}> {
  const [base, dryRun] = await Promise.all([
    checkStockRequestPromotionReadiness(),
    dryRunStockRequestPromotion(),
  ]);

  const blockers: string[] = [];
  if (base.requests <= 0) blockers.push("no-stock-requests");
  if (base.items <= 0) blockers.push("no-stock-request-items");
  if (base.missingInputs.length) blockers.push(`missing-inputs:${base.missingInputs.length}`);
  if (base.invalidQuantities.length) blockers.push(`invalid-product-quantities:${base.invalidQuantities.length}`);
  if (base.flowProjects !== 1) blockers.push(`flow-projects:${base.flowProjects}`);
  if (base.flowBudgets !== 1) blockers.push(`flow-budgets:${base.flowBudgets}`);
  if (base.activeCompanyMembers <= 0) blockers.push("no-active-company-member");
  if (base.unresolvedServiceLinks) blockers.push(`unresolved-service-links:${base.unresolvedServiceLinks}`);
  if (dryRun.quantityConservationMismatches) {
    blockers.push(`quantity-conservation-mismatches:${dryRun.quantityConservationMismatches}`);
  }
  if (dryRun.requestsInStaging !== 903) blockers.push(`request-count:${dryRun.requestsInStaging}`);
  if (dryRun.sourceItemsInStaging !== 3_697) blockers.push(`source-item-count:${dryRun.sourceItemsInStaging}`);
  if (dryRun.intendedRows !== 3_769) blockers.push(`intended-row-count:${dryRun.intendedRows}`);
  if (dryRun.intendedRealServiceRows !== 3_245) blockers.push(`real-service-row-count:${dryRun.intendedRealServiceRows}`);
  if (dryRun.intendedLegacyRows !== 524) blockers.push(`legacy-row-count:${dryRun.intendedLegacyRows}`);
  if (Math.abs(dryRun.intendedTotalQuantity - 673_513.6992) > 0.00001) {
    blockers.push(`intended-total-quantity:${dryRun.intendedTotalQuantity}`);
  }

  return {
    ok: true,
    ready: blockers.length === 0,
    sourceRequests: base.requests,
    sourceItems: base.items,
    unresolvedServiceLinks: base.unresolvedServiceLinks,
    sourceQuantityMismatches: base.serviceQuantityMismatches.length,
    recoverableOrLegacyQuantityMismatches: base.serviceQuantityMismatches.length,
    quantityConservationMismatches: dryRun.quantityConservationMismatches,
    intendedRows: dryRun.intendedRows,
    intendedRealServiceRows: dryRun.intendedRealServiceRows,
    intendedLegacyRows: dryRun.intendedLegacyRows,
    intendedLegacyNoLinks: dryRun.intendedLegacyNoLinks,
    intendedLegacyQuantityMismatch: dryRun.intendedLegacyQuantityMismatch,
    intendedTotalQuantity: dryRun.intendedTotalQuantity,
    blockers,
  };
}
