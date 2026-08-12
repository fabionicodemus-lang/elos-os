import { previewKoperPurchaseOrderRequestReconciliationV2 } from "./diagnostics/reconcile-koper-purchase-order-request-links-v2.js";

async function main(): Promise<void> {
  const preview = await previewKoperPurchaseOrderRequestReconciliationV2();
  const failures: string[] = [];
  if (preview.direct !== 3_480) failures.push(`direct=${preview.direct}`);
  if (preview.multi !== 72) failures.push(`multi=${preview.multi}`);
  if (preview.orphan !== 1) failures.push(`orphan=${preview.orphan}`);
  if (preview.allocations !== 144) failures.push(`allocations=${preview.allocations}`);
  if (preview.purchaseItems !== 4_610) failures.push(`purchaseItems=${preview.purchaseItems}`);
  if (Math.abs(preview.orderedQuantity - 846_641.9392) > 0.000001) failures.push(`orderedQuantity=${preview.orderedQuantity}`);
  if (preview.v1ReferencesBefore !== 0) failures.push(`v1References=${preview.v1ReferencesBefore}`);
  if (failures.length) throw new Error(`Koper importer v2 preview mismatch: ${failures.join(", ")}`);
  console.log("KOPER_PURCHASE_IMPORTER_V2_PREVIEW", JSON.stringify(preview));
}

void main().catch((error) => {
  console.error("KOPER_PURCHASE_IMPORTER_V2_PREVIEW_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
