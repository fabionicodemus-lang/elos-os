import { inspectKoperMenuMap } from "./diagnostics/inspect-koper-menu-map.js";

try {
  const result = await inspectKoperMenuMap();
  console.log("KOPER_MENU_MAP_RESULT", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_MENU_MAP_FAILED", JSON.stringify({
    message: error instanceof Error ? error.message.slice(0, 1_000) : String(error),
  }));
}

await import("./index.js");
