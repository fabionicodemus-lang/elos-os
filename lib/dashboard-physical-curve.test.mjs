import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDashboardPhysicalMonths,
  calculateDashboardActivityWeights,
} from "./dashboard-physical-curve.mjs";

const activities = [
  {
    id: "a1",
    service_id: "s1",
    quantity_snapshot: 100,
    duration_days: 31,
    planned_start: "2026-08-01",
    planned_finish: "2026-08-31",
    planned_cost: 60_000,
    record_status: "active",
  },
  {
    id: "a2",
    service_id: "s2",
    quantity_snapshot: 100,
    duration_days: 61,
    planned_start: "2026-09-01",
    planned_finish: "2026-10-31",
    planned_cost: 40_000,
    record_status: "active",
  },
];

test("pesos físicos somam 100% e respeitam custo quando não há configuração", () => {
  const weights = calculateDashboardActivityWeights(activities, []);
  const total = [...weights.values()].reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 100) < 0.0001);
  assert.ok(Math.abs(weights.get("a1") - 60) < 0.0001);
  assert.ok(Math.abs(weights.get("a2") - 40) < 0.0001);
});

test("previsto mensal é acumulado, crescente e termina em 100%", () => {
  const rows = buildDashboardPhysicalMonths({
    activities,
    measurements: [],
    serviceWeights: [],
    today: "2026-08-10",
  });

  assert.deepEqual(rows.map((row) => row.key), ["2026-08", "2026-09", "2026-10"]);
  assert.equal(rows[0].current, true);
  assert.ok(rows[0].planned > 59 && rows[0].planned <= 60);
  assert.ok(rows[1].planned > rows[0].planned);
  assert.equal(rows[2].planned, 100);
  assert.deepEqual(rows.map((row) => row.actual), [null, null, null]);
});

test("realizado usa a última medição disponível e não é projetado para meses futuros", () => {
  const rows = buildDashboardPhysicalMonths({
    activities,
    measurements: [
      {
        activity_id: "a1",
        measurement_date: "2026-08-10",
        progress_percent: 50,
        created_at: "2026-08-10T12:00:00Z",
      },
      {
        activity_id: "a1",
        measurement_date: "2026-09-15",
        progress_percent: 100,
        created_at: "2026-09-15T12:00:00Z",
      },
      {
        activity_id: "a2",
        measurement_date: "2026-09-15",
        progress_percent: 25,
        created_at: "2026-09-15T12:01:00Z",
      },
    ],
    serviceWeights: [],
    today: "2026-09-20",
  });

  assert.ok(Math.abs(rows[0].actual - 30) < 0.0001);
  assert.ok(Math.abs(rows[1].actual - 70) < 0.0001);
  assert.equal(rows[2].actual, null);
});

test("pesos explícitos por serviço prevalecem e a sobra é distribuída", () => {
  const weights = calculateDashboardActivityWeights(activities, [
    { service_id: "s1", physical_weight_percent: 70, distribution_method: "cost" },
  ]);
  assert.ok(Math.abs(weights.get("a1") - 70) < 0.0001);
  assert.ok(Math.abs(weights.get("a2") - 30) < 0.0001);
});
