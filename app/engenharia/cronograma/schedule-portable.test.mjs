import test from "node:test";
import assert from "node:assert/strict";
import {
  SCHEMA_VERSION,
  PAYLOAD_SCRIPT_ID,
  buildScheduleHtml,
  buildSchedulePayload,
  extractSchedulePayload,
  validateSchedulePayload,
} from "./schedule-portable.mjs";

const model = {
  meta: {
    baselineId: "b1",
    baselineCode: "CRONO-001",
    budgetId: "bud1",
    projectName: "Flow Aptos <Torre A>",
    workOnSaturday: false,
    startDate: "2026-08-06",
    exportedAt: "2026-08-06T12:00:00.000Z",
  },
  locations: [{ id: "p1", code: "PAV1", name: "Pavimento 1" }],
  services: [{ id: "alv", code: "ALV", description: "Alvenaria" }],
  activities: [
    {
      code: "ALV-PAV1",
      name: "Alvenaria · Pavimento 1",
      serviceId: "alv",
      locationId: "p1",
      plannedStart: "2026-08-06",
      plannedFinish: "2026-08-12",
      durationDays: 5,
      teamCount: 1,
      productivity: 4,
      quantity: 20,
      plannedCost: 1125.5,
      planningStatus: "draft",
      color: "#e0e0e0",
      textColor: "#111827",
      abbr: "ALV",
    },
  ],
  dependencies: [{ predecessorCode: "ALV-PAV1", successorCode: "ALV-PAV2", relationType: "FS", lagDays: 0 }],
};

test("buildScheduleHtml embute o bloco JSON e desenha o container", () => {
  const html = buildScheduleHtml(model);
  assert.match(html, /<!doctype html>/i);
  assert.ok(html.includes(`id="${PAYLOAD_SCRIPT_ID}"`));
  assert.ok(html.includes('id="elos-gantt"'));
  assert.ok(html.includes("JSON.parse(dataEl.textContent)"), "deve embutir o corpo do visualizador");
  assert.ok(html.trimStart().startsWith("<!doctype html>"), "documento completo");
});

test("round-trip: extractSchedulePayload recupera exatamente o payload embutido", () => {
  const html = buildScheduleHtml(model);
  const result = extractSchedulePayload(html);
  assert.equal(result.ok, true);
  assert.equal(result.payload.meta.schemaVersion, SCHEMA_VERSION);
  assert.equal(result.payload.meta.baselineId, "b1");
  assert.equal(result.payload.meta.projectName, "Flow Aptos <Torre A>");
  assert.equal(result.payload.activities.length, 1);
  assert.equal(result.payload.activities[0].code, "ALV-PAV1");
  assert.equal(result.payload.activities[0].plannedCost, 1125.5);
  assert.deepEqual(result.payload.dependencies[0], { predecessorCode: "ALV-PAV1", successorCode: "ALV-PAV2", relationType: "FS", lagDays: 0 });
});

test("o escape de '<' não quebra o parse e preserva o nome com caractere especial", () => {
  const html = buildScheduleHtml(model);
  // o '<' do nome do projeto foi escapado como < dentro do JSON embutido
  assert.ok(html.includes("\\u003c"));
  const result = extractSchedulePayload(html);
  assert.equal(result.ok, true);
  assert.ok(result.payload.meta.projectName.includes("<Torre A>"));
});

test("validateSchedulePayload rejeita arquivos que não são cronograma", () => {
  assert.equal(validateSchedulePayload(null).ok, false);
  assert.equal(validateSchedulePayload({ meta: { kind: "outro" } }).ok, false);
  assert.equal(validateSchedulePayload({ meta: { kind: "cronograma", schemaVersion: 999 } }).ok, false);
  assert.equal(validateSchedulePayload({ meta: { kind: "cronograma", schemaVersion: SCHEMA_VERSION }, activities: [], dependencies: [] }).ok, true);
});

test("extractSchedulePayload trata HTML sem o bloco e JSON corrompido", () => {
  assert.equal(extractSchedulePayload("<html></html>").ok, false);
  const broken = `<script type="application/json" id="${PAYLOAD_SCRIPT_ID}">{ isso não é json }</script>`;
  assert.equal(extractSchedulePayload(broken).ok, false);
});

test("buildSchedulePayload normaliza campos ausentes com padrões seguros", () => {
  const payload = buildSchedulePayload({ meta: { baselineId: "x" }, activities: [{ code: "A", name: "A" }] });
  assert.equal(payload.meta.kind, "cronograma");
  assert.equal(payload.meta.workOnSaturday, false);
  assert.equal(payload.activities[0].teamCount, 1);
  assert.equal(payload.activities[0].plannedCost, 0);
  assert.deepEqual(payload.locations, []);
  assert.deepEqual(payload.dependencies, []);
});
