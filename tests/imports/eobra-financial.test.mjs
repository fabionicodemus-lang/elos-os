import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateIndexNumberAmount,
  calculateInstallmentCorrection,
  reconcilePaymentEvents,
  reconcileInstallmentFinancials,
} from "../../lib/eobra-import/financial.mjs";

// All identities, dates and amounts below are synthetic; no customer exports.
const components = {
  interest_amount: "0.00", penalty_amount: "0.00", other_accrual_amount: "0.00", discount_amount: "0.00",
};
const policy = overrides => ({ mode: "index_number", base_month: "2022-03", reference_month: "2022-04", base_value: "100.000000", reference_value: "110.000000", ...overrides });
const installment = overrides => ({
  original_amount: "100.00", current_amount: "110.00", correction_amount: "10.00", paid_amount: "0.00", balance_amount: "110.00",
  status: "open", correction_locked: false, correction: policy(), ...components,
  events: [], events_complete: true, ...overrides,
});
const payment = (id, amount, overrides = {}) => ({ source_id: id, kind: "payment", amount, occurred_on: "2022-04-15", ...overrides });
const reversal = (id, target, amount, overrides = {}) => ({ source_id: id, kind: "reversal", amount, occurred_on: "2022-04-16", reverses_source_id: target, ...overrides });
const has = (result, pattern) => result.errors.some(error => pattern.test(error));

test("razão exata de índices, seis casas e um único arredondamento em centavos", () => {
  assert.deepEqual(calculateIndexNumberAmount({ original_amount: "1234.56", base_value: "2500.000000", reference_value: "2750.000001" }), {
    original_amount: "1234.56", adjusted_principal_amount: "1358.02", correction_amount: "123.46", rounding: "half_up",
  });
  assert.equal(calculateIndexNumberAmount({ original_amount: "0.03", base_value: "0.000003", reference_value: "0.000005" }).adjusted_principal_amount, "0.05");
  // Rounding the ratio to six decimals first would incorrectly yield 1333332.99.
  assert.equal(calculateIndexNumberAmount({ original_amount: "999999.99", base_value: "3", reference_value: "4" }).adjusted_principal_amount, "1333333.32");
});

test("HALF_UP resolve meia unidade de centavo sem float binário", () => {
  assert.equal(calculateIndexNumberAmount({ original_amount: "1.00", base_value: "2.00", reference_value: "2.01" }).adjusted_principal_amount, "1.01");
  assert.equal(calculateIndexNumberAmount({ original_amount: "1.00", base_value: "2.00", reference_value: "1.99" }).adjusted_principal_amount, "1.00");
  assert.equal(calculateIndexNumberAmount({ original_amount: "1.00", base_value: "2.00", reference_value: "1.989999" }).adjusted_principal_amount, "0.99");
});

test("precisão em centavos ultrapassa Number.MAX_SAFE_INTEGER e respeita numeric(16,2)", () => {
  const result = calculateIndexNumberAmount({ original_amount: "99999999999999.99", base_value: "1", reference_value: "1" });
  assert.equal(result.adjusted_principal_amount, "99999999999999.99");
  assert.throws(() => calculateIndexNumberAmount({ original_amount: "99999999999999.99", base_value: "1", reference_value: "2" }), /precisão/);
});

test("decimais inválidos e índices ausentes/zero/negativos nunca viram fallback", () => {
  for (const original_amount of [10.1, "1,00", "1e2", "1.005", "NaN", "", null, " 1.00 "]) {
    assert.throws(() => calculateIndexNumberAmount({ original_amount, base_value: "1", reference_value: "2" }), /original_amount/);
  }
  for (const base_value of [undefined, "0", "-1", "1.0000001", 1]) {
    assert.throws(() => calculateIndexNumberAmount({ original_amount: "1.00", base_value, reference_value: "2" }), /base_value/);
  }
});

test("política por parcela usa base explícita e não herda venda nem carência Flow", () => {
  const result = calculateInstallmentCorrection(installment({ sale_date: "2030-12-31", correction: policy({ reference_month: "2022-03" }) }));
  assert.equal(result.ok, true);
  assert.equal(result.current_amount, "110.00");
  const without = calculateInstallmentCorrection(installment({ correction: { mode: "none" } }));
  assert.equal(without.current_amount, "100.00");
  assert.equal(without.correction_amount, "0.00");
});

test("correção separada de juros, multa, acréscimos e desconto", () => {
  const result = calculateInstallmentCorrection(installment({
    correction: { mode: "none" }, interest_amount: "10.00", penalty_amount: "5.00", other_accrual_amount: "3.00", discount_amount: "7.00",
  }));
  assert.equal(result.ok, true);
  assert.equal(result.current_amount, "111.00");
  assert.equal(result.correction_amount, "0.00");
  assert.equal(result.interest_amount, "10.00");
  assert.equal(calculateInstallmentCorrection(installment({ discount_amount: undefined })).ok, false);
});

test("ausência de configuração não significa sem correção nem autoriza inferir competências", () => {
  assert.ok(has(calculateInstallmentCorrection(installment({ correction: undefined })), /ausência não significa/));
  for (const key of ["base_month", "reference_month", "base_value", "reference_value"]) {
    const result = calculateInstallmentCorrection(installment({ correction: policy({ [key]: undefined }) }));
    assert.equal(result.ok, false, key);
    assert.ok(has(result, new RegExp(key)));
  }
  assert.equal(calculateInstallmentCorrection(installment({ correction: { mode: "none", base_value: "100" } })).ok, false);
  assert.equal(calculateInstallmentCorrection(installment({ correction: { mode: "percentage" } })).ok, false);
});

test("defasagem só é validada quando fornecida; não existe default zero", () => {
  const explicit = policy({ base_month: "2021-02", reference_month: "2023-11", calculation_month: "2023-12", lag_months: 1 });
  assert.equal(calculateInstallmentCorrection(installment({ correction: explicit })).ok, true);
  assert.equal(calculateInstallmentCorrection(installment({ correction: { ...explicit, lag_months: undefined, calculation_month: "2024-02" } })).ok, true);
  assert.equal(calculateInstallmentCorrection(installment({ correction: { ...explicit, lag_months: 0 } })).ok, false);
  assert.equal(calculateInstallmentCorrection(installment({ correction: { ...explicit, calculation_month: undefined } })).ok, false);
  assert.equal(calculateInstallmentCorrection(installment({ correction: { ...explicit, lag_months: -1 } })).ok, false);
});

test("competências inválidas, anteriores à base ou futuras ao cálculo bloqueiam", () => {
  for (const overrides of [{ reference_month: "2022-13" }, { reference_month: "2022-02" }, { calculation_month: "2022-03" }]) {
    assert.equal(calculateInstallmentCorrection(installment({ correction: policy(overrides) })).ok, false);
  }
});

test("variação negativa da razão é preservada sem inventar piso contratual", () => {
  const result = calculateInstallmentCorrection(installment({ correction: policy({ reference_value: "98.500000" }) }));
  assert.equal(result.ok, true);
  assert.equal(result.current_amount, "98.50");
  assert.equal(result.correction_amount, "-1.50");
});

test("máxima do período conserva pico em queda/recuperação e só sobe quando há novo máximo", () => {
  const index_values = [
    { reference_month: "2022-03", value: "100" }, { reference_month: "2022-04", value: "120" },
    { reference_month: "2022-05", value: "110" }, { reference_month: "2022-06", value: "119" },
    { reference_month: "2022-07", value: "125" }, { reference_month: "2022-08", value: "120" },
    { reference_month: "2022-09", value: "999" }, // Must never leak into an earlier reference.
  ];
  for (const [reference_month, reference_value, expected, effectiveMonth] of [
    ["2022-04", "120", "120.00", "2022-04"], ["2022-05", "110", "120.00", "2022-04"],
    ["2022-06", "119", "120.00", "2022-04"], ["2022-07", "125", "125.00", "2022-07"],
    ["2022-08", "120", "125.00", "2022-07"],
  ]) {
    const result = calculateInstallmentCorrection(installment({ correction: policy({ reference_month, reference_value, negative_variation_policy: "maximum_of_period", index_values }) }));
    assert.equal(result.ok, true);
    assert.equal(result.current_amount, expected);
    assert.equal(result.effective_reference_month, effectiveMonth);
    assert.equal(result.effective_reference_value, `${expected.slice(0, -3)}.000000`);
  }
});

test("máxima do período inclui base, exige série completa e rejeita valor declarado divergente", () => {
  const index_values = [{ reference_month: "2022-03", value: "100" }, { reference_month: "2022-04", value: "90" }];
  const correction = policy({ reference_value: "90", negative_variation_policy: "maximum_of_period", index_values });
  const result = calculateInstallmentCorrection(installment({ correction }));
  assert.equal(result.ok, true);
  assert.equal(result.current_amount, "100.00");
  assert.equal(result.effective_reference_month, "2022-03");
  for (const overrides of [
    { index_values: undefined }, { base_value: "101" }, { reference_value: "91" },
    { index_values: [...index_values, index_values[0]] },
    { reference_month: "2022-05", reference_value: "110", index_values: [index_values[0], { reference_month: "2022-05", value: "110" }] },
  ]) {
    const blocked = calculateInstallmentCorrection(installment({ correction: { ...correction, ...overrides } }));
    assert.equal(blocked.ok, false);
    assert.equal(blocked.current_amount, null);
  }
});

test("usar variação negativa é uma política distinta e taxa fixa não vira índice", () => {
  const result = calculateInstallmentCorrection(installment({ correction: policy({ reference_value: "90", negative_variation_policy: "use_negative" }) }));
  assert.equal(result.ok, true);
  assert.equal(result.current_amount, "90.00");
  assert.equal(calculateInstallmentCorrection(installment({ correction: { mode: "fixed_percentage", rate: "0.8" } })).ok, false);
  const historical = calculateInstallmentCorrection(installment({ correction_locked: true, correction: { mode: "fixed_percentage", rate: "0.8" } }));
  assert.equal(historical.ok, true);
  assert.equal(historical.current_amount, "110.00");
  assert.equal(historical.effective_reference_value, null);
});

for (const mode of ["paid", "cancelled", "locked"]) test(`snapshot ${mode} não é recalculado nem depende da série atual`, () => {
  const result = calculateInstallmentCorrection(installment({
    status: mode === "locked" ? "open" : mode, correction_locked: mode === "locked",
    current_amount: "107.23", correction_amount: "7.23", correction: policy({ base_value: "0", reference_month: "inválida" }),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.preserved, true);
  assert.equal(result.current_amount, "107.23");
  assert.equal(result.correction_amount, "7.23");
  assert.equal(result.rounding, null);
  assert.match(result.warnings[0], /não foi aplicada nem validada/);
});

test("snapshot zero permanece zero; snapshot ausente/divergente não é reconstruído", () => {
  const zero = calculateInstallmentCorrection(installment({ status: "cancelled", current_amount: "0.00", correction_amount: "-100.00" }));
  assert.equal(zero.ok, true);
  assert.equal(zero.current_amount, "0.00");
  const missing = calculateInstallmentCorrection(installment({ status: "paid", current_amount: undefined }));
  assert.equal(missing.ok, false);
  assert.equal(missing.current_amount, null);
  const different = calculateInstallmentCorrection(installment({ status: "paid", current_amount: "200.00" }));
  assert.equal(different.current_amount, "200.00");
  assert.ok(has(different, /snapshot não confere/));
});

test("múltiplas baixas e estornos conciliam independentemente da ordem da exportação", () => {
  const result = reconcilePaymentEvents({
    paid_amount: "350.00", events_complete: true,
    events: [reversal("rv-1", "p-1", "50.00"), payment("p-2", "100.00", { medium: "cash" }), payment("p-1", "300.00", { medium: "bank", account_source_id: "conta-sintetica" })],
  });
  assert.equal(result.ok, true);
  assert.equal(result.payment_amount, "400.00");
  assert.equal(result.reversal_amount, "50.00");
  assert.equal(result.net_amount, "350.00");
  assert.equal(result.event_count, 3);
});

test("source_id repetido idêntico conta uma vez; conteúdo diferente bloqueia", () => {
  const replay = reconcilePaymentEvents({ paid_amount: "20.00", events_complete: true, events: [payment("0001", "20"), payment("0001", "20.00")] });
  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate_event_count, 1);
  assert.equal(replay.net_amount, "20.00");
  assert.equal(replay.events[0].source_id, "0001");
  const conflict = reconcilePaymentEvents({ paid_amount: "20.00", events_complete: true, events: [payment("0001", "20.00"), payment("0001", "21.00")] });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.totals_complete, false);
  assert.equal(conflict.net_amount, null);
  assert.ok(has(conflict, /mesmo source_id/));
});

test("estorno exige baixa existente, data compatível e limite acumulado", () => {
  for (const events of [
    [reversal("r-1", "ausente", "1.00")],
    [payment("p-1", "10.00"), reversal("r-1", "p-1", "6.00"), reversal("r-2", "p-1", "5.00")],
    [payment("p-1", "10.00"), reversal("r-1", "p-1", "1.00", { occurred_on: "2022-04-14" })],
    [payment("p-1", "10.00"), reversal("r-1", "p-1", "1.00"), reversal("r-2", "r-1", "1.00")],
  ]) {
    const result = reconcilePaymentEvents({ paid_amount: "0.00", events_complete: true, events });
    assert.equal(result.ok, false);
    assert.equal(result.net_amount, null);
  }
});

test("data/ID/valor/kind inválidos não são aceitos como eventos efetivos", () => {
  for (const event of [
    payment(12, "1.00"), payment("x", "0.00"), payment("x", "-1.00"), payment("x", "1.00", { occurred_on: "2022-02-30" }),
    payment("x", "1.00", { kind: "correction" }), payment("x", "1.00", { reverses_source_id: "y" }),
  ]) assert.equal(reconcilePaymentEvents({ paid_amount: "1.00", events_complete: true, events: [event] }).ok, false);
});

test("histórico incompleto não produz total confiável; total completo divergente continua legível", () => {
  const partial = reconcilePaymentEvents({ paid_amount: "20.00", events_complete: false, events: [payment("p-1", "20.00")] });
  assert.equal(partial.ok, false);
  assert.equal(partial.net_amount, null);
  const mismatch = reconcilePaymentEvents({ paid_amount: "10.00", events_complete: true, events: [payment("p-1", "20.00")] });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.totals_complete, true);
  assert.equal(mismatch.net_amount, "20.00");
  assert.ok(has(mismatch, /soma das baixas/));
});

test("baixa explicitamente anulada tem efeito zero, mantém valor e sinaliza estorno sem data", () => {
  const voided = payment("voided-01", "60.00", { kind: "voided_payment", voided_by_source_id: "archive-reversal-01", voided_date_unknown: true });
  const result = reconcilePaymentEvents({ paid_amount: "60.00", events_complete: true, events: [voided, payment("replacement-01", "60.00", { medium: "non_cash" })] });
  assert.equal(result.ok, true);
  assert.equal(result.net_amount, "60.00");
  assert.equal(result.voided_amount, "60.00");
  assert.equal(result.voided_event_count, 1);
  assert.equal(result.totals_complete, true);
  assert.equal(result.history_dates_complete, false);
  assert.equal(result.events[0].amount, "60.00");
  assert.equal(result.events[0].occurred_on, "2022-04-15");
  assert.match(result.warnings.join(" "), /não tem data válida/);
});

test("estorno indatável não ganha data e voided exige evidência sem dupla subtração", () => {
  const voided = payment("voided-01", "60.00", { kind: "voided_payment", voided_by_source_id: "archive-01", voided_date_unknown: true });
  for (const events of [
    [payment("p-1", "60.00"), reversal("r-1", "p-1", "60.00", { occurred_on: "-0001-11-30" })],
    [{ ...voided, voided_by_source_id: undefined }], [{ ...voided, voided_date_unknown: false }],
    [voided, reversal("r-1", "voided-01", "60.00")],
  ]) assert.equal(reconcilePaymentEvents({ paid_amount: "0.00", events_complete: true, events }).ok, false);
});

for (const status of ["open", "partial"]) test(`parcial ${status} preserva principal, saldo e eventos sem fingir quitação`, () => {
  const source = installment({ status, paid_amount: "30.00", balance_amount: "80.00", events: [payment("p-1", "20.00"), payment("p-2", "20.00"), reversal("r-1", "p-1", "10.00")] });
  const result = reconcileInstallmentFinancials(source);
  assert.equal(result.ok, true);
  assert.equal(result.settlement_state, "partial");
  assert.equal(result.canonical_status, "open");
  assert.equal(result.requires_partial_support, true);
  assert.equal(result.computed_balance_amount, "80.00");
  assert.equal(result.collectible_balance_amount, "80.00");
  assert.equal(result.source_snapshot.original_amount, "100.00");
  assert.match(result.warnings.join(" "), /não usar RPC de quitação integral/);
});

test("saldo, situação e política divergentes impedem conciliação sem alterar a fonte", () => {
  for (const overrides of [
    { balance_amount: "109.99" }, { status: "paid" }, { status: "partial" },
    { current_amount: "111.00", balance_amount: "111.00" }, { correction_amount: "11.00" },
    { status: "unknown" }, { correction_locked: "false" },
  ]) {
    const source = installment(overrides);
    const result = reconcileInstallmentFinancials(source);
    assert.equal(result.ok, false, JSON.stringify(overrides));
    assert.deepEqual(result.source_snapshot, source);
  }
});

test("quitada histórica confere eventos sem reaplicar índice corrente", () => {
  const result = reconcileInstallmentFinancials(installment({ status: "paid", current_amount: "103.00", correction_amount: "3.00", paid_amount: "103.00", balance_amount: "0.00", events: [payment("p-1", "60.00"), payment("p-2", "43.00")] }));
  assert.equal(result.ok, true);
  assert.equal(result.expected_current_amount, "103.00");
  assert.equal(result.correction_preserved, true);
  assert.equal(result.settlement_state, "paid");
  assert.equal(result.requires_partial_support, false);
});

test("abatimento capturado no cancelamento exige composição explícita sem apagar principal", () => {
  const source = installment({ status: "cancelled", current_amount: "0.00", correction_amount: "0.00", discount_amount: "100.00", balance_amount: "0.00" });
  const result = reconcileInstallmentFinancials(source);
  assert.equal(result.ok, true);
  assert.equal(result.canonical_status, "cancelled");
  assert.equal(result.source_snapshot.original_amount, "100.00");
  assert.equal(result.collectible_balance_amount, "0.00");
  const incomplete = reconcileInstallmentFinancials(installment({ status: "cancelled", balance_amount: "0.00" }));
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.source_snapshot.current_amount, "110.00");
  assert.ok(has(incomplete, /composição explícita/));
});

test("cancelada preserva saldo histórico positivo e baixas sem criar saldo exigível", () => {
  for (const paid of ["0.00", "30.00"]) {
    const source = installment({ status: "cancelled", paid_amount: paid, balance_amount: paid === "0.00" ? "110.00" : "80.00", events: paid === "0.00" ? [] : [payment("historical-partial", paid)] });
    const result = reconcileInstallmentFinancials(source);
    assert.equal(result.ok, true, result.errors.join(" "));
    assert.equal(result.canonical_status, "cancelled");
    assert.equal(result.computed_balance_amount, source.balance_amount);
    assert.equal(result.collectible_balance_amount, "0.00");
    assert.equal(result.source_snapshot.original_amount, "100.00");
    assert.equal(result.source_snapshot.discount_amount, "0.00");
    assert.equal(result.payments.net_amount, paid);
    assert.equal(result.requires_partial_support, false);
    assert.equal(result.correction_preserved, true);
  }
});

test("cancelada historicamente quitada preserva pagamento conciliado sem inventar desconto", () => {
  const source = installment({ status: "cancelled", paid_amount: "110.00", balance_amount: "0.00", events: [payment("historical-paid", "110.00")] });
  const result = reconcileInstallmentFinancials(source);
  assert.equal(result.ok, true, result.errors.join(" "));
  assert.equal(result.canonical_status, "cancelled");
  assert.equal(result.computed_balance_amount, "0.00");
  assert.equal(result.collectible_balance_amount, "0.00");
  assert.equal(result.payments.net_amount, "110.00");
  assert.equal(result.source_snapshot.original_amount, "100.00");
  assert.equal(result.source_snapshot.discount_amount, "0.00");
});

test("funções são puras: input congelado e snapshot de saída independente", () => {
  const source = installment({ paid_amount: "10.00", balance_amount: "100.00", events: [payment("p-1", "10.00")] });
  const before = structuredClone(source);
  Object.freeze(source.correction);
  Object.freeze(source.events[0]);
  Object.freeze(source.events);
  Object.freeze(source);
  const result = reconcileInstallmentFinancials(source);
  assert.equal(result.ok, true);
  assert.deepEqual(source, before);
  result.source_snapshot.correction.base_value = "1";
  result.payments.events[0].amount = "99.00";
  assert.deepEqual(source, before);
});
