import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("./forecast-load-worker.mjs", import.meta.url));

function runScenario(mode) {
  const execution = spawnSync(process.execPath, ["--expose-gc", workerPath, mode], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  });

  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  const lines = execution.stdout.trim().split("\n").filter(Boolean);
  assert.ok(lines.length > 0, `cenário ${mode} não produziu métricas`);
  return JSON.parse(lines.at(-1));
}

function report(metrics) {
  const memoryMb = metrics.memory.peakGrowthBytes / 1024 / 1024;
  const payloadMb = metrics.output.payloadBytes / 1024 / 1024;
  console.log(
    `[performance:${metrics.mode}] `
    + `tempo=${metrics.timingMs.total.toFixed(1)}ms `
    + `heap=+${memoryMb.toFixed(1)}MB `
    + `meses=${metrics.output.months} `
    + `células=${metrics.output.cells} `
    + `células-não-zero=${metrics.output.nonZeroCells} `
    + `payload=${payloadMb.toFixed(2)}MB`,
  );
}

test("cenários sintéticos versionados medem carga, isolamento e crescimento de memória", { timeout: 300_000 }, () => {
  const half = runScenario("half");
  const full = runScenario("full");
  const extreme = runScenario("extreme");

  report(half);
  report(full);
  report(extreme);

  assert.deepEqual(
    {
      activities: full.counts.activities,
      progressMeasurements: full.counts.progressMeasurements,
      payables: full.counts.payables,
    },
    {
      activities: 10_000,
      progressMeasurements: 100_000,
      payables: 50_000,
    },
  );
  assert.equal(full.counts.latestProgressMeasurements, 10_000);
  assert.equal(full.output.months, 240);
  assert.equal(full.output.cells, full.counts.services * full.output.months);
  assert.equal(full.output.budget, full.expected.budget);
  assert.equal(full.output.projectedCost, full.expected.budget);

  assert.equal(full.counts.sourceCompanies, full.expected.sourceCompanies);
  assert.ok(full.counts.sourceCompanies > 1);
  assert.equal(full.isolation.foreignRowsInSelection, 0);
  assert.equal(full.isolation.foreignServicesInResult, 0);

  assert.ok(extreme.output.months <= 241, `janela extrema inesperada: ${extreme.output.months}`);
  assert.ok(extreme.output.warnings.includes("schedule_horizon_clamped"));
  assert.equal(extreme.output.budget, extreme.expected.budget);
  assert.equal(extreme.output.projectedCost, extreme.expected.budget);

  const memoryGrowthRatio = full.memory.peakGrowthBytes / Math.max(half.memory.peakGrowthBytes, 1);
  assert.ok(
    memoryGrowthRatio < 3.5,
    `crescimento de memória aparenta superlinear: ${memoryGrowthRatio.toFixed(2)}x ao dobrar a carga`,
  );
  assert.ok(full.memory.peakGrowthBytes < 1024 * 1024 * 1024, "cenário sintético excedeu 1 GB de heap");

  console.log(`[performance:growth] heap-full/heap-half=${memoryGrowthRatio.toFixed(2)}x`);
});
