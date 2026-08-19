const originalLog = console.log.bind(console);

console.log = (...args: unknown[]) => {
  if (args[0] === "KOPER_RECEIPT_WBS_RESULT" && typeof args[1] === "string") {
    try {
      const payload = JSON.parse(args[1]) as Record<string, unknown>;
      const compact = {
        ok: payload.ok,
        readOnly: payload.readOnly,
        selectedBills: payload.selectedBills,
        blockedWrites: payload.blockedWrites,
        receiptBills: payload.receiptBills,
        receiptValue: payload.receiptValue,
        resolutions: payload.resolutions,
        unique: payload.unique,
        purchaseBridge: payload.purchaseBridge,
      };
      originalLog("KOPER_RECEIPT_WBS_COMPACT", JSON.stringify(compact));
      const exceptions = Array.isArray(payload.exceptions) ? payload.exceptions : [];
      for (const row of exceptions.slice(0, 12)) {
        const r = row as Record<string, unknown>;
        originalLog("KOPER_RECEIPT_WBS_EXCEPTION", JSON.stringify({
          billId: r.billId,
          value: r.value,
          receiptId: r.receiptId,
          purchaseIds: r.purchaseIds,
          serviceOrderIds: r.serviceOrderIds,
          serviceIds: r.serviceIds,
          serviceNames: r.serviceNames,
          wbsReferences: r.wbsReferences,
          costCenterIds: r.costCenterIds,
          buildMonitoringIds: r.buildMonitoringIds,
          evidencePath: r.evidencePath,
          resolution: r.resolution,
          error: r.error,
        }));
      }
      const wbsSample = Array.isArray(payload.wbsSample) ? payload.wbsSample : [];
      for (const row of wbsSample.slice(0, 8)) {
        const r = row as Record<string, unknown>;
        originalLog("KOPER_RECEIPT_WBS_EXACT", JSON.stringify({
          billId: r.billId,
          value: r.value,
          receiptId: r.receiptId,
          purchaseIds: r.purchaseIds,
          serviceOrderIds: r.serviceOrderIds,
          serviceIds: r.serviceIds,
          serviceNames: r.serviceNames,
          wbsReferences: r.wbsReferences,
          evidencePath: r.evidencePath,
        }));
      }
      return;
    } catch {
      originalLog(...args);
      return;
    }
  }
  originalLog(...args);
};

await import("./resolve-native-payable-receipt-wbs.js");
