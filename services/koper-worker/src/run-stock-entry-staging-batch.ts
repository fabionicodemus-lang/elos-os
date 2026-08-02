try {
  await import("./stock-entry-staging-batch-and-start.js");
} catch (error: unknown) {
  const raw = error instanceof Error ? error.message : "Unknown error";
  const reason = /429 Too Many Requests/i.test(raw)
    ? "BROWSERLESS_RATE_LIMIT"
    : /Request context disposed|timeout/i.test(raw)
      ? "BROWSERLESS_SESSION_LIMIT"
      : raw
          .split("\n")[0]
          ?.replace(/[a-z]+:\/\/\S+/gi, "[URL_REDACTED]")
          .replace(/(?:accessToken|x-accesstoken|authorization|cookie)[^\s,;]*/gi, "[CREDENTIAL_REDACTED]")
          .slice(0, 300)
        ?? "UNKNOWN_BATCH_FAILURE";
  console.error("KOPER_STOCK_ENTRY_STAGING_BATCH_FAILED", { reason });
  await import("./index.js");
}
