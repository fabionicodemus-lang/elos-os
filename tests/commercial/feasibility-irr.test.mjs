import { test } from "node:test";
import assert from "node:assert/strict";
import { monthlyIrr } from "../../lib/commercial/feasibility.mjs";

function close(actual, expected, tolerance = 1e-8) {
  assert.ok(actual != null, `esperava valor próximo de ${expected}, recebeu null`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `esperava ${expected}, recebeu ${actual}`);
}

test("TIR mensal continua correta para fluxo convencional", () => {
  const rate = monthlyIrr([-100, 0, 110]);
  close(rate, Math.sqrt(1.1) - 1);
});

test("TIR encontra raiz quando o fluxo é positivo, negativo e positivo", () => {
  // NPV = 0,6060606 - 1,5757576/(1+r) + 1/(1+r)^2.
  // Existem duas raízes positivas: 10% e 50% a.m. O motor usa a menor raiz não negativa.
  const rate = monthlyIrr([0.606060606060606, -1.5757575757575757, 1]);
  close(rate, 0.1, 1e-7);
});

test("TIR retorna null quando há entradas e saídas, mas nenhuma raiz real", () => {
  assert.equal(monthlyIrr([1, -1, 1]), null);
});

test("TIR retorna null quando o fluxo não possui os dois sinais", () => {
  assert.equal(monthlyIrr([1, 2, 3]), null);
  assert.equal(monthlyIrr([-1, -2, -3]), null);
});
