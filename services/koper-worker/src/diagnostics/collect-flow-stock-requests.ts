import type { Page } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import {
  isAllowedFlowSwitch,
  openCompanySelector,
  readActiveCompanyLabel,
} from "./inspect-koper-engineering.js";

export type FlowStockRequest = Record<string, unknown>;

export type FlowStockRequestDetail = {
  requestId: string;
  payload: Record<string, unknown>;
};

export type FlowStockRequestCollection = {
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  listMode: "active" | "closed";
  total: number;
  requests: FlowStockRequest[];
  details: FlowStockRequestDetail[];
  blockedWrites: number;
  message: string | null;
};

function identifier(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requestList(body: unknown): FlowStockRequest[] {
  const object = objectValue(body);
  return Array.isArray(object?.requests)
    ? object.requests.filter(
      (value): value is FlowStockRequest => objectValue(value) !== null,
    )
    : [];
}

function totalValue(body: unknown): number | null {
  const total = objectValue(body)?.itemsAmount;
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}

async function selectFlow(page: Page): Promise<boolean> {
  let activeCompany = await readActiveCompanyLabel(page).catch(() => null);
  if (/flow/i.test(activeCompany ?? "")) return true;
  if (!activeCompany) return false;

  await openCompanySelector(page, activeCompany).catch(() => undefined);
  const flowCard = page
    .locator('[data-testid="multiCompaniesModal"]')
    .filter({ has: page.getByText(/^FLOW APTOS - BOSSA$/i, { exact: true }) })
    .first();
  if (!(await flowCard.isVisible().catch(() => false))) return false;

  const action = flowCard.getByText(/^Acessar esta empresa$/i, { exact: true }).last();
  if (!(await action.isVisible().catch(() => false))) return false;
  await action.click();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.waitForTimeout(1_500);
    activeCompany = await readActiveCompanyLabel(page).catch(() => null);
    if (/flow/i.test(activeCompany ?? "")) return true;
  }
  return false;
}

async function fetchRequests(
  page: Page,
  headers: Record<string, string>,
  open: "yes" | "no",
  range?: { offset: number; limit: number },
): Promise<{ total: number; requests: FlowStockRequest[] }> {
  const requests: FlowStockRequest[] = [];
  const limit = range?.limit ?? 100;
  let total = 0;

  for (let offset = range?.offset ?? 0; ; offset += limit) {
    const query = new URLSearchParams({
      group: "request",
      limit: String(limit),
      offset: String(offset),
      open,
      orderFlag: "desc",
      orderby: "requestDate",
      typeDate: "requestDate",
    });
    const response = await page.request.get(
      `https://api.koper.com.br/stock/v1/request?${query.toString()}`,
      { headers, timeout: 30_000 },
    );
    if (!response.ok()) {
      throw new Error(`Koper stock request list failed (HTTP ${response.status()})`);
    }
    const body: unknown = await response.json();
    const pageRequests = requestList(body);
    total = totalValue(body) ?? total;
    requests.push(...pageRequests);
    if (range) break;
    if (pageRequests.length < limit || (total > 0 && requests.length >= total)) break;
  }

  return { total, requests };
}

async function fetchDetails(
  page: Page,
  headers: Record<string, string>,
  requests: FlowStockRequest[],
): Promise<FlowStockRequestDetail[]> {
  const ids = requests.flatMap((request) => {
    const id = identifier(request.requestId);
    return id ? [id] : [];
  });
  const details: FlowStockRequestDetail[] = [];
  const concurrency = requests.length >= 100 ? 30 : 12;

  for (let offset = 0; offset < ids.length; offset += concurrency) {
    const batch = ids.slice(offset, offset + concurrency);
    details.push(...await Promise.all(batch.map(async (requestId) => {
      const query = new URLSearchParams({ group: "request", requestId });
      const response = await page.request.get(
        `https://api.koper.com.br/stock/v1/product_request?${query.toString()}`,
        { headers, timeout: 30_000 },
      );
      if (!response.ok()) {
        throw new Error(
          `Koper stock request detail ${requestId} failed (HTTP ${response.status()})`,
        );
      }
      const body: unknown = await response.json();
      const payload = objectValue(body);
      if (!payload) throw new Error(`Koper stock request detail ${requestId} is invalid`);
      return { requestId, payload };
    })));
  }

  return details;
}

async function collectFlowStockRequests(
  listMode: "active" | "closed",
  range?: { offset: number; limit: number },
): Promise<FlowStockRequestCollection> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) {
      return {
        ok: true,
        authenticated: false,
        flowSelected: false,
        listMode,
        total: 0,
        requests: [],
        details: [],
        blockedWrites: 0,
        message: login.message,
      };
    }

    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      const method = request.method();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        const isRead = ["GET", "HEAD", "OPTIONS"].includes(method);
        if (isKoper && !isRead && !isAllowedFlowSwitch(url, method, request.postData())) {
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {
        // URLs inválidas seguem o navegador.
      }
      await route.continue();
    });

    const flowSelected = await selectFlow(page);
    if (!flowSelected) {
      return {
        ok: true,
        authenticated: true,
        flowSelected: false,
        listMode,
        total: 0,
        requests: [],
        details: [],
        blockedWrites,
        message: "KOPER_FLOW_COMPANY_NOT_SELECTED",
      };
    }

    let requestHeaders: Record<string, string> | null = null;
    const captureHeaders = (request: { method(): string; url(): string; headers(): Record<string, string> }): void => {
      try {
        const url = new URL(request.url());
        if (
          request.method() === "GET"
          && url.hostname === "api.koper.com.br"
          && url.pathname === "/stock/v1/request"
          && requestHeaders === null
        ) requestHeaders = request.headers();
      } catch {
        // Ignora URLs inválidas.
      }
    };
    page.on("request", captureHeaders);
    await page.goto("https://app.koper.com.br/suprimentos/solicitacoes/", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    for (let attempt = 0; attempt < 12 && !requestHeaders; attempt += 1) {
      await page.waitForTimeout(1_000);
    }
    page.off("request", captureHeaders);
    if (!requestHeaders) throw new Error("Koper stock request headers were not captured");

    const collection = await fetchRequests(
      page,
      requestHeaders,
      listMode === "active" ? "yes" : "no",
      range,
    );
    const details = await fetchDetails(page, requestHeaders, collection.requests);
    if (details.length !== collection.requests.length) {
      throw new Error(`Koper ${listMode} stock request detail count does not match list`);
    }

    return {
      ok: true,
      authenticated: true,
      flowSelected: true,
      listMode,
      total: collection.total,
      requests: collection.requests,
      details,
      blockedWrites,
      message: null,
    };
  }, { sessionTimeoutMs: 60_000 });
}

export async function collectFlowActiveStockRequests(): Promise<FlowStockRequestCollection> {
  return collectFlowStockRequests("active");
}

export async function collectFlowClosedStockRequests(): Promise<FlowStockRequestCollection> {
  return collectFlowStockRequests("closed");
}

export async function collectFlowClosedStockRequestBatch(
  batchIndex: number,
  batchSize = 100,
): Promise<FlowStockRequestCollection> {
  if (!Number.isInteger(batchIndex) || batchIndex < 0) throw new Error("Invalid closed request batch index");
  return collectFlowStockRequests("closed", { offset: batchIndex * batchSize, limit: batchSize });
}
