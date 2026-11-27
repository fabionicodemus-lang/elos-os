import test from "node:test";
import assert from "node:assert/strict";
import { createIdleSession, IDLE_TIMEOUT_MS, IDLE_WARNING_MS, idleSessionId } from "../../lib/auth/idle-session.mjs";

function fixture() {
  let time = 100000;
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let expired = 0;
  const options = { storage, sessionId: "test-session", now: () => time, onExpire: () => expired++ };
  return { options, values, advance: ms => { time += ms; }, expired: () => expired };
}

test("warns two minutes before expiry and expires at exactly 30 minutes", () => {
  const f = fixture(), session = createIdleSession(f.options);
  f.advance(IDLE_TIMEOUT_MS - IDLE_WARNING_MS);
  assert.equal(session.check().warning, true);
  f.advance(IDLE_WARNING_MS - 1);
  assert.equal(session.check().expired, false);
  f.advance(1);
  assert.equal(session.check().expired, true);
  session.check();
  assert.equal(f.expired(), 1);
});
test("real activity extends the deadline; timer checks do not", () => {
  const f = fixture(), session = createIdleSession(f.options);
  f.advance(20 * 60000); session.activity();
  f.advance(20 * 60000); assert.equal(session.check().expired, false);
  f.advance(10 * 60000); assert.equal(session.check().expired, true);
});
test("resume after suspension expires before accepting a click", () => {
  const f = fixture(), session = createIdleSession(f.options);
  f.advance(3 * IDLE_TIMEOUT_MS);
  assert.equal(session.activity(), false);
  assert.equal(f.expired(), 1);
});
test("reload and refresh preserve the existing deadline", () => {
  const f = fixture(); createIdleSession(f.options);
  f.advance(IDLE_TIMEOUT_MS);
  assert.equal(createIdleSession(f.options).check().expired, true);
});
test("activity in one tab keeps the same session active in another tab", () => {
  const f = fixture(), a = createIdleSession(f.options), b = createIdleSession(f.options);
  f.advance(IDLE_TIMEOUT_MS - 1000); a.activity();
  f.advance(1000); assert.equal(b.check().expired, false);
  f.advance(IDLE_TIMEOUT_MS); assert.equal(b.check().expired, true);
  assert.equal(a.activity(), false);
});
test("expired marker survives reload even when logout is offline", () => {
  const f = fixture(), a = createIdleSession(f.options);
  f.advance(IDLE_TIMEOUT_MS); a.check();
  const reloaded = createIdleSession(f.options);
  assert.equal(reloaded.activity(), false);
});
test("new login has its own deadline", () => {
  const f = fixture(), old = createIdleSession(f.options);
  f.advance(IDLE_TIMEOUT_MS); old.check();
  const fresh = createIdleSession({ ...f.options, sessionId: "new-session" });
  assert.equal(fresh.check().expired, false);
});
test("clock rollback cannot extend the session", () => {
  const f = fixture(), session = createIdleSession(f.options);
  f.advance(-1000); assert.equal(session.check().expired, true);
});
test("unavailable or malformed initial storage fails closed", () => {
  const f = fixture();
  f.options.storage.getItem = () => { throw new Error("blocked"); };
  assert.equal(createIdleSession(f.options).check().expired, true);
  f.options.storage.getItem = () => "invalid-json";
  assert.equal(createIdleSession(f.options).check().expired, true);
});
test("a storage failure after initialization does not reset the deadline", () => {
  const f = fixture(), session = createIdleSession(f.options);
  f.options.storage.getItem = () => { throw new Error("blocked"); };
  f.advance(IDLE_TIMEOUT_MS); assert.equal(session.check().expired, true);
});
test("JWT parsing is only a namespace, stable across refreshed tokens", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const token = exp => `header.${Buffer.from(JSON.stringify({ session_id: id, exp })).toString("base64url")}.signature`;
  assert.equal(idleSessionId(token(100)), id);
  assert.equal(idleSessionId(token(200)), id);
  assert.equal(idleSessionId("invalid"), null);
});
