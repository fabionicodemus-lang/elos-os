import { inspectFlowPurchaseBridge } from "./diagnostics/inspect-flow-purchase-bridge.js";

const result = await inspectFlowPurchaseBridge();
console.log("KOPER_PURCHASE_BRIDGE_RESULT", JSON.stringify(result));

await import("./index.js");
