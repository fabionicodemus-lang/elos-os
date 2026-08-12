import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
import {
  officialStockRequestServiceKey,
  resolveFlowStockRequestServices,
} from "./resolve-flow-stock-request-services.js";

type RecordValue = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type InputRow = { id: string; source_id: string | null; code: string; description: string; unit: string; category: string };
type ServiceRow = { id: string; source_id: string | null; code: string; description: string };
type RequestRow = { id: string; request_number: string };
type ExistingItemRow = {
  id: string;
  request_id: string;
  input_id: string;
  cost_center_service_id: string;
  cost_center_code: string;
  requested_quantity: number;
  notes: string | null;
};

type IntendedAllocation = {
  requestId: string;
  inputId: string;
  inputCode: string;
  serviceId: string;
  serviceCode: string;
  quantity: number;
  legacyReason: "no-service-links" | "quantity-mismatch" | null;
  productRequestIds: string[];
};

function objectValue(value: unknown): RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : {};
}

function identifier(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

async function readPaged<T>(resource: string, filters: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await requestSupabase<T[]>(resource, {
      query: new URLSearchParams({ ...filters, limit: "1000", offset: String(offset) }),
      timeoutMs: 30_000,
    });
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function readStaging(entity: "stock_request" | "stock_request_item"): Promise<StagingRow[]> {
  return readPaged<StagingRow>("koper_staging_records", {
    select: "koper_id,koper_parent_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: `eq.${entity}`,
    sync_state: "eq.present",
  });
}

async function readCatalog<T>(table: "engineering_inputs" | "engineering_services", select: string): Promise<T[]> {
  return readPaged<T>(table, {
    select,
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source_system: "eq.koper",
  });
}

function allocationKey(requestId: string, inputId: string, serviceId: string): string {
  return `${requestId}:${inputId}:${serviceId}`;
}

function requestInputKey(requestId: string, inputId: string): string {
  return `${requestId}:${inputId}`;
}

function almostEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.00001;
}

export async function dryRunStockRequestPromotion(): Promise<{
  ok: true;
  mode: "read-only";
  requestsInStaging: number;
  sourceItemsInStaging: number;
  currentImportedRows: number;
  intendedRows: number;
  currentLegacyRows: number;
  intendedLegacyRows: number;
  intendedLegacyNoLinks: number;
  intendedLegacyQuantityMismatch: number;
  intendedRealServiceRows: number;
  exactRows: number;
  quantityOnlyChanges: number;
  missingIntendedRows: number;
  staleCurrentRows: number;
  legacyRowsLeavingLegacy: number;
  legacyRowsRemainingLegacy: number;
  realRowsAlreadyPresent: number;
  realRowsToInsert: number;
  requestInputGroupsChanged: number;
  requestInputGroupsUnchanged: number;
  quantityConservationMismatches: number;
  currentTotalQuantity: number;
  intendedTotalQuantity: number;
  staleSamples: Array<{ itemId: string; requestId: string; inputId: string; serviceCode: string; quantity: number }>;
  missingSamples: Array<{ requestId: string; inputId: string; serviceCode: string; quantity: number; legacyReason: string | null }>;
  changedGroupSamples: Array<{ requestId: string; inputId: string; currentServices: string[]; intendedServices: string[] }>;
}> {
  const [requestRows, itemRows, inputs, services, projects, currentRequests] = await Promise.all([
    readStaging("stock_request"),
    readStaging("stock_request_item"),
    readCatalog<InputRow>("engineering_inputs", "id,source_id,code,description,unit,category"),
    readCatalog<ServiceRow>("engineering_services", "id,source_id,code,description"),
    requestSupabase<Array<{ id: string }>>("projects", {
      query: new URLSearchParams({
        select: "id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        name: "ilike.*Flow*",
        status: "neq.archived",
        limit: "10",
      }),
    }),
    readPaged<RequestRow>("execution_material_requests", {
      select: "id,request_number",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      request_number: "like.KOPER-*",
    }),
  ]);

  if (projects.length !== 1) throw new Error(`Expected exactly one active Flow project, found ${projects.length}`);
  const project = projects[0];
  if (!project) throw new Error("Flow project not found");

  const existingItems = await readPaged<ExistingItemRow>("execution_material_request_items", {
    select: "id,request_id,input_id,cost_center_service_id,cost_center_code,requested_quantity,notes",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    project_id: `eq.${project.id}`,
    notes: "like.Koper productRequestIds=*",
  });

  const requestIdBySource = new Map(
    currentRequests.map((row) => [row.request_number.replace(/^KOPER-/, ""), row.id]),
  );
  const inputBySource = new Map(inputs.map((row) => [row.source_id, row]));
  const serviceBySource = new Map(services.map((row) => [row.source_id, row]));
  const fallbackService = services.find((row) => row.source_id === "stock-request-legacy-cost-center");
  if (!fallbackService) throw new Error("KOPER-SR-LEGACY service is missing from the Elos catalog");

  const missingHeaders = requestRows.filter((row) => !requestIdBySource.has(row.koper_id));
  if (missingHeaders.length > 0) {
    throw new Error(`Dry-run requires existing Koper request headers; ${missingHeaders.length} headers are missing`);
  }

  const officialServiceMap = await resolveFlowStockRequestServices(itemRows);
  const intendedByKey = new Map<string, IntendedAllocation>();

  function addAllocation(allocation: IntendedAllocation): void {
    const key = allocationKey(allocation.requestId, allocation.inputId, allocation.serviceId);
    const existing = intendedByKey.get(key);
    if (existing) {
      existing.quantity += allocation.quantity;
      existing.productRequestIds.push(...allocation.productRequestIds);
      if (existing.legacyReason !== allocation.legacyReason) existing.legacyReason = allocation.legacyReason ?? existing.legacyReason;
      return;
    }
    intendedByKey.set(key, allocation);
  }

  function officialService(payload: RecordValue, link: RecordValue): ServiceRow {
    const resolutionKey = officialStockRequestServiceKey(payload.inputId, link.itemMonitInputId);
    if (!resolutionKey) throw new Error("Official Koper allocation is missing inputId or itemMonitInputId");
    const resolution = officialServiceMap.get(resolutionKey);
    if (!resolution) throw new Error(`Official Koper service resolution missing for ${resolutionKey}`);
    const service = serviceBySource.get(resolution.koperServiceId);
    if (!service) throw new Error(`Koper service ${resolution.koperServiceId} is missing from Elos catalog`);
    return service;
  }

  for (const row of itemRows) {
    const payload = objectValue(row.payload);
    const sourceRequestId = row.koper_parent_id ?? identifier(payload.requestId);
    const requestId = sourceRequestId ? requestIdBySource.get(sourceRequestId) : null;
    const productId = identifier(payload.productId);
    const inputSourceId = productId && inputBySource.has(productId) ? productId : identifier(payload.inputId);
    const input = inputSourceId ? inputBySource.get(inputSourceId) : null;
    const quantity = numberValue(payload.productAmount);
    if (!requestId || !input || quantity === null || quantity <= 0) {
      throw new Error(`Incomplete dry-run mapping for Koper product request ${row.koper_id}`);
    }

    const links = Array.isArray(payload.services) ? payload.services.map(objectValue) : [];
    if (links.length === 0) {
      addAllocation({
        requestId,
        inputId: input.id,
        inputCode: input.code,
        serviceId: fallbackService.id,
        serviceCode: fallbackService.code,
        quantity,
        legacyReason: "no-service-links",
        productRequestIds: [row.koper_id],
      });
      continue;
    }

    const allocated = links.reduce((sum, link) => sum + (numberValue(link.inputAmount) ?? 0), 0);
    const hasInvalidLinkQuantity = links.some((link) => (numberValue(link.inputAmount) ?? 0) <= 0);
    const quantityMismatch = hasInvalidLinkQuantity || !almostEqual(allocated, quantity);
    const allocationIds = [...new Set(links
      .map((link) => identifier(link.itemMonitInputId))
      .filter((value): value is string => Boolean(value))
    )];

    if (quantityMismatch && allocationIds.length === 1) {
      const allocationId = allocationIds[0];
      const representative = links.find((link) => identifier(link.itemMonitInputId) === allocationId);
      if (!representative) throw new Error(`Missing representative Koper allocation for ${row.koper_id}`);
      const service = officialService(payload, representative);
      addAllocation({
        requestId,
        inputId: input.id,
        inputCode: input.code,
        serviceId: service.id,
        serviceCode: service.code,
        quantity,
        legacyReason: null,
        productRequestIds: [row.koper_id],
      });
      continue;
    }

    if (quantityMismatch) {
      addAllocation({
        requestId,
        inputId: input.id,
        inputCode: input.code,
        serviceId: fallbackService.id,
        serviceCode: fallbackService.code,
        quantity,
        legacyReason: "quantity-mismatch",
        productRequestIds: [row.koper_id],
      });
      continue;
    }

    for (const link of links) {
      const linkQuantity = numberValue(link.inputAmount);
      if (linkQuantity === null || linkQuantity <= 0) {
        throw new Error(`Invalid official allocation in Koper product request ${row.koper_id}`);
      }
      const service = officialService(payload, link);
      addAllocation({
        requestId,
        inputId: input.id,
        inputCode: input.code,
        serviceId: service.id,
        serviceCode: service.code,
        quantity: linkQuantity,
        legacyReason: null,
        productRequestIds: [row.koper_id],
      });
    }
  }

  const currentByKey = new Map(existingItems.map((row) => [
    allocationKey(row.request_id, row.input_id, row.cost_center_service_id),
    row,
  ]));

  let exactRows = 0;
  let quantityOnlyChanges = 0;
  let realRowsAlreadyPresent = 0;
  let realRowsToInsert = 0;
  let legacyRowsRemainingLegacy = 0;
  const missingIntended = [...intendedByKey.entries()].filter(([key, intended]) => {
    const current = currentByKey.get(key);
    if (!current) {
      if (intended.serviceId === fallbackService.id) {
        // counted below via intendedLegacyRows
      } else realRowsToInsert += 1;
      return true;
    }
    if (almostEqual(current.requested_quantity, intended.quantity)) exactRows += 1;
    else quantityOnlyChanges += 1;
    if (intended.serviceId === fallbackService.id) legacyRowsRemainingLegacy += 1;
    else realRowsAlreadyPresent += 1;
    return false;
  });

  const staleCurrent = existingItems.filter((row) => !intendedByKey.has(
    allocationKey(row.request_id, row.input_id, row.cost_center_service_id),
  ));

  const intendedLegacyRows = [...intendedByKey.values()].filter((row) => row.serviceId === fallbackService.id);
  const currentLegacyRows = existingItems.filter((row) => row.cost_center_service_id === fallbackService.id);

  const intendedByGroup = new Map<string, IntendedAllocation[]>();
  for (const intended of intendedByKey.values()) {
    const key = requestInputKey(intended.requestId, intended.inputId);
    const group = intendedByGroup.get(key) ?? [];
    group.push(intended);
    intendedByGroup.set(key, group);
  }
  const currentByGroup = new Map<string, ExistingItemRow[]>();
  for (const current of existingItems) {
    const key = requestInputKey(current.request_id, current.input_id);
    const group = currentByGroup.get(key) ?? [];
    group.push(current);
    currentByGroup.set(key, group);
  }

  const allGroupKeys = new Set([...intendedByGroup.keys(), ...currentByGroup.keys()]);
  let requestInputGroupsChanged = 0;
  let requestInputGroupsUnchanged = 0;
  let quantityConservationMismatches = 0;
  const changedGroupSamples: Array<{ requestId: string; inputId: string; currentServices: string[]; intendedServices: string[] }> = [];

  for (const key of allGroupKeys) {
    const current = currentByGroup.get(key) ?? [];
    const intended = intendedByGroup.get(key) ?? [];
    const currentServices = current.map((row) => row.cost_center_code).sort();
    const intendedServices = intended.map((row) => row.serviceCode).sort();
    const sameServices = currentServices.length === intendedServices.length
      && currentServices.every((value, index) => value === intendedServices[index]);
    const currentQuantity = current.reduce((sum, row) => sum + row.requested_quantity, 0);
    const intendedQuantity = intended.reduce((sum, row) => sum + row.quantity, 0);
    if (!almostEqual(currentQuantity, intendedQuantity)) quantityConservationMismatches += 1;

    if (sameServices && almostEqual(currentQuantity, intendedQuantity)) {
      requestInputGroupsUnchanged += 1;
    } else {
      requestInputGroupsChanged += 1;
      if (changedGroupSamples.length < 25) {
        const [requestId, inputId] = key.split(":");
        changedGroupSamples.push({
          requestId: requestId ?? "",
          inputId: inputId ?? "",
          currentServices,
          intendedServices,
        });
      }
    }
  }

  const legacyRowsLeavingLegacy = currentLegacyRows.filter((row) => {
    const group = intendedByGroup.get(requestInputKey(row.request_id, row.input_id)) ?? [];
    return group.length > 0 && group.every((intended) => intended.serviceId !== fallbackService.id);
  }).length;

  const currentTotalQuantity = existingItems.reduce((sum, row) => sum + row.requested_quantity, 0);
  const intendedTotalQuantity = [...intendedByKey.values()].reduce((sum, row) => sum + row.quantity, 0);

  return {
    ok: true,
    mode: "read-only",
    requestsInStaging: requestRows.length,
    sourceItemsInStaging: itemRows.length,
    currentImportedRows: existingItems.length,
    intendedRows: intendedByKey.size,
    currentLegacyRows: currentLegacyRows.length,
    intendedLegacyRows: intendedLegacyRows.length,
    intendedLegacyNoLinks: intendedLegacyRows.filter((row) => row.legacyReason === "no-service-links").length,
    intendedLegacyQuantityMismatch: intendedLegacyRows.filter((row) => row.legacyReason === "quantity-mismatch").length,
    intendedRealServiceRows: intendedByKey.size - intendedLegacyRows.length,
    exactRows,
    quantityOnlyChanges,
    missingIntendedRows: missingIntended.length,
    staleCurrentRows: staleCurrent.length,
    legacyRowsLeavingLegacy,
    legacyRowsRemainingLegacy,
    realRowsAlreadyPresent,
    realRowsToInsert,
    requestInputGroupsChanged,
    requestInputGroupsUnchanged,
    quantityConservationMismatches,
    currentTotalQuantity: Number(currentTotalQuantity.toFixed(6)),
    intendedTotalQuantity: Number(intendedTotalQuantity.toFixed(6)),
    staleSamples: staleCurrent.slice(0, 25).map((row) => ({
      itemId: row.id,
      requestId: row.request_id,
      inputId: row.input_id,
      serviceCode: row.cost_center_code,
      quantity: row.requested_quantity,
    })),
    missingSamples: missingIntended.slice(0, 25).map(([, row]) => ({
      requestId: row.requestId,
      inputId: row.inputId,
      serviceCode: row.serviceCode,
      quantity: row.quantity,
      legacyReason: row.legacyReason,
    })),
    changedGroupSamples,
  };
}