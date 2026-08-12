import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type UnknownRecord = Record<string, unknown>;
type ServiceItem = { itemMonitoringId: number; serviceId: number };
type RequestSample = { inputId: number; itemMonitInputId: number | null; monitInputPchId: number | null; candidateServiceIds: number[] };

function obj(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export async function inspectBuildMonitoringRoutes(): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  serviceItems: number;
  successfulCompositions: number;
  totalCompositionLinks: number;
  distinctInputs: number;
  uniqueInputs: number;
  ambiguousInputs: number;
  maxServicesPerInput: number;
  request266Products: number;
  request266AllocationLinks: number;
  request266UniqueByInput: number;
  request266AmbiguousByInput: number;
  request266MissingByInput: number;
  request266Samples: RequestSample[];
  blockedWrites: number;
  message: string | null;
}> {
  return withBrowserless(async ({ page }) => {
    const empty = {
      ok: true as const,
      authenticated: false,
      flowSelected: false,
      serviceItems: 0,
      successfulCompositions: 0,
      totalCompositionLinks: 0,
      distinctInputs: 0,
      uniqueInputs: 0,
      ambiguousInputs: 0,
      maxServicesPerInput: 0,
      request266Products: 0,
      request266AllocationLinks: 0,
      request266UniqueByInput: 0,
      request266AmbiguousByInput: 0,
      request266MissingByInput: 0,
      request266Samples: [] as RequestSample[],
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
    const itemResponse = await page.request.get(`https://api.koper.com.br/engineering/v1/item_monitoring?${itemQuery.toString()}`, { headers: requestHeaders, timeout: 10_000 });
    const itemBody: unknown = await itemResponse.json().catch(() => null);
    const itemRows = Array.isArray(obj(itemBody)?.items) ? obj(itemBody)?.items as unknown[] : [];
    const serviceItems: ServiceItem[] = [];
    const seen = new Set<number>();
    for (const raw of itemRows) {
      const record = obj(raw);
      const itemMonitoringId = num(record?.itemMonitoringId);
      const serviceId = num(record?.serviceId);
      if (itemMonitoringId === null || serviceId === null || seen.has(itemMonitoringId)) continue;
      seen.add(itemMonitoringId);
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
          { headers: requestHeaders, timeout: 6_000 },
        ).catch(() => null);
        if (!response || response.status() !== 200) return [] as number[];
        successfulCompositions += 1;
        const body: unknown = await response.json().catch(() => null);
        const rows = Array.isArray(body) ? body : [];
        totalCompositionLinks += rows.length;
        return [...new Set(rows.map((row) => num(obj(row)?.inputId)).filter((value): value is number => value !== null))];
      }));
      results.forEach((inputIds, index) => {
        const serviceId = batch[index].serviceId;
        for (const inputId of inputIds) {
          const services = inputToServices.get(inputId) ?? new Set<number>();
          services.add(serviceId);
          inputToServices.set(inputId, services);
        }
      });
    }

    let uniqueInputs = 0;
    let ambiguousInputs = 0;
    let maxServicesPerInput = 0;
    for (const services of inputToServices.values()) {
      if (services.size === 1) uniqueInputs += 1;
      else if (services.size > 1) ambiguousInputs += 1;
      maxServicesPerInput = Math.max(maxServicesPerInput, services.size);
    }

    const requestResponse = await page.request.get(
      "https://api.koper.com.br/stock/v1/product_request?group=request&requestId=266",
      { headers: requestHeaders, timeout: 10_000 },
    );
    const requestBody: unknown = await requestResponse.json().catch(() => null);
    const products = Array.isArray(obj(requestBody)?.products) ? obj(requestBody)?.products as unknown[] : [];
    const samples: RequestSample[] = [];
    let allocationLinks = 0;
    let uniqueByInput = 0;
    let ambiguousByInput = 0;
    let missingByInput = 0;
    for (const raw of products) {
      const product = obj(raw);
      const inputId = num(product?.inputId);
      if (inputId === null) continue;
      const servicesRaw = Array.isArray(product?.services) ? product.services : [];
      const candidateServiceIds = [...(inputToServices.get(inputId) ?? new Set<number>())].sort((a, b) => a - b);
      for (const rawService of servicesRaw) {
        const allocation = obj(rawService);
        allocationLinks += 1;
        if (candidateServiceIds.length === 1) uniqueByInput += 1;
        else if (candidateServiceIds.length > 1) ambiguousByInput += 1;
        else missingByInput += 1;
        if (samples.length < 20) {
          samples.push({
            inputId,
            itemMonitInputId: num(allocation?.itemMonitInputId),
            monitInputPchId: num(allocation?.monitInputPchId),
            candidateServiceIds,
          });
        }
      }
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
      maxServicesPerInput,
      request266Products: products.length,
      request266AllocationLinks: allocationLinks,
      request266UniqueByInput: uniqueByInput,
      request266AmbiguousByInput: ambiguousByInput,
      request266MissingByInput: missingByInput,
      request266Samples: samples,
      blockedWrites,
      message: requestResponse.status() === 200 ? null : `KOPER_REQUEST_266_STATUS_${requestResponse.status()}`,
    };
  }, { sessionTimeoutMs: 60_000 });
}
