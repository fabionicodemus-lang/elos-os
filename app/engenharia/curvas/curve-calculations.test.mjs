import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCurves, detectIntegrityAlerts } from "./curve-calculations.mjs";

function activity(overrides) {
  return {
    id: overrides.id,
    service_id: overrides.service_id ?? "service-a",
    code: overrides.code ?? overrides.id.toUpperCase(),
    name: overrides.name ?? overrides.id,
    quantity_snapshot: overrides.quantity_snapshot ?? 1,
    planned_start: overrides.planned_start ?? "2026-01-05",
    planned_finish: overrides.planned_finish ?? overrides.planned_start ?? "2026-01-05",
    planned_cost: overrides.planned_cost ?? 0,
  };
}

function budgetItem(overrides) {
  return {
    id: overrides.id,
    service_id: overrides.service_id === undefined ? "service-a" : overrides.service_id,
    code: overrides.code ?? overrides.id.toUpperCase(),
    description: overrides.description ?? overrides.id,
    total_direct_cost: overrides.total_direct_cost ?? 0,
    status: overrides.status ?? "active",
  };
}

const services = [
  { id: "service-a", code: "01", description: "Serviço A" },
  { id: "service-b", code: "02", description: "Serviço B" },
];

test("pondera a curva física pelo custo atribuído", () => {
  const activities = [
    activity({ id: "jan", planned_start: "2026-01-05", planned_finish: "2026-01-05" }),
    activity({ id: "feb", planned_start: "2026-02-02", planned_finish: "2026-02-02" }),
  ];
  const result = buildCurves(activities, new Map([["jan", 100], ["feb", 300]]), 400, false);

  assert.equal(result.usesEqualPhysicalWeights, false);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].physicalMonth, 25);
  assert.equal(result.rows[0].physicalAccumulated, 25);
  assert.equal(result.rows[1].physicalMonth, 75);
  assert.equal(result.rows[1].physicalAccumulated, 100);
});

test("usa pesos físicos iguais quando todas as atividades estão sem custo", () => {
  const activities = [
    activity({ id: "jan", planned_start: "2026-01-05", planned_finish: "2026-01-05" }),
    activity({ id: "feb", planned_start: "2026-02-02", planned_finish: "2026-02-02" }),
  ];
  const result = buildCurves(activities, new Map([["jan", 0], ["feb", 0]]), 0, false);

  assert.equal(result.usesEqualPhysicalWeights, true);
  assert.equal(result.rows[0].physicalMonth, 50);
  assert.equal(result.rows[1].physicalMonth, 50);
  assert.equal(result.rows[1].physicalAccumulated, 100);
});

test("distribui uma atividade em três meses usando dias úteis sem sábado", () => {
  const activities = [activity({
    id: "three-months",
    planned_start: "2026-01-30",
    planned_finish: "2026-03-02",
  })];
  const result = buildCurves(activities, new Map([["three-months", 2200]]), 2200, false);

  assert.deepEqual(result.rows.map((row) => Math.round(row.financialMonth)), [100, 2000, 100]);
  assert.deepEqual(result.rows.map((row) => Math.round(row.physicalMonth)), [5, 91, 5]);
});

test("distribui uma atividade em três meses contando sábado quando habilitado", () => {
  const activities = [activity({
    id: "three-months",
    planned_start: "2026-01-30",
    planned_finish: "2026-03-02",
  })];
  const result = buildCurves(activities, new Map([["three-months", 2700]]), 2700, true);

  assert.deepEqual(result.rows.map((row) => Math.round(row.financialMonth)), [200, 2400, 100]);
  assert.deepEqual(result.rows.map((row) => Math.round(row.physicalMonth)), [7, 89, 4]);
});

test("aloca no mês inicial e avisa quando a atividade não possui dia útil", () => {
  const activities = [activity({
    id: "sunday",
    planned_start: "2026-02-01",
    planned_finish: "2026-02-01",
  })];
  const result = buildCurves(activities, new Map([["sunday", 500]]), 500, false);

  assert.deepEqual(result.zeroWorkdayActivityIds, ["sunday"]);
  assert.equal(result.rows[0].financialMonth, 500);
  assert.equal(result.rows[0].physicalMonth, 100);
});

test("detecta serviço do orçamento sem atividade", () => {
  const alerts = detectIntegrityAlerts([], [budgetItem({ id: "item-a", total_direct_cost: 100 })], services);

  assert.equal(alerts.servicesWithoutActivities.length, 1);
  assert.equal(alerts.servicesWithoutActivities[0].serviceLabel, "01 · Serviço A");
  assert.equal(alerts.servicesWithoutActivities[0].budgetValue, 100);
});

test("detecta custo explícito programado acima do orçamento do serviço", () => {
  const alerts = detectIntegrityAlerts(
    [activity({ id: "a1", planned_cost: 60 }), activity({ id: "a2", planned_cost: 50 })],
    [budgetItem({ id: "item-a", total_direct_cost: 100 })],
    services,
  );

  assert.equal(alerts.overprogrammedServices.length, 1);
  assert.equal(alerts.overprogrammedServices[0].programmedValue, 110);
  assert.equal(alerts.overprogrammedServices[0].excessValue, 10);
});

test("detecta atividade vinculada a serviço ausente na revisão", () => {
  const alerts = detectIntegrityAlerts(
    [activity({ id: "activity-b", service_id: "service-b" })],
    [budgetItem({ id: "item-a", service_id: "service-a", total_direct_cost: 100 })],
    services,
  );

  assert.equal(alerts.activitiesWithoutBudgetService.length, 1);
  assert.equal(alerts.activitiesWithoutBudgetService[0].serviceLabel, "02 · Serviço B");
});

test("detecta item ativo do orçamento sem serviço vinculado", () => {
  const alerts = detectIntegrityAlerts(
    [],
    [budgetItem({ id: "loose", service_id: null, code: "99", description: "Reserva", total_direct_cost: 300 })],
    services,
  );

  assert.equal(alerts.budgetItemsWithoutService.length, 1);
  assert.equal(alerts.budgetItemsWithoutService[0].itemLabel, "99 · Reserva");
  assert.equal(alerts.budgetItemsWithoutService[0].budgetValue, 300);
});
