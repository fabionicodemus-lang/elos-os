import test from "node:test";
import assert from "node:assert/strict";
import { titleFinancialValues, titleFinancialTimeline } from "../../lib/finance/title-balances.mjs";

const title = overrides => ({ id: "title-a", amount: "100.00", adjusted_amount: "110.00", paid_amount: "30.00", status: "open", due_date: "2022-04-10", paid_at: "2022-03-12", ...overrides });
const event = (id, date, amount, kind = "payment") => ({ event_id: id, title_kind: "receivable", title_id: "title-a", project_id: "project-a", occurred_on: date, amount, kind, medium: "bank", account_name: "Conta sintética", source_system: "synthetic" });

test("saldo parcial preserva nominal/atualizado e inclui pago acumulado", () => {
  const result = titleFinancialValues(title());
  assert.equal(result.original, 100);
  assert.equal(result.updated, 110);
  assert.equal(result.paid, 30);
  assert.equal(result.remaining, 80);
  assert.equal(result.partial, true);
});

test("regressão de títulos legados sem ajustes ou pagamentos parciais", () => {
  assert.equal(titleFinancialValues(title({ adjusted_amount: undefined, paid_amount: null })).remaining, 100);
  const paid = titleFinancialValues(title({ adjusted_amount: undefined, paid_amount: null, status: "paid" }));
  assert.equal(paid.paid, 100);
  assert.equal(paid.remaining, 0);
  assert.equal(titleFinancialValues(title({ status: "cancelled" })).remaining, 0);
  assert.equal(titleFinancialValues(title({ paid_amount: "120.00" })).remaining, 0);
});

test("centavos calculados sem erro de ponto flutuante intermediário", () => {
  assert.equal(titleFinancialValues(title({ amount: "0.30", adjusted_amount: "0.30", paid_amount: "0.10" })).remaining_amount, "0.20");
  assert.equal(titleFinancialValues(title({ amount: "99999999999999.99", adjusted_amount: "99999999999999.99", paid_amount: "0.01" })).remaining_amount, "99999999999999.98");
  assert.throws(() => titleFinancialValues(title({ paid_amount: "inválido" })), /inválido/);
});

test("cancelada preserva saldo histórico positivo sem cobrança ou previsão", () => {
  const result = titleFinancialTimeline(title({ status: "cancelled" }), [event("historical-partial", "2022-01-10", "30.00")]);
  assert.equal(result.historical_balance_amount, "80.00");
  assert.equal(result.historical_balance, 80);
  assert.equal(result.remaining_amount, "0.00");
  assert.equal(result.partial, false);
  assert.equal(result.original_amount, "100.00");
  assert.equal(result.updated_amount, "110.00");
  assert.equal(result.paid_amount, "30.00");
  assert.equal(result.history_complete, true);
  assert.deepEqual(result.entries.map(row => [row.situation, row.amount]), [["realized", 30]]);
});

test("linha do tempo usa cada data e estorno, com uma previsão apenas para saldo", () => {
  const rows = [event("a", "2022-01-10", "20.00"), event("b", "2022-02-10", "20.00"), event("c", "2022-03-12", "-10.00", "reversal")];
  const result = titleFinancialTimeline(title(), rows);
  assert.equal(result.history_complete, true);
  assert.deepEqual(result.entries.map(row => [row.date, row.amount, row.situation]), [
    ["2022-01-10", 20, "realized"], ["2022-02-10", 20, "realized"], ["2022-03-12", -10, "realized"], ["2022-04-10", 80, "forecast"],
  ]);
});

test("histórico ausente/divergente não é atribuído à última paid_at", () => {
  const result = titleFinancialTimeline(title());
  assert.equal(result.history_complete, false);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].situation, "forecast");
  assert.equal(result.entries[0].amount, 80);
  assert.equal(titleFinancialTimeline(title(), [event("a", "2022-01-01", "20.00")]).history_complete, false);
});

test("repetição idêntica não duplica evento; conflito e vínculo incorreto impedem total", () => {
  const one = event("a", "2022-01-10", "30.00");
  const replay = titleFinancialTimeline(title(), [one, { ...one }]);
  assert.equal(replay.history_complete, true);
  assert.equal(replay.entries.filter(row => row.situation === "realized").length, 1);
  assert.equal(titleFinancialTimeline(title(), [one, { ...one, amount: "31.00" }]).history_complete, false);
  assert.equal(titleFinancialTimeline(title(), [{ ...one, title_id: "another" }]).history_complete, false);
});

test("quitada e estorno integral mantêm histórico datado sem previsão residual", () => {
  const paid = titleFinancialTimeline(title({ status: "paid", paid_amount: "110.00" }), [event("a", "2022-01-01", "40.00"), event("b", "2022-02-01", "70.00")]);
  assert.equal(paid.history_complete, true);
  assert.equal(paid.entries.length, 2);
  const cancelled = titleFinancialTimeline(title({ status: "cancelled", paid_amount: "0.00" }), [event("a", "2022-01-01", "40.00"), event("b", "2022-02-01", "-40.00", "reversal")]);
  assert.equal(cancelled.history_complete, true);
  assert.equal(cancelled.entries.length, 2);
});

test("marcador voided não vira caixa nem inventa data do estorno, mas mantém aviso temporal", () => {
  const voided = { ...event("voided", "2022-01-01", "0.00", "voided_payment"), history_dates_complete: false };
  const replacement = { ...event("replacement", "2022-01-01", "30.00"), medium: "non_cash" };
  const result = titleFinancialTimeline(title(), [voided, replacement]);
  assert.equal(result.history_complete, true);
  assert.equal(result.history_dates_complete, false);
  assert.equal(result.entries.filter(row => row.situation === "realized").length, 1);
  assert.equal(result.entries[0].amount, 30);
  assert.equal(result.entries[0].medium, "non_cash");
});
