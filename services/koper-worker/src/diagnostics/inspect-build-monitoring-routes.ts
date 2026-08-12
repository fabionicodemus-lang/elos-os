import { env } from "../config/env.js";
import { requestSupabase } from "../elos/supabase.js";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type Rec = Record<string, unknown>;
type StagingRow = { koper_id: string; payload: unknown };
type ServiceRow = { id: string; source_id: string | null };
type MonitoringItem = { serviceId: number | null; reference: string | null };
type OfficialOption = { itemMonitoringId: number; itemMonitInputId: number; reference: string | null };

const SHARD_COUNT = 4;
const SHARD_INDEX = 3;

function rec(value: unknown): Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Rec : {};
}

function n(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function text(value: unknown): string | null {
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

export async function inspectBuildMonitoringRoutes() {
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
    for (let i = 0; i < 10 && !capturedHeaders; i += 1) await page.waitForTimeout(750);
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
    const itemRows = Array.isArray(rec(itemBody).items) ? rec(itemBody).items as unknown[] : [];
    const monitoringById = new Map<number, MonitoringItem>();
    for (const raw of itemRows) {
      const row = rec(raw);
      const itemMonitoringId = n(row.itemMonitoringId);
      if (itemMonitoringId === null) continue;
      monitoringById.set(itemMonitoringId, { serviceId: n(row.serviceId), reference: text(row.itemReference) });
    }

    const context = await contextPromise;
    const elosServiceByKoperId = new Map<number, string>();
    for (const service of context.services) {
      const sourceId = n(service.source_id);
      if (sourceId !== null) elosServiceByKoperId.set(sourceId, service.id);
    }

    const linkedRows = context.stockItems.filter((row) => {
      const links = rec(row.payload).services;
      return Array.isArray(links) && links.length > 0;
    });
    const shardRows = linkedRows.filter((row) => {
      const inputId = n(rec(row.payload).inputId);
      return inputId !== null && ((inputId % SHARD_COUNT) + SHARD_COUNT) % SHARD_COUNT === SHARD_INDEX;
    });
    const inputIds = [...new Set(shardRows.map((row) => n(rec(row.payload).inputId)).filter((value): value is number => value !== null))];

    const officialByPair = new Map<string, OfficialOption>();
    let inputRoutesOk = 0;
    let inputRoutesFailed = 0;
    const concurrency = 10;
    for (let start = 0; start < inputIds.length; start += concurrency) {
      const batch = inputIds.slice(start, start + concurrency);
      const results = await Promise.all(batch.map(async (inputId) => {
        const query = new URLSearchParams({ services: "yes", inputId: String(inputId), buildMonitoringId: "67", page: "stockRequest" });
        const response = await page.request.get(
          `https://api.koper.com.br/engineering/v1/monitoring_input?${query.toString()}`,
          { headers, timeout: 10_000 },
        ).catch(() => null);
        if (!response || response.status() !== 200) return { inputId, ok: false as const, rows: [] as unknown[] };
        const body: unknown = await response.json().catch(() => null);
        return { inputId, ok: true as const, rows: Array.isArray(body) ? body : [] };
      }));
      for (const result of results) {
        if (!result.ok) {
          inputRoutesFailed += 1;
          continue;
        }
        inputRoutesOk += 1;
        for (const raw of result.rows) {
          const row = rec(raw);
          const itemMonitInputId = n(row.itemMonitInputId);
          const itemMonitoringId = n(row.itemMonitoringId);
          if (itemMonitInputId === null || itemMonitoringId === null) continue;
          officialByPair.set(`${result.inputId}:${itemMonitInputId}`, {
            itemMonitoringId,
            itemMonitInputId,
            reference: text(row.monitItemReference),
          });
        }
      }
      await page.waitForTimeout(80);
    }

    let serviceLinks = 0;
    let resolvedLinks = 0;
    let missingOfficialPair = 0;
    let missingMonitoringItem = 0;
    let missingService = 0;
    let missingElosService = 0;
    let referenceMismatches = 0;
    let fullyResolvedItems = 0;
    let partiallyResolvedItems = 0;
    let unresolvedItems = 0;

    for (const row of shardRows) {
      const payload = rec(row.payload);
      const inputId = n(payload.inputId);
      const links = Array.isArray(payload.services) ? payload.services : [];
      serviceLinks += links.length;
      let resolvedForItem = 0;
      for (const rawLink of links) {
        const itemMonitInputId = n(rec(rawLink).itemMonitInputId);
        const official = inputId !== null && itemMonitInputId !== null ? officialByPair.get(`${inputId}:${itemMonitInputId}`) : undefined;
        if (!official) {
          missingOfficialPair += 1;
          continue;
        }
        const monitoring = monitoringById.get(official.itemMonitoringId);
        if (!monitoring) {
          missingMonitoringItem += 1;
          continue;
        }
        if (monitoring.serviceId === null) {
          missingService += 1;
          continue;
        }
        if (!elosServiceByKoperId.has(monitoring.serviceId)) {
          missingElosService += 1;
          continue;
        }
        resolvedLinks += 1;
        resolvedForItem += 1;
        if (official.reference && monitoring.reference && official.reference !== monitoring.reference) referenceMismatches += 1;
      }
      if (resolvedForItem === links.length) fullyResolvedItems += 1;
      else if (resolvedForItem > 0) partiallyResolvedItems += 1;
      else unresolvedItems += 1;
    }

    return {
      ok: true,
      authenticated: true,
      flowSelected: true,
      shardIndex: SHARD_INDEX,
      shardCount: SHARD_COUNT,
      shardInputs: inputIds.length,
      shardItems: shardRows.length,
      serviceLinks,
      inputRoutesOk,
      inputRoutesFailed,
      officialAllocationPairs: officialByPair.size,
      resolvedLinks,
      resolvedPercent: serviceLinks === 0 ? 0 : Number(((resolvedLinks / serviceLinks) * 100).toFixed(2)),
      missingOfficialPair,
      missingMonitoringItem,
      missingService,
      missingElosService,
      fullyResolvedItems,
      partiallyResolvedItems,
      unresolvedItems,
      referenceMismatches,
      blockedWrites,
    };
  }, { sessionTimeoutMs: 60_000 });
}
