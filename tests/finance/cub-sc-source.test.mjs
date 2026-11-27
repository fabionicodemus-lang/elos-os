import test from "node:test";
import assert from "node:assert/strict";
import { cubWindow, parseCubPublication, fetchCubPublication, runCubSync, CUB_SOURCE_URL } from "../../lib/cub-sc/source.mjs";

const html = `<h3>CUB Norma 2006</h3><p>Residencial Médio</p><p>Mês de Referência: Outubro/2026</p><p>Para ser usado em: Novembro/2026</p><p>R$3.182,95<br>0,35%</p><p>Comercial Médio</p><p>Mês de Referência: Outubro/2026</p><p>Para ser usado em: Novembro/2026</p><p>R$3.385,25<br>0,33%</p><h2>Metodologia</h2>`;

test("São Paulo window includes only local days 1–3, including UTC month boundary", () => {
  assert.equal(cubWindow(new Date("2026-12-01T02:59:59Z")).open, false);
  assert.deepEqual(cubWindow(new Date("2026-12-01T03:00:00Z")), { month: "2026-12-01", day: 1, open: true });
  assert.equal(cubWindow(new Date("2026-12-04T02:59:59Z")).open, true);
  assert.equal(cubWindow(new Date("2026-12-04T03:00:00Z")).open, false);
  assert.equal(cubWindow(new Date("2027-01-01T03:00:00Z")).month, "2027-01-01");
});
test("parses official cards, decimal values and separate reference/application months", () => {
  const value = parseCubPublication(html, "2026-11-01");
  assert.equal(value.reference_month, "2026-10-01");
  assert.equal(value.application_month, "2026-11-01");
  assert.equal(value.residential, 3182.95);
  assert.equal(value.commercial, 3385.25);
  assert.equal(value.source_url, CUB_SOURCE_URL);
  assert.match(value.source_hash, /^[a-f0-9]{64}$/);
  assert.equal(parseCubPublication(html.replaceAll("Outubro/2026", "Dezembro/2026").replaceAll("Novembro/2026", "Janeiro/2027"), "2027-01-01").reference_month, "2026-12-01");
});
test("old month, ambiguous cards, missing values and wrong reference fail closed", () => {
  assert.throws(() => parseCubPublication(html, "2026-12-01"), /not_published/);
  assert.throws(() => parseCubPublication(html.replace("R$3.182,95", "R$"), "2026-11-01"), /invalid_source/);
  assert.throws(() => parseCubPublication(html.replaceAll("Outubro/2026", "Setembro/2026"), "2026-11-01"), /invalid_source/);
  assert.throws(() => parseCubPublication(html.replace("<h2>Metodologia", html+"<h2>Metodologia"), "2026-11-01"), /invalid_source/);
  assert.throws(() => parseCubPublication(html.replace("Residencial Médio", "Residencial Médio Desonerado"), "2026-11-01"), /invalid_source/);
});
test("fetch uses fixed official URL, no redirects and bounds the response", async () => {
  const value = await fetchCubPublication("2026-11-01", async (url, options) => {
    assert.equal(url, CUB_SOURCE_URL); assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
    return new Response(html, { headers: { "content-type": "text/html" } });
  });
  assert.equal(value.residential, 3182.95);
  await assert.rejects(fetchCubPublication("2026-11-01", async () => new Response("blocked", { status: 503 })), /source_unavailable/);
  await assert.rejects(fetchCubPublication("2026-11-01", async () => new Response("x".repeat(2_000_001), { headers: { "content-type": "text/html" } })), /invalid_source/);
});
test("outside window or completed month never fetches the source", async () => {
  let calls = 0;
  const db = { rpc: async () => { calls++; return { data: null }; } };
  const fetchPublication = async () => { throw new Error("must not fetch"); };
  assert.equal((await runCubSync({ db, now: new Date("2026-11-27T12:00Z"), fetchPublication })).status, "outside_window");
  assert.equal(calls, 0);
  assert.equal((await runCubSync({ db, now: new Date("2026-11-02T12:00Z"), fetchPublication })).status, "skipped");
  assert.equal(calls, 1);
});
test("successful claim publishes exactly once; errors are sanitized", async () => {
  for (const fail of [false, true]) {
    const calls = [];
    const db = { rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: name === "cub_sc_claim" ? { month: "2026-11-01", token: "test" } : fail ? "source_unavailable" : "completed" };
    } };
    await runCubSync({ db, now: new Date("2026-11-01T12:00Z"), fetchPublication: async () => { if (fail) throw new Error("private provider response"); return parseCubPublication(html, "2026-11-01"); } });
    assert.equal(calls.length, 2); assert.equal(calls[1].name, "cub_sc_finish");
    assert.equal(calls[1].args.p_failure, fail ? "source_unavailable" : null);
  }
});
