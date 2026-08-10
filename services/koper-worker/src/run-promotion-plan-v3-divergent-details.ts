import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const sourceUrl = new URL("./plan-financial-receipt-material-promotion-v3.js", import.meta.url);
const patchedUrl = pathToFileURL(`/tmp/koper-promotion-plan-v3-divergent-details-${process.pid}.mjs`);
const source = await readFile(sourceUrl, "utf8");
const safeMarker = "const safeEntries = [];";
const outputMarker = "safeEntryExamples: safeEntries.slice(0, 15),";
if (!source.includes(safeMarker) || !source.includes(outputMarker)) {
  throw new Error("KOPER_PROMOTION_PLAN_V3_DIVERGENT_DETAILS_MARKER_NOT_FOUND");
}

let patched = source
  .replace(/from "(\.\/[^\"]+)"/g, (_m, s: string) => `from "${new URL(s, sourceUrl).href}"`)
  .replace(/import\("(\.\/[^\"]+)"\)/g, (_m, s: string) => `import("${new URL(s, sourceUrl).href}")`);

patched = patched.replace(
  safeMarker,
  `const excludedDetails = [];\n  const addDetail = (reason, entryId, itemId, data = {}) => { excludedDetails.push({ reason, entryId, itemId, ...data }); };\n  ${safeMarker}`,
);

patched = patched.replace(
  `if (!allocations.length) {\n                entryReason = "missingOrderAllocation";\n                break;\n            }`,
  `if (!allocations.length) {\n                addDetail("missingOrderAllocation", entryId, item.koper_id, { receiptId: financialProduct.receiptId, receiptProductId: financialProduct.receiptProductId, sourceQuantity: numberValue(payload.productAmount), receiptQuantity: financialProduct.productAmount });\n                entryReason = "missingOrderAllocation";\n                break;\n            }`,
);
patched = patched.replace(
  `if (allocations.length !== 1) {\n                entryReason = "allocationSplit";\n                break;\n            }`,
  `if (allocations.length !== 1) {\n                addDetail("allocationSplit", entryId, item.koper_id, { receiptId: financialProduct.receiptId, receiptProductId: financialProduct.receiptProductId, sourceQuantity: numberValue(payload.productAmount), receiptQuantity: financialProduct.productAmount, allocations });\n                entryReason = "allocationSplit";\n                break;\n            }`,
);
patched = patched.replace(
  `if (sourceQuantity === null || sourceQuantity <= 0\n                || receiptQuantity === null || receiptQuantity <= 0\n                || allocationQuantity === null || allocationQuantity <= 0) {\n                entryReason = "invalidQuantity";\n                break;\n            }`,
  `if (sourceQuantity === null || sourceQuantity <= 0\n                || receiptQuantity === null || receiptQuantity <= 0\n                || allocationQuantity === null || allocationQuantity <= 0) {\n                addDetail("invalidQuantity", entryId, item.koper_id, { receiptId: financialProduct.receiptId, receiptProductId: financialProduct.receiptProductId, orderId: allocation.orderId, orderProductId: allocation.orderProductId, sourceQuantity, receiptQuantity, allocationQuantity });\n                entryReason = "invalidQuantity";\n                break;\n            }`,
);
patched = patched.replace(
  `if (!approximatelyEqual(sourceQuantity, receiptQuantity)) {\n                entryReason = "receiptQuantityMismatch";\n                break;\n            }`,
  `if (!approximatelyEqual(sourceQuantity, receiptQuantity)) {\n                addDetail("receiptQuantityMismatch", entryId, item.koper_id, { receiptId: financialProduct.receiptId, receiptProductId: financialProduct.receiptProductId, orderId: allocation.orderId, orderProductId: allocation.orderProductId, sourceQuantity, receiptQuantity, allocationQuantity });\n                entryReason = "receiptQuantityMismatch";\n                break;\n            }`,
);
patched = patched.replace(outputMarker, `${outputMarker}\n    excludedDetails,`);

await writeFile(patchedUrl, patched, "utf8");
await import(patchedUrl.href);
