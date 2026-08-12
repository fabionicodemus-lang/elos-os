import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type UnknownRecord = Record<string, unknown>;
type ServiceItem = { itemMonitoringId: number; serviceId: number };
type StagingRow = { koper_id: string; payload: unknown };
type ServiceRow = { id: string; source_id: string | null; code: string };
type RequestItemRow = { id: string; notes: string | null };
type PurchaseItemRow = { id: string; source_id: string | null };

function obj(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : {};
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

async function readPaged<T>(resource: string, base: Record<string, string>, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await requestSupabase<T[]>(resource, {
      query: new URLSearchParams({ ...base, limit: String(pageSize), offset: String(offset) }),
      timeoutMs: 30_000,
    });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function loadContext(): Promise<{
  staging: StagingRow[];
  services: ServiceRow[];
  legacyId: string;
  requestItems: RequestItemRow[];
  purchaseItems: PurchaseItemRow[];
}> {
  const [staging, services, projects] = await Promise.all([
    readPaged<StagingRow>("koper_staging_records", {
      select: "koper_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.stock_request_item",
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
  const legacy = services.find((row) => row.code === "KOPER-SR-LEGACY");
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
  return { staging, services, legacyId: legacy.id, requestItems, purchaseItems };
}

function productRequestIdsFromNotes(notes: string | null): string[] {
  if (!notes) return [];
  const match = notes.match(/Koper productRequestIds=([^·]+)/);
  if (!match?.[1]) return [];
  return match[1].split(",").map((value) => value.trim()).filter(Boolean);
}

export async function inspectBuildMonitoringRoutes(): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  legacyRequestItems: number;
  legacyRequestItemsSafe: number;
  legacyRequestItemsAmbiguous: number;
  legacyRequestItemsMissing: number;
  legacyPurchaseItems: number;
  legacyPurchaseItemsSafe: number;
  legacyPurchaseItemsAmbiguous: number;
  legacyPurchaseItemsMissing: number;
  distinctInputs: number;
  uniqueInputs: number;
  ambiguousInputs: number;
  mappedKoperServices: number;
  blockedWrites: number;
  message: string | null;
}> {
  const contextPromise = loadContext();
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

    let headers: Record<string, string> | null = null;
    const capture = (request: { method(): string; url(): string; headers(): Record<string, string> }): void => {
      try {
        const url = new URL(request.url());
        if (request.method() === "GET" && url.hostname === "api.koper.com.br" && url.pathname === "/engineering/v1/item_monitoring" && headers === null) headers = request.headers();
      } catch {}
    };
    page.on("request", capture);
    await page.goto("https://app.koper.com.br/engenharia/acompanhamento_obra/view/67/cronograma_financeiro", { waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => undefined);
    for (let i = 0; i < 8 && !headers; i += 1) await page.waitForTimeout(600);
    page.off("request", capture);
    if (!headers) throw new Error("Koper engineering headers not captured");
    const requestHeaders: Record<string, string> = headers;

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
    const itemResponse = await page.request.get(`https://api.koper.com.br/engineering/v1/item_monitoring?${itemQuery.toString()}`, { headers: requestHeaders, timeout: 8_000 });
    const itemBody: unknown = await itemResponse.json().catch(() => null);
    const itemRecord = obj(itemBody);
    const items = Array.isArray(itemRecord.items) ? itemRecord.items : [];
    const serviceItems: ServiceItem[] = [];
    const seen = new Set<number>();
    for (const raw of items) {
      const record = obj(raw);
      const itemMonitoringId = num(record.itemMonitoringId);
      const serviceId = num(record.serviceId);
      if (itemMonitoringId === null || serviceId === null || seen.has(itemMonitoringId)) continue;
      seen.add(itemMonitoringId);
      serviceItems.push({ itemMonitoringId, serviceId });
    }

    const inputToServices = new Map<number, Set<number>>();
    const concurrency = 50;
    for (let start = 0; start < serviceItems.length; start += concurrency) {
      const batch = serviceItems.slice(start, start + concurrency);
      const resultSets = await Promise.all(batch.map(async (item) => {
        const response = await page.request.get(
          `https://api.koper.com.br/engineering/v1/monitoring_input?itemMonitoringId=${item.itemMonitoringId}`,
          { headers: requestHeaders, timeout: 5_000 },
        ).catch(() => null);
        if (!response || response.status() !== 200) return [] as number[];
        const body: unknown = await response.json().catch(() => null);
        const rows = Array.isArray(body) ? body : [];
        return [...new Set(rows.map((row) => num(obj(row).inputId)).filter((value): value is number => value !== null))];
      }));
      resultSets.forEach((inputIds, index) => {
        const serviceItem = batch[index];
        if (!serviceItem) return;
        for (const inputId of inputIds) {
          const set = inputToServices.get(inputId) ?? new Set<number>();
          set.add(serviceItem.serviceId);
          inputToServices.set(inputId, set);
        }
      });
    }

    const context = await contextPromise;
    const stagingById = new Map(context.staging.map((row) => [row.koper_id, obj(row.payload)]));
    const elosServiceByKoperId = new Map<string, string>();
    for (const service of context.services) if (service.source_id) elosServiceByKoperId.set(service.source_id, service.id);

    function safeServiceForProductRequest(productRequestId: string): { state: "safe" | "ambiguous" | "missing"; elosServiceId?: string } {
      const payload = stagingById.get(productRequestId);
      if (!payload) return { state: "missing" };
      const inputId = num(payload.inputId);
      if (inputId === null) return { state: "missing" };
      const candidates = [...(inputToServices.get(inputId) ?? new Set<number>())];
      const mapped = [...new Set(candidates.map((id) => elosServiceByKoperId.get(String(id))).filter((id): id is string => Boolean(id)))];
      const mappedServiceId = mapped.length === 1 ? mapped[0] : undefined;
      if (candidates.length === 1 && mappedServiceId) return { state: "safe", elosServiceId: mappedServiceId };
      if (candidates.length > 1) return { state: "ambiguous" };
      return { state: "missing" };
    }

    let requestSafe = 0;
    let requestAmbiguous = 0;
    let requestMissing = 0;
    for (const row of context.requestItems) {
      const sourceIds = productRequestIdsFromNotes(row.notes);
      if (sourceIds.length === 0) {
        requestMissing += 1;
        continue;
      }
      const resolutions = sourceIds.map(safeServiceForProductRequest);
      const safeIds = [...new Set(resolutions.flatMap((resolution) => resolution.state === "safe" && resolution.elosServiceId ? [resolution.elosServiceId] : []))];
      if (resolutions.every((resolution) => resolution.state === "safe") && safeIds.length === 1) requestSafe += 1;
      else if (resolutions.some((resolution) => resolution.state === "ambiguous") || safeIds.length > 1) requestAmbiguous += 1;
      else requestMissing += 1;
    }

    let purchaseSafe = 0;
    let purchaseAmbiguous = 0;
    let purchaseMissing = 0;
    for (const row of context.purchaseItems) {
      const parts = (row.source_id ?? "").split(":");
      const productRequestId = parts[1] ?? null;
      if (!productRequestId) {
        purchaseMissing += 1;
        continue;
      }
      const resolution = safeServiceForProductRequest(productRequestId);
      if (resolution.state === "safe") purchaseSafe += 1;
      else if (resolution.state === "ambiguous") purchaseAmbiguous += 1;
      else purchaseMissing += 1;
    }

    let uniqueInputs = 0;
    let ambiguousInputs = 0;
    for (const candidates of inputToServices.values()) {
      if (candidates.size === 1) uniqueInputs += 1;
      else if (candidates.size > 1) ambiguousInputs += 1;
    }

    return {
      ok: true,
      authenticated: true,
      flowSelected: true,
      legacyRequestItems: context.requestItems.length,
      legacyRequestItemsSafe: requestSafe,
      legacyRequestItemsAmbiguous: requestAmbiguous,
      legacyRequestItemsMissing: requestMissing,
      legacyPurchaseItems: context.purchaseItems.length,
      legacyPurchaseItemsSafe: purchaseSafe,
      legacyPurchaseItemsAmbiguous: purchaseAmbiguous,
      legacyPurchaseItemsMissing: purchaseMissing,
      distinctInputs: inputToServices.size,
      uniqueInputs,
      ambiguousInputs,
      mappedKoperServices: elosServiceByKoperId.size,
      blockedWrites,
      message: null,
    };
  }, { sessionTimeoutMs: 60_000 });
}
