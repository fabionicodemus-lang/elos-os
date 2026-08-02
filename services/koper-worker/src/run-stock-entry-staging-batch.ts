try {
  await import("./stock-entry-staging-batch-and-start.js");
} catch (error: unknown) {
  const raw = error instanceof Error ? error.message : "Unknown error";
  const safeMessage = raw
    .replace(/https?:\/\/\S+/gi, "[URL_REDACTED]")
    .replace(/(?:accessToken|x-accesstoken|authorization|cookie)[^\s,;]*/gi, "[CREDENTIAL_REDACTED]")
    .slice(0, 500);
  console.error("KOPER_STOCK_ENTRY_STAGING_BATCH_FAILED", { message: safeMessage });
  process.exitCode = 1;
}
