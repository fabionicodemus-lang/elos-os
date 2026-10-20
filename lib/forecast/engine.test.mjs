import test from "node:test";
import assert from "node:assert/strict";
import { buildUnifiedForecast } from "./engine.mjs";

const base = {
  asOfDate: "2026-01-15",
  defaultPaymentDays: 30,
  workOnSaturday: false,
  services: [{ id: "s1", code: "01", name: "Serviço", budgetAmount: 100 }],
  activities: [{ id: "a1", serviceId: "s1", plannedStart: "2026-01-01", plannedFinish: "2026-03-31", currentStart: "2026-01-01", currentFinish: "2026-03-31", progressPercent: 0, assignedCost: 100 }],
  actualPayments: [],
  openPayables: [],
  commitments: [],
};

function service(result) { return result.services.find((item) => item.id === "s1"); }

function close(actual, expected, precision = 0.0001) {
  assert.ok(Math.abs(actual - expected) <= precision, `${actual} != ${expected}`);
}

test("serviço sem contrato fica 100% a comprometer", () => {
  const result = buildUnifiedForecast(base);
  assert.equal(service(result).actual, 0);
  assert.equal(service(result).committed, 0);
  assert.equal(service(result).toCommit, 100);
  close(result.months.reduce((sum, row) => sum + row.toCommit, 0), 100);
});

test("contrato reduz exatamente a camada a comprometer", () => {
  const result = buildUnifiedForecast({ ...base, commitments: [{ id: "c1", kind: "contract", serviceId: "s1", amount: 40, paymentDays: 30 }] });
  close(service(result).committedFuture, 40);
  close(service(result).toCommit, 60);
  close(service(result).projectedCost, 100);
});

test("medição aprovada migra do futuro para payable prevista sem dupla contagem", () => {
  const result = buildUnifiedForecast({
    ...base,
    openPayables: [{ id: "p1", serviceId: "s1", amount: 10, dueDate: "2026-02-20" }],
    commitments: [{ id: "c1", kind: "contract", serviceId: "s1", amount: 30, paymentDays: 30 }],
  });
  assert.equal(service(result).committedPayable, 10);
  close(service(result).committedFuture, 30);
  close(service(result).committed, 40);
  close(service(result).toCommit, 60);
  close(result.totals.engineeringProjected, 90);
  close(result.months.reduce((sum, row) => sum + row.engineeringProjected, 0), 90);
  assert.equal(result.months.reduce((sum, row) => sum + row.committedPayable, 0), 10);
});

test("payable paga migra para realizado e some das demais camadas", () => {
  const result = buildUnifiedForecast({
    ...base,
    actualPayments: [{ id: "p1", serviceId: "s1", amount: 10, paidAt: "2026-02-20" }],
    commitments: [{ id: "c1", kind: "contract", serviceId: "s1", amount: 30, paymentDays: 30 }],
  });
  assert.equal(service(result).actual, 10);
  close(service(result).committed, 30);
  close(service(result).toCommit, 60);
  close(service(result).projectedCost, 100);
});

test("soma das camadas é o custo final e série engenharia exclui payable aberta", () => {
  const result = buildUnifiedForecast({
    ...base,
    actualPayments: [{ id: "paid", serviceId: "s1", amount: 20, paidAt: "2026-01-10" }],
    openPayables: [{ id: "open", serviceId: "s1", amount: 15, dueDate: "2026-02-10" }],
    commitments: [{ id: "future", kind: "contract", serviceId: "s1", amount: 25, paymentDays: 30 }],
  });
  close(service(result).toCommit, 40);
  close(service(result).projectedCost, 100);
  close(result.totals.engineeringProjected, 65);
  assert.equal(result.boundaries.openPayablesExcludedFromEngineeringProjected, true);
});

test("estouro zera a comprometer e mostra desvio", () => {
  const result = buildUnifiedForecast({
    ...base,
    actualPayments: [{ id: "paid", serviceId: "s1", amount: 70, paidAt: "2026-01-10" }],
    commitments: [{ id: "future", kind: "contract", serviceId: "s1", amount: 50, paymentDays: 30 }],
  });
  assert.equal(service(result).toCommit, 0);
  close(service(result).projectedCost, 120);
  close(service(result).deviation, 20);
});

test("prazo de pagamento desloca corretamente na virada do mês", () => {
  const result = buildUnifiedForecast({
    ...base,
    asOfDate: "2026-01-30",
    activities: [{ id: "a1", serviceId: "s1", plannedStart: "2026-01-30", plannedFinish: "2026-01-30", currentStart: "2026-01-30", currentFinish: "2026-01-30", progressPercent: 0, assignedCost: 100 }],
    commitments: [{ id: "c1", kind: "contract", serviceId: "s1", amount: 40, paymentDays: 2 }],
  });
  const feb = result.months.find((row) => row.key === "2026-02");
  assert.ok(feb);
  close(feb.committedFuture, 40);
});

test("fonte futura de pedido de compra usa a mesma interface do comprometido", () => {
  const result = buildUnifiedForecast({
    ...base,
    commitments: [{ id: "po1", kind: "purchase_order", serviceId: "s1", amount: 25, paymentDays: 30 }],
  });
  close(service(result).committedFuture, 25);
  close(service(result).toCommit, 75);
  close(service(result).projectedCost, 100);
});

test("cronograma grande mantém memória limitada e preserva totais", () => {
  const activities = Array.from({ length: 12_000 }, (_, index) => ({
    id: `a${index}`,
    serviceId: "s1",
    plannedStart: "2026-01-01",
    plannedFinish: "2030-12-31",
    currentStart: "2026-01-01",
    currentFinish: "2030-12-31",
    progressPercent: 0,
    assignedCost: 1,
  }));
  const before = process.memoryUsage().heapUsed;
  const result = buildUnifiedForecast({ ...base, activities });
  const growth = process.memoryUsage().heapUsed - before;
  close(result.months.reduce((sum, row) => sum + row.toCommit, 0), 100);
  assert.ok(result.months.length <= 241);
  assert.ok(growth < 300 * 1024 * 1024, `crescimento de heap inesperado: ${growth}`);
});

test("previsão pelas parcelas do contrato usa só os títulos e não distribui pelo cronograma", () => {
  const result = buildUnifiedForecast({
    ...base,
    services: [{ id: "s1", code: "21.01", name: "Elevadores", budgetAmount: 100, financialMode: "payment_plan" }],
    actualPayments: [{ id: "p1", serviceId: "s1", amount: 30, paidAt: "2026-01-10" }],
    openPayables: [
      { id: "p2", serviceId: "s1", amount: 40, dueDate: "2026-05-15" },
      { id: "p3", serviceId: "s1", amount: 50, dueDate: "2026-09-15" },
    ],
  });
  const row = service(result);
  assert.equal(row.financialMode, "payment_plan");
  assert.equal(row.toCommit, 0);
  close(row.projectedCost, 120);
  close(row.deviation, 20);
  close(result.months.reduce((sum, month) => sum + month.toCommit, 0), 0);
  close(result.months.find((month) => month.key === "2026-09").committedPayable, 50);
  assert.equal(result.months.some((month) => month.key === "2026-02" || month.key === "2026-03"), false);
});

test("previsão pelas parcelas sem títulos lançados gera aviso", () => {
  const result = buildUnifiedForecast({
    ...base,
    services: [{ id: "s1", code: "10.01", name: "Janelas", budgetAmount: 100, financialMode: "payment_plan" }],
  });
  assert.equal(service(result).toCommit, 0);
  assert.ok(result.warnings.some((warning) => warning.code === "payment_plan_without_installments"));
});

test("grupo do mesmo contrato divide as parcelas pelo orçamento de cada serviço", () => {
  const result = buildUnifiedForecast({
    ...base,
    services: [
      { id: "s1", code: "10.01", name: "Janelas", budgetAmount: 60, financialMode: "payment_plan", planGroup: "Liv" },
      { id: "s2", code: "10.04", name: "Gradis", budgetAmount: 40, financialMode: "payment_plan", planGroup: "Liv" },
    ],
    actualPayments: [{ id: "p1", serviceId: "s1", amount: 50, paidAt: "2026-01-10" }],
    openPayables: [{ id: "p2", serviceId: "s1", amount: 70, dueDate: "2026-06-25" }],
  });
  const s1 = result.services.find((item) => item.id === "s1");
  const s2 = result.services.find((item) => item.id === "s2");
  close(s1.actual, 30);
  close(s2.actual, 20);
  close(s1.committedPayable, 42);
  close(s2.committedPayable, 28);
  close(s1.projectedCost + s2.projectedCost, 120);
  close(result.totals.projectedCost, 120);
  assert.equal(s2.planGroup, "Liv");
  assert.equal(result.warnings.some((warning) => warning.code === "payment_plan_without_installments"), false);
});

test("serviço sem modo informado continua pelo cronograma", () => {
  const result = buildUnifiedForecast(base);
  assert.equal(service(result).financialMode, "schedule");
});

test("data extrema é limitada e gera aviso sem explodir a série mensal", () => {
  const result = buildUnifiedForecast({
    ...base,
    activities: [{ ...base.activities[0], currentFinish: "9999-12-31", plannedFinish: "9999-12-31" }],
  });
  assert.ok(result.months.length <= 241);
  assert.ok(result.warnings.some((warning) => warning.code === "schedule_horizon_clamped"));
  close(service(result).projectedCost, 100);
});

test("prazo fixo divide saldo (contrato + a contratar) igualmente pelos meses, sem cronograma", () => {
  const result = buildUnifiedForecast({
    ...base,
    services: [{ id: "s1", code: "25.11", name: "Empreiteiro elétrica", budgetAmount: 1000, financialMode: "fixed_term", distributionStart: "2025-06-01", distributionEnd: "2026-04-30" }],
    actualPayments: [{ id: "p1", serviceId: "s1", amount: 200, paidAt: "2025-12-10" }],
    openPayables: [{ id: "p2", serviceId: "s1", amount: 100, dueDate: "2026-01-20" }],
    commitments: [{ id: "c1", serviceId: "s1", amount: 300 }],
  });
  const row = service(result);
  close(row.committedFuture, 300);
  close(row.toCommit, 400);
  const months = ["2026-01", "2026-02", "2026-03", "2026-04"];
  for (const key of months) {
    const month = result.months.find((item) => item.key === key);
    close(month.committedFuture, 75);
    close(month.toCommit, 100);
  }
  close(result.months.find((item) => item.key === "2026-01").committedPayable, 100);
  assert.equal(result.warnings.some((warning) => warning.code === "service_without_future_schedule"), false);
});

test("prazo fixo com fim no passado concentra o saldo no mês atual", () => {
  const result = buildUnifiedForecast({
    ...base,
    services: [{ id: "s1", code: "25.10", name: "Estrutura", budgetAmount: 500, financialMode: "fixed_term", distributionStart: "2025-01-01", distributionEnd: "2025-09-30" }],
  });
  close(result.months.find((item) => item.key === "2026-01").toCommit, 500);
});
