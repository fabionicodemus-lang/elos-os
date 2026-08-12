// Runner operacional protegido: o preview e os invariantes sempre rodam antes de qualquer DELETE.
import {
  cleanupKoperStockRequestItemsV1,
  previewKoperStockRequestV1Cleanup,
} from "./diagnostics/cleanup-koper-stock-request-items-v1.js";

function assertPreview(preview: Awaited<ReturnType<typeof previewKoperStockRequestV1Cleanup>>): void {
  const failures: string[] = [];
  if (preview.v2Rows !== 3769) failures.push(`v2Rows=${preview.v2Rows}`);
  if (preview.staleRows !== 3173) failures.push(`staleRows=${preview.staleRows}`);
  if (preview.purchaseReferences !== 0) failures.push(`purchaseReferences=${preview.purchaseReferences}`);
  if (preview.quotationReferences !== 0) failures.push(`quotationReferences=${preview.quotationReferences}`);
  if (preview.allocationReferences !== 0) failures.push(`allocationReferences=${preview.allocationReferences}`);
  if (!preview.safeToDelete) failures.push("safeToDelete=false");
  if (Math.abs(preview.v2Quantity - 673513.6992) > 0.00001) failures.push(`v2Quantity=${preview.v2Quantity}`);
  if (failures.length) throw new Error(`Koper v1 cleanup preflight mismatch: ${failures.join(", ")}`);
}

async function main(): Promise<void> {
  const preview = await previewKoperStockRequestV1Cleanup();
  assertPreview(preview);
  console.log("KOPER_STOCK_REQUEST_V1_CLEANUP_PREVIEW", JSON.stringify(preview));

  if (process.env.KOPER_STOCK_REQUEST_V1_CLEANUP_ENABLED !== "true") {
    console.log("KOPER_STOCK_REQUEST_V1_CLEANUP_SKIPPED", JSON.stringify({ reason: "write-flag-disabled" }));
    return;
  }

  const result = await cleanupKoperStockRequestItemsV1();
  console.log("KOPER_STOCK_REQUEST_V1_CLEANUP_RESULT", JSON.stringify(result));
}

void main().catch((error) => {
  console.error("KOPER_STOCK_REQUEST_V1_CLEANUP_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
