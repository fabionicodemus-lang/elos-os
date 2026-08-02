import { inspectFlowStockEntries } from "./diagnostics/inspect-flow-stock-entries.js";

const result = await inspectFlowStockEntries();
console.log("KOPER_STOCK_ENTRY_SHAPE_RESULT", JSON.stringify(result));

await import("./index.js");
