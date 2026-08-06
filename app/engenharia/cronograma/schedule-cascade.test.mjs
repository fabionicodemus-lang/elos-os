import test from "node:test";
import assert from "node:assert/strict";
import { rescheduleFromMove } from "./schedule-cascade.mjs";

// Datas de referência (dias úteis seg–sex):
// 2026-08-03 seg, 04 ter, 05 qua, 06 qui, 07 sex, 08 sáb, 09 dom, 10 seg...
function activity(id, start, finish, duration) {
  return { id, planned_start: start, planned_finish: finish, duration_days: duration };
}
function find(result, id) {
  return result.activities.find((a) => a.id === id);
}

const acts = [
  activity("A", "2026-08-03", "2026-08-07", 5), // seg–sex
  activity("B", "2026-08-10", "2026-08-14", 5), // seg–sex seguinte
];
const fs = [{ predecessor_id: "A", successor_id: "B", relation_type: "FS", lag_days: 0 }];

test("FS: mover A para frente empurra B para o dia útil seguinte ao novo término de A", () => {
  const result = rescheduleFromMove({ activities: acts, dependencies: fs, movedId: "A", newStart: "2026-08-05", workOnSaturday: false, cascade: true });
  const a = find(result, "A");
  const b = find(result, "B");
  assert.equal(a.plannedStart, "2026-08-05");
  assert.equal(a.plannedFinish, "2026-08-11"); // 5 dias úteis: qua,qui,sex,seg,ter → 05,06,07,10,11
  assert.equal(b.plannedStart, "2026-08-12"); // dia útil seguinte ao término de A
  assert.deepEqual(result.changed.sort(), ["A", "B"]);
});

test("FS: mover A para trás NÃO puxa B para antes (piso = posição atual)", () => {
  const result = rescheduleFromMove({ activities: acts, dependencies: fs, movedId: "A", newStart: "2026-08-03", workOnSaturday: false, cascade: true });
  const b = find(result, "B");
  assert.equal(b.plannedStart, "2026-08-10"); // permanece onde estava
  assert.deepEqual(result.changed, []); // nada mudou
});

test("Sem cascata: só a atividade movida muda", () => {
  const result = rescheduleFromMove({ activities: acts, dependencies: fs, movedId: "A", newStart: "2026-08-05", workOnSaturday: false, cascade: false });
  const b = find(result, "B");
  assert.equal(b.plannedStart, "2026-08-10");
  assert.deepEqual(result.changed, ["A"]);
});

test("FS com defasagem de 2 dias úteis", () => {
  const result = rescheduleFromMove({
    activities: acts,
    dependencies: [{ predecessor_id: "A", successor_id: "B", relation_type: "FS", lag_days: 2 }],
    movedId: "A", newStart: "2026-08-05", workOnSaturday: false, cascade: true,
  });
  // término A = 11 (ter). +1 dia útil = 12 (qua), +2 defasagem = 12→13→16? 2 workdays: qua 12→qui 13→? lag2+1=3 workdays após 11: qua12,qui13,sex14
  assert.equal(find(result, "B").plannedStart, "2026-08-14");
});

test("SS: início-início empurra o começo da sucessora ao da predecessora + defasagem", () => {
  const result = rescheduleFromMove({
    activities: acts,
    dependencies: [{ predecessor_id: "A", successor_id: "B", relation_type: "SS", lag_days: 1 }],
    movedId: "A", newStart: "2026-08-17", workOnSaturday: false, cascade: true,
  });
  // A começa 17 (seg); SS lag 1 → B começa 1 dia útil depois: 18 (ter). Piso de B (10) é superado.
  assert.equal(find(result, "B").plannedStart, "2026-08-18");
});

test("FF: término-término alinha o fim da sucessora ao da predecessora", () => {
  const result = rescheduleFromMove({
    activities: [activity("A", "2026-08-03", "2026-08-07", 5), activity("B", "2026-08-03", "2026-08-05", 3)],
    dependencies: [{ predecessor_id: "A", successor_id: "B", relation_type: "FF", lag_days: 0 }],
    movedId: "A", newStart: "2026-08-05", workOnSaturday: false, cascade: true,
  });
  // término A = 11 (ter); B dura 3 → início = 11 menos 2 dias úteis = 07 (sex)? 11 ter → 10 seg → 07 sex
  const b = find(result, "B");
  assert.equal(b.plannedFinish, "2026-08-11");
  assert.equal(b.plannedStart, "2026-08-07");
});

test("Cadeia A→B→C propaga em cascata", () => {
  const chain = [
    activity("A", "2026-08-03", "2026-08-07", 5),
    activity("B", "2026-08-10", "2026-08-11", 2),
    activity("C", "2026-08-12", "2026-08-13", 2),
  ];
  const deps = [
    { predecessor_id: "A", successor_id: "B", relation_type: "FS", lag_days: 0 },
    { predecessor_id: "B", successor_id: "C", relation_type: "FS", lag_days: 0 },
  ];
  const result = rescheduleFromMove({ activities: chain, dependencies: deps, movedId: "A", newStart: "2026-08-10", workOnSaturday: false, cascade: true });
  // A: 10–14; B começa 17 (seg), dura 2 → 17–18; C começa 19 → 19–20
  assert.equal(find(result, "A").plannedFinish, "2026-08-14");
  assert.equal(find(result, "B").plannedStart, "2026-08-17");
  assert.equal(find(result, "C").plannedStart, "2026-08-19");
  assert.deepEqual(result.changed.sort(), ["A", "B", "C"]);
});

test("Move normaliza para dia útil quando cai em fim de semana", () => {
  const result = rescheduleFromMove({ activities: acts, dependencies: [], movedId: "A", newStart: "2026-08-08", workOnSaturday: false, cascade: true });
  assert.equal(find(result, "A").plannedStart, "2026-08-10"); // sábado 08 → segunda 10
});

test("Ciclo não perde atividades (fallback estável)", () => {
  const result = rescheduleFromMove({
    activities: [activity("A", "2026-08-03", "2026-08-04", 2), activity("B", "2026-08-05", "2026-08-06", 2)],
    dependencies: [
      { predecessor_id: "A", successor_id: "B", relation_type: "FS", lag_days: 0 },
      { predecessor_id: "B", successor_id: "A", relation_type: "FS", lag_days: 0 },
    ],
    movedId: "A", newStart: "2026-08-05", workOnSaturday: false, cascade: true,
  });
  assert.equal(result.activities.length, 2);
});
