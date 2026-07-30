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

function buildBrowserlessEndpoint(): string {
  const endpoint = new URL(env.BROWSERLESS_WS_URL);
  endpoint.searchParams.set("token", env.BROWSERLESS_TOKEN);
  return endpoint.toString();
}

export async function withBrowserless<T>(
  task: (session: BrowserlessSession) => Promise<T>,
): Promise<T> {
  const browser = await chromium.connectOverCDP(buildBrowserlessEndpoint(), {
    timeout: 30_000,
  });

  try {
    const context = browser.contexts()[0];

    if (!context) {
      throw new Error("O Browserless não retornou um contexto padrão.");
    }

    context.setDefaultTimeout(20_000);
    context.setDefaultNavigationTimeout(45_000);

    const page = context.pages()[0] ?? (await context.newPage());

    return await task({ browser, context, page });
  } finally {
    await browser.close().catch(() => undefined);
  }
}
