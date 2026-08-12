import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type Rec = Record<string, unknown>;
type StagingRow = { koper_id: string; payload: unknown };
type ServiceRow = { id: string; source_id: string | null };
type MonitoringItem = { itemMonitoringId: number; serviceId: number | null; itemReference: string | null };
type OfficialOption = { itemMonitoringId: number; itemMonitInputId: number; reference: string | null };
type UnresolvedSample = {
  productRequestId: string;
  inputId: number | null;
  itemMonitInputId: number | null;
  reason: string;
};

function rec(value: unknown): Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Rec : {};
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
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

async function loadContext(): Promise<{ stockItems: StagingRow[]; services: ServiceRow[] }> {
  const [stockItems, services] = await Promise.all([
    readPaged<StagingRow>("koper_staging_records", {
      select: "koper_id,payload",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper",
      entity: "eq.stock_request_item",
      sync_state: "eq.present",
    }),
    readPaged<ServiceRow>("engineering_services", {
      select: "id,source_id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
    }),
  ]);
  return { stockItems, services };
}

export async function inspectBuildMonitoringRoutes(): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  stockItems: number;
  linkedStockItems: number;
  serviceLinks: number;
  distinctLinkedInputs: number;
  inputRoutesOk: number;
  inputRoutesFailed: number;
  officialAllocationPairs: number;
  monitoringItems: number;
  monitoringItemsWithService: number;
  mappedKoperServices: number;
  resolvedLinks: number;
  resolvedPercent: number;
  unresolvedMissingInput: number;
  unresolvedMissingOfficialPair: number;
  unresolvedMissingMonitoringItem: number;
  unresolvedMissingService: number;
  unresolvedMissingElosService: number;
  itemsFullyResolved: number;
  itemsPartiallyResolved: number;
  itemsUnresolved: number;
  multiAllocationItems: number;
  referenceMismatches: number;
  unresolvedSamples: UnresolvedSample[];
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
    const capture = (request: { method(): string; url(): string; headers(): Record<string, string> }) => {
      try {
        const url = new URL(request.url());
        if (request.method() === "GET" && url.hostname === "api.koper.com.br" && url.pathname === "/engineering/v1/item_monitoring" && headers === null) headers = request.headers();
      } catch {}
    };
    page.on("request", capture);
    await page.goto("https://app.koper.com.br/engenharia/acompanhamento_obra/view/67/cronograma_financeiro", {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    }).catch(() => undefined);
    for (let attempt = 0; attempt < 10 && !headers; attempt += 1) await page.waitForTimeout(750);
    page.off("request", capture);
    if (!headers) throw new Error("Koper engineering headers not captured");
    const requestHeaders: Record<string, string> = headers;

    const context = await contextPromise;
    const linkedRows = context.stockItems.filter((row) => {
      const services = rec(row.payload).services;
      return Array.isArray(services) && services.length > 0;
    });

    const distinctInputs = new Set<number>();
    let serviceLinks = 0;
    let multiAllocationItems = 0;
    for (const row of linkedRows) {
      const payload = rec(row.payload);
      const inputId = numberValue(payload.inputId);
      if (inputId !== null) distinctInputs.add(inputId);
      const links = Array.isArray(payload.services) ? payload.services : [];
      serviceLinks += links.length;
      if (links.length > 1) multiAllocationItems += 1;
    }

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
      { headers: requestHeaders, timeout: 10_000 },
    );
    const itemBody: unknown = await itemResponse.json().catch(() => null);
    const itemRows = Array.isArray(rec(itemBody).items) ? rec(itemBody).items as unknown[] : [];
    const monitoringById = new Map<number, MonitoringItem>();
    for (const raw of itemRows) {
      const row = rec(raw);
      const itemMonitoringId = numberValue(row.itemMonitoringId);
      if (itemMonitoringId === null) continue;
      monitoringById.set(itemMonitoringId, {
        itemMonitoringId,
        serviceId: numberValue(row.serviceId),
        itemReference: textValue(row.itemReference),
      });
    }

    const officialByPair = new Map<string, OfficialOption>();
    let inputRoutesOk = 0;
    let inputRoutesFailed = 0;
    const inputList = [...distinctInputs];
    const concurrency = 35;
    for (let start = 0; start < inputList.length; start += concurrency) {
      const batch = inputList.slice(start, start + concurrency);
      const results = await Promise.all(batch.map(async (inputId) => {
        const query = new URLSearchParams({
          services: "yes",
          inputId: String(inputId),
          buildMonitoringId: "67",
          page: "stockRequest",
        });
        const response = await page.request.get(
          `https://api.koper.com.br/engineering/v1/monitoring_input?${query.toString()}`,
          { headers: requestHeaders, timeout: 6_000 },
        ).catch(() => null);
        if (!response || response.status() !== 200) return { inputId, ok: false as const, body: [] as unknown[] };
        const body: unknown = await response.json().catch(() => null);
        return { inputId, ok: true as const, body: Array.isArray(body) ? body : [] };
      }));
      for (const result of results) {
        if (!result.ok) {
          inputRoutesFailed += 1;
          continue;
        }
        inputRoutesOk += 1;
        for (const raw of result.body) {
          const option = rec(raw);
          const itemMonitInputId = numberValue(option.itemMonitInputId);
          const itemMonitoringId = numberValue(option.itemMonitoringId);
          if (itemMonitInputId === null || itemMonitoringId === null) continue;
          officialByPair.set(`${result.inputId}:${itemMonitInputId}`, {
            itemMonitoringId,
            itemMonitInputId,
            reference: textValue(option.monitItemReference),
          });
        }
      }
    }

    const elosServiceByKoperId = new Map<number, string>();
    for (const service of context.services) {
      const sourceId = numberValue(service.source_id);
      if (sourceId !== null) elosServiceByKoperId.set(sourceId, service.id);
    }

    let resolvedLinks = 0;
    let unresolvedMissingInput = 0;
    let unresolvedMissingOfficialPair = 0;
    let unresolvedMissingMonitoringItem = 0;
    let unresolvedMissingService = 0;
    let unresolvedMissingElosService = 0;
    let referenceMismatches = 0;
    let itemsFullyResolved = 0;
    let itemsPartiallyResolved = 0;
    let itemsUnresolved = 0;
    const unresolvedSamples: UnresolvedSample[] = [];

    for (const row of linkedRows) {
      const payload = rec(row.payload);
      const inputId = numberValue(payload.inputId);
      const links = Array.isArray(payload.services) ? payload.services : [];
      let resolvedForItem = 0;

      for (const rawLink of links) {
        const link = rec(rawLink);
        const itemMonitInputId = numberValue(link.itemMonitInputId);
        let reason: string | null = null;

        if (inputId === null || itemMonitInputId === null) {
          unresolvedMissingInput += 1;
          reason = "missing-input-or-itemMonitInputId";
        } else {
          const official = officialByPair.get(`${inputId}:${itemMonitInputId}`);
          if (!official) {
            unresolvedMissingOfficialPair += 1;
            reason = "official-pair-not-found";
          } else {
            const monitoring = monitoringById.get(official.itemMonitoringId);
            if (!monitoring) {
              unresolvedMissingMonitoringItem += 1;
              reason = "itemMonitoringId-not-found";
            } else if (monitoring.serviceId === null) {
              unresolvedMissingService += 1;
              reason = "monitoring-item-without-service";
            } else if (!elosServiceByKoperId.has(monitoring.serviceId)) {
              unresolvedMissingElosService += 1;
              reason = "koper-service-not-mapped-to-elos";
            } else {
              resolvedLinks += 1;
              resolvedForItem += 1;
              if (official.reference && monitoring.itemReference && official.reference !== monitoring.itemReference) referenceMismatches += 1;
            }
          }
        }

        if (reason && unresolvedSamples.length < 30) {
          unresolvedSamples.push({ productRequestId: row.koper_id, inputId, itemMonitInputId, reason });
        }
      }

      if (resolvedForItem === links.length) itemsFullyResolved += 1;
      else if (resolvedForItem > 0) itemsPartiallyResolved += 1;
      else itemsUnresolved += 1;
    }

    return {
      ok: true,
      authenticated: true,
      flowSelected: true,
      stockItems: context.stockItems.length,
      linkedStockItems: linkedRows.length,
      serviceLinks,
      distinctLinkedInputs: distinctInputs.size,
      inputRoutesOk,
      inputRoutesFailed,
      officialAllocationPairs: officialByPair.size,
      monitoringItems: monitoringById.size,
      monitoringItemsWithService: [...monitoringById.values()].filter((item) => item.serviceId !== null).length,
      mappedKoperServices: elosServiceByKoperId.size,
      resolvedLinks,
      resolvedPercent: serviceLinks === 0 ? 0 : Number(((resolvedLinks / serviceLinks) * 100).toFixed(2)),
      unresolvedMissingInput,
      unresolvedMissingOfficialPair,
      unresolvedMissingMonitoringItem,
      unresolvedMissingService,
      unresolvedMissingElosService,
      itemsFullyResolved,
      itemsPartiallyResolved,
      itemsUnresolved,
      multiAllocationItems,
      referenceMismatches,
      unresolvedSamples,
      blockedWrites,
      message: null,
    };
  }, { sessionTimeoutMs: 60_000 });
}
