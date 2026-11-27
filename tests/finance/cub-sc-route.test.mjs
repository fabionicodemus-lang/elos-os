import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

function fixture(env, failure = false) {
  const calls = [], logs = [];
  const modules = {
    "node:crypto": { timingSafeEqual },
    "@/lib/supabase/admin": { createAuthAdminClient: () => { calls.push("admin"); return {}; } },
    "@/lib/cub-sc/source.mjs": { runCubSync: async () => { calls.push("sync"); if (failure) throw new Error("private DB response"); return { status: "skipped" }; } },
  };
  const source = readFileSync(new URL("../../app/api/cron/cub-sc/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Response, TextEncoder, process: { env }, console: { error: m => logs.push(m) }, require: name => { assert.ok(modules[name]); return modules[name]; } });
  return { calls, logs, get: token => exports.GET(new Request("https://test.invalid/api/cron/cub-sc", { headers: token ? { authorization: token } : {} })) };
}
test("cron rejects missing configuration, missing header and incorrect secrets before DB access", async () => {
  for (const [secret, header] of [[undefined, "Bearer undefined"], ["test", null], ["test", "Bearer wrong"], ["test", "Bearer tesX"]]) {
    const f = fixture({ CRON_SECRET: secret, VERCEL_ENV: "production" });
    assert.equal((await f.get(header)).status, 401); assert.equal(f.calls.length, 0);
  }
});
test("preview and development never execute the worker", async () => {
  for (const env of ["preview", "development", undefined]) {
    const f = fixture({ CRON_SECRET: "test", VERCEL_ENV: env });
    assert.equal((await (await f.get("Bearer test")).json()).status, "disabled"); assert.equal(f.calls.length, 0);
  }
});
test("authorized production executes once and response never caches", async () => {
  const f = fixture({ CRON_SECRET: "test", VERCEL_ENV: "production" });
  const response = await f.get("Bearer test");
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(f.calls, ["admin", "sync"]);
});
test("worker failure exposes only a sanitized error", async () => {
  const f = fixture({ CRON_SECRET: "test", VERCEL_ENV: "production" }, true);
  const response = await f.get("Bearer test");
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "cub_sc_sync_failed" });
  assert.deepEqual(f.logs, ["cub_sc_sync_failed"]);
});
