import { saveKoperStagingRecord } from "../elos/koper-staging-repository.js";
import { collectFlowStagingSample } from "./preview-flow-staging.js";

export async function writeFlowStagingSample(): Promise<{
  ok: true;
  written: number;
  results: Array<{ koperId: string; action: "inserted" | "unchanged" | "updated" }>;
}> {
  if (process.env.KOPER_STAGING_WRITE_ENABLED !== "true") {
    throw new Error("Koper staging write is not explicitly enabled");
  }

  const records = await collectFlowStagingSample();
  const results: Array<{
    koperId: string;
    action: "inserted" | "unchanged" | "updated";
  }> = [];

  for (const record of records) {
    const saved = await saveKoperStagingRecord(record);
    results.push({ koperId: record.koper_id, action: saved.action });
  }

  return { ok: true, written: results.length, results };
}
