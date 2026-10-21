import test from "node:test";
import assert from "node:assert/strict";
import { extractFlowSnapshot, finishWorkday, prepareFlowImport } from "./flow-standalone-import.mjs";

const task = (i) => ({
  id: "T" + String(i).padStart(3, "0"),
  code: "ALV", name: "Alvenaria", location: "Pavto 600",
  baselineStart: "2026-09-01", start: "2026-09-01",
  durationDays: 5, actualPercent: 0, actualStart: "", actualEnd: "",
  measurements: [],
});
function source() {
  return {
    project: { name: "Flow Aptos", baselineName: "Baseline 01 — Cronograma 14.07.2026",
      scheduleRevision: { date: "2026-10-06" } },
    tasks: Array.from({ length: 395 }, (_, i) => task(i + 1)),
  };
}
const html = (value) => '<html><script>const INITIAL_DATA = ' + JSON.stringify(value) + ';\n</script></html>';
const existingActivities = (value) => value.tasks.map((t) => ({
  id: "db-" + t.id, code: t.id, planned_start: t.baselineStart,
  planned_finish: "2026-09-07", duration_days: 5,
}));

test("parseia exatamente o HTML histórico, sem avaliar JavaScript", () => {
  const parsed = extractFlowSnapshot(html(source()));
  assert.equal(parsed.tasks.length, 395);
  assert.throws(() => extractFlowSnapshot("alert('xss')"), /INITIAL_DATA/);
  assert.throws(() => extractFlowSnapshot(html({ ...source(), project: { name: "Outra obra" } })), /Flow Aptos/);
});

test("calcula o término sem sábados ou domingos", () => {
  assert.equal(finishWorkday("2026-10-09", 5), "2026-10-15");
  assert.equal(finishWorkday("2026-10-10", 1), "2026-10-12");
});

test("preserva setembro e gera reprogramação distinta em outubro", () => {
  const snapshot = source();
  snapshot.tasks[0].start = "2026-10-13";
  snapshot.tasks[0].actualPercent = 60;
  snapshot.tasks[0].measurements = [
    { date: "2026-09-30", percent: 60, notes: "Medição acumulada de setembro" },
  ];
  const prepared = prepareFlowImport(snapshot, existingActivities(snapshot), []);
  assert.equal(prepared.rows.length, 2);
  assert.deepEqual(prepared.rows.map((r) => [r.measurement_date, r.progress_percent, r.current_start]),
    [["2026-09-30", 60, "2026-09-01"], ["2026-10-06", 60, "2026-10-13"]]);
  assert.equal(prepared.summary.importedMeasurements, 1);
  assert.equal(prepared.summary.newReplans, 1);
});

test("não regrava registros existentes, mesmo anulados", () => {
  const snapshot = source();
  snapshot.tasks[0].measurements = [{ date: "2026-09-30", percent: 100, notes: "Executado" }];
  const previous = [{ activity_id: "db-T001", measurement_date: "2026-09-30", voided_at: "2026-10-15T12:00:00Z" }];
  const prepared = prepareFlowImport(snapshot, existingActivities(snapshot), previous);
  assert.equal(prepared.rows.length, 0);
  assert.equal(prepared.summary.existingPreserved, 1);
});

test("não permite importação parcial com atividades sem código Txxx correspondente", () => {
  const snapshot = source();
  const activities = existingActivities(snapshot).slice(0, 394);
  assert.throws(() => prepareFlowImport(snapshot, activities, []), /sem correspondência/);
});
