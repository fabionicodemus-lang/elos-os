import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeCommercialScenario, analyzeDevelopmentResult, effectiveAnnualDiscount,
  expandCommercialPayments, isCommercialIsoDate,
} from "./commercial-analysis.mjs";

const payment = (overrides = {}) => ({ installment_count: 1, first_due_date: "2027-01-01", interval_months: 0, amount_per_installment: 1_100, ...overrides });
const scenario = (overrides = {}) => analyzeCommercialScenario({ label: "Proposta", nominalAmount: 1_100, paymentItems: [payment()], discountAnnualPct: 10, valuationDate: "2026-01-01", ...overrides });

test("VP desconta valores pelo prazo efetivo e preserva a entrada na data-base", () => {
  const result = scenario({ nominalAmount: 1_500, paymentItems: [payment({ amount_per_installment: 400, first_due_date: "2026-01-01" }), payment()] });
  assert.equal(result.nominal, 1_500);
  assert.equal(result.presentValue, 1_400);
  assert.equal(result.marginPct, null);
  assert.deepEqual(result.warnings, []);
});

test("taxa mensal é convertida por composição e não por multiplicação simples", () => {
  const annual = effectiveAnnualDiscount(1, "mensal");
  assert.ok(Math.abs(annual - 12.682503013196978) < 1e-10);
  assert.equal(scenario({ discountAnnualPct: annual }).presentValue, 976.19);
  assert.equal(effectiveAnnualDiscount(null, null), null);
  assert.throws(() => effectiveAnnualDiscount(null, "anual"), /Informe a taxa/);
  assert.throws(() => effectiveAnnualDiscount(10, null), /Informe a taxa/);
  assert.throws(() => effectiveAnnualDiscount(-1, "anual"), /não negativa/);
});

test("não presume SELIC, taxa zero, data-base ou plano à vista", () => {
  for (const missing of [{ discountAnnualPct: null }, { valuationDate: null }, { paymentItems: [] }]) {
    const result = scenario(missing);
    assert.equal(result.presentValue, null);
    assert.equal(result.nominal, 1_100);
    assert.ok(result.warnings.length > 0);
  }
  assert.equal(scenario({ discountAnnualPct: 0 }).presentValue, 1_100);
});

test("as parcelas devem fechar todo o preço; não desconta somente a entrada", () => {
  const result = scenario({ paymentItems: [payment({ amount_per_installment: 400 })] });
  assert.equal(result.presentValue, null);
  assert.equal(result.planned, 400);
  assert.match(result.warnings.join(" "), /não fecham/);
  assert.equal(scenario({ nominalAmount: null }).nominal, 1_100);
});

test("parcelas com correção/juros indefinidos ou vencimentos passados não geram VP", () => {
  for (const item of [payment({ adjustment_index: "INCC" }), payment({ interest_rate_monthly: 1 }), payment({ first_due_date: "2025-12-01" })]) {
    const result = scenario({ paymentItems: [item] });
    assert.equal(result.presentValue, null);
    assert.ok(result.warnings.some((warning) => /correção|anteriores/.test(warning)));
  }
});

test("meses de calendário preservam o dia original em fevereiro e anos bissextos", () => {
  const payments = expandCommercialPayments([payment({ installment_count: 3, first_due_date: "2026-01-31", interval_months: 1 })]);
  assert.deepEqual(payments.map((item) => item.date), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  assert.equal(isCommercialIsoDate("2024-02-29"), true);
  assert.equal(isCommercialIsoDate("2026-02-29"), false);
  assert.throws(() => expandCommercialPayments([payment({ first_due_date: "2026-02-31" })]), /vencimento válido/);
  assert.throws(() => expandCommercialPayments([payment({ installment_count: 2, total_amount: 1_100 })]), /diverge/);
});

const baselineMetrics = {
  available_vgv: 1_000, available_units: 2, total_cost: 700, construction_cost: 400,
  contingency_cost: 20, commission_cost: 50, tax_cost: 40, profit: 300, margin_pct: 30,
};
const developmentInput = {
  baselineMetrics, baselineStudy: { commission_pct: 5, tax_rate_pct: 4 },
  units: [{ status: "available", list_price: 500 }, { status: "available", list_price: 500 }],
  forecast: { services: [
    { id: "obra", budgetAmount: 420, projectedCost: 430, actual: 100, committed: 100, toCommit: 230 },
    { id: "__unallocated__", budgetAmount: 0, projectedCost: 80, actual: 80, committed: 0, toCommit: 0 },
  ] },
  developmentCosts: { rows: [
    { code: "TER", category: "land", budget: 150, appropriated: 160, status: "over", rateBased: false },
    { code: "DIS", category: "cancellations", budget: 0, appropriated: 10, status: "ok", rateBased: false },
  ] },
};

test("lucro reconcilia com receita menos componentes oficiais, incluindo distratos e excesso sem classificação", () => {
  const analysis = analyzeDevelopmentResult({ input: developmentInput, baselineApproved: true });
  assert.equal(analysis.projecao_disponivel, true);
  assert.equal(analysis.baseline_disponivel, true);
  const result = analysis.resultado;
  assert.equal(result.cost.projectedOtherCost, 240);
  assert.equal(result.cost.projectedCancellations, 10);
  assert.equal(result.result.projectedProfit, 230);
  const costs = result.cost.engineeringProjected + result.cost.projectedCommission + result.cost.projectedTaxes + result.cost.projectedOtherCost + result.cost.projectedCancellations;
  assert.equal(costs, result.cost.projectedTotalCost);
  assert.equal(result.commercial.projectedVgv - costs, result.result.projectedProfit);
  assert.equal(result.result.projectedMarginPct, 23);
  assert.ok(analysis.avisos.some((warning) => /sem serviço\/centro/.test(warning)));
});

test("baseline completo sem forecast mantém a referência e seu aviso, sem inventar decomposição", () => {
  const analysis = analyzeDevelopmentResult({ input: { baselineMetrics, units: developmentInput.units }, baselineApproved: true });
  assert.equal(analysis.resultado.result.projectedProfit, 300);
  assert.match(analysis.avisos.join(" "), /Sem previsão financeira atual/);
});

test("custos/taxas ausentes, aprovação ausente ou leitura parcial não viram lucro de 100%", () => {
  const { tax_cost: _tax, ...noTax } = baselineMetrics;
  for (const input of [
    { input: { ...developmentInput, baselineMetrics: noTax }, baselineApproved: true },
    { input: developmentInput, baselineApproved: false },
    { input: developmentInput, baselineApproved: true, sourceErrors: ["Falha na fonte"] },
    { input: { units: developmentInput.units }, baselineApproved: false },
  ]) {
    const result = analyzeDevelopmentResult(input);
    assert.equal(result.projecao_disponivel, false);
    assert.equal(result.resultado, null);
    assert.ok(result.avisos.length > 0);
  }
});

test("comparação de baseline precisa do lucro e da margem originais, ainda que custos permitam a projeção", () => {
  const { profit: _profit, margin_pct: _margin, ...withoutComparison } = baselineMetrics;
  const result = analyzeDevelopmentResult({ input: { ...developmentInput, baselineMetrics: withoutComparison }, baselineApproved: true });
  assert.equal(result.projecao_disponivel, true);
  assert.equal(result.baseline_disponivel, false);
});

test("baseline inconsistente ou sem base para taxas não produz projeção otimista", () => {
  const noVgv = { ...baselineMetrics, available_vgv: null };
  const missingRates = analyzeDevelopmentResult({ input: { ...developmentInput, baselineMetrics: noVgv, baselineStudy: {} }, baselineApproved: true });
  assert.equal(missingRates.resultado, null);
  assert.match(missingRates.avisos.join(" "), /taxas zero/);
  const inconsistent = analyzeDevelopmentResult({ input: { ...developmentInput, baselineMetrics: { ...baselineMetrics, total_cost: 100 } }, baselineApproved: true });
  assert.equal(inconsistent.resultado, null);
  assert.match(inconsistent.avisos.join(" "), /excedem o seu custo total/);
});
