import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCurves, buildLiveCurves, detectIntegrityAlerts } from "./curve-calculations.mjs";

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

function measurement(overrides) {
  return {
    id: overrides.id ?? `${overrides.activity_id}-${overrides.measurement_date}`,
    activity_id: overrides.activity_id,
    measurement_date: overrides.measurement_date,
    progress_percent: overrides.progress_percent ?? 0,
    actual_cost: overrides.actual_cost ?? 0,
    current_start: overrides.current_start ?? "2026-01-05",
    current_finish: overrides.current_finish ?? "2026-01-30",
    actual_start: overrides.actual_start ?? null,
    actual_finish: overrides.actual_finish ?? null,
    created_at: overrides.created_at ?? `${overrides.measurement_date}T12:00:00Z`,
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
  const activities = [activity({ id: "three-months", planned_start: "2026-01-30", planned_finish: "2026-03-02" })];
  const result = buildCurves(activities, new Map([["three-months", 2200]]), 2200, false);

  assert.deepEqual(result.rows.map((row) => Math.round(row.financialMonth)), [100, 2000, 100]);
  assert.deepEqual(result.rows.map((row) => Math.round(row.physicalMonth)), [5, 91, 5]);
});

test("distribui uma atividade em três meses contando sábado quando habilitado", () => {
  const activities = [activity({ id: "three-months", planned_start: "2026-01-30", planned_finish: "2026-03-02" })];
  const result = buildCurves(activities, new Map([["three-months", 2700]]), 2700, true);

  assert.deepEqual(result.rows.map((row) => Math.round(row.financialMonth)), [200, 2400, 100]);
  assert.deepEqual(result.rows.map((row) => Math.round(row.physicalMonth)), [7, 89, 4]);
});

test("aloca no mês inicial e avisa quando a atividade não possui dia útil", () => {
  const activities = [activity({ id: "sunday", planned_start: "2026-02-01", planned_finish: "2026-02-01" })];
  const result = buildCurves(activities, new Map([["sunday", 500]]), 500, false);

  assert.deepEqual(result.zeroWorkdayActivityIds, ["sunday"]);
  assert.equal(result.rows[0].financialMonth, 500);
  assert.equal(result.rows[0].physicalMonth, 100);
});

test("atividade atrasada desloca o custo futuro para frente sem alterar a baseline", () => {
  const activities = [activity({ id: "late", planned_start: "2026-01-05", planned_finish: "2026-01-30" })];
  const assigned = new Map([["late", 1000]]);
  const result = buildLiveCurves(activities, assigned, 1000, false, [measurement({
    activity_id: "late",
    measurement_date: "2026-01-30",
    progress_percent: 0,
    current_start: "2026-02-02",
    current_finish: "2026-02-27",
  })], "2026-02-02");

  const jan = result.rows.find((row) => row.key === "2026-01");
  const feb = result.rows.find((row) => row.key === "2026-02");
  assert.equal(Math.round(jan.financialMonth), 1000);
  assert.equal(Math.round(jan.currentFinancialMonth), 0);
  assert.equal(Math.round(feb.currentFinancialMonth), 1000);
});

test("atividade concluída não mantém saldo em meses futuros", () => {
  const activities = [activity({ id: "done", planned_start: "2026-01-05", planned_finish: "2026-03-31" })];
  const result = buildLiveCurves(activities, new Map([["done", 1000]]), 1000, false, [measurement({
    activity_id: "done",
    measurement_date: "2026-02-10",
    progress_percent: 100,
    actual_cost: 1200,
    current_finish: "2026-02-10",
    actual_finish: "2026-02-10",
  })], "2026-02-15");

  const march = result.rows.find((row) => row.key === "2026-03");
  assert.equal(Math.round(march.currentFinancialMonth), 0);
  assert.equal(Math.round(result.rows.at(-1).currentFinancialAccumulated), 1200);
});

test("atividade 40% executada mantém realizado e distribui 60% do orçamento no futuro", () => {
  const activities = [activity({ id: "progress", planned_start: "2026-01-05", planned_finish: "2026-04-30" })];
  const result = buildLiveCurves(activities, new Map([["progress", 1000]]), 1000, false, [measurement({
    activity_id: "progress",
    measurement_date: "2026-02-28",
    progress_percent: 40,
    actual_cost: 700,
    current_start: "2026-01-05",
    current_finish: "2026-04-30",
  })], "2026-03-02");

  const feb = result.rows.find((row) => row.key === "2026-02");
  const future = result.rows.filter((row) => row.key >= "2026-03").reduce((sum, row) => sum + row.currentFinancialMonth, 0);
  assert.equal(Math.round(feb.actualFinancialMonth), 700);
  assert.equal(Math.round(future), 600);
  assert.equal(Math.round(result.rows.at(-1).currentFinancialAccumulated), 1300);
});

test("obra sem medições reproduz exatamente as linhas da fase 1", () => {
  const activities = [activity({ id: "same", planned_start: "2026-01-05", planned_finish: "2026-02-27" })];
  const assigned = new Map([["same", 1000]]);
  const baseline = buildCurves(activities, assigned, 1000, false);
  const live = buildLiveCurves(activities, assigned, 1000, false, [], "2026-02-10");

  assert.equal(live.hasExecutionData, false);
  assert.deepEqual(live.rows, baseline.rows);
});

test("avisa quando o custo real acumulado começa a ser informado tardiamente", () => {
  const activities = [activity({ id: "late-cost", planned_start: "2026-01-05", planned_finish: "2026-04-30" })];
  const result = buildLiveCurves(activities, new Map([["late-cost", 1000]]), 1000, false, [
    measurement({ activity_id: "late-cost", measurement_date: "2026-01-31", progress_percent: 20, actual_cost: 0 }),
    measurement({ activity_id: "late-cost", measurement_date: "2026-02-28", progress_percent: 40, actual_cost: 500 }),
  ], "2026-03-01");

  assert.deepEqual(result.lateActualCostWarnings, [{ activityId: "late-cost", measurementDate: "2026-02-28" }]);
  const feb = result.rows.find((row) => row.key === "2026-02");
  assert.equal(Math.round(feb.actualFinancialMonth), 300);
  assert.equal(Math.round(feb.actualFinancialAccumulated), 500);
});

test("correções negativas aparecem no mês sem reescrever o passado", () => {
  const activities = [activity({ id: "correction", planned_start: "2026-01-05", planned_finish: "2026-04-30" })];
  const result = buildLiveCurves(activities, new Map([["correction", 1000]]), 1000, false, [
    measurement({ activity_id: "correction", measurement_date: "2026-01-31", progress_percent: 50, actual_cost: 600 }),
    measurement({ activity_id: "correction", measurement_date: "2026-02-28", progress_percent: 40, actual_cost: 550 }),
  ], "2026-03-01");

  const january = result.rows.find((row) => row.key === "2026-01");
  const february = result.rows.find((row) => row.key === "2026-02");
  assert.equal(Math.round(january.actualFinancialMonth), 600);
  assert.equal(Math.round(february.actualFinancialMonth), -50);
  assert.equal(Math.round(february.actualPhysicalMonth), -10);
  assert.equal(Math.round(february.actualFinancialAccumulated), 550);
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
