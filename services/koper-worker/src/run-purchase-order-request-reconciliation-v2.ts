// Runner operacional protegido: sempre valida o preview antes de qualquer escrita.
import {
  previewKoperPurchaseOrderRequestReconciliationV2,
  reconcileKoperPurchaseOrderRequestLinksV2,
} from "./diagnostics/reconcile-koper-purchase-order-request-links-v2.js";

function assertPreview(preview: Awaited<ReturnType<typeof previewKoperPurchaseOrderRequestReconciliationV2>>): void {
  const failures: string[] = [];
  if (preview.updates !== 3553) failures.push(`updates=${preview.updates}`);
  if (preview.direct !== 3480) failures.push(`direct=${preview.direct}`);
  if (preview.multi !== 72) failures.push(`multi=${preview.multi}`);
  if (preview.orphan !== 1) failures.push(`orphan=${preview.orphan}`);
  if (preview.purchaseItems !== 4610) failures.push(`purchaseItems=${preview.purchaseItems}`);
  if (preview.v1ReferencesBefore !== 3047) failures.push(`v1ReferencesBefore=${preview.v1ReferencesBefore}`);
  if (preview.allocations < preview.multi * 2) failures.push(`allocations=${preview.allocations}`);
  if (failures.length) throw new Error(`Koper purchase reconciliation v2 preflight mismatch: ${failures.join(", ")}`);
}

async function main(): Promise<void> {
  const preview = await previewKoperPurchaseOrderRequestReconciliationV2();
  assertPreview(preview);
  console.log("KOPER_PURCHASE_REQUEST_RECONCILIATION_V2_PREVIEW", JSON.stringify(preview));

  if (process.env.KOPER_PURCHASE_ORDER_REQUEST_RECONCILIATION_ENABLED !== "true") {
    console.log("KOPER_PURCHASE_REQUEST_RECONCILIATION_V2_SKIPPED", JSON.stringify({ reason: "write-flag-disabled" }));
    return;
  }

  const result = await reconcileKoperPurchaseOrderRequestLinksV2();
  if (result.updates !== 3553 || result.direct !== 3480 || result.multi !== 72 || result.orphan !== 1) {
    throw new Error(`Koper purchase reconciliation v2 result counters changed: ${JSON.stringify(result)}`);
  }
  if (result.purchaseItems !== 4610) throw new Error(`Koper purchase item count changed: ${result.purchaseItems}`);
  if (result.v1References !== 0) throw new Error(`Koper purchase v1 references remain: ${result.v1References}`);
  console.log("KOPER_PURCHASE_REQUEST_RECONCILIATION_V2_RESULT", JSON.stringify(result));
}

void main().catch((error) => {
  console.error("KOPER_PURCHASE_REQUEST_RECONCILIATION_V2_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
