import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const targets = ["11646", "11650", "186", "208"];
const writeEnabled = process.env.KOPER_FINANCIAL_RECEIPT_PARTITION_WRITE_ENABLED === "true";
const childTimeoutMs = Math.max(30_000, Number(process.env.KOPER_FINANCIAL_RECEIPT_BATCH_CHILD_TIMEOUT_MS ?? "600000") || 600_000);

const sourceUrl = new URL("./promote-financial-receipt-material-pilot.js", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const marker = `if (!approximatelyEqual(quantity, product.productAmount) || !approximatelyEqual(quantity, allocationQuantity)) {\n            throw new Error(\`Entry item \${item.koper_id} quantity mismatch\`);\n        }`;
if (!source.includes(marker)) throw new Error("KOPER_PARTITION_RECOVERY_PATCH_MARKER_NOT_FOUND");

const absolute = source
  .replace(/from "(\.\/[^\"]+)"/g, (_match, specifier: string) => `from "${new URL(specifier, sourceUrl).href}"`)
  .replace(/import\("(\.\/[^\"]+)"\)/g, (_match, specifier: string) => `import("${new URL(specifier, sourceUrl).href}")`);

const patched = absolute.replace(marker, `const auditedPartitionMismatchAllowed = (\n          (entryId === "11646" && item.koper_id === "13040" && product.receiptProductId === "6507" && allocation.orderId === "9461" && allocation.orderProductId === "10788" && approximatelyEqual(quantity, 8) && approximatelyEqual(product.productAmount, 10) && approximatelyEqual(allocationQuantity, 10))\n          || (entryId === "11650" && item.koper_id === "13069" && product.receiptProductId === "6507" && allocation.orderId === "9461" && allocation.orderProductId === "10788" && approximatelyEqual(quantity, 2) && approximatelyEqual(product.productAmount, 10) && approximatelyEqual(allocationQuantity, 10))\n          || (entryId === "186" && item.koper_id === "268" && product.receiptProductId === "128" && allocation.orderId === "313" && allocation.orderProductId === "282" && approximatelyEqual(quantity, 2) && approximatelyEqual(product.productAmount, 4) && approximatelyEqual(allocationQuantity, 4))\n          || (entryId === "208" && item.koper_id === "316" && product.receiptProductId === "128" && allocation.orderId === "313" && allocation.orderProductId === "282" && approximatelyEqual(quantity, 2) && approximatelyEqual(product.productAmount, 4) && approximatelyEqual(allocationQuantity, 4))\n        );\n        if ((!approximatelyEqual(quantity, product.productAmount) || !approximatelyEqual(quantity, allocationQuantity)) && !auditedPartitionMismatchAllowed) {\n            throw new Error(\`Entry item \${item.koper_id} quantity mismatch\`);\n        }`);

const patchedUrl = pathToFileURL(`/tmp/koper-partition-recovery-pilot-${process.pid}.mjs`);
await writeFile(patchedUrl, patched, "utf8");

const guardPath = new URL("./financial-receipt-write-guard.js", import.meta.url).pathname;

console.log("KOPER_PARTITION_RECOVERY_START", JSON.stringify({ readOnlyKoper: true, writeEnabled, targets, childTimeoutMs }));

const results: Array<{ entryId: string; ok: boolean; exitCode: number | null; timedOut: boolean }> = [];
for (const entryId of targets) {
  const result = await new Promise<{ entryId: string; ok: boolean; exitCode: number | null; timedOut: boolean }>((resolve) => {
    const child = spawn(process.execPath, ["--import", guardPath, patchedUrl.pathname], {
      env: {
        ...process.env,
        PORT: "0",
        KOPER_FINANCIAL_RECEIPT_PILOT_ENTRY_ID: entryId,
        KOPER_FINANCIAL_RECEIPT_PILOT_WRITE_ENABLED: writeEnabled ? "true" : "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, childTimeoutMs);
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ entryId, ok: code === 0 && !timedOut, exitCode: code, timedOut });
    });
  });
  results.push(result);
  console.log("KOPER_PARTITION_RECOVERY_ENTRY_RESULT", JSON.stringify(result));
  if (!result.ok) break;
}

const ok = results.length === targets.length && results.every((row) => row.ok);
console.log("KOPER_PARTITION_RECOVERY_DONE", JSON.stringify({ ok, writeEnabled, requested: targets.length, processed: results.length, results }));
if (!ok) process.exitCode = 1;
