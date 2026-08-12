import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type StagingLike = { koper_id: string; payload: unknown };
type UnknownRecord = Record<string, unknown>;

export type OfficialStockRequestServiceResolution = {
  inputId: string;
  itemMonitInputId: string;
  itemMonitoringId: string;
  koperServiceId: string;
  itemReference: string | null;
};

export type OfficialStockRequestServiceMap = Map<string, OfficialStockRequestServiceResolution>;

function objectValue(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function identifier(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function pairKey(inputId: string, itemMonitInputId: string): string {
  return `${inputId}:${itemMonitInputId}`;
}

export function officialStockRequestServiceKey(inputId: unknown, itemMonitInputId: unknown): string | null {
  const input = identifier(inputId);
  const allocation = identifier(itemMonitInputId);
  return input && allocation ? pairKey(input, allocation) : null;
}

export async function resolveFlowStockRequestServices(
  itemRows: StagingLike[],
): Promise<OfficialStockRequestServiceMap> {
  const requiredPairs = new Map<string, { inputId: string; itemMonitInputId: string; productRequestId: string }>();
  const inputIds = new Set<string>();

  for (const itemRow of itemRows) {
    const payload = objectValue(itemRow.payload);
    const inputId = identifier(payload.inputId);
    const links = Array.isArray(payload.services) ? payload.services.map(objectValue) : [];
    if (links.length === 0) continue;
    if (!inputId) throw new Error(`Koper product request ${itemRow.koper_id} has service links without inputId`);
    inputIds.add(inputId);
    for (const link of links) {
      const itemMonitInputId = identifier(link.itemMonitInputId);
      if (!itemMonitInputId) {
        throw new Error(`Koper product request ${itemRow.koper_id} has a service link without itemMonitInputId`);
      }
      requiredPairs.set(pairKey(inputId, itemMonitInputId), { inputId, itemMonitInputId, productRequestId: itemRow.koper_id });
    }
  }

  if (requiredPairs.size === 0) return new Map();

  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) throw new Error(login.message ?? "Koper login failed while resolving stock request services");

    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (isKoper && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !isAllowedFlowSwitch(url, request.method(), request.postData())) {
          await route.abort("blockedbyclient");
          return;
        }
      } catch {}
      await route.continue();
    });

    if (!await selectFlow(page)) throw new Error("KOPER_FLOW_COMPANY_NOT_SELECTED");

    let capturedHeaders: Record<string, string> | null = null;
    const capture = (request: { method(): string; url(): string; headers(): Record<string, string> }): void => {
      try {
        const url = new URL(request.url());
        if (
          request.method() === "GET"
          && url.hostname === "api.koper.com.br"
          && url.pathname === "/engineering/v1/item_monitoring"
          && capturedHeaders === null
        ) capturedHeaders = request.headers();
      } catch {}
    };
    page.on("request", capture);
    await page.goto("https://app.koper.com.br/engenharia/acompanhamento_obra/view/67/cronograma_financeiro", {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    }).catch(() => undefined);
    for (let attempt = 0; attempt < 10 && !capturedHeaders; attempt += 1) await page.waitForTimeout(750);
    page.off("request", capture);
    if (!capturedHeaders) throw new Error("Koper engineering headers not captured while resolving stock request services");
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
    if (itemResponse.status() !== 200) throw new Error(`Koper item_monitoring returned ${itemResponse.status()}`);
    const itemBody: unknown = await itemResponse.json().catch(() => null);
    const monitoringRows = Array.isArray(objectValue(itemBody).items) ? objectValue(itemBody).items as unknown[] : [];
    const serviceByMonitoringId = new Map<string, { serviceId: string; reference: string | null }>();
    for (const raw of monitoringRows) {
      const row = objectValue(raw);
      const itemMonitoringId = identifier(row.itemMonitoringId);
      const serviceId = identifier(row.serviceId);
      if (!itemMonitoringId || !serviceId) continue;
      serviceByMonitoringId.set(itemMonitoringId, {
        serviceId,
        reference: typeof row.itemReference === "string" ? row.itemReference : null,
      });
    }

    const official = new Map<string, OfficialStockRequestServiceResolution>();
    const inputs = [...inputIds];
    const concurrency = 10;
    for (let start = 0; start < inputs.length; start += concurrency) {
      const batch = inputs.slice(start, start + concurrency);
      const responses = await Promise.all(batch.map(async (inputId) => {
        const query = new URLSearchParams({
          services: "yes",
          inputId,
          buildMonitoringId: "67",
          page: "stockRequest",
        });
        const response = await page.request.get(
          `https://api.koper.com.br/engineering/v1/monitoring_input?${query.toString()}`,
          { headers, timeout: 10_000 },
        ).catch(() => null);
        if (!response || response.status() !== 200) {
          throw new Error(`Koper monitoring_input failed for inputId=${inputId} status=${response?.status() ?? 0}`);
        }
        const body: unknown = await response.json().catch(() => null);
        return { inputId, rows: Array.isArray(body) ? body : [] };
      }));

      for (const response of responses) {
        for (const raw of response.rows) {
          const row = objectValue(raw);
          const itemMonitInputId = identifier(row.itemMonitInputId);
          const itemMonitoringId = identifier(row.itemMonitoringId);
          if (!itemMonitInputId || !itemMonitoringId) continue;
          const key = pairKey(response.inputId, itemMonitInputId);
          if (!requiredPairs.has(key)) continue;
          const monitoring = serviceByMonitoringId.get(itemMonitoringId);
          if (!monitoring) throw new Error(`No monitored service for Koper itemMonitoringId=${itemMonitoringId}`);
          official.set(key, {
            inputId: response.inputId,
            itemMonitInputId,
            itemMonitoringId,
            koperServiceId: monitoring.serviceId,
            itemReference: typeof row.monitItemReference === "string" ? row.monitItemReference : monitoring.reference,
          });
        }
      }
      await page.waitForTimeout(80);
    }

    const missing = [...requiredPairs.entries()].filter(([key]) => !official.has(key));
    if (missing.length > 0) {
      const examples = missing.slice(0, 10).map(([, value]) =>
        `productRequestId=${value.productRequestId},inputId=${value.inputId},itemMonitInputId=${value.itemMonitInputId}`
      ).join(";");
      throw new Error(`Koper official stock request service mapping incomplete: ${missing.length}/${requiredPairs.size} missing. ${examples}`);
    }

    for (const resolution of official.values()) {
      if (positiveInteger(resolution.koperServiceId) === null) {
        throw new Error(`Invalid Koper serviceId ${resolution.koperServiceId} for inputId=${resolution.inputId}`);
      }
    }

    return official;
  }, { sessionTimeoutMs: 300_000 });
}
