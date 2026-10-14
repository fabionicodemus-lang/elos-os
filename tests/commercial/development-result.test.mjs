import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateDevelopmentResult } from "../../lib/commercial/development-result.mjs";

const baselineMetrics = {
  available_vgv: 21_000_000,
  available_units: 30,
  total_cost: 12_912_000,
  construction_cost: 7_600_000,
  contingency_cost: 380_000,
  commission_cost: 1_260_000,
  tax_cost: 840_000,
  profit: 8_088_000,
  margin_pct: 38.5142857143,
};

const baselineStudy = { commission_pct: 6, tax_rate_pct: 4 };

const forecast = {
  services: [
    { id: "estrutura", budgetAmount: 4_000_000, actual: 1_500_000, committed: 1_000_000, toCommit: 1_800_000, projectedCost: 4_300_000 },
    { id: "acabamentos", budgetAmount: 3_980_000, actual: 600_000, committed: 800_000, toCommit: 2_700_000, projectedCost: 4_100_000 },
    { id: "__unallocated__", budgetAmount: 0, actual: 100_000, committed: 50_000, toCommit: 0, projectedCost: 150_000 },
  ],
};

test("resultado compara baseline com VGV atual e custo projetado", () => {
  const result = calculateDevelopmentResult({
    baselineMetrics,
    baselineStudy,
    project: { total_units: 36 },
    sales: [
      { status: "active", unit_id: "u1", total_amount: 800_000, commission_pct: 6, commission_amount: 48_000 },
      { status: "active", unit_id: "u2", total_amount: 900_000, commission_pct: 6, commission_amount: 54_000 },
      { status: "cancelled", unit_id: "u3", total_amount: 950_000, commission_pct: 6, commission_amount: 57_000 },
    ],
    units: [
      { status: "sold", list_price: 800_000 },
      { status: "sold", list_price: 900_000 },
      ...Array.from({ length: 28 }, () => ({ status: "available", list_price: 750_000 })),
    ],
    receivables: [
      { status: "paid", paid_amount: 500_000, amount: 500_000, due_date: "2026-01-10" },
      { status: "open", adjusted_amount: 600_000, amount: 590_000, due_date: "2026-09-10" },
    ],
    payables: [
      { status: "paid", paid_amount: 2_000_000, amount: 2_000_000 },
      { status: "open", amount: 1_000_000 },
    ],
    forecast,
    today: "2026-10-14",
  });

  assert.equal(result.commercial.soldVgv, 1_700_000);
  assert.equal(result.commercial.inventoryVgv, 21_000_000);
  assert.equal(result.commercial.projectedVgv, 22_700_000);
  assert.equal(result.cash.received, 500_000);
  assert.equal(result.cash.overdue, 600_000);
  assert.equal(result.cost.engineeringProjected, 8_400_000);
  assert.equal(result.cost.unallocatedProjected, 150_000);
  assert.equal(result.cost.projectedOtherCost, 2_832_000);
  assert.equal(result.result.projectedProfit, 9_198_000);
  assert.ok(result.result.projectedMarginPct > 40 && result.result.projectedMarginPct < 41);
  assert.equal(result.result.profitDeviation, 1_110_000);
  assert.equal(result.result.health, "above");
  assert.ok(result.warnings.some((warning) => warning.includes("sem serviço/centro")));
});

test("sem previsão atual usa custo do baseline e estima estoque faltante", () => {
  const result = calculateDevelopmentResult({
    baselineMetrics,
    baselineStudy,
    project: { total_units: 36 },
    sales: [{ status: "active", unit_id: "u1", total_amount: 700_000, commission_pct: 6 }],
    units: [],
    receivables: [],
    payables: [],
    forecast: null,
    today: "2026-10-14",
  });

  assert.equal(result.commercial.soldUnits, 1);
  assert.equal(result.commercial.availableUnits, 29);
  assert.equal(result.commercial.projectedVgv, 21_000_000);
  assert.equal(result.cost.engineeringProjected, 7_980_000);
  assert.equal(result.result.projectedProfit, baselineMetrics.profit);
  assert.ok(result.warnings.some((warning) => warning.includes("Sem previsão financeira atual")));
});

test("estoque disponível acima do baseline não volta a contar permutas ou unidades extras", () => {
  const result = calculateDevelopmentResult({
    baselineMetrics,
    baselineStudy,
    sales: [
      { status: "active", unit_id: "u1", total_amount: 800_000 },
      { status: "active", unit_id: "u2", total_amount: 900_000 },
    ],
    units: Array.from({ length: 34 }, () => ({ status: "available", list_price: 750_000 })),
    forecast: null,
    today: "2026-10-14",
  });

  assert.equal(result.commercial.availableUnits, 28);
  assert.equal(result.commercial.inventoryVgv, 21_000_000);
  assert.equal(result.commercial.projectedVgv, 22_700_000);
  assert.ok(result.warnings.some((warning) => warning.includes("além do estoque comercializável")));
});

test("recebíveis vencidos e caixa realizado ficam separados do lucro projetado", () => {
  const result = calculateDevelopmentResult({
    baselineMetrics,
    baselineStudy,
    sales: [], units: [], forecast: null,
    receivables: [
      { status: "open", amount: 100_000, due_date: "2026-10-01" },
      { status: "open", amount: 200_000, due_date: "2026-11-01" },
      { status: "paid", amount: 300_000, paid_amount: 310_000, due_date: "2026-08-01" },
    ],
    payables: [
      { status: "paid", amount: 250_000, paid_amount: 250_000 },
      { status: "open", amount: 400_000 },
    ],
    today: "2026-10-14",
  });
  assert.equal(result.cash.overdue, 100_000);
  assert.equal(result.cash.receivableOpen, 300_000);
  assert.equal(result.cash.received, 310_000);
  assert.equal(result.cash.paidOut, 250_000);
  assert.equal(result.cash.cashBalance, 60_000);
  assert.equal(result.cash.payableOpen, 400_000);
});
