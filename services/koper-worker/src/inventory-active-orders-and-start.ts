import { inventoryFlowActivePurchaseOrders } from "./diagnostics/inventory-flow-active-purchase-orders.js";

const result = await inventoryFlowActivePurchaseOrders();
console.log("KOPER_ACTIVE_PURCHASE_ORDER_INVENTORY_RESULT", JSON.stringify(result));

await import("./index.js");
