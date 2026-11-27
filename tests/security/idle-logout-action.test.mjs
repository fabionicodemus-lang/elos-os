import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual Server Action with isolated Auth/cookie adapters. No
// credentials, Next server, or hosted database is used by this test.
function actionFixture({ sessionId = "session-a", claimsError = null, signOutError = null } = {}) {
  const removed = [], signOuts = [];
  const cookieNames = ["sb-test-auth-token", "sb-test-auth-token.0", "sb-test-auth-token.1", "sb-test-auth-token-code-verifier", "sb-other-auth-token", "preference"];
  const modules = {
    "next/headers": { cookies: async () => ({ getAll: () => cookieNames.map(name => ({ name })), delete: name => removed.push(name) }) },
    "@/lib/supabase/config": { getSupabaseConfig: () => ({ url: "https://test.supabase.co" }) },
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      getClaims: async () => ({ data: sessionId ? { claims: { session_id: sessionId } } : null, error: claimsError }),
      signOut: async options => { signOuts.push(options); return { error: signOutError }; },
    } }) },
  };
  const source = readFileSync(new URL("../../app/login/idle-actions.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, URL, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  return { run: exports.logoutInactiveSession, removed, signOuts };
}

test("idle logout ends only the current session and removes its cookies/context", async () => {
  const f = actionFixture();
  assert.equal(await f.run("session-a"), "expired");
  assert.equal(f.signOuts.length, 1);
  assert.equal(f.signOuts[0].scope, "local");
  assert.deepEqual(f.removed, ["sb-test-auth-token", "sb-test-auth-token.0", "sb-test-auth-token.1", "sb-test-auth-token-code-verifier", "elos_company_id", "elos_project_id"]);
});
test("stale tab cannot sign out a newly authenticated session", async () => {
  const f = actionFixture({ sessionId: "new-session" });
  assert.equal(await f.run("old-session"), "changed");
  assert.equal(f.signOuts.length, 0);
  assert.equal(f.removed.length, 0);
});
test("cookies are cleared even when remote revocation returns an error", async () => {
  const f = actionFixture({ signOutError: { message: "unavailable" } });
  assert.equal(await f.run("session-a"), "expired");
  assert.ok(f.removed.includes("sb-test-auth-token.0"));
});
test("missing/expired session still clears stale auth cookies", async () => {
  const f = actionFixture({ sessionId: null, claimsError: { message: "expired" } });
  assert.equal(await f.run("session-a"), "expired");
  assert.ok(f.removed.includes("elos_company_id"));
});
