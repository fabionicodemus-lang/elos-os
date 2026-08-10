import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

await import("./index.js");

const entryId = "3606";
const writeEnabled = process.env.KOPER_FINANCIAL_RECEIPT_ZERO_3606_WRITE_ENABLED === "true";
const childTimeoutMs = Math.max(60_000, Math.min(600_000, Number(process.env.KOPER_FINANCIAL_RECEIPT_BATCH_CHILD_TIMEOUT_MS ?? "300000") || 300_000));
const sourceUrl = new URL("./promote-financial-receipt-material-pilot.js", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const marker = `const quantity = numberValue(payload.productAmount);\n        const allocationQuantity = allocation.productAmount ?? allocation.amountReceived ?? allocation.amount;\n        if (quantity === null || quantity <= 0 || product.productAmount === null || allocationQuantity === null) {\n            throw new Error(\`Entry item \${item.koper_id} has invalid quantity\`);\n        }\n        if (!approximatelyEqual(quantity, product.productAmount) || !approximatelyEqual(quantity, allocationQuantity)) {\n            throw new Error(\`Entry item \${item.koper_id} quantity mismatch\`);\n        }`;
if (!source.includes(marker)) throw new Error("KOPER_ZERO_3606_PATCH_MARKER_NOT_FOUND");

const absolute = source
  .replace(/from "(\.\/[^\"]+)"/g, (_match, specifier: string) => `from "${new URL(specifier, sourceUrl).href}"`)
  .replace(/import\("(\.\/[^\"]+)"\)/g, (_match, specifier: string) => `import("${new URL(specifier, sourceUrl).href}")`);

const replacement = `const sourceQuantity = numberValue(payload.productAmount);\n        const allocationQuantity = allocation.productAmount ?? allocation.amountReceived ?? allocation.amount;\n        const auditedZero3606 = entryId === "3606"\n            && item.koper_id === "4601"\n            && product.receiptId === "3829"\n            && product.receiptProductId === "2707"\n            && sourceQuantity !== null\n            && approximatelyEqual(sourceQuantity, 0);\n        if (auditedZero3606 && (allocation.orderId !== "3135"\n            || allocation.orderProductId !== "4097"\n            || product.productAmount === null\n            || allocationQuantity === null\n            || !approximatelyEqual(product.productAmount, 1)\n            || !approximatelyEqual(allocationQuantity, 1))) {\n            throw new Error("KOPER_ZERO_3606_AUDIT_GUARD_CHANGED");\n        }\n        const quantity = auditedZero3606 ? 1 : sourceQuantity;\n        if (quantity === null || quantity <= 0 || product.productAmount === null || allocationQuantity === null) {\n            throw new Error(\`Entry item \${item.koper_id} has invalid quantity\`);\n        }\n        if (!approximatelyEqual(quantity, product.productAmount) || !approximatelyEqual(quantity, allocationQuantity)) {\n            throw new Error(\`Entry item \${item.koper_id} quantity mismatch\`);\n        }`;
const patched = absolute.replace(marker, replacement);
const patchedUrl = pathToFileURL(`/tmp/koper-zero-3606-recovery-${process.pid}.mjs`);
await writeFile(patchedUrl, patched, "utf8");
const guardPath = new URL("./financial-receipt-write-guard.js", import.meta.url).pathname;

type Result = { ok: boolean; planned: boolean; written: boolean; timedOut: boolean; finalLine: string | null; error: string | null };
console.log("KOPER_ZERO_3606_RECOVERY_START", JSON.stringify({ readOnlyKoper: true, writeEnabled, entryId, childTimeoutMs }));
const result = await new Promise<Result>((resolve) => {
  const child = spawn(process.execPath, ["--import", guardPath, patchedUrl.pathname], {
    env: {
      ...process.env,
      PORT: "19400",
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
      console.log("KOPER_ZERO_3606_RECOVERY_PLAN", JSON.stringify({ line: trimmed.slice(0, 5000) }));
    }
    if (trimmed.includes("KOPER_FINANCIAL_RECEIPT_PILOT_RESULT")) {
      finalLine = trimmed;
      finish({ ok: true, planned, written: true, timedOut: false, finalLine, error: null });
    } else if (trimmed.includes("KOPER_FINANCIAL_RECEIPT_PILOT_SKIPPED")) {
      finalLine = trimmed;
      finish({ ok: planned, planned, written: false, timedOut: false, finalLine, error: planned ? null : "skipped_without_plan" });
    } else if (trimmed.includes("KOPER_FINANCIAL_RECEIPT_PILOT_FAILED")) {
      finalLine = trimmed;
      finish({ ok: false, planned, written: false, timedOut: false, finalLine, error: trimmed.slice(0, 2500) });
    } else if (sourceName === "stderr" && /error|failed/i.test(trimmed)) {
      console.error("KOPER_ZERO_3606_RECOVERY_CHILD_STDERR", JSON.stringify({ line: trimmed.slice(0, 1500) }));
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
  child.on("error", (error) => finish({ ok: false, planned, written: false, timedOut: false, finalLine, error: error.message }));
  child.on("exit", (code, signal) => {
    if (completed) return;
    if (stdoutBuffer.trim()) consumeLine(stdoutBuffer, "stdout");
    if (stderrBuffer.trim()) consumeLine(stderrBuffer, "stderr");
    if (completed) return;
    finish({ ok: false, planned, written: false, timedOut: false, finalLine, error: `child_exited_before_final_log code=${code ?? "null"} signal=${signal ?? "null"}` });
  });
  const timer = setTimeout(() => finish({ ok: false, planned, written: false, timedOut: true, finalLine, error: `timeout_after_${childTimeoutMs}ms` }), childTimeoutMs);
});
console.log("KOPER_ZERO_3606_RECOVERY_DONE", JSON.stringify({ ...result, writeEnabled, entryId }));
if (!result.ok) process.exitCode = 1;
