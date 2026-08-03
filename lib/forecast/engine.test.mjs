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
