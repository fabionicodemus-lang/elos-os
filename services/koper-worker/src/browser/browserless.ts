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

function hasRemoteBrowserless(): boolean {
  return Boolean(env.BROWSERLESS_WS_URL && env.BROWSERLESS_TOKEN);
}

function buildBrowserlessEndpoint(options?: BrowserlessConnectOptions): string {
  if (!env.BROWSERLESS_WS_URL || !env.BROWSERLESS_TOKEN) {
    throw new Error("Browserless remoto não configurado");
  }

  const endpoint = new URL(env.BROWSERLESS_WS_URL);
  endpoint.searchParams.set("token", env.BROWSERLESS_TOKEN);

  if (options?.sessionTimeoutMs) {
    endpoint.searchParams.set("timeout", String(options.sessionTimeoutMs));
  }

  return endpoint.toString();
}

async function connectLocalChromium(): Promise<BrowserlessSession> {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext();
  context.setDefaultTimeout(20_000);
  context.setDefaultNavigationTimeout(45_000);
  const page = await context.newPage();
  return { browser, context, page };
}

export async function connectBrowserless(
  options?: BrowserlessConnectOptions,
): Promise<BrowserlessSession> {
  if (!hasRemoteBrowserless()) return connectLocalChromium();

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
