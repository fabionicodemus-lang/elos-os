import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import { env } from "../config/env.js";

export type BrowserlessSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
};

export type BrowserlessConnectOptions = {
  sessionTimeoutMs?: number;
};

function buildBrowserlessEndpoint(options?: BrowserlessConnectOptions): string {
  const rawUrl = env.BROWSERLESS_WS_URL?.trim();
  const token = env.BROWSERLESS_TOKEN?.trim();
  if (!rawUrl || !token) {
    throw new Error("Browserless não configurado para esta execução.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(rawUrl);
  } catch {
    throw new Error("BROWSERLESS_WS_URL inválida para esta execução.");
  }
  endpoint.searchParams.set("token", token);

  if (options?.sessionTimeoutMs) {
    endpoint.searchParams.set("timeout", String(options.sessionTimeoutMs));
  }

  return endpoint.toString();
}

export async function connectBrowserless(
  options?: BrowserlessConnectOptions,
): Promise<BrowserlessSession> {
  const browser = await chromium.connectOverCDP(buildBrowserlessEndpoint(options), {
    timeout: 30_000,
  });

  const context = browser.contexts()[0];

  if (!context) {
    await browser.close().catch(() => undefined);
    throw new Error("O Browserless não retornou um contexto padrão.");
  }

  context.setDefaultTimeout(20_000);
  context.setDefaultNavigationTimeout(45_000);

  const page = context.pages()[0] ?? (await context.newPage());

  return {
    browser,
    context,
    page,
  };
}

export async function withBrowserless<T>(
  task: (session: BrowserlessSession) => Promise<T>,
  options?: BrowserlessConnectOptions,
): Promise<T> {
  const session = await connectBrowserless(options);

  try {
    return await task(session);
  } finally {
    await session.browser.close().catch(() => undefined);
  }
}