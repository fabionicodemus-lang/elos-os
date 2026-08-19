const originalLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  if (args[0] === "KOPER_SAFE_WBS_CROSSWALK" && typeof args[1] === "string") {
    try {
      const p = JSON.parse(args[1]) as Record<string, unknown>;
      originalLog("KOPER_SAFE_WBS_CROSSWALK_COMPACT", JSON.stringify({
        ok: p.ok,
        readOnly: p.readOnly,
        stagedRows: p.stagedRows,
        pairEvidence: p.pairEvidence,
        entitiesWithEvidence: p.entitiesWithEvidence,
        serviceIds: p.serviceIds,
        monitoringIds: p.monitoringIds,
        duplicatePairsRemoved: p.duplicatePairsRemoved,
      }));
      for (const row of (Array.isArray(p.ambiguousServiceSample) ? p.ambiguousServiceSample : []).slice(0, 15)) {
        originalLog("KOPER_SAFE_WBS_AMBIGUOUS", JSON.stringify(row));
      }
      for (const row of (Array.isArray(p.safeServiceSample) ? p.safeServiceSample : []).slice(0, 25)) {
        originalLog("KOPER_SAFE_WBS_UNIQUE", JSON.stringify(row));
      }
      return;
    } catch {}
  }
  originalLog(...args);
};
originalLog("KOPER_SAFE_WBS_WRAPPER_START");
await new Promise((resolve) => setTimeout(resolve, 1200));
await import("./audit-safe-service-wbs-crosswalk.js");
originalLog("KOPER_SAFE_WBS_WRAPPER_DONE");
await new Promise((resolve) => setTimeout(resolve, 1200));
