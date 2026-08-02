import { inventoryFlowStockEntries } from "./diagnostics/inventory-flow-stock-entries.js";

const result = await inventoryFlowStockEntries();
console.log("KOPER_STOCK_ENTRY_INVENTORY_RESULT", JSON.stringify(result));

await import("./index.js");
