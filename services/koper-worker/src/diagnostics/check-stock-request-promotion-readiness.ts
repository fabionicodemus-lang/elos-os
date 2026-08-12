import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
import {
  officialStockRequestServiceKey,
  resolveFlowStockRequestServices,
} from "./resolve-flow-stock-request-services.js";
import { dryRunStockRequestPromotion } from "./dry-run-stock-request-promotion.js";

type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type CatalogRow = { id: string; source_id: string | null };

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function identifier(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function readStaging(entity: "stock_request" | "stock_request_item"): Promise<StagingRow[]> {
  const rows: StagingRow[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await requestSupabase<StagingRow[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "koper_id,koper_parent_id,payload",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: `eq.${entity}`,
        sync_state: "eq.present",
        limit: String(pageSize),
        offset: String(offset),
      }),
    });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function readKoperInputs(): Promise<CatalogRow[]> {
  const rows: CatalogRow[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await requestSupabase<CatalogRow[]>("engineering_inputs", {
      query: new URLSearchParams({
        select: "id,source_id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper",
        limit: String(pageSize),
        offset: String(offset),
      }),
    });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export async function checkStockRequestPromotionReadiness(): Promise<{
  ok: true;
  ready: boolean;
  requests: number;
  items: number;
  requestStatuses: Record<string, number>;
  resolvedInputs: number;
  resolutionByField: Record<string, number>;
  missingInputs: Array<{
    productRequestId: string;
    requestId: string | null;
    productId: string | null;
    mainProductId: string | null;
    inputId: string | null;
    productName: string | null;
  }>;
  invalidQuantities: string[];
  itemsWithServiceLinks: number;
  itemsWithoutServiceLinks: number;
  serviceLinks: number;
  serviceLinkSamples: Array<{
    productRequestId: string;
    requestId: string | null;
    inputId: string | null;
    itemMonitInputId: string | null;
    itemMonitoringId: string | null;
    koperServiceId: string | null;
    monitInputPchId: string | null;
    inputAmount: number | null;
  }>;
  serviceLinkResolution: Record<string, number>;
  unresolvedServiceLinks: number;
  serviceQuantityMismatches: Array<{
    productRequestId: string;
    requestId: string | null;
    productAmount: number | null;
    allocatedAmount: number;
    links: number;
  }>;
  flowProjects: number;
  flowBudgets: number;
  flowBudgetStatuses: Record<string, number>;
  activeCompanyMembers: number;
}> {
  const [requests, items, catalog, projects, budgets, memberships] = await Promise.all([
    readStaging("stock_request"),
    readStaging("stock_request_item"),
    readKoperInputs(),
    requestSupabase<Array<{ id: string; name: string }>>("projects", {
      query: new URLSearchParams({
        select: "id,name",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        name: "ilike.*Flow*",
        status: "neq.archived",
        limit: "100",
      }),
    }),
    requestSupabase<Array<{ id: string; status: string }>>("engineering_budgets", {
      query: new URLSearchParams({
        select: "id,status",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper",
        limit: "100",
      }),
    }),
    requestSupabase<Array<{ user_id: string }>>("company_memberships", {
      query: new URLSearchParams({
        select: "user_id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        status: "eq.active",
        limit: "1000",
      }),
    }),
  ]);

  const officialServiceMap = await resolveFlowStockRequestServices(items);
  const sourceIds = new Set(catalog.map((row) => row.source_id).filter(Boolean));
  const resolutionByField: Record<string, number> = {};
  const missingInputs: Array<{
    productRequestId: string;
    requestId: string | null;
    productId: string | null;
    mainProductId: string | null;
    inputId: string | null;
    productName: string | null;
  }> = [];
  const invalidQuantities: string[] = [];
  const serviceLinkSamples: Array<{
    productRequestId: string;
    requestId: string | null;
    inputId: string | null;
    itemMonitInputId: string | null;
    itemMonitoringId: string | null;
    koperServiceId: string | null;
    monitInputPchId: string | null;
    inputAmount: number | null;
  }> = [];
  let resolvedInputs = 0;
  let itemsWithServiceLinks = 0;
  let serviceLinks = 0;
  let unresolvedServiceLinks = 0;
  const serviceLinkResolution: Record<string, number> = {};
  const serviceQuantityMismatches: Array<{
    productRequestId: string;
    requestId: string | null;
    productAmount: number | null;
    allocatedAmount: number;
    links: number;
  }> = [];

  for (const row of items) {
    const payload = objectValue(row.payload);
    const candidates = [
      ["productId", identifier(payload.productId)],
      ["mainProductId", identifier(payload.mainProductId)],
      ["inputId", identifier(payload.inputId)],
    ] as const;
    const resolved = candidates.find(([, id]) => id !== null && sourceIds.has(id));
    if (resolved) {
      resolvedInputs += 1;
      resolutionByField[resolved[0]] = (resolutionByField[resolved[0]] ?? 0) + 1;
    } else {
      missingInputs.push({
        productRequestId: row.koper_id,
        requestId: row.koper_parent_id,
        productId: candidates[0][1],
        mainProductId: candidates[1][1],
        inputId: candidates[2][1],
        productName: text(payload.productName) ?? text(payload.productFullName),
      });
    }

    const quantity = numberValue(payload.productAmount);
    if (quantity === null || quantity <= 0) invalidQuantities.push(row.koper_id);

    const links = Array.isArray(payload.services) ? payload.services : [];
    if (links.length > 0) itemsWithServiceLinks += 1;
    serviceLinks += links.length;
    if (links.length > 0) {
      const allocatedAmount = links.reduce(
        (sum, value) => sum + (numberValue(objectValue(value).inputAmount) ?? 0),
        0,
      );
      if (quantity === null || Math.abs(allocatedAmount - quantity) > 0.00001) {
        serviceQuantityMismatches.push({
          productRequestId: row.koper_id,
          requestId: row.koper_parent_id,
          productAmount: quantity,
          allocatedAmount,
          links: links.length,
        });
      }
    }

    for (const value of links) {
      const link = objectValue(value);
      const inputId = identifier(payload.inputId);
      const itemMonitInputId = identifier(link.itemMonitInputId);
      const key = officialStockRequestServiceKey(inputId, itemMonitInputId);
      const official = key ? officialServiceMap.get(key) : null;
      if (official) {
        serviceLinkResolution["official-monitoring-input"] = (serviceLinkResolution["official-monitoring-input"] ?? 0) + 1;
      } else {
        unresolvedServiceLinks += 1;
      }
      if (serviceLinkSamples.length < 20) {
        serviceLinkSamples.push({
          productRequestId: row.koper_id,
          requestId: row.koper_parent_id,
          inputId,
          itemMonitInputId,
          itemMonitoringId: official?.itemMonitoringId ?? null,
          koperServiceId: official?.koperServiceId ?? null,
          monitInputPchId: identifier(link.monitInputPchId),
          inputAmount: numberValue(link.inputAmount),
        });
      }
    }
  }

  const requestStatuses = requests.reduce<Record<string, number>>((counts, row) => {
    const status = text(objectValue(row.payload).status) ?? "(ausente)";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  const itemsWithoutServiceLinks = items.length - itemsWithServiceLinks;
  const ready = requests.length > 0
    && items.length > 0
    && missingInputs.length === 0
    && invalidQuantities.length === 0
    && projects.length === 1
    && budgets.length === 1
    && memberships.length > 0
    && unresolvedServiceLinks === 0
    && serviceQuantityMismatches.length === 0;

  return {
    ok: true,
    ready,
    requests: requests.length,
    items: items.length,
    requestStatuses,
    resolvedInputs,
    resolutionByField,
    missingInputs,
    invalidQuantities,
    itemsWithServiceLinks,
    itemsWithoutServiceLinks,
    serviceLinks,
    serviceLinkSamples,
    serviceLinkResolution,
    unresolvedServiceLinks,
    serviceQuantityMismatches,
    flowProjects: projects.length,
    flowBudgets: budgets.length,
    flowBudgetStatuses: budgets.reduce<Record<string, number>>((counts, budget) => {
      counts[budget.status] = (counts[budget.status] ?? 0) + 1;
      return counts;
    }, {}),
    activeCompanyMembers: memberships.length,
  };
}

export async function checkStockRequestAllocationMismatches(): Promise<{
  ok: true;
  count: number;
  mismatches: Array<{
    productRequestId: string;
    requestId: string | null;
    productAmount: number | null;
    allocatedAmount: number;
    links: number;
  }>;
}> {
  const readiness = await checkStockRequestPromotionReadiness();
  return {
    ok: true,
    count: readiness.serviceQuantityMismatches.length,
    mismatches: readiness.serviceQuantityMismatches,
  };
}

export async function checkStockRequestFullPromotionSummary() {
  return dryRunStockRequestPromotion();
}
