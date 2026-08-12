import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type Rec = Record<string, unknown>;
type StagingRow = { koper_id: string; payload: unknown };
type ServiceRow = { id: string; source_id: string | null; code: string };
type RequestItemRow = { id: string; notes: string | null };
type PurchaseItemRow = { id: string; source_id: string | null };
type ServiceItem = { itemMonitoringId: number; serviceId: number };
type Resolution = { state: "safe" | "ambiguous" | "missing"; koperServiceId?: number; elosServiceId?: string };

function record(value: unknown): Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Rec : {};
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function id(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
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

function productRequestIdsFromNotes(notes: string | null): string[] {
  const match = notes?.match(/Koper productRequestIds=([^·]+)/);
  return match?.[1]
    ? match[1].split(",").map((value) => value.trim()).filter(Boolean)
    : [];
}

async function loadElosContext() {
  const [stockItems, budgetItems, services, projects] = await Promise.all([
    readPaged<StagingRow>("koper_staging_records", {
      select: "koper_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.stock_request_item",
      sync_state: "eq.present",
    }),
    readPaged<StagingRow>("koper_staging_records", {
      select: "koper_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.budget_item",
      sync_state: "eq.present",
    }),
    readPaged<ServiceRow>("engineering_services", {
      select: "id,source_id,code",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
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

  const legacy = services.find((service) => service.code === "KOPER-SR-LEGACY");
  const project = projects[0];
  if (!legacy || !project || projects.length !== 1) throw new Error("Flow/legacy context is ambiguous");

  const [requestItems, purchaseItems] = await Promise.all([
    readPaged<RequestItemRow>("execution_material_request_items", {
      select: "id,notes",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${project.id}`,
      cost_center_service_id: `eq.${legacy.id}`,
    }),
    readPaged<PurchaseItemRow>("procurement_purchase_order_items", {
      select: "id,source_id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      project_id: `eq.${project.id}`,
      source_system: "eq.koper",
      cost_center_service_id: `eq.${legacy.id}`,
    }),
  ]);

  return { stockItems, budgetItems, services, requestItems, purchaseItems };
}

export async function inspectBuildMonitoringRoutes() {
  const elosContextPromise = loadElosContext();

  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) throw new Error(login.message ?? "Koper login failed");

    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (isKoper && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !isAllowedFlowSwitch(url, request.method(), request.postData())) {
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {}
      await route.continue();
    });

    const flowSelected = await selectFlow(page);
    if (!flowSelected) throw new Error("KOPER_FLOW_COMPANY_NOT_SELECTED");

    let capturedHeaders: Record<string, string> | null = null;
    const capture = (request: { method(): string; url(): string; headers(): Record<string, string> }) => {
      try {
        const url = new URL(request.url());
        if (request.method() === "GET" && url.hostname === "api.koper.com.br" && url.pathname === "/engineering/v1/item_monitoring" && capturedHeaders === null) {
          capturedHeaders = request.headers();
        }
      } catch {}
    };
    page.on("request", capture);
    await page.goto("https://app.koper.com.br/engenharia/acompanhamento_obra/view/67/cronograma_financeiro", {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    }).catch(() => undefined);
    for (let attempt = 0; attempt < 10 && !capturedHeaders; attempt += 1) await page.waitForTimeout(750);
    page.off("request", capture);
    if (!capturedHeaders) throw new Error("Koper engineering headers not captured");
    const headers: Record<string, string> = capturedHeaders;

    const itemQuery = new URLSearchParams({
      buildMonitoringId: "67",
      financialSchedule: "yes",
      limitX: "1",
      limitY: "500",
      offsetX: "0",
      offsetY: "0",
      positionDate: new Date().toISOString().slice(0, 10),
      scale: "month",
    });
    const itemResponse = await page.request.get(
      `https://api.koper.com.br/engineering/v1/item_monitoring?${itemQuery.toString()}`,
      { headers, timeout: 10_000 },
    );
    const itemBody: unknown = await itemResponse.json().catch(() => null);
    const itemRecord = record(itemBody);
    const itemRows = Array.isArray(itemRecord.items) ? itemRecord.items : [];
    const serviceItems: ServiceItem[] = [];
    const seenMonitoringItems = new Set<number>();
    for (const raw of itemRows) {
      const row = record(raw);
      const itemMonitoringId = numberValue(row.itemMonitoringId);
      const serviceId = numberValue(row.serviceId);
      if (itemMonitoringId === null || serviceId === null || seenMonitoringItems.has(itemMonitoringId)) continue;
      seenMonitoringItems.add(itemMonitoringId);
      serviceItems.push({ itemMonitoringId, serviceId });
    }

    const inputToServices = new Map<number, Set<number>>();
    let successfulCompositions = 0;
    let totalCompositionLinks = 0;
    const concurrency = 30;
    for (let start = 0; start < serviceItems.length; start += concurrency) {
      const batch = serviceItems.slice(start, start + concurrency);
      const results = await Promise.all(batch.map(async (item) => {
        const response = await page.request.get(
          `https://api.koper.com.br/engineering/v1/monitoring_input?itemMonitoringId=${item.itemMonitoringId}`,
          { headers, timeout: 6_000 },
        ).catch(() => null);
        if (!response || response.status() !== 200) return [] as number[];
        successfulCompositions += 1;
        const body: unknown = await response.json().catch(() => null);
        const rows = Array.isArray(body) ? body : [];
        totalCompositionLinks += rows.length;
        return [...new Set(rows.map((row) => numberValue(record(row).inputId)).filter((value): value is number => value !== null))];
      }));
      results.forEach((inputIds, index) => {
        const serviceItem = batch[index];
        if (!serviceItem) return;
        for (const inputId of inputIds) {
          const services = inputToServices.get(inputId) ?? new Set<number>();
          services.add(serviceItem.serviceId);
          inputToServices.set(inputId, services);
        }
      });
    }

    const context = await elosContextPromise;
    const stockByProductRequestId = new Map(context.stockItems.map((row) => [row.koper_id, record(row.payload)]));
    const elosServiceByKoperId = new Map<string, string>();
    for (const service of context.services) if (service.source_id) elosServiceByKoperId.set(service.source_id, service.id);

    const budgetById = new Map(context.budgetItems.map((row) => [row.koper_id, row]));
    const budgetByInputId = new Map<string, StagingRow>();
    for (const row of context.budgetItems) {
      const inputId = id(record(row.payload).inputId);
      if (inputId) budgetByInputId.set(inputId, row);
    }

    function oldResolvedKoperService(link: Rec): number | null {
      const itemMonitInputId = id(link.itemMonitInputId);
      const monitInputPchId = id(link.monitInputPchId);
      const budget =
        (itemMonitInputId ? budgetById.get(itemMonitInputId) : undefined)
        ?? (monitInputPchId ? budgetById.get(monitInputPchId) : undefined)
        ?? (itemMonitInputId ? budgetByInputId.get(itemMonitInputId) : undefined)
        ?? (monitInputPchId ? budgetByInputId.get(monitInputPchId) : undefined);
      return budget ? numberValue(record(budget.payload).serviceId) : null;
    }

    function resolveProductRequest(productRequestId: string): Resolution {
      const payload = stockByProductRequestId.get(productRequestId);
      if (!payload) return { state: "missing" };
      const inputId = numberValue(payload.inputId);
      if (inputId === null) return { state: "missing" };
      const candidates = [...(inputToServices.get(inputId) ?? new Set<number>())];
      if (candidates.length > 1) return { state: "ambiguous" };
      const koperServiceId = candidates[0];
      if (koperServiceId === undefined) return { state: "missing" };
      const elosServiceId = elosServiceByKoperId.get(String(koperServiceId));
      if (!elosServiceId) return { state: "missing" };
      return { state: "safe", koperServiceId, elosServiceId };
    }

    let validationKnownLinks = 0;
    let validationComparableUnique = 0;
    let validationMatches = 0;
    let validationMismatches = 0;
    for (const row of context.stockItems) {
      const payload = record(row.payload);
      const inputId = numberValue(payload.inputId);
      if (inputId === null) continue;
      const candidateSet = inputToServices.get(inputId);
      const uniqueCandidate = candidateSet?.size === 1 ? [...candidateSet][0] : undefined;
      const links = Array.isArray(payload.services) ? payload.services : [];
      for (const rawLink of links) {
        const knownService = oldResolvedKoperService(record(rawLink));
        if (knownService === null) continue;
        validationKnownLinks += 1;
        if (uniqueCandidate === undefined) continue;
        validationComparableUnique += 1;
        if (uniqueCandidate === knownService) validationMatches += 1;
        else validationMismatches += 1;
      }
    }

    let legacyRequestItemsSafe = 0;
    let legacyRequestItemsAmbiguous = 0;
    let legacyRequestItemsMissing = 0;
    for (const row of context.requestItems) {
      const sourceIds = productRequestIdsFromNotes(row.notes);
      if (sourceIds.length === 0) {
        legacyRequestItemsMissing += 1;
        continue;
      }
      const resolutions = sourceIds.map(resolveProductRequest);
      const safeElosServices = [...new Set(resolutions.flatMap((result) => result.state === "safe" && result.elosServiceId ? [result.elosServiceId] : []))];
      if (resolutions.every((result) => result.state === "safe") && safeElosServices.length === 1) legacyRequestItemsSafe += 1;
      else if (resolutions.some((result) => result.state === "ambiguous") || safeElosServices.length > 1) legacyRequestItemsAmbiguous += 1;
      else legacyRequestItemsMissing += 1;
    }

    let legacyPurchaseItemsSafe = 0;
    let legacyPurchaseItemsAmbiguous = 0;
    let legacyPurchaseItemsMissing = 0;
    for (const row of context.purchaseItems) {
      const productRequestId = (row.source_id ?? "").split(":")[1];
      if (!productRequestId) {
        legacyPurchaseItemsMissing += 1;
        continue;
      }
      const result = resolveProductRequest(productRequestId);
      if (result.state === "safe") legacyPurchaseItemsSafe += 1;
      else if (result.state === "ambiguous") legacyPurchaseItemsAmbiguous += 1;
      else legacyPurchaseItemsMissing += 1;
    }

    let uniqueInputs = 0;
    let ambiguousInputs = 0;
    for (const services of inputToServices.values()) {
      if (services.size === 1) uniqueInputs += 1;
      else if (services.size > 1) ambiguousInputs += 1;
    }

    return {
      ok: true,
      authenticated: true,
      flowSelected: true,
      serviceItems: serviceItems.length,
      successfulCompositions,
      totalCompositionLinks,
      distinctInputs: inputToServices.size,
      uniqueInputs,
      ambiguousInputs,
      validationKnownLinks,
      validationComparableUnique,
      validationMatches,
      validationMismatches,
      legacyRequestItems: context.requestItems.length,
      legacyRequestItemsSafe,
      legacyRequestItemsAmbiguous,
      legacyRequestItemsMissing,
      legacyPurchaseItems: context.purchaseItems.length,
      legacyPurchaseItemsSafe,
      legacyPurchaseItemsAmbiguous,
      legacyPurchaseItemsMissing,
      mappedKoperServices: elosServiceByKoperId.size,
      blockedWrites,
      message: null,
    };
  }, { sessionTimeoutMs: 60_000 });
}
