import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

await import("./index.js");

const targets = ["1224", "2676"];
const writeEnabled = process.env.KOPER_FINANCIAL_RECEIPT_SPLIT_WRITE_ENABLED === "true";
const childTimeoutMs = Math.max(60_000, Math.min(600_000, Number(process.env.KOPER_FINANCIAL_RECEIPT_BATCH_CHILD_TIMEOUT_MS ?? "300000") || 300_000));

const sourceUrl = new URL("./promote-financial-receipt-material-pilot.js", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const marker = `const allocations = product.orders.filter((allocation) => allocation.orderId && allocation.orderProductId);\n        if (allocations.length !== 1)\n            throw new Error(\`Entry item \${item.koper_id} has \${allocations.length} order allocations\`);\n        const allocation = allocations[0];\n        const quantity = numberValue(payload.productAmount);\n        const allocationQuantity = allocation.productAmount ?? allocation.amountReceived ?? allocation.amount;\n        if (quantity === null || quantity <= 0 || product.productAmount === null || allocationQuantity === null) {\n            throw new Error(\`Entry item \${item.koper_id} has invalid quantity\`);\n        }\n        if (!approximatelyEqual(quantity, product.productAmount) || !approximatelyEqual(quantity, allocationQuantity)) {\n            throw new Error(\`Entry item \${item.koper_id} quantity mismatch\`);\n        }\n        preliminary.push({\n            item,\n            payload,\n            product,\n            allocation,\n            quantity,\n            unitCost: Math.max(0, numberValue(payload.averageProductValue)\n                ?? numberValue(payload.productValue)\n                ?? product.price\n                ?? 0),\n        });`;

if (!source.includes(marker)) throw new Error("KOPER_ALLOCATION_SPLIT_PATCH_MARKER_NOT_FOUND");

const absolute = source
  .replace(/from "(\.\/[^\"]+)"/g, (_match, specifier: string) => `from "${new URL(specifier, sourceUrl).href}"`)
  .replace(/import\("(\.\/[^\"]+)"\)/g, (_match, specifier: string) => `import("${new URL(specifier, sourceUrl).href}")`);

const replacement = `const allocations = product.orders.filter((allocation) => allocation.orderId && allocation.orderProductId);\n        const quantity = numberValue(payload.productAmount);\n        if (!allocations.length || quantity === null || quantity <= 0 || product.productAmount === null) {\n            throw new Error(\`Entry item \${item.koper_id} has invalid allocation split\`);\n        }\n        const splitRows = allocations.map((allocation) => ({\n            allocation,\n            allocationQuantity: allocation.productAmount ?? allocation.amountReceived ?? allocation.amount,\n        }));\n        if (splitRows.some((row) => row.allocationQuantity === null || row.allocationQuantity <= 0)) {\n            throw new Error(\`Entry item \${item.koper_id} has invalid split quantity\`);\n        }\n        const allocationTotal = splitRows.reduce((sum, row) => sum + row.allocationQuantity, 0);\n        if (!approximatelyEqual(quantity, product.productAmount) || !approximatelyEqual(quantity, allocationTotal)) {\n            throw new Error(\`Entry item \${item.koper_id} allocation split quantity mismatch\`);\n        }\n        const unitCost = Math.max(0, numberValue(payload.averageProductValue)\n            ?? numberValue(payload.productValue)\n            ?? product.price\n            ?? 0);\n        for (const row of splitRows) {\n            preliminary.push({\n                item,\n                payload,\n                product,\n                allocation: row.allocation,\n                quantity: row.allocationQuantity,\n                unitCost,\n            });\n        }`;

const patched = absolute.replace(marker, replacement);
const patchedUrl = pathToFileURL(`/tmp/koper-allocation-split-recovery-${process.pid}.mjs`);
await writeFile(patchedUrl, patched, "utf8");
const guardPath = new URL("./financial-receipt-write-guard.js", import.meta.url).pathname;

type Result = {
  entryId: string;
  ok: boolean;
  planned: boolean;
  written: boolean;
  timedOut: boolean;
  finalLine: string | null;
  error: string | null;
};

console.log("KOPER_ALLOCATION_SPLIT_RECOVERY_START", JSON.stringify({ readOnlyKoper: true, writeEnabled, targets, childTimeoutMs }));
const results: Result[] = [];

for (let index = 0; index < targets.length; index += 1) {
  const entryId = targets[index]!;
  const result = await new Promise<Result>((resolve) => {
    const child = spawn(process.execPath, ["--import", guardPath, patchedUrl.pathname], {
      env: {
        ...process.env,
        PORT: String(19_300 + index),
        KOPER_FINANCIAL_RECEIPT_PILOT_ENTRY_ID: entryId,
        KOPER_FINANCIAL_RECEIPT_PILOT_WRITE_ENABLED: writeEnabled ? "true" : "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let planned = false;
    let completed = false;
    let finalLine: string | null = null;

    const finish = (value: Result): void => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      resolve(value);
    };

    const consumeLine = (line: string, sourceName: "stdout" | "stderr"): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.includes("KOPER_FINANCIAL_RECEIPT_PILOT_PLAN")) {
        planned = true;
        console.log("KOPER_ALLOCATION_SPLIT_RECOVERY_PLAN", JSON.stringify({ entryId, line: trimmed.slice(0, 5000) }));
      }
      if (trimmed.includes("KOPER_FINANCIAL_RECEIPT_PILOT_RESULT")) {
        finalLine = trimmed;
        finish({ entryId, ok: true, planned, written: true, timedOut: false, finalLine, error: null });
        return;
      }
      if (trimmed.includes("KOPER_FINANCIAL_RECEIPT_PILOT_SKIPPED")) {
        finalLine = trimmed;
        finish({ entryId, ok: planned, planned, written: false, timedOut: false, finalLine, error: planned ? null : "skipped_without_plan" });
        return;
      }
      if (trimmed.includes("KOPER_FINANCIAL_RECEIPT_PILOT_FAILED")) {
        finalLine = trimmed;
        finish({ entryId, ok: false, planned, written: false, timedOut: false, finalLine, error: trimmed.slice(0, 2500) });
        return;
      }
      if (sourceName === "stderr" && /error|failed/i.test(trimmed)) {
        console.error("KOPER_ALLOCATION_SPLIT_RECOVERY_CHILD_STDERR", JSON.stringify({ entryId, line: trimmed.slice(0, 1500) }));
      }
    };

    const consumeChunk = (chunk: Buffer, sourceName: "stdout" | "stderr"): void => {
      if (sourceName === "stdout") {
        stdoutBuffer += chunk.toString("utf8");
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        lines.forEach((line) => consumeLine(line, sourceName));
      } else {
        stderrBuffer += chunk.toString("utf8");
        const lines = stderrBuffer.split("\n");
        stderrBuffer = lines.pop() ?? "";
        lines.forEach((line) => consumeLine(line, sourceName));
      }
    };

    child.stdout.on("data", (chunk: Buffer) => consumeChunk(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => consumeChunk(chunk, "stderr"));
    child.on("error", (error) => finish({ entryId, ok: false, planned, written: false, timedOut: false, finalLine, error: error.message }));
    child.on("exit", (code, signal) => {
      if (completed) return;
      if (stdoutBuffer.trim()) consumeLine(stdoutBuffer, "stdout");
      if (stderrBuffer.trim()) consumeLine(stderrBuffer, "stderr");
      if (completed) return;
      finish({ entryId, ok: false, planned, written: false, timedOut: false, finalLine, error: `child_exited_before_final_log code=${code ?? "null"} signal=${signal ?? "null"}` });
    });

    const timer = setTimeout(() => {
      finish({ entryId, ok: false, planned, written: false, timedOut: true, finalLine, error: `timeout_after_${childTimeoutMs}ms` });
    }, childTimeoutMs);
  });

  results.push(result);
  console.log("KOPER_ALLOCATION_SPLIT_RECOVERY_ENTRY_RESULT", JSON.stringify(result));
  if (!result.ok) break;
}

const ok = results.length === targets.length && results.every((row) => row.ok);
console.log("KOPER_ALLOCATION_SPLIT_RECOVERY_DONE", JSON.stringify({ ok, writeEnabled, requested: targets.length, processed: results.length, results }));
if (!ok) process.exitCode = 1;
