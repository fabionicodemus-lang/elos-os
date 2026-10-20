import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDevelopmentCostSummary } from "../../lib/development-costs/summary.mjs";
import { calculateDevelopmentResult } from "../../lib/commercial/development-result.mjs";

const centers = [
  { id: "inc01", code: "INC.01", description: "Terreno", development_cost_category: "land" },
  { id: "inc02", code: "INC.02", description: "Outorga", development_cost_category: "onerous_grant" },
  { id: "inc04", code: "INC.04", description: "Comissões", development_cost_category: "commission" },
  { id: "inc06", code: "INC.06", description: "Impostos", development_cost_category: "taxes" },
];

test("centros somam pago e aberto por centro e ignoram títulos cancelados e serviços de obra", () => {
  const summary = buildDevelopmentCostSummary({
    centers,
    budgets: [
      { service_id: "inc01", budget_amount: 1_000, source: "feasibility" },
      { service_id: "inc02", budget_amount: 500, source: "feasibility" },
    ],
    allocations: [
      { payable_id: "p1", service_id: "inc01", allocation_amount: 600 },
      { payable_id: "p2", service_id: "inc01", allocation_amount: 350 },
      { payable_id: "p3", service_id: "inc02", allocation_amount: 700 },
      { payable_id: "p4", service_id: "inc02", allocation_amount: 999 },
      { payable_id: "p5", service_id: "obra", allocation_amount: 5_000 },
    ],
    payables: [
      { id: "p1", status: "paid", amount: 600, paid_amount: 660 },
      { id: "p2", status: "open", amount: 350 },
      { id: "p3", status: "paid", amount: 700, paid_amount: 700 },
      { id: "p4", status: "cancelled", amount: 999 },
      { id: "p5", status: "paid", amount: 5_000, paid_amount: 5_000 },
    ],
  });

  const land = summary.rows.find((row) => row.code === "INC.01");
  const grant = summary.rows.find((row) => row.code === "INC.02");
  assert.equal(land.paid, 660);
  assert.equal(land.open, 350);
  assert.equal(land.appropriated, 1_010);
  assert.equal(land.status, "over");
  assert.equal(grant.appropriated, 700);
  assert.equal(grant.status, "over");
  assert.equal(grant.titleCount, 1);
  assert.equal(summary.totals.budget, 1_500);
  assert.equal(summary.rows.length, 4);
});

const baselineMetrics = {
  available_vgv: 10_000_000, available_units: 10, total_cost: 7_000_000,
  construction_cost: 4_000_000, contingency_cost: 0, commission_cost: 500_000, tax_cost: 400_000,
  profit: 3_000_000, margin_pct: 30,
};
const baselineStudy = { commission_pct: 5, tax_rate_pct: 4 };
const units = Array.from({ length: 10 }, () => ({ status: "available", list_price: 1_000_000 }));
const forecast = (unallocated) => ({ services: [
  { id: "obra", budgetAmount: 4_000_000, actual: 1_000_000, committed: 0, toCommit: 3_000_000, projectedCost: 4_000_000 },
  { id: "__unallocated__", budgetAmount: 0, actual: unallocated, committed: 0, toCommit: 0, projectedCost: unallocated },
] });

// Demais custos do baseline = 7.000.000 − 4.000.000 − 500.000 − 400.000 = 2.100.000
const rows = [
  { category: "land", budget: 1_500_000, appropriated: 1_600_000, status: "over" },
  { category: "onerous_grant", budget: 600_000, appropriated: 100_000, status: "ok" },
  { category: "commission", budget: 500_000, appropriated: 650_000, status: "over", rateBased: true },
  { category: "taxes", budget: 400_000, appropriated: 50_000, status: "ok", rateBased: true },
];

test("resultado usa orçado ou apropriado de cada centro e comissão nunca abaixo do apropriado", () => {
  const result = calculateDevelopmentResult({ baselineMetrics, baselineStudy, units, forecast: forecast(0), developmentCosts: { rows }, today: "2026-10-19" });
  // terreno estourou (1,6 mi) + outorga pelo orçado (600 mil)
  assert.equal(result.cost.developmentCentersProjected, 2_200_000);
  assert.equal(result.cost.baselineOtherRemainder, 0);
  assert.equal(result.cost.projectedOtherCost, 2_200_000);
  // taxa: 5% de 10 mi = 500 mil < 650 mil apropriados
  assert.equal(result.cost.projectedCommission, 650_000);
  assert.equal(result.cost.projectedTaxes, 400_000);
  assert.equal(result.cost.projectedTotalCost, 4_000_000 + 2_200_000 + 650_000 + 400_000);
  assert.ok(result.warnings.some((warning) => warning.includes("acima do orçado")));
});

test("custos sem centro consomem primeiro o saldo dos centros antes de aumentar o custo", () => {
  // saldo não apropriado dos centros: 2.200.000 − 1.700.000 = 500.000
  const covered = calculateDevelopmentResult({ baselineMetrics, baselineStudy, units, forecast: forecast(400_000), developmentCosts: { rows }, today: "2026-10-19" });
  assert.equal(covered.cost.projectedOtherCost, 2_200_000);
  assert.equal(covered.cost.unallocatedExcess, 0);

  const excess = calculateDevelopmentResult({ baselineMetrics, baselineStudy, units, forecast: forecast(800_000), developmentCosts: { rows }, today: "2026-10-19" });
  assert.equal(excess.cost.projectedOtherCost, 2_500_000);
  assert.equal(excess.cost.unallocatedExcess, 300_000);
});

test("sem centros gerados mantém o bloco único do baseline", () => {
  const result = calculateDevelopmentResult({ baselineMetrics, baselineStudy, units, forecast: forecast(0), today: "2026-10-19" });
  assert.equal(result.cost.projectedOtherCost, 2_100_000);
  assert.equal(result.cost.projectedCommission, 500_000);
  assert.ok(result.warnings.some((warning) => warning.includes("ainda não gerados")));
});

test("distratos têm grupo próprio: entram pelo apropriado, fora dos demais custos", () => {
  const withCancellations = [...rows, { category: "cancellations", budget: 0, appropriated: 208_000, status: "no_budget" }];
  const result = calculateDevelopmentResult({ baselineMetrics, baselineStudy, units, forecast: forecast(0), developmentCosts: { rows: withCancellations }, today: "2026-10-19" });
  assert.equal(result.cost.projectedCancellations, 208_000);
  assert.equal(result.cost.projectedOtherCost, 2_200_000);
  assert.equal(result.cost.projectedTotalCost, 4_000_000 + 2_200_000 + 208_000 + 650_000 + 400_000);
  assert.ok(!result.warnings.some((warning) => warning.includes("INC.09")));
});
