import test from "node:test";
import assert from "node:assert/strict";
import { distributeByQuantity, planScheduleFromBudget } from "./schedule-generation.mjs";

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

test("distributeByQuantity conserva o total exatamente (proporcional)", () => {
  const parts = distributeByQuantity(10000, [1, 1, 1]); // R$ 100,00 em 3 partes iguais
  assert.equal(sum(parts), 10000);
  assert.deepEqual(parts, [3334, 3333, 3333]); // sobra de 1 centavo vai para o maior resto (empate → primeiro índice)
});

test("distributeByQuantity rateia proporcionalmente à quantidade", () => {
  const parts = distributeByQuantity(10000, [30, 10]); // 75% / 25%
  assert.equal(sum(parts), 10000);
  assert.deepEqual(parts, [7500, 2500]);
});

test("distributeByQuantity divide igualmente quando todas as quantidades são zero", () => {
  const parts = distributeByQuantity(10001, [0, 0, 0]);
  assert.equal(sum(parts), 10001);
  // 10001/3 → 3334, 3334, 3333 (dois maiores restos recebem o centavo extra)
  assert.equal(Math.max(...parts) - Math.min(...parts) <= 1, true);
});

test("distributeByQuantity trata parte única e lista vazia", () => {
  assert.deepEqual(distributeByQuantity(999, [5]), [999]);
  assert.deepEqual(distributeByQuantity(999, []), []);
});

const services = [
  { id: "alv", code: "ALV", description: "Alvenaria", unit: "m2" },
  { id: "pin", code: "PIN", description: "Pintura", unit: "m2" },
  { id: "lmp", code: "LMP", description: "Limpeza", unit: "vb" },
];
const locations = [
  { id: "p1", code: "PAV1", name: "Pavimento 1", sort_order: 1 },
  { id: "p2", code: "PAV2", name: "Pavimento 2", sort_order: 2 },
];

test("planScheduleFromBudget: soma das partes = valor do orçamento do serviço", () => {
  const result = planScheduleFromBudget({
    services,
    locations,
    budgetItems: [
      { service_id: "alv", total_direct_cost: 1000, status: "active" },
      { service_id: "alv", total_direct_cost: 500, status: "active" },
    ],
    takeoffCells: [
      { service_id: "alv", location_id: "p1", total_quantity: 30, unit_snapshot: "m2" },
      { service_id: "alv", location_id: "p2", total_quantity: 10, unit_snapshot: "m2" },
    ],
  });
  const alv = result.conservation.find((entry) => entry.serviceId === "alv");
  assert.equal(alv.budgetValue, 1500);
  assert.equal(alv.scheduledValue, 1500);
  assert.equal(alv.delta, 0);
  // R$ 1500 rateado 30/10 → 1125 / 375
  const costs = result.activities.filter((a) => a.serviceId === "alv").map((a) => a.plannedCost);
  assert.deepEqual(costs, [1125, 375]);
});

test("planScheduleFromBudget: serviço do orçamento sem levantamento vira atividade geral com valor cheio", () => {
  const result = planScheduleFromBudget({
    services,
    locations,
    budgetItems: [{ service_id: "lmp", total_direct_cost: 800, status: "active" }],
    takeoffCells: [],
  });
  const lmpActivities = result.activities.filter((a) => a.serviceId === "lmp");
  assert.equal(lmpActivities.length, 1);
  assert.equal(lmpActivities[0].locationId, null);
  assert.equal(lmpActivities[0].plannedCost, 800);
  assert.match(lmpActivities[0].code, /^LMP-GERAL/);
});

test("planScheduleFromBudget: encadeia predecessoras FS por serviço na ordem dos locais", () => {
  const result = planScheduleFromBudget({
    services,
    locations,
    budgetItems: [{ service_id: "alv", total_direct_cost: 100, status: "active" }],
    takeoffCells: [
      { service_id: "alv", location_id: "p2", total_quantity: 5 },
      { service_id: "alv", location_id: "p1", total_quantity: 5 },
    ],
  });
  const alv = result.activities.filter((a) => a.serviceId === "alv");
  // ordenado por sort_order: PAV1 antes de PAV2
  assert.deepEqual(alv.map((a) => a.code), ["ALV-PAV1", "ALV-PAV2"]);
  assert.deepEqual(result.dependencies, [{ predecessorCode: "ALV-PAV1", successorCode: "ALV-PAV2" }]);
});

test("planScheduleFromBudget: total geral bate com a soma dos orçamentos e ignora item sem serviço", () => {
  const result = planScheduleFromBudget({
    services,
    locations,
    budgetItems: [
      { service_id: "alv", total_direct_cost: 1000, status: "active" },
      { service_id: "pin", total_direct_cost: 250.55, status: "active" },
      { service_id: null, total_direct_cost: 999, status: "active" },
      { service_id: "pin", total_direct_cost: 100, status: "inactive" },
    ],
    takeoffCells: [{ service_id: "pin", location_id: "p1", total_quantity: 12 }],
  });
  assert.equal(result.totals.budgetValue, 1250.55);
  assert.equal(result.totals.scheduledValue, 1250.55);
  assert.equal(result.totals.serviceCount, 2);
});

test("planScheduleFromBudget: gera códigos únicos quando o mesmo serviço/local se repete", () => {
  const result = planScheduleFromBudget({
    services,
    locations: [{ id: "p1", code: "PAV1", name: "Pavimento 1", sort_order: 1 }],
    budgetItems: [
      { service_id: "alv", total_direct_cost: 100, status: "active" },
      { service_id: "pin", total_direct_cost: 100, status: "active" },
    ],
    takeoffCells: [
      { service_id: "alv", location_id: "p1", total_quantity: 5 },
      { service_id: "pin", location_id: "p1", total_quantity: 5 },
    ],
  });
  const codes = result.activities.map((a) => a.code);
  assert.equal(new Set(codes).size, codes.length);
});
