import { readFile, writeFile } from "node:fs/promises";

const target = new URL("./inspect-live-stock-order-linkage.js", import.meta.url);

try {
  const compiled = await readFile(target, "utf8");
  const patched = compiled
    .replaceAll("sessionTimeoutMs: 75000", "sessionTimeoutMs: 58000")
    .replaceAll("sessionTimeoutMs: 75_000", "sessionTimeoutMs: 58_000");

  if (patched === compiled) {
    console.warn("KOPER_LIVE_LINKAGE_RUNNER_PATCH_NOT_FOUND");
  } else {
    await writeFile(target, patched, "utf8");
    console.log("KOPER_LIVE_LINKAGE_RUNNER_PATCHED", JSON.stringify({ sessionTimeoutMs: 58_000 }));
  }

  await import("./inspect-live-stock-order-linkage.js");
} catch (error: unknown) {
  console.error("KOPER_LIVE_LINKAGE_RUNNER_FAILED", JSON.stringify({
    message: error instanceof Error ? error.message.slice(0, 1_200) : "unknown",
  }));
}

await import("./index.js");
