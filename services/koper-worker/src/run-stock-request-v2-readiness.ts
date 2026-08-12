import { checkStockRequestPromotionReadiness } from "./diagnostics/check-stock-request-promotion-readiness.js";
import { dryRunStockRequestPromotion } from "./diagnostics/dry-run-stock-request-promotion.js";

async function main(): Promise<void> {
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
  if (dryRun.quantityConservationMismatches) blockers.push(`quantity-conservation-mismatches:${dryRun.quantityConservationMismatches}`);
  if (dryRun.requestsInStaging !== 903) blockers.push(`request-count:${dryRun.requestsInStaging}`);
  if (dryRun.sourceItemsInStaging !== 3697) blockers.push(`source-item-count:${dryRun.sourceItemsInStaging}`);
  if (dryRun.intendedRows !== 3769) blockers.push(`intended-row-count:${dryRun.intendedRows}`);
  if (dryRun.intendedRealServiceRows !== 3245) blockers.push(`real-service-row-count:${dryRun.intendedRealServiceRows}`);
  if (dryRun.intendedLegacyRows !== 524) blockers.push(`legacy-row-count:${dryRun.intendedLegacyRows}`);
  if (Math.abs(dryRun.intendedTotalQuantity - 673513.6992) > 0.00001) blockers.push(`intended-total-quantity:${dryRun.intendedTotalQuantity}`);
  console.log("KOPER_STOCK_REQUEST_V2_READINESS", JSON.stringify({
    ok: true,
    ready: blockers.length === 0,
    sourceQuantityMismatches: base.serviceQuantityMismatches.length,
    unresolvedServiceLinks: base.unresolvedServiceLinks,
    quantityConservationMismatches: dryRun.quantityConservationMismatches,
    intendedRows: dryRun.intendedRows,
    intendedRealServiceRows: dryRun.intendedRealServiceRows,
    intendedLegacyRows: dryRun.intendedLegacyRows,
    intendedLegacyNoLinks: dryRun.intendedLegacyNoLinks,
    intendedLegacyQuantityMismatch: dryRun.intendedLegacyQuantityMismatch,
    intendedTotalQuantity: dryRun.intendedTotalQuantity,
    blockers,
  }));
}

void main().catch((error) => {
  console.error("KOPER_STOCK_REQUEST_V2_READINESS_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
