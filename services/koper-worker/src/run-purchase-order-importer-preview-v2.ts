// One-shot read-only runner for the authenticated Koper Accounts Payable audit.
void import("./audit-full-koper-payables-authenticated.js").catch((error) => {
  console.error("KOPER_LIVE_PAYABLE_AUDIT_RUNNER_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
