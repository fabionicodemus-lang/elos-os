import { env } from "../config/env.js";
import { createKoperStagingRecord } from "../sync/staging-record.js";
import { inspectKoperFlowContext } from "./inspect-koper-companies.js";

const FLOW_ENTERPRISE_ID = "6d3b4724-5880-11ee-827d-1219c832db49";
const SAMPLE_LIMIT = 5;

export async function previewFlowStaging(): Promise<{
  ok: true;
  dryRun: true;
  companyId: string;
  enterpriseId: string;
  entity: "stock_request";
  sampledRecords: number;
  records: Array<{
    koperId: string;
    payloadHash: string;
    payload: unknown;
  }>;
}> {
  const diagnostic = await inspectKoperFlowContext();

  if (!diagnostic.authenticated || !diagnostic.flowSelected) {
    throw new Error("Flow context was not established");
  }

  const samples = diagnostic.stockRequestReads
    .filter((read) => read.listMode === "active")
    .flatMap((read) => read.requests)
    .filter((item) => item.requestId !== null)
    .slice(0, SAMPLE_LIMIT);

  const records = samples.map((sample) => {
    const staging = createKoperStagingRecord({
      companyId: env.BOSSA_COMPANY_ID,
      entity: "stock_request",
      koperId: sample.requestId as string | number,
      sanitizedPayload: {
        enterpriseId: FLOW_ENTERPRISE_ID,
        ...sample,
      },
      koperCreatedAt: sample.requestDate,
      mappingVersion: 1,
    });

    return {
      koperId: staging.koper_id,
      payloadHash: staging.payload_hash,
      payload: staging.payload,
    };
  });

  return {
    ok: true,
    dryRun: true,
    companyId: env.BOSSA_COMPANY_ID,
    enterpriseId: FLOW_ENTERPRISE_ID,
    entity: "stock_request",
    sampledRecords: records.length,
    records,
  };
}
