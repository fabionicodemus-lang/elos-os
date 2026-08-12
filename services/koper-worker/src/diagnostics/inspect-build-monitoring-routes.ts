import { checkStockRequestPromotionReadiness } from "./check-stock-request-promotion-readiness.js";

export async function inspectBuildMonitoringRoutes() {
  return checkStockRequestPromotionReadiness();
}
