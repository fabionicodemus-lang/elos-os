import { readFile, writeFile } from "node:fs/promises";

const sourceUrl = new URL("./plan-financial-receipt-material-promotion-v3.js", import.meta.url);
const patchedUrl = new URL("./plan-financial-receipt-material-promotion-v3-full.js", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const marker = "safeEntryExamples: safeEntries.slice(0, 15),";

if (!source.includes(marker)) {
  throw new Error("KOPER_PROMOTION_PLAN_V3_OUTPUT_MARKER_NOT_FOUND");
}

const patched = source.replace(
  marker,
  `${marker}\n    safeEntryIds: safeEntries.map((entry) => entry.entryId),`,
);

await writeFile(patchedUrl, patched, "utf8");
await import(patchedUrl.href);
