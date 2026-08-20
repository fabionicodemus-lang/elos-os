import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
import {
  officialStockRequestServiceKey,
  resolveFlowStockRequestServices,
} from "./resolve-flow-stock-request-services.js";

type RecordValue = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type RequestRow = { id: string; request_number: string };
type InputRow = {
  id: string;
  source_id: string | null;
  code: string;
  description: string;
  unit: string;
  category: string;
};
type ServiceRow = {
  id: string;
  source_id: string | null;
  code: string;
  description: string;
};
type IntendedItem = {
  requestId: string;
  input: InputRow;
  service: ServiceRow | null;
  quantity: number;
  productRequestIds: string[];
  evidence: string[];
};

type IntendedPayload = {
  company_id: string;
  project_id: string;
  request_id: string;
  input_id: string;
  input_code: string;
  input_name: string;
  unit_snapshot: string;
  category_snapshot: string;
  cost_center_service_id: string | null;
  cost_center_code: string;
  cost_center_name: string;
  requested_quantity: number;
  notes: string;
  sort_order: number;
  updated_at: string;
};

function objectValue(value: unknown): RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : {};
}

function identifier(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function almostEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.00001;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
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
    if (page.length < 1_000) break;
  }
  return rows;
}

async function buildIntendedPayloads(): Promise<{
  projectId: string;
  payloads: IntendedPayload[];
  sourceItems: number;
  realServiceRows: number;
  legacyNoLinks: number;
  legacyAmbiguous: number;
  totalQuantity: number;
}> {
  const [itemRows, requests, inputs, services, projects] = await Promise.all([
    readAll<StagingRow>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.stock_request_item",
      sync_state: "eq.present",
      order: "koper_id.asc",
    }),
    readAll<RequestRow>("execution_material_requests", {
      select: "id,request_number",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      request_number: "like.KOPER-*",
      order: "request_number.asc",
    }),
    readAll<InputRow>("engineering_inputs", {
      select: "id,source_id,code,description,unit,category",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      order: "source_id.asc",
    }),
    readAll<ServiceRow>("engineering_services", {
      select: "id,source_id,code,description",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      order: "source_id.asc",
    }),
    requestSupabase<Array<{ id: string }>>("projects", {
      query: new URLSearchParams({
        select: "id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        name: "ilike.*Flow*",
        status: "neq.archived",
        limit: "10",
      }),
    }),
  ]);

  const project = projects[0];
  if (projects.length !== 1 || !project) throw new Error("Flow project is ambiguous");
  const requestIdBySource = new Map(requests.map((row) => [row.request_number.replace(/^KOPER-/, ""), row.id]));
  const inputBySource = new Map(inputs.map((row) => [row.source_id, row]));
  const serviceBySource = new Map(services.map((row) => [row.source_id, row]));
  const official = await resolveFlowStockRequestServices(itemRows);
  const intendedByKey = new Map<string, IntendedItem>();
  let legacyNoLinks = 0;
  let legacyAmbiguous = 0;

  function officialService(payload: RecordValue, link: RecordValue): ServiceRow {
    const key = officialStockRequestServiceKey(payload.inputId, link.itemMonitInputId);
    if (!key) throw new Error("Official Koper allocation is missing inputId or itemMonitInputId");
    const resolution = official.get(key);
    if (!resolution) throw new Error(`Official Koper service resolution missing for ${key}`);
    const service = serviceBySource.get(resolution.koperServiceId);
    if (!service) throw new Error(`Koper service ${resolution.koperServiceId} is missing from Elos`);
    return service;
  }

  function add(item: IntendedItem): void {
    const key = `${item.requestId}:${item.input.id}:${item.service?.id ?? "pending-native-service"}`;
    const current = intendedByKey.get(key);
    if (!current) {
      intendedByKey.set(key, item);
      return;
    }
    current.quantity += item.quantity;
    current.productRequestIds.push(...item.productRequestIds);
    current.evidence.push(...item.evidence);
  }

  for (const row of itemRows) {
    const payload = objectValue(row.payload);
    const sourceRequestId = row.koper_parent_id ?? identifier(payload.requestId);
    const requestId = sourceRequestId ? requestIdBySource.get(sourceRequestId) : null;
    const productId = identifier(payload.productId);
    const inputSourceId = productId && inputBySource.has(productId) ? productId : identifier(payload.inputId);
    const input = inputSourceId ? inputBySource.get(inputSourceId) : null;
    const quantity = numeric(payload.productAmount);
    if (!requestId || !input || quantity === null || quantity <= 0) {
      throw new Error(`Incomplete Koper stock request mapping for productRequestId=${row.koper_id}`);
    }

    const links = Array.isArray(payload.services) ? payload.services.map(objectValue) : [];
    if (!links.length) {
      legacyNoLinks += 1;
      add({
        requestId,
        input,
        service: null,
        quantity,
        productRequestIds: [row.koper_id],
        evidence: ["reason=no-service-links"],
      });
      continue;
    }

    const allocated = links.reduce((sum, link) => sum + (numeric(link.inputAmount) ?? 0), 0);
    const invalid = links.some((link) => (numeric(link.inputAmount) ?? 0) <= 0);
    const mismatch = invalid || !almostEqual(allocated, quantity);
    const allocationIds = [...new Set(links
      .map((link) => identifier(link.itemMonitInputId))
      .filter((value): value is string => Boolean(value)))];

    if (mismatch && allocationIds.length > 1) {
      legacyAmbiguous += 1;
      add({
        requestId,
        input,
        service: null,
        quantity,
        productRequestIds: [row.koper_id],
        evidence: [`reason=ambiguous-quantity,productAmount=${quantity},allocatedAmount=${allocated},allocationIds=${allocationIds.join(",")}`],
      });
      continue;
    }

    if (mismatch) {
      const allocationId = allocationIds[0];
      const representative = links.find((link) => identifier(link.itemMonitInputId) === allocationId);
      if (!representative) throw new Error(`Representative allocation missing for productRequestId=${row.koper_id}`);
      const service = officialService(payload, representative);
      add({
        requestId,
        input,
        service,
        quantity,
        productRequestIds: [row.koper_id],
        evidence: [`reason=unique-allocation-recovery,productAmount=${quantity},allocatedAmount=${allocated},itemMonitInputId=${allocationId}`],
      });
      continue;
    }

    for (const link of links) {
      const linkQuantity = numeric(link.inputAmount);
      if (linkQuantity === null || linkQuantity <= 0) {
        throw new Error(`Invalid service quantity for productRequestId=${row.koper_id}`);
      }
      const service = officialService(payload, link);
      add({
        requestId,
        input,
        service,
        quantity: linkQuantity,
        productRequestIds: [row.koper_id],
        evidence: [`reason=official,itemMonitInputId=${identifier(link.itemMonitInputId) ?? "n/a"},inputAmount=${linkQuantity}`],
      });
    }
  }

  const now = new Date().toISOString();
  const payloads = [...intendedByKey.values()].map((item, sortOrder): IntendedPayload => ({
    company_id: env.BOSSA_COMPANY_ID,
    project_id: project.id,
    request_id: item.requestId,
    input_id: item.input.id,
    input_code: item.input.code,
    input_name: item.input.description,
    unit_snapshot: item.input.unit,
    category_snapshot: item.input.category,
    cost_center_service_id: item.service?.id ?? null,
    cost_center_code: item.service?.code ?? "KOPER-PENDING-NATIVE-SERVICE",
    cost_center_name: item.service?.description ?? "Pendente — sem vínculo nativo no Koper",
    requested_quantity: item.quantity,
    notes: `Koper productRequestIds=${item.productRequestIds.join(",")} · resolution=v2 · ${item.evidence.join(";")}`,
    sort_order: sortOrder,
    updated_at: now,
  }));

  const totalQuantity = payloads.reduce((sum, row) => sum + row.requested_quantity, 0);
  const realServiceRows = payloads.filter((row) => row.cost_center_service_id !== null).length;
  return {
    projectId: project.id,
    payloads,
    sourceItems: itemRows.length,
    realServiceRows,
    legacyNoLinks,
    legacyAmbiguous,
    totalQuantity,
  };
}

export async function previewKoperStockRequestItemsV2(): Promise<{
  ok: true;
  mode: "read-only";
  sourceItems: number;
  intendedRows: number;
  realServiceRows: number;
  legacyNoLinks: number;
  legacyAmbiguous: number;
  totalQuantity: number;
}> {
  const plan = await buildIntendedPayloads();
  return {
    ok: true,
    mode: "read-only",
    sourceItems: plan.sourceItems,
    intendedRows: plan.payloads.length,
    realServiceRows: plan.realServiceRows,
    legacyNoLinks: plan.legacyNoLinks,
    legacyAmbiguous: plan.legacyAmbiguous,
    totalQuantity: plan.totalQuantity,
  };
}

export async function seedKoperStockRequestItemsV2(): Promise<{
  ok: true;
  seededRows: number;
  verifiedV2Rows: number;
  totalQuantity: number;
}> {
  if (process.env.KOPER_STOCK_REQUEST_V2_SEED_ENABLED !== "true") {
    throw new Error("Koper stock request v2 seed is not explicitly enabled");
  }
  const plan = await buildIntendedPayloads();
  for (const batch of chunks(plan.payloads, 100)) {
    await requestSupabase("execution_material_request_items", {
      method: "POST",
      body: batch,
      prefer: "resolution=merge-duplicates,return=minimal",
      query: new URLSearchParams({ on_conflict: "request_id,input_id,cost_center_code" }),
    });
  }

  const verified = await readAll<{
    id: string;
    request_id: string;
    input_id: string;
    cost_center_service_id: string | null;
    requested_quantity: number;
    notes: string | null;
  }>("execution_material_request_items", {
    select: "id,request_id,input_id,cost_center_service_id,requested_quantity,notes",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    project_id: `eq.${plan.projectId}`,
    notes: "like.*resolution=v2*",
    order: "id.asc",
  });
  if (verified.length !== plan.payloads.length) {
    throw new Error(`Koper stock request v2 verification failed: expected=${plan.payloads.length} actual=${verified.length}`);
  }
  const intendedByKey = new Map(plan.payloads.map((row) => [
    `${row.request_id}:${row.input_id}:${row.cost_center_service_id}`,
    row.requested_quantity,
  ]));
  for (const row of verified) {
    const expected = intendedByKey.get(`${row.request_id}:${row.input_id}:${row.cost_center_service_id}`);
    if (expected === undefined || !almostEqual(expected, row.requested_quantity)) {
      throw new Error(`Koper stock request v2 row mismatch for item=${row.id}`);
    }
  }
  const verifiedTotal = verified.reduce((sum, row) => sum + row.requested_quantity, 0);
  if (!almostEqual(verifiedTotal, plan.totalQuantity)) {
    throw new Error(`Koper stock request v2 total mismatch: expected=${plan.totalQuantity} actual=${verifiedTotal}`);
  }
  return { ok: true, seededRows: plan.payloads.length, verifiedV2Rows: verified.length, totalQuantity: verifiedTotal };
}
