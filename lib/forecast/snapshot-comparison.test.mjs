import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProjectionEvolution,
  compareSnapshots,
  compareSnapshotToActual,
  summarizeSnapshotRows,
} from "./snapshot-comparison.mjs";

const baseRows = [
  { service_key: "s1", service_code: "01", service_name: "Estrutura", service_budget_amount: 1000, month: "2026-03-01", layer: "actual", amount: 100 },
  { service_key: "s1", service_code: "01", service_name: "Estrutura", service_budget_amount: 1000, month: "2026-03-01", layer: "committed", amount: 300 },
  { service_key: "s1", service_code: "01", service_name: "Estrutura", service_budget_amount: 1000, month: "2026-04-01", layer: "to_commit", amount: 600 },
];

test("resume as três camadas sem multiplicar o orçamento repetido nas linhas", () => {
  const [summary] = summarizeSnapshotRows(baseRows);
  assert.equal(summary.budget, 1000);
  assert.equal(summary.actual, 100);
  assert.equal(summary.committed, 300);
  assert.equal(summary.toCommit, 600);
  assert.equal(summary.projected, 1000);
  assert.equal(summary.deviation, 0);
});

test("comparação entre snapshots mostra a migração exata entre camadas", () => {
  const later = [
    { ...baseRows[0], amount: 250 },
    { ...baseRows[1], amount: 450 },
    { ...baseRows[2], amount: 300 },
  ];
  const [comparison] = compareSnapshots(baseRows, later);
  assert.equal(comparison.delta.actual, 150);
  assert.equal(comparison.delta.committed, 150);
  assert.equal(comparison.delta.toCommit, -300);
  assert.equal(comparison.delta.projected, 0);
});

test("snapshot permanece representado pelos valores congelados após mudança da fonte operacional", () => {
  const frozen = summarizeSnapshotRows(baseRows);
  const changedOperationalRows = baseRows.map((row) => ({ ...row, amount: Number(row.amount) * 2 }));
  const recalculated = summarizeSnapshotRows(changedOperationalRows);
  assert.equal(frozen[0].projected, 1000);
  assert.equal(recalculated[0].projected, 2000);
  assert.equal(frozen[0].projected, 1000);
});

test("compara previsão mensal congelada com realizado atual e calcula o desvio", () => {
  const comparison = compareSnapshotToActual(baseRows, [
    { key: "2026-03", actual: 500 },
    { key: "2026-04", actual: 450 },
  ], "2026-05");
  assert.deepEqual(comparison.map((row) => row.month), ["2026-03", "2026-04"]);
  assert.equal(comparison[0].predicted, 400);
  assert.equal(comparison[0].deviation, 100);
  assert.equal(comparison[0].deviationPercent, 25);
  assert.equal(comparison[0].closed, true);
});

test("percentual fica nulo quando não havia previsão no mês", () => {
  const [row] = compareSnapshotToActual([], [{ key: "2026-02", actual: 200 }], "2026-03");
  assert.equal(row.predicted, 0);
  assert.equal(row.deviation, 200);
  assert.equal(row.deviationPercent, null);
});

test("evolução é ordenada pela data real do congelamento", () => {
  const evolution = buildProjectionEvolution([
    { id: "b", captured_at: "2026-04-01T10:00:00Z", reference_month: "2026-04-01", budget_total: 1000, projected_cost_total: 1100, deviation_total: 100 },
    { id: "a", captured_at: "2026-03-01T10:00:00Z", reference_month: "2026-03-01", budget_total: 1000, projected_cost_total: 1000, deviation_total: 0 },
  ]);
  assert.deepEqual(evolution.map((item) => item.id), ["a", "b"]);
  assert.equal(evolution[1].projected, 1100);
});
