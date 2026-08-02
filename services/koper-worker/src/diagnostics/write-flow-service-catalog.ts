import { env } from "../config/env.js";
import { saveKoperStagingBatch } from "../elos/koper-staging-repository.js";
import { createKoperStagingRecord } from "../sync/staging-record.js";
import type { KoperStagingRecord } from "../sync/staging-record.js";
import { inspectKoperEngineering } from "./inspect-koper-engineering.js";

const FLOW_ENTERPRISE_ID = "6d3b4724-5880-11ee-827d-1219c832db49";

export function buildServiceStagingRecords(
  services: Array<Record<string, unknown>>,
): KoperStagingRecord[] {
  const unique = new Map<string, Record<string, unknown>>();

  for (const service of services) {
    const serviceId = service.serviceId;
    if (typeof serviceId !== "string" && typeof serviceId !== "number") continue;
    unique.set(String(serviceId), service);
  }

  return [...unique.values()].map((service) => {
    const serviceId = service.serviceId as string | number;
    const categoryId = service.categoryId;

    return createKoperStagingRecord({
      companyId: env.BOSSA_COMPANY_ID,
      entity: "service",
      koperId: serviceId,
      koperParentId:
        typeof categoryId === "string" || typeof categoryId === "number"
          ? categoryId
          : null,
      sanitizedPayload: {
        enterpriseId: FLOW_ENTERPRISE_ID,
        serviceId,
        serviceName: service.serviceName ?? null,
        categoryId: categoryId ?? null,
        categoryName: service.categoryName ?? null,
        subcategoryId: service.subcategoryId ?? null,
        subcategoryName: service.subcategoryName ?? null,
        unitMeasureId: service.unitMeasureId ?? null,
        unitMeasureName: service.unitMeasureName ?? null,
        version: service.version ?? null,
        weather: service.weather ?? null,
      },
      mappingVersion: 1,
    });
  });
}

export async function writeFlowServiceCatalog(): Promise<{
  ok: true;
  extracted: number;
  inserted: number;
  unchanged: number;
  updated: number;
}> {
  if (
    process.env.KOPER_STAGING_WRITE_ENABLED !== "true" ||
    process.env.KOPER_SERVICE_STAGING_WRITE_ENABLED !== "true" ||
    process.env.KOPER_SERVICE_FULL_STAGING_WRITE_ENABLED !== "true"
  ) {
    throw new Error("Full Koper service staging write is not explicitly enabled");
  }

  const diagnostic = await inspectKoperEngineering({
    collectFullServices: true,
  });

  if (!diagnostic.authenticated || !diagnostic.flowSelected) {
    throw new Error("Flow context was not established");
  }

  if (!diagnostic.fullServiceRecords) {
    throw new Error("Full Koper service catalog was not captured");
  }

  const records = buildServiceStagingRecords(diagnostic.fullServiceRecords);
  const result = await saveKoperStagingBatch(records);

  return {
    ok: true,
    extracted: records.length,
    ...result,
  };
}
