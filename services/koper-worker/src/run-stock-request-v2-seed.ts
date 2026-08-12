import {
  previewKoperStockRequestItemsV2,
  seedKoperStockRequestItemsV2,
} from "./diagnostics/seed-koper-stock-request-items-v2.js";

function assertExpected(preview: Awaited<ReturnType<typeof previewKoperStockRequestItemsV2>>): void {
  const failures: string[] = [];
  if (preview.sourceItems !== 3697) failures.push(`sourceItems=${preview.sourceItems}`);
  if (preview.intendedRows !== 3769) failures.push(`intendedRows=${preview.intendedRows}`);
  if (preview.realServiceRows !== 3245) failures.push(`realServiceRows=${preview.realServiceRows}`);
  if (preview.legacyNoLinks !== 517) failures.push(`legacyNoLinks=${preview.legacyNoLinks}`);
  if (preview.legacyAmbiguous !== 7) failures.push(`legacyAmbiguous=${preview.legacyAmbiguous}`);
  if (Math.abs(preview.totalQuantity - 673513.6992) > 0.00001) failures.push(`totalQuantity=${preview.totalQuantity}`);
  if (failures.length) throw new Error(`Koper stock request v2 preflight mismatch: ${failures.join(", ")}`);
}

async function main(): Promise<void> {
  const preview = await previewKoperStockRequestItemsV2();
  assertExpected(preview);
  console.log("KOPER_STOCK_REQUEST_V2_PREVIEW", JSON.stringify(preview));

  if (process.env.KOPER_STOCK_REQUEST_V2_SEED_ENABLED !== "true") {
    console.log("KOPER_STOCK_REQUEST_V2_SEED_SKIPPED", JSON.stringify({ reason: "write-flag-disabled" }));
    return;
  }

  const result = await seedKoperStockRequestItemsV2();
  console.log("KOPER_STOCK_REQUEST_V2_SEED_RESULT", JSON.stringify(result));
}

void main().catch((error) => {
  console.error("KOPER_STOCK_REQUEST_V2_SEED_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
