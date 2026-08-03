import test from "node:test";
import assert from "node:assert/strict";
import { buildSafeMonthWindow, MAX_CURVE_MONTHS } from "./month-window.mjs";

test("mantém intervalo normal completo", () => {
  const result = buildSafeMonthWindow(["2026-01", "2026-03"], "2026-02");
  assert.deepEqual(result.keys, ["2026-01", "2026-02", "2026-03"]);
  assert.equal(result.truncated, false);
});

test("limita datas extremas sem criar milhares de competências", () => {
  const result = buildSafeMonthWindow(["0001-01", "2026-08", "9999-12"], "2026-08");
  assert.equal(result.keys.length, MAX_CURVE_MONTHS);
  assert.equal(result.truncated, true);
  assert.ok(result.keys.includes("2026-08"));
  assert.equal(result.keys[0], "2024-08");
});

test("ignora competências inválidas", () => {
  const result = buildSafeMonthWindow(["x", "2026-00", "2026-01", "2026-13"], "2026-01");
  assert.deepEqual(result.keys, ["2026-01"]);
});
