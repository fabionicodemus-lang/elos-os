import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type UnknownRecord = Record<string, unknown>;
type MonitoringItem = { itemMonitoringId: number; serviceId: number };
type InputLink = { itemMonitoringId: number; serviceId: number; status: number; inputIds: number[]; inputCount: number };

function obj(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : null;
}

function numberish(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export async function inspectBuildMonitoringRoutes(): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  itemsAmount: number;
  itemRows: number;
  serviceItems: number;
  queriedItems: number;
  successfulItems: number;
  itemsWithInputs: number;
  totalInputLinks: number;
  distinctInputs: number;
  statusCounts: Record<string, number>;
  sampleLinks: InputLink[];
  blockedWrites: number;
  message: string | null;
}> {
  return withBrowserless(async ({ page }) => {
    const empty = {
      ok: true as const,
      authenticated: false,
      flowSelected: false,
      itemsAmount: 0,
      itemRows: 0,
      serviceItems: 0,
      queriedItems: 0,
      successfulItems: 0,
      itemsWithInputs: 0,
      totalInputLinks: 0,
      distinctInputs: 0,
      statusCounts: {},
      sampleLinks: [],
      blockedWrites: 0,
      message: null as string | null,
    };

    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ...empty, message: login.message };

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
    if (!flowSelected) return { ...empty, authenticated: true, blockedWrites, message: "KOPER_FLOW_COMPANY_NOT_SELECTED" };

    let headers: Record<string, string> | null = null;
    const capture = (request: { method(): string; url(): string; headers(): Record<string, string> }): void => {
      try {
        const url = new URL(request.url());
        if (request.method() === "GET" && url.hostname === "api.koper.com.br" && url.pathname === "/engineering/v1/item_monitoring" && headers === null) headers = request.headers();
      } catch {}
    };
    page.on("request", capture);
    await page.goto("https://app.koper.com.br/engenharia/acompanhamento_obra/view/67/cronograma_financeiro", { waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => undefined);
    for (let i = 0; i < 10 && !headers; i += 1) await page.waitForTimeout(750);
    page.off("request", capture);
    if (!headers) throw new Error("Koper engineering headers not captured");

    const positionDate = new Date().toISOString().slice(0, 10);
    const itemQuery = new URLSearchParams({
      buildMonitoringId: "67",
      financialSchedule: "yes",
      limitX: "1",
      limitY: "500",
      offsetX: "0",
      offsetY: "0",
      positionDate,
      scale: "month",
    });
    const itemResponse = await page.request.get(`https://api.koper.com.br/engineering/v1/item_monitoring?${itemQuery.toString()}`, { headers, timeout: 10_000 });
    const itemBody: unknown = await itemResponse.json().catch(() => null);
    const itemRecord = obj(itemBody);
    const itemRows = Array.isArray(itemRecord?.items) ? itemRecord.items : [];
    const itemsAmount = numberish(itemRecord?.itemsAmount) ?? itemRows.length;

    const serviceItems: MonitoringItem[] = [];
    const seen = new Set<number>();
    for (const raw of itemRows) {
      const record = obj(raw);
      if (!record) continue;
      const itemMonitoringId = numberish(record.itemMonitoringId);
      const serviceId = numberish(record.serviceId);
      if (itemMonitoringId === null || serviceId === null || seen.has(itemMonitoringId)) continue;
      seen.add(itemMonitoringId);
      serviceItems.push({ itemMonitoringId, serviceId });
    }

    const links: InputLink[] = [];
    const batchSize = 20;
    for (let start = 0; start < serviceItems.length; start += batchSize) {
      const batch = serviceItems.slice(start, start + batchSize);
      const batchResults = await Promise.all(batch.map(async (item): Promise<InputLink> => {
        const response = await page.request.get(
          `https://api.koper.com.br/engineering/v1/monitoring_input?itemMonitoringId=${item.itemMonitoringId}`,
          { headers, timeout: 6_000 },
        ).catch(() => null);
        if (!response) return { ...item, status: 0, inputIds: [], inputCount: 0 };
        const body: unknown = await response.json().catch(() => null);
        const rows = Array.isArray(body) ? body : [];
        const inputIds = [...new Set(rows.map((row) => numberish(obj(row)?.inputId)).filter((id): id is number => id !== null))];
        return { ...item, status: response.status(), inputIds, inputCount: rows.length };
      }));
      links.push(...batchResults);
    }

    const statusCounts: Record<string, number> = {};
    const distinctInputIds = new Set<number>();
    let successfulItems = 0;
    let itemsWithInputs = 0;
    let totalInputLinks = 0;
    for (const link of links) {
      statusCounts[String(link.status)] = (statusCounts[String(link.status)] ?? 0) + 1;
      if (link.status === 200) successfulItems += 1;
      if (link.inputCount > 0) itemsWithInputs += 1;
      totalInputLinks += link.inputCount;
      for (const inputId of link.inputIds) distinctInputIds.add(inputId);
    }

    return {
      ok: true,
      authenticated: true,
      flowSelected: true,
      itemsAmount,
      itemRows: itemRows.length,
      serviceItems: serviceItems.length,
      queriedItems: links.length,
      successfulItems,
      itemsWithInputs,
      totalInputLinks,
      distinctInputs: distinctInputIds.size,
      statusCounts,
      sampleLinks: links.filter((link) => link.inputCount > 0).slice(0, 30),
      blockedWrites,
      message: itemResponse.status() === 200 ? null : `KOPER_ITEM_MONITORING_STATUS_${itemResponse.status()}`,
    };
  }, { sessionTimeoutMs: 60_000 });
}
