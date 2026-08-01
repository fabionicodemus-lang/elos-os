import { saveKoperStagingBatch } from "../elos/koper-staging-repository.js";
import { inspectKoperFlowContext } from "./inspect-koper-companies.js";
import { buildProductStagingRecords } from "./write-flow-product-sample.js";

export async function writeFlowProductCatalog(): Promise<{
  ok: true;
  extracted: number;
  inserted: number;
  unchanged: number;
  updated: number;
}> {
  if (
    process.env.KOPER_STAGING_WRITE_ENABLED !== "true"
    || process.env.KOPER_PRODUCT_STAGING_WRITE_ENABLED !== "true"
    || process.env.KOPER_PRODUCT_FULL_STAGING_WRITE_ENABLED !== "true"
  ) throw new Error("Full Koper product staging write is not explicitly enabled");

  const previousDiscovery = process.env.KOPER_PRODUCT_DISCOVERY_ONLY;
  const previousFullMode = process.env.KOPER_PRODUCT_FULL_IMPORT_MODE;
  process.env.KOPER_PRODUCT_DISCOVERY_ONLY = "true";
  process.env.KOPER_PRODUCT_FULL_IMPORT_MODE = "true";

  try {
    const diagnostic = await inspectKoperFlowContext();
    if (!diagnostic.authenticated || !diagnostic.flowSelected) {
      throw new Error("Flow context was not established");
    }
    const catalog = diagnostic.productCatalogReads.find((read) =>
      read.endpoint.endsWith("/stock/v1/product")
      && read.queryParams.allProducts === "all"
      && Array.isArray(read.records)
    );
    if (!catalog?.records) throw new Error("Full Koper product catalog was not captured");

    const records = buildProductStagingRecords(catalog.records);
    const result = await saveKoperStagingBatch(records);
    return { ok: true, extracted: records.length, ...result };
  } finally {
    if (previousDiscovery === undefined) delete process.env.KOPER_PRODUCT_DISCOVERY_ONLY;
    else process.env.KOPER_PRODUCT_DISCOVERY_ONLY = previousDiscovery;
    if (previousFullMode === undefined) delete process.env.KOPER_PRODUCT_FULL_IMPORT_MODE;
    else process.env.KOPER_PRODUCT_FULL_IMPORT_MODE = previousFullMode;
  }
}
