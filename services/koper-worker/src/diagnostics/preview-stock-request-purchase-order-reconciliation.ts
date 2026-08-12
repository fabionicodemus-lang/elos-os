import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
import {
  officialStockRequestServiceKey,
  resolveFlowStockRequestServices,
} from "./resolve-flow-stock-request-services.js";

type RecordValue = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type ServiceRow = { id: string; source_id: string | null; code: string };
type RequestItemRow = {
  id: string;
  request_id: string;
  input_id: string;
  cost_center_service_id: string | null;
  cost_center_code: string;
  notes: string | null;
};
type PurchaseItemRow = {
  id: string;
  source_id: string | null;
  request_item_id: string | null;
  cost_center_service_id: string | null;
  cost_center_code: string;
};
type QuotationItemRow = {
  id: string;
  quotation_id: string;
  request_item_id: string;
};

type Target = {
  productRequestId: string;
  koperServiceId: string | null;
  elosServiceId: string;
  serviceCode: string;
  legacy: boolean;
  reason: "no-links" | "ambiguous-quantity" | "official";
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

function productRequestIds(notes: string | null): string[] {
  const match = notes?.match(/Koper productRequestIds=([^·]+)/);
  return match?.[1]?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
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

async function readStaging(entity: "stock_request_item" | "purchase_order_item"): Promise<StagingRow[]> {
  return readAll<StagingRow>("koper_staging_records", {
    select: "koper_id,koper_parent_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: `eq.${entity}`,
    sync_state: "eq.present",
    order: "koper_id.asc",
  });
}

export async function previewStockRequestPurchaseOrderReconciliation() {
  const [stockItems, purchaseSourceItems, services, requestItems, purchaseItems, quotationItems] = await Promise.all([
    readStaging("stock_request_item"),
    readStaging("purchase_order_item"),
    readAll<ServiceRow>("engineering_services", {
      select: "id,source_id,code",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      order: "source_id.asc",
    }),
    readAll<RequestItemRow>("execution_material_request_items", {
      select: "id,request_id,input_id,cost_center_service_id,cost_center_code,notes",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      notes: "like.Koper productRequestIds=*",
      order: "id.asc",
    }),
    readAll<PurchaseItemRow>("procurement_purchase_order_items", {
      select: "id,source_id,request_item_id,cost_center_service_id,cost_center_code",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      order: "id.asc",
    }),
    readAll<QuotationItemRow>("procurement_material_quotation_items", {
      select: "id,quotation_id,request_item_id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      order: "id.asc",
    }),
  ]);

  const fallback = services.find((row) => row.source_id === "stock-request-legacy-cost-center");
  if (!fallback) throw new Error("KOPER-SR-LEGACY service is missing");
  const serviceBySource = new Map(services.map((row) => [row.source_id, row]));
  const official = await resolveFlowStockRequestServices(stockItems);

  const targetsByProductRequest = new Map<string, Target[]>();
  for (const row of stockItems) {
    const payload = objectValue(row.payload);
    const links = Array.isArray(payload.services) ? payload.services.map(objectValue) : [];
    const productAmount = numeric(payload.productAmount);
    if (productAmount === null || productAmount <= 0) continue;
    const targets: Target[] = [];

    if (links.length === 0) {
      targets.push({
        productRequestId: row.koper_id,
        koperServiceId: null,
        elosServiceId: fallback.id,
        serviceCode: fallback.code,
        legacy: true,
        reason: "no-links",
      });
    } else {
      const allocated = links.reduce((sum, link) => sum + (numeric(link.inputAmount) ?? 0), 0);
      const invalid = links.some((link) => (numeric(link.inputAmount) ?? 0) <= 0);
      const mismatch = invalid || Math.abs(allocated - productAmount) > 0.00001;
      const allocationIds = [...new Set(links
        .map((link) => identifier(link.itemMonitInputId))
        .filter((value): value is string => Boolean(value))
      )];

      if (mismatch && allocationIds.length > 1) {
        targets.push({
          productRequestId: row.koper_id,
          koperServiceId: null,
          elosServiceId: fallback.id,
          serviceCode: fallback.code,
          legacy: true,
          reason: "ambiguous-quantity",
        });
      } else {
        const effectiveLinks = mismatch && allocationIds.length === 1
          ? links.filter((link, index) => index === links.findIndex((candidate) => identifier(candidate.itemMonitInputId) === identifier(link.itemMonitInputId)))
          : links;
        const seenServices = new Set<string>();
        for (const link of effectiveLinks) {
          const key = officialStockRequestServiceKey(payload.inputId, link.itemMonitInputId);
          const resolution = key ? official.get(key) : null;
          if (!resolution) throw new Error(`Official service missing for productRequestId=${row.koper_id}`);
          const service = serviceBySource.get(resolution.koperServiceId);
          if (!service) throw new Error(`Elos service missing for Koper service ${resolution.koperServiceId}`);
          if (seenServices.has(service.id)) continue;
          seenServices.add(service.id);
          targets.push({
            productRequestId: row.koper_id,
            koperServiceId: resolution.koperServiceId,
            elosServiceId: service.id,
            serviceCode: service.code,
            legacy: false,
            reason: "official",
          });
        }
      }
    }
    targetsByProductRequest.set(row.koper_id, targets);
  }

  const currentRequestItemById = new Map(requestItems.map((row) => [row.id, row]));
  const currentProductMap = new Map<string, RequestItemRow[]>();
  for (const row of requestItems) {
    for (const productRequestId of productRequestIds(row.notes)) {
      currentProductMap.set(productRequestId, [...(currentProductMap.get(productRequestId) ?? []), row]);
    }
  }
  const currentPurchaseBySource = new Map(purchaseItems.map((row) => [row.source_id, row]));

  let sourceRequestLinks = 0;
  let sourceUnlinkedSplits = 0;
  let singleTargetLinks = 0;
  let multiTargetLinks = 0;
  let multiTargetResolvedByPurchaseCostCenter = 0;
  let multiTargetAmbiguous = 0;
  let missingStockRequestTarget = 0;
  let currentPurchaseRowsMatched = 0;
  let currentPurchaseRowsOnCorrectService = 0;
  let currentPurchaseRowsNeedRepoint = 0;
  let currentPurchaseRowsWithMissingRequestItem = 0;
  const ambiguousSamples: Array<Record<string, unknown>> = [];
  const repointSamples: Array<Record<string, unknown>> = [];

  for (const purchaseRow of purchaseSourceItems) {
    const payload = objectValue(purchaseRow.payload);
    const sourceLinks = Array.isArray(payload.requests) ? payload.requests.map(objectValue) : [];
    const positiveLinks = sourceLinks.filter((link) => (numeric(link.requestAmount) ?? 0) > 0);
    const splits = positiveLinks.length > 0 ? positiveLinks : [{}];

    for (const link of splits) {
      const productRequestId = identifier(link.productRequestId);
      if (!productRequestId) {
        sourceUnlinkedSplits += 1;
        continue;
      }
      sourceRequestLinks += 1;
      const targets = targetsByProductRequest.get(productRequestId) ?? [];
      if (targets.length === 0) {
        missingStockRequestTarget += 1;
        continue;
      }

      let chosen: Target | null = null;
      if (targets.length === 1) {
        singleTargetLinks += 1;
        chosen = targets[0] ?? null;
      } else {
        multiTargetLinks += 1;
        const purchaseCostCenter = identifier(payload.costCenterId);
        const matches = purchaseCostCenter
          ? targets.filter((target) => target.koperServiceId === purchaseCostCenter)
          : [];
        if (matches.length === 1) {
          multiTargetResolvedByPurchaseCostCenter += 1;
          chosen = matches[0] ?? null;
        } else {
          multiTargetAmbiguous += 1;
          if (ambiguousSamples.length < 30) ambiguousSamples.push({
            orderProductId: purchaseRow.koper_id,
            productRequestId,
            purchaseCostCenter,
            targetServices: targets.map((target) => ({ koperServiceId: target.koperServiceId, serviceCode: target.serviceCode })),
            requestAmount: numeric(link.requestAmount),
          });
        }
      }

      const sourceId = `${purchaseRow.koper_id}:${productRequestId}`;
      const currentPurchase = currentPurchaseBySource.get(sourceId);
      if (!currentPurchase) continue;
      currentPurchaseRowsMatched += 1;
      const currentRequestItem = currentPurchase.request_item_id
        ? currentRequestItemById.get(currentPurchase.request_item_id)
        : null;
      if (!currentRequestItem) currentPurchaseRowsWithMissingRequestItem += 1;
      if (!chosen) continue;

      if (currentPurchase.cost_center_service_id === chosen.elosServiceId) {
        currentPurchaseRowsOnCorrectService += 1;
      } else {
        currentPurchaseRowsNeedRepoint += 1;
        if (repointSamples.length < 30) repointSamples.push({
          purchaseItemId: currentPurchase.id,
          sourceId,
          productRequestId,
          currentRequestItemId: currentPurchase.request_item_id,
          currentServiceCode: currentPurchase.cost_center_code,
          targetServiceCode: chosen.serviceCode,
          currentProductRequestRows: (currentProductMap.get(productRequestId) ?? []).map((row) => ({
            id: row.id,
            serviceCode: row.cost_center_code,
          })),
        });
      }
    }
  }

  const staleRequestItemIds = new Set(requestItems
    .filter((row) => {
      const ids = productRequestIds(row.notes);
      if (ids.length === 0) return false;
      return ids.every((id) => {
        const targets = targetsByProductRequest.get(id) ?? [];
        return targets.every((target) => target.elosServiceId !== row.cost_center_service_id);
      });
    })
    .map((row) => row.id));

  const purchaseRowsReferencingStale = purchaseItems.filter(
    (row) => row.request_item_id && staleRequestItemIds.has(row.request_item_id),
  );
  const quotationRowsReferencingStale = quotationItems.filter(
    (row) => staleRequestItemIds.has(row.request_item_id),
  );

  const intendedLegacyNoLinks = [...targetsByProductRequest.values()].filter(
    (targets) => targets.length === 1 && targets[0]?.reason === "no-links",
  ).length;
  const intendedLegacyAmbiguous = [...targetsByProductRequest.values()].filter(
    (targets) => targets.length === 1 && targets[0]?.reason === "ambiguous-quantity",
  ).length;
  const intendedRealServiceTargets = [...targetsByProductRequest.values()].reduce(
    (sum, targets) => sum + targets.filter((target) => !target.legacy).length,
    0,
  );

  return {
    ok: true as const,
    mode: "read-only" as const,
    stockRequestItems: stockItems.length,
    purchaseSourceItems: purchaseSourceItems.length,
    currentRequestItems: requestItems.length,
    currentPurchaseItems: purchaseItems.length,
    currentQuotationItems: quotationItems.length,
    targetProductRequests: targetsByProductRequest.size,
    intendedLegacyNoLinks,
    intendedLegacyAmbiguous,
    intendedRealServiceTargets,
    sourceRequestLinks,
    sourceUnlinkedSplits,
    singleTargetLinks,
    multiTargetLinks,
    multiTargetResolvedByPurchaseCostCenter,
    multiTargetAmbiguous,
    missingStockRequestTarget,
    currentPurchaseRowsMatched,
    currentPurchaseRowsOnCorrectService,
    currentPurchaseRowsNeedRepoint,
    currentPurchaseRowsWithMissingRequestItem,
    staleRequestItems: staleRequestItemIds.size,
    purchaseRowsReferencingStale: purchaseRowsReferencingStale.length,
    staleRequestItemsBlockedByPurchaseRows: new Set(
      purchaseRowsReferencingStale.map((row) => row.request_item_id).filter(Boolean),
    ).size,
    quotationRowsReferencingStale: quotationRowsReferencingStale.length,
    staleRequestItemsBlockedByQuotationRows: new Set(
      quotationRowsReferencingStale.map((row) => row.request_item_id),
    ).size,
    safeDeleteAfterPurchaseRepoint: quotationRowsReferencingStale.length === 0,
    ambiguousSamples,
    repointSamples,
  };
}
