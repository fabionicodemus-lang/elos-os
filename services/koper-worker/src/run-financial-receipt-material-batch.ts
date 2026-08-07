import { spawn } from "node:child_process";

await import("./index.js");

type ChildOutcome = {
  entryId: string;
  ok: boolean;
  planned: boolean;
  written: boolean;
  finalLine: string | null;
  error: string | null;
};

const entryIds = (process.env.KOPER_FINANCIAL_RECEIPT_BATCH_ENTRY_IDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const writeEnabled = process.env.KOPER_FINANCIAL_RECEIPT_BATCH_WRITE_ENABLED === "true";
const timeoutMs = Math.max(
  60_000,
  Math.min(600_000, Number(process.env.KOPER_FINANCIAL_RECEIPT_BATCH_CHILD_TIMEOUT_MS ?? "300000") || 300_000),
);

if (!entryIds.length) {
  console.error("KOPER_FINANCIAL_RECEIPT_BATCH_FAILED", JSON.stringify({
    message: "KOPER_FINANCIAL_RECEIPT_BATCH_ENTRY_IDS is required",
  }));
} else if (new Set(entryIds).size !== entryIds.length) {
  console.error("KOPER_FINANCIAL_RECEIPT_BATCH_FAILED", JSON.stringify({
    message: "KOPER_FINANCIAL_RECEIPT_BATCH_ENTRY_IDS contains duplicates",
  }));
} else {
  console.log("KOPER_FINANCIAL_RECEIPT_BATCH_START", JSON.stringify({
    writeEnabled,
    entryIds,
    timeoutMs,
  }));

  const outcomes: ChildOutcome[] = [];

  const runEntry = async (entryId: string, index: number): Promise<ChildOutcome> =>
    new Promise((resolve) => {
      const childPort = 18_100 + index;
      const child = spawn(
        process.execPath,
        [
          "--import",
          new URL("./financial-receipt-write-guard.js", import.meta.url).pathname,
          new URL("./promote-financial-receipt-material-pilot.js", import.meta.url).pathname,
        ],
        {
          env: {
            ...process.env,
            PORT: String(childPort),
            KOPER_FINANCIAL_RECEIPT_PILOT_ENTRY_ID: entryId,
            KOPER_FINANCIAL_RECEIPT_PILOT_WRITE_ENABLED: writeEnabled ? "true" : "false",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let stdoutBuffer = "";
      let stderrBuffer = "";
      let planned = false;
      let finalLine: string | null = null;
      let error: string | null = null;
      let completed = false;

      const finish = (outcome: ChildOutcome): void => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        child.kill("SIGTERM");
        resolve(outcome);
      };

      const consumeLine = (line: string, source: "stdout" | "stderr"): void => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (trimmed.includes("KOPER_FINANCIAL_RECEIPT_PILOT_PLAN")) {
          planned = true;
          console.log("KOPER_FINANCIAL_RECEIPT_BATCH_PLAN", JSON.stringify({ entryId, line: trimmed.slice(0, 4_000) }));
        }
        if (trimmed.includes("KOPER_FINANCIAL_RECEIPT_PILOT_RESULT")) {
          finalLine = trimmed;
          console.log("KOPER_FINANCIAL_RECEIPT_BATCH_ENTRY_RESULT", JSON.stringify({ entryId, line: trimmed.slice(0, 4_000) }));
          finish({ entryId, ok: true, planned, written: true, finalLine, error: null });
          return;
        }
        if (trimmed.includes("KOPER_FINANCIAL_RECEIPT_PILOT_SKIPPED")) {
          finalLine = trimmed;
          console.log("KOPER_FINANCIAL_RECEIPT_BATCH_ENTRY_SKIPPED", JSON.stringify({ entryId, line: trimmed.slice(0, 2_000) }));
          finish({ entryId, ok: planned, planned, written: false, finalLine, error: planned ? null : "skipped_without_plan" });
          return;
        }
        if (trimmed.includes("KOPER_FINANCIAL_RECEIPT_PILOT_FAILED")) {
          finalLine = trimmed;
          error = trimmed.slice(0, 2_000);
          console.error("KOPER_FINANCIAL_RECEIPT_BATCH_ENTRY_FAILED", JSON.stringify({ entryId, line: error }));
          finish({ entryId, ok: false, planned, written: false, finalLine, error });
          return;
        }
        if (source === "stderr" && /error|failed/i.test(trimmed)) {
          stderrBuffer = `${stderrBuffer}\n${trimmed}`.slice(-4_000);
        }
      };

      const consumeChunk = (chunk: Buffer, source: "stdout" | "stderr"): void => {
        if (source === "stdout") {
          stdoutBuffer += chunk.toString("utf8");
          const lines = stdoutBuffer.split("\n");
          stdoutBuffer = lines.pop() ?? "";
          lines.forEach((line) => consumeLine(line, source));
        } else {
          stderrBuffer += chunk.toString("utf8");
          const lines = stderrBuffer.split("\n");
          stderrBuffer = lines.pop() ?? "";
          lines.forEach((line) => consumeLine(line, source));
        }
      };

      child.stdout.on("data", (chunk: Buffer) => consumeChunk(chunk, "stdout"));
      child.stderr.on("data", (chunk: Buffer) => consumeChunk(chunk, "stderr"));
      child.on("error", (childError) => {
        error = childError.message;
        finish({ entryId, ok: false, planned, written: false, finalLine, error });
      });
      child.on("exit", (code, signal) => {
        if (completed) return;
        if (stdoutBuffer.trim()) consumeLine(stdoutBuffer, "stdout");
        if (stderrBuffer.trim()) consumeLine(stderrBuffer, "stderr");
        if (completed) return;
        error = `child_exited_before_final_log code=${code ?? "null"} signal=${signal ?? "null"}`;
        finish({ entryId, ok: false, planned, written: false, finalLine, error });
      });

      const timer = setTimeout(() => {
        error = `timeout_after_${timeoutMs}ms`;
        console.error("KOPER_FINANCIAL_RECEIPT_BATCH_ENTRY_TIMEOUT", JSON.stringify({ entryId, timeoutMs }));
        finish({ entryId, ok: false, planned, written: false, finalLine, error });
      }, timeoutMs);
    });

  for (let index = 0; index < entryIds.length; index += 1) {
    const entryId = entryIds[index]!;
    const outcome = await runEntry(entryId, index);
    outcomes.push(outcome);
    if (!outcome.ok) break;
  }

  const failed = outcomes.filter((outcome) => !outcome.ok);
  const written = outcomes.filter((outcome) => outcome.written);
  console.log("KOPER_FINANCIAL_RECEIPT_BATCH_DONE", JSON.stringify({
    ok: failed.length === 0 && outcomes.length === entryIds.length,
    writeEnabled,
    requestedEntries: entryIds.length,
    processedEntries: outcomes.length,
    plannedEntries: outcomes.filter((outcome) => outcome.planned).length,
    writtenEntries: written.length,
    failedEntries: failed.map((outcome) => ({ entryId: outcome.entryId, error: outcome.error })),
    outcomes,
  }));
}
