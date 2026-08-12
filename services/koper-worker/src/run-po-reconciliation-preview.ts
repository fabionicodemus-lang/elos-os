import { previewStockRequestPurchaseOrderReconciliation } from "./diagnostics/preview-stock-request-purchase-order-reconciliation.js";

// Runner temporário, exclusivamente read-only, para validar a reconciliação histórica via Chromium local.
async function main(): Promise<void> {
  try {
    const result = await previewStockRequestPurchaseOrderReconciliation();
    console.log("KOPER_PO_RECONCILIATION_RESULT", JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("KOPER_PO_RECONCILIATION_FAILED", message);
    process.exitCode = 1;
  }
}

void main();
