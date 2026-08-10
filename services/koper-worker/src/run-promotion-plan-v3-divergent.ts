import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const sourceUrl = new URL("./plan-financial-receipt-material-promotion-v3.js", import.meta.url);
const patchedUrl = pathToFileURL(`/tmp/koper-promotion-plan-v3-divergent-${process.pid}.mjs`);
const source = await readFile(sourceUrl, "utf8");

const safeMarker = "const safeEntries = [];";
const outputMarker = "safeEntryExamples: safeEntries.slice(0, 15),";
if (!source.includes(safeMarker) || !source.includes(outputMarker)) {
  throw new Error("KOPER_PROMOTION_PLAN_V3_DIVERGENT_MARKER_NOT_FOUND");
}

let patched = source
  .replace(
    /from "(\.\/[^\"]+)"/g,
    (_match, specifier: string) => `from "${new URL(specifier, sourceUrl).href}"`,
  )
  .replace(
    /import\("(\.\/[^\"]+)"\)/g,
    (_match, specifier: string) => `import("${new URL(specifier, sourceUrl).href}")`,
  );

patched = patched.replace(
  safeMarker,
  `const excludedEntryIds = {};\n  const recordExcluded = (reason, entryId) => {\n    increment(excluded, reason);\n    excludedEntryIds[reason] = [...(excludedEntryIds[reason] ?? []), entryId];\n  };\n  ${safeMarker}`,
);

patched = patched.replace(
  /increment\(excluded, "([A-Za-z]+)"\);/g,
  (_match, reason: string) => `recordExcluded("${reason}", entryId);`,
);
patched = patched.replace(
  "increment(excluded, entryReason);",
  "recordExcluded(entryReason, entryId);",
);

patched = patched.replace(
  outputMarker,
  `${outputMarker}\n    excludedEntryIds,`,
);

await writeFile(patchedUrl, patched, "utf8");
await import(patchedUrl.href);
