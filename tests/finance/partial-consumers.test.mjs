import test from "node:test";
import assert from "node:assert/strict";
import { summarizePayables, summarizeReceivables, buildCashflowMonths } from "../../lib/elos-ia/summaries.mjs";
import { buildDevelopmentCostSummary } from "../../lib/development-costs/summary.mjs";
import { calculateDevelopmentResult } from "../../lib/commercial/development-result.mjs";

const event = (id, date, amount, kind = "payment", extra = {}) => ({
  event_id: id, title_kind: "receivable", title_id: "title-synthetic", project_id: "project-synthetic",
  occurred_on: date, amount, kind, medium: "bank", account_name: "Conta sintética", source_system: "eobra_snapshot", ...extra,
});
const receipt = () => ({
  id: "title-synthetic", status: "open", amount: 100, adjustedAmount: 110, paidAmount: 30, dueDate: "2022-05-01", paidAt: "2022-03-10",
  client: "Cliente sintético", unit: "A-001", category: "monthly",
  paymentEvents: [event("one", "2022-01-10", "20.00"), event("two", "2022-02-10", "20.00"), event("three", "2022-03-10", "-10.00", "reversal")],
});

test("AI receivable summary uses residual stock and real receipt dates for a partial", () => {
  const row = receipt();
  const summary = summarizeReceivables([row], { today: "2022-04-01" });
  assert.equal(summary.resumo_geral.carteira_em_aberto.valor, 80);
  assert.equal(summary.resumo_geral.recebidas.valor, 30);
  assert.equal(summary.historico_por_data_completo, true);
  const february = summarizeReceivables([row], { today: "2022-04-01", situation: "recebidas", from: "2022-02-01", to: "2022-02-28" });
  assert.equal(february.selecao.valor, 20);
  assert.equal(february.itens[0].recebido_em, "2022-02-10");
  const march = summarizeReceivables([row], { today: "2022-04-01", situation: "recebidas", from: "2022-03-01", to: "2022-03-31" });
  assert.equal(march.selecao.valor, -10);
});

test("AI payable summary uses adjusted unpaid amount and includes partial payment", () => {
  const row = { ...receipt(), adjustedAmount: 115, paidAmount: 25, supplier: "Fornecedor sintético", paymentEvents: [event("payment", "2022-02-10", "25.00", "payment", { title_kind: "payable" })] };
  const summary = summarizePayables([row], { today: "2022-04-01" });
  assert.equal(summary.resumo_geral.em_aberto.valor, 90);
  assert.equal(summary.resumo_geral.pagas.valor, 25);
});

test("cashflow separates actual receipt/reversal months and forecasts only residual", () => {
  const summary = buildCashflowMonths({ receivables: [receipt()], today: "2022-04-01", monthsBack: 3, monthsAhead: 1 });
  assert.equal(summary.totais_de_toda_a_obra.recebido, 30);
  assert.equal(summary.totais_de_toda_a_obra.a_receber, 80);
  const months = new Map(summary.meses.map(month => [month.mes, month]));
  assert.equal(months.get("2022-01").recebido, 20);
  assert.equal(months.get("2022-02").recebido, 20);
  assert.equal(months.get("2022-03").recebido, -10);
  assert.equal(months.get("2022-05").a_receber, 80);
});

test("voided history does not inflate AI cash totals and announces missing reversal date", () => {
  const row = receipt();
  row.paymentEvents.push(event("voided", "2021-12-01", "0.00", "voided_payment", { history_dates_complete: false }));
  const summary = summarizeReceivables([row], { today: "2022-04-01" });
  assert.equal(summary.resumo_geral.recebidas.valor, 30);
  assert.equal(summary.historico_por_data_completo, false);
  const flow = buildCashflowMonths({ receivables: [row], today: "2022-04-01" });
  assert.equal(flow.totais_de_toda_a_obra.recebido, 30);
  assert.equal(flow.historico_por_data_completo, false);
});

test("development allocations preserve nominal share and split paid from remaining", () => {
  const summary = buildDevelopmentCostSummary({
    centers: [{ id: "center", code: "01", description: "Centro sintético", development_cost_category: "land" }],
    budgets: [{ service_id: "center", budget_amount: 100 }],
    allocations: [{ payable_id: "title", service_id: "center", allocation_amount: 50 }],
    payables: [{ id: "title", status: "open", amount: 100, adjusted_amount: 110, paid_amount: 30 }],
  });
  assert.equal(summary.totals.paid, 15);
  assert.equal(summary.totals.open, 40);
  assert.equal(summary.totals.appropriated, 55);
});

test("commercial result includes accumulated partials without duplicating outstanding stock", () => {
  const result = calculateDevelopmentResult({
    baselineMetrics: {}, baselineStudy: {}, project: {}, sales: [], units: [], forecast: null, today: "2022-04-01",
    receivables: [{ status: "open", amount: 100, adjusted_amount: 110, paid_amount: 30, due_date: "2022-03-01" }],
    payables: [{ status: "open", amount: 100, adjusted_amount: 115, paid_amount: 25 }],
  });
  assert.equal(result.cash.received, 30);
  assert.equal(result.cash.receivableOpen, 80);
  assert.equal(result.cash.overdue, 80);
  assert.equal(result.cash.paidOut, 25);
  assert.equal(result.cash.payableOpen, 90);
});

for (const paid of [30, 110]) test(`cancelled history with paid ${paid} keeps realized cash and cost without reopening its historical balance`, () => {
  const row = { ...receipt(), status: "cancelled", paidAmount: paid, paymentEvents: [event("cancelled-paid", "2022-02-10", paid.toFixed(2))] };
  const summary = summarizeReceivables([row], { today: "2022-04-01" });
  assert.equal(summary.resumo_geral.recebidas.valor, paid);
  assert.equal(summary.resumo_geral.carteira_em_aberto.valor, 0);
  const flow = buildCashflowMonths({ receivables: [row], today: "2022-04-01" });
  assert.equal(flow.totais_de_toda_a_obra.recebido, paid);
  assert.equal(flow.totais_de_toda_a_obra.a_receber, 0);
  const result = calculateDevelopmentResult({
    baselineMetrics: {}, baselineStudy: {}, sales: [], units: [], forecast: null, today: "2022-04-01",
    receivables: [{ status: "cancelled", amount: 100, adjusted_amount: 110, paid_amount: paid }],
    payables: [{ status: "cancelled", amount: 100, adjusted_amount: 115, paid_amount: paid }],
  });
  assert.equal(result.cash.received, paid);assert.equal(result.cash.receivableOpen, 0);
  assert.equal(result.cash.paidOut, paid);assert.equal(result.cash.payableOpen, 0);
  const allocated = buildDevelopmentCostSummary({
    centers: [{ id: "center", code: "01", description: "Centro sintético", development_cost_category: "land" }],
    allocations: [{ payable_id: "title", service_id: "center", allocation_amount: 50 }],
    payables: [{ id: "title", status: "cancelled", amount: 100, adjusted_amount: 110, paid_amount: paid }],
  });
  assert.equal(allocated.totals.paid, paid / 2);assert.equal(allocated.totals.open, 0);
});
