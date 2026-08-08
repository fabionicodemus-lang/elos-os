import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const sourceUrl = new URL(
  "./plan-financial-receipt-material-promotion-v3.js",
  import.meta.url,
);
const patchedUrl = pathToFileURL(
  `/tmp/koper-promotion-plan-v3-full-${process.pid}.mjs`,
);
const source = await readFile(sourceUrl, "utf8");
const marker = "safeEntryExamples: safeEntries.slice(0, 15),";

if (!source.includes(marker)) {
  throw new Error("KOPER_PROMOTION_PLAN_V3_OUTPUT_MARKER_NOT_FOUND");
}

const absoluteImports = source
  .replace(
    /from "(\.\/[^\"]+)"/g,
    (_match, specifier: string) => `from "${new URL(specifier, sourceUrl).href}"`,
  )
  .replace(
    /import\("(\.\/[^\"]+)"\)/g,
    (_match, specifier: string) => `import("${new URL(specifier, sourceUrl).href}")`,
  );

const patched = absoluteImports.replace(
  marker,
  `${marker}\n    safeEntryIds: safeEntries.map((entry) => entry.entryId),`,
);

await writeFile(patchedUrl, patched, "utf8");
await import(patchedUrl.href);
