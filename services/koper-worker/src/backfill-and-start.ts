import { backfillKoperHistoricalSuppliers } from "./diagnostics/backfill-koper-historical-suppliers.js";

const result = await backfillKoperHistoricalSuppliers();
console.log("KOPER_BACKFILL_RESULT", JSON.stringify(result));
await import("./index.js");
