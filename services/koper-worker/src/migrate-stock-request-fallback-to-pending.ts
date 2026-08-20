import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type RequestItemRow = {
  id: string;
  project_id: string;
  cost_center_service_id: string | null;
  cost_center_code: string;
  requested_quantity: number;
  notes: string | null;
};

const PENDING_CODE = "KOPER-PENDING-NATIVE-SERVICE";
const PENDING_NAME = "Pendente — sem vínculo nativo no Koper";
const EXPECTED_ROWS = 524;
const EXPECTED_QUANTITY = 111_762.72;

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function readAll<T>(resource: string, query: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(resource, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
      timeoutMs: 30_000,
    });
    rows.push(...page);
    if (page.length < 1_000) return rows;
  }
}

async function main(): Promise<void> {
  const promotedRows = await readAll<RequestItemRow>("execution_material_request_items", {
    select: "id,project_id,cost_center_service_id,cost_center_code,requested_quantity,notes",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    notes: "like.*resolution=v2*",
    order: "id.asc",
  });
  const candidates = promotedRows.filter((row) =>
    row.notes?.includes("reason=no-service-links") || row.notes?.includes("reason=ambiguous-quantity")
  );
  const quantity = candidates.reduce((sum, row) => sum + row.requested_quantity, 0);
  const noLinks = candidates.filter((row) => row.notes?.includes("reason=no-service-links")).length;
  const ambiguous = candidates.filter((row) => row.notes?.includes("reason=ambiguous-quantity")).length;
  const currentPending = candidates.filter((row) =>
    row.cost_center_service_id === null && row.cost_center_code === PENDING_CODE
  ).length;
  const realServiceRows = promotedRows.filter((row) => row.cost_center_service_id !== null).length;
  const legacyRows = promotedRows.filter((row) => row.cost_center_code === "KOPER-SR-LEGACY").length;
  const unclassifiedRows = promotedRows.length - realServiceRows - currentPending;
  const preview = {
    promotedRows: promotedRows.length,
    realServiceRows,
    candidates: candidates.length,
    noLinks,
    ambiguous,
    currentPending,
    legacyRows,
    unclassifiedRows,
    quantity,
  };
  console.log("KOPER_STOCK_REQUEST_PENDING_PREVIEW", JSON.stringify(preview));

  if (candidates.length !== EXPECTED_ROWS || Math.abs(quantity - EXPECTED_QUANTITY) > 0.00001) {
    throw new Error(`Pending preflight mismatch rows=${candidates.length} quantity=${quantity}`);
  }
  if (noLinks !== 517 || ambiguous !== 7) {
    throw new Error(`Fallback reason mismatch noLinks=${noLinks} ambiguous=${ambiguous}`);
  }
  if (promotedRows.length !== 3_769 || realServiceRows !== 3_245 || legacyRows !== 0 || unclassifiedRows !== 0) {
    throw new Error(`Promotion mismatch rows=${promotedRows.length} real=${realServiceRows} legacy=${legacyRows} unclassified=${unclassifiedRows}`);
  }
  if (process.env.KOPER_STOCK_REQUEST_NATIVE_PENDING_ENABLED !== "true") {
    console.log("KOPER_STOCK_REQUEST_PENDING_SKIPPED", JSON.stringify({ reason: "write-flag-disabled" }));
    return;
  }

  let updated = 0;
  for (const batch of chunks(candidates.map((row) => row.id), 100)) {
    const rows = await requestSupabase<Array<{ id: string }>>("execution_material_request_items", {
      method: "PATCH",
      body: {
        cost_center_service_id: null,
        cost_center_code: PENDING_CODE,
        cost_center_name: PENDING_NAME,
        updated_at: new Date().toISOString(),
      },
      prefer: "return=representation",
      query: new URLSearchParams({
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        id: `in.(${batch.join(",")})`,
        select: "id",
      }),
      timeoutMs: 30_000,
    });
    updated += rows.length;
  }

  const verifiedRows = await readAll<RequestItemRow>("execution_material_request_items", {
    select: "id,project_id,cost_center_service_id,cost_center_code,requested_quantity,notes",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    notes: "like.*resolution=v2*",
    order: "id.asc",
  });
  const pendingRows = verifiedRows.filter((row) =>
    (row.notes?.includes("reason=no-service-links") || row.notes?.includes("reason=ambiguous-quantity"))
    && row.cost_center_service_id === null
    && row.cost_center_code === PENDING_CODE
  );
  const pendingQuantity = pendingRows.reduce((sum, row) => sum + row.requested_quantity, 0);
  if (updated !== EXPECTED_ROWS || pendingRows.length !== EXPECTED_ROWS) {
    throw new Error(`Pending verification mismatch updated=${updated} pending=${pendingRows.length}`);
  }
  if (Math.abs(pendingQuantity - EXPECTED_QUANTITY) > 0.00001) {
    throw new Error(`Pending quantity mismatch ${pendingQuantity}`);
  }
  console.log("KOPER_STOCK_REQUEST_PENDING_RESULT", JSON.stringify({
    updated,
    remainingFallback: 0,
    pendingRows: pendingRows.length,
    pendingQuantity,
  }));
}

void main().catch((error) => {
  console.error("KOPER_STOCK_REQUEST_PENDING_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
