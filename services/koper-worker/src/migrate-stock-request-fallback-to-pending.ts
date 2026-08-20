import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type RequestItemRow = {
  id: string;
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
  const projects = await requestSupabase<Array<{ id: string }>>("projects", {
    query: new URLSearchParams({
      select: "id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      name: "ilike.*Flow*",
      status: "neq.archived",
      limit: "10",
    }),
  });
  const project = projects[0];
  if (projects.length !== 1 || !project) throw new Error("Flow project is ambiguous");

  const fallbackServices = await requestSupabase<Array<{ id: string }>>("engineering_services", {
    query: new URLSearchParams({
      select: "id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      source_id: "eq.stock-request-legacy-cost-center",
    }),
  });
  const fallback = fallbackServices[0];
  if (fallbackServices.length !== 1 || !fallback) throw new Error("KOPER-SR-LEGACY service is ambiguous");

  const fallbackRows = await readAll<RequestItemRow>("execution_material_request_items", {
    select: "id,requested_quantity,notes",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    project_id: `eq.${project.id}`,
    cost_center_service_id: `eq.${fallback.id}`,
    notes: "like.*resolution=v2*",
    order: "id.asc",
  });
  const quantity = fallbackRows.reduce((sum, row) => sum + row.requested_quantity, 0);
  const noLinks = fallbackRows.filter((row) => row.notes?.includes("reason=no-service-links")).length;
  const ambiguous = fallbackRows.filter((row) => row.notes?.includes("reason=ambiguous-quantity")).length;
  const preview = { fallbackRows: fallbackRows.length, noLinks, ambiguous, quantity };
  console.log("KOPER_STOCK_REQUEST_PENDING_PREVIEW", JSON.stringify(preview));

  if (fallbackRows.length !== EXPECTED_ROWS || Math.abs(quantity - EXPECTED_QUANTITY) > 0.00001) {
    throw new Error(`Fallback preflight mismatch rows=${fallbackRows.length} quantity=${quantity}`);
  }
  if (noLinks !== 517 || ambiguous !== 7) {
    throw new Error(`Fallback reason mismatch noLinks=${noLinks} ambiguous=${ambiguous}`);
  }
  if (process.env.KOPER_STOCK_REQUEST_NATIVE_PENDING_ENABLED !== "true") {
    console.log("KOPER_STOCK_REQUEST_PENDING_SKIPPED", JSON.stringify({ reason: "write-flag-disabled" }));
    return;
  }

  let updated = 0;
  for (const batch of chunks(fallbackRows.map((row) => row.id), 100)) {
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
        project_id: `eq.${project.id}`,
        id: `in.(${batch.join(",")})`,
        select: "id",
      }),
      timeoutMs: 30_000,
    });
    updated += rows.length;
  }

  const [remainingFallback, pendingRows] = await Promise.all([
    readAll<{ id: string }>("execution_material_request_items", {
      select: "id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${project.id}`,
      cost_center_service_id: `eq.${fallback.id}`,
      notes: "like.*resolution=v2*",
      order: "id.asc",
    }),
    readAll<RequestItemRow>("execution_material_request_items", {
      select: "id,requested_quantity,notes",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${project.id}`,
      cost_center_service_id: "is.null",
      cost_center_code: `eq.${PENDING_CODE}`,
      notes: "like.*resolution=v2*",
      order: "id.asc",
    }),
  ]);
  const pendingQuantity = pendingRows.reduce((sum, row) => sum + row.requested_quantity, 0);
  if (updated !== EXPECTED_ROWS || remainingFallback.length !== 0 || pendingRows.length !== EXPECTED_ROWS) {
    throw new Error(`Pending verification mismatch updated=${updated} fallback=${remainingFallback.length} pending=${pendingRows.length}`);
  }
  if (Math.abs(pendingQuantity - EXPECTED_QUANTITY) > 0.00001) {
    throw new Error(`Pending quantity mismatch ${pendingQuantity}`);
  }
  console.log("KOPER_STOCK_REQUEST_PENDING_RESULT", JSON.stringify({
    updated,
    remainingFallback: remainingFallback.length,
    pendingRows: pendingRows.length,
    pendingQuantity,
  }));
}

void main().catch((error) => {
  console.error("KOPER_STOCK_REQUEST_PENDING_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
