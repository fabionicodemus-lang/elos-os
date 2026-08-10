import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

await import("./index.js");
const entryId = "5354";
const writeEnabled = process.env.KOPER_FINANCIAL_RECEIPT_5354_WRITE_ENABLED === "true";
const childTimeoutMs = Math.max(60_000, Math.min(600_000, Number(process.env.KOPER_FINANCIAL_RECEIPT_BATCH_CHILD_TIMEOUT_MS ?? "300000") || 300_000));
const sourceUrl = new URL("./promote-financial-receipt-material-pilot.js", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const marker = `const allocations = product.orders.filter((allocation) => allocation.orderId && allocation.orderProductId);\n        if (allocations.length !== 1)\n            throw new Error(\`Entry item \${item.koper_id} has \${allocations.length} order allocations\`);\n        const allocation = allocations[0];\n        const quantity = numberValue(payload.productAmount);\n        const allocationQuantity = allocation.productAmount ?? allocation.amountReceived ?? allocation.amount;\n        if (quantity === null || quantity <= 0 || product.productAmount === null || allocationQuantity === null) {\n            throw new Error(\`Entry item \${item.koper_id} has invalid quantity\`);\n        }\n        if (!approximatelyEqual(quantity, product.productAmount) || !approximatelyEqual(quantity, allocationQuantity)) {\n            throw new Error(\`Entry item \${item.koper_id} quantity mismatch\`);\n        }\n        preliminary.push({\n            item,\n            payload,\n            product,\n            allocation,\n            quantity,\n            unitCost: Math.max(0, numberValue(payload.averageProductValue)\n                ?? numberValue(payload.productValue)\n                ?? product.price\n                ?? 0),\n        });`;
if (!source.includes(marker)) throw new Error("KOPER_5354_PATCH_MARKER_NOT_FOUND");
const absolute = source
  .replace(/from "(\.\/[^\"]+)"/g, (_match, specifier: string) => `from "${new URL(specifier, sourceUrl).href}"`)
  .replace(/import\("(\.\/[^\"]+)"\)/g, (_match, specifier: string) => `import("${new URL(specifier, sourceUrl).href}")`);
const replacement = `const allocations = product.orders.filter((allocation) => allocation.orderId && allocation.orderProductId);\n        const sourceQuantity = numberValue(payload.productAmount);\n        const audited5354Override = entryId === "5354" && item.koper_id === "6614"\n            && product.receiptId === "5851" && product.receiptProductId === "4043"\n            && sourceQuantity !== null && approximatelyEqual(sourceQuantity, 12)\n            && product.productAmount !== null && approximatelyEqual(product.productAmount, 20);\n        const quantity = audited5354Override ? 20 : sourceQuantity;\n        if (!allocations.length || quantity === null || quantity <= 0 || product.productAmount === null) {\n            throw new Error(\`Entry item \${item.koper_id} has invalid allocation set\`);\n        }\n        const splitRows = allocations.map((allocation) => ({ allocation, allocationQuantity: allocation.productAmount ?? allocation.amountReceived ?? allocation.amount }));\n        if (splitRows.some((row) => row.allocationQuantity === null || row.allocationQuantity <= 0)) {\n            throw new Error(\`Entry item \${item.koper_id} has invalid allocation quantity\`);\n        }\n        const allocationTotal = splitRows.reduce((sum, row) => sum + row.allocationQuantity, 0);\n        if (!approximatelyEqual(quantity, product.productAmount) || !approximatelyEqual(quantity, allocationTotal)) {\n            throw new Error(\`Entry item \${item.koper_id} allocation quantity mismatch\`);\n        }\n        if (audited5354Override) {\n            const only = splitRows.length === 1 ? splitRows[0] : null;\n            if (!only || only.allocation.orderId !== "4359" || only.allocation.orderProductId !== "5482" || !approximatelyEqual(only.allocationQuantity, 20)) {\n                throw new Error("KOPER_5354_AUDIT_GUARD_CHANGED");\n            }\n        }\n        const unitCost = Math.max(0, numberValue(payload.averageProductValue) ?? numberValue(payload.productValue) ?? product.price ?? 0);\n        for (const row of splitRows) {\n            preliminary.push({ item, payload, product, allocation: row.allocation, quantity: row.allocationQuantity, unitCost });\n        }`;
const patched = absolute.replace(marker, replacement);
const patchedUrl = pathToFileURL(`/tmp/koper-5354-recovery-${process.pid}.mjs`);
await writeFile(patchedUrl, patched, "utf8");
const guardPath = new URL("./financial-receipt-write-guard.js", import.meta.url).pathname;
type Result = { ok: boolean; planned: boolean; written: boolean; timedOut: boolean; finalLine: string | null; error: string | null };
console.log("KOPER_5354_RECOVERY_START", JSON.stringify({ readOnlyKoper: true, writeEnabled, entryId, childTimeoutMs }));
const result = await new Promise<Result>((resolve) => {
  const child = spawn(process.execPath, ["--import", guardPath, patchedUrl.pathname], { env: { ...process.env, PORT: "19420", KOPER_FINANCIAL_RECEIPT_PILOT_ENTRY_ID: entryId, KOPER_FINANCIAL_RECEIPT_PILOT_WRITE_ENABLED: writeEnabled ? "true" : "false" }, stdio: ["ignore", "pipe", "pipe"] });
  let stdoutBuffer = ""; let stderrBuffer = ""; let planned = false; let completed = false; let finalLine: string | null = null;
  const finish = (value: Result): void => { if (completed) return; completed = true; clearTimeout(timer); child.kill("SIGTERM"); resolve(value); };
  const consumeLine = (line: string): void => {
    const trimmed = line.trim(); if (!trimmed) return;
    if (trimmed.includes("KOPER_FINANCIAL_RECEIPT_PILOT_PLAN")) { planned = true; console.log("KOPER_5354_RECOVERY_PLAN", JSON.stringify({ line: trimmed.slice(0, 12000) })); }
    if (trimmed.includes("KOPER_FINANCIAL_RECEIPT_PILOT_RESULT")) { finalLine = trimmed; finish({ ok: true, planned, written: true, timedOut: false, finalLine, error: null }); }
    else if (trimmed.includes("KOPER_FINANCIAL_RECEIPT_PILOT_SKIPPED")) { finalLine = trimmed; finish({ ok: planned, planned, written: false, timedOut: false, finalLine, error: planned ? null : "skipped_without_plan" }); }
    else if (trimmed.includes("KOPER_FINANCIAL_RECEIPT_PILOT_FAILED")) { finalLine = trimmed; finish({ ok: false, planned, written: false, timedOut: false, finalLine, error: trimmed.slice(0, 3000) }); }
  };
  child.stdout.on("data", (chunk: Buffer) => { stdoutBuffer += chunk.toString("utf8"); const lines = stdoutBuffer.split("\n"); stdoutBuffer = lines.pop() ?? ""; lines.forEach(consumeLine); });
  child.stderr.on("data", (chunk: Buffer) => { stderrBuffer += chunk.toString("utf8"); const lines = stderrBuffer.split("\n"); stderrBuffer = lines.pop() ?? ""; lines.forEach(consumeLine); });
  child.on("error", (error) => finish({ ok: false, planned, written: false, timedOut: false, finalLine, error: error.message }));
  child.on("exit", (code, signal) => { if (completed) return; if (stdoutBuffer.trim()) consumeLine(stdoutBuffer); if (stderrBuffer.trim()) consumeLine(stderrBuffer); if (!completed) finish({ ok: false, planned, written: false, timedOut: false, finalLine, error: `child_exited_before_final_log code=${code ?? "null"} signal=${signal ?? "null"}` }); });
  const timer = setTimeout(() => finish({ ok: false, planned, written: false, timedOut: true, finalLine, error: `timeout_after_${childTimeoutMs}ms` }), childTimeoutMs);
});
console.log("KOPER_5354_RECOVERY_DONE", JSON.stringify({ ...result, writeEnabled, entryId }));
if (!result.ok) process.exitCode = 1;
