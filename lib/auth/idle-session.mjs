export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const IDLE_WARNING_MS = 2 * 60 * 1000;

// This is a browser inactivity control, not an authorization boundary. Never
// use this localStorage record to authorize requests or validate a JWT.
export function createIdleSession({ sessionId, storage, now = Date.now, onExpire = () => {} }) {
  const key = `elos:idle:v1:${sessionId}`;
  let record;
  let expired = false;
  function read() {
    try {
      const raw = storage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (!Number.isFinite(parsed.lastActiveAt) || typeof parsed.expired !== "boolean") throw new Error("Invalid idle record");
        return parsed;
      }
    } catch {
      // With unavailable storage keep the in-memory deadline. Never renew it.
      return record ?? { lastActiveAt: now(), expired: true };
    }
    return record ?? { lastActiveAt: now(), expired: false };
  }
  function write() {
    try { storage.setItem(key, JSON.stringify(record)); } catch { /* memory fallback */ }
  }
  record = read();
  write();
  function check() {
    if (!expired) {
      record = read();
      const time = now();
      // Sleep/resume and clock rollback must not revive an expired session.
      if (record.expired || time < record.lastActiveAt || time - record.lastActiveAt >= IDLE_TIMEOUT_MS) {
        expired = true;
        record.expired = true;
        write();
        onExpire();
      }
    }
    const remaining = expired ? 0 : Math.max(0, IDLE_TIMEOUT_MS - (now() - record.lastActiveAt));
    return { expired, remaining, warning: !expired && remaining <= IDLE_WARNING_MS };
  }
  return {
    key,
    check,
    activity() {
      if (check().expired) return false;
      record = { lastActiveAt: now(), expired: false };
      write();
      return true;
    },
  };
}

// Read only a stable session namespace; authentication stays with Supabase.
export function idleSessionId(accessToken) {
  try {
    const encoded = accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const id = JSON.parse(atob(encoded)).session_id;
    return typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id) ? id : null;
  } catch { return null; }
}
