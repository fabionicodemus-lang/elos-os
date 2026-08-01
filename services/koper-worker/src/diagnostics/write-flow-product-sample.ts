import { env } from "../config/env.js";
import { saveKoperStagingRecord } from "../elos/koper-staging-repository.js";
import { createKoperStagingRecord } from "../sync/staging-record.js";
import type { KoperStagingRecord } from "../sync/staging-record.js";
import { inspectKoperFlowContext } from "./inspect-koper-companies.js";

const FLOW_ENTERPRISE_ID = "6d3b4724-5880-11ee-827d-1219c832db49";

export function buildProductStagingRecords(
  products: Array<Record<string, unknown>>,
): KoperStagingRecord[] {
  return products.flatMap((product) => {
    const productId = product.productId;
    if (typeof productId !== "string" && typeof productId !== "number") return [];

    const parentId = product.mainProductId;
    return [createKoperStagingRecord({
      companyId: env.BOSSA_COMPANY_ID,
      entity: "product",
      koperId: productId,
      koperParentId:
        typeof parentId === "string" || typeof parentId === "number"
          ? parentId
          : null,
      sanitizedPayload: {
        enterpriseId: FLOW_ENTERPRISE_ID,
        ...product,
      },
      mappingVersion: 1,
    })];
  });
}

async function collectProductSample(): Promise<KoperStagingRecord[]> {
  const previousMode = process.env.KOPER_PRODUCT_DISCOVERY_ONLY;
  process.env.KOPER_PRODUCT_DISCOVERY_ONLY = "true";

  try {
    const diagnostic = await inspectKoperFlowContext();
    if (!diagnostic.authenticated || !diagnostic.flowSelected) {
      throw new Error("Flow context was not established");
    }

    const page = diagnostic.productCatalogReads.find((read) =>
      read.endpoint.endsWith("/stock/v1/product")
      && read.queryParams.limit === "25"
      && read.queryParams.offset === "0"
    );
    if (!page) throw new Error("Koper product sample was not captured");

    return buildProductStagingRecords(page.sample);
  } finally {
    if (previousMode === undefined) delete process.env.KOPER_PRODUCT_DISCOVERY_ONLY;
    else process.env.KOPER_PRODUCT_DISCOVERY_ONLY = previousMode;
  }
}

export async function writeFlowProductSample(): Promise<{
  ok: true;
  sampled: number;
  results: Array<{ koperId: string; action: "inserted" | "unchanged" | "updated" }>;
}> {
  if (
    process.env.KOPER_STAGING_WRITE_ENABLED !== "true"
    || process.env.KOPER_PRODUCT_STAGING_WRITE_ENABLED !== "true"
  ) {
    throw new Error("Koper product staging write is not explicitly enabled");
  }

  const records = await collectProductSample();
  const results = [];

  for (const record of records) {
    const saved = await saveKoperStagingRecord(record);
    results.push({ koperId: record.koper_id, action: saved.action });
  }

  return { ok: true, sampled: records.length, results };
}
