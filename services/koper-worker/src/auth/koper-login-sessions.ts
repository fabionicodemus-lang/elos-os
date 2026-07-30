import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { connectBrowserless } from "../browser/browserless.js";
import { env } from "../config/env.js";

type ActiveKoperLoginSession = {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  liveUrl: string;
  createdAt: Date;
  expiresAt: Date;
  cleanupTimer: NodeJS.Timeout;
};

type BrowserlessCdpSession = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
};

export type KoperLoginSessionCreated = {
  ok: true;
  sessionId: string;
  liveUrl: string;
  createdAt: string;
  expiresAt: string;
};

export type KoperLoginSessionStatus = {
  ok: true;
  sessionId: string;
  active: boolean;
  authenticated: boolean;
  currentUrl: string;
  title: string;
  createdAt: string;
  expiresAt: string;
};

const sessions = new Map<string, ActiveKoperLoginSession>();
let activeSessionId: string | null = null;

function isLoginPage(currentUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const login = new URL(env.KOPER_LOGIN_URL);

    return current.hostname === login.hostname;
  } catch {
    return true;
  }
}

async function disposeSession(session: ActiveKoperLoginSession): Promise<void> {
  clearTimeout(session.cleanupTimer);
  sessions.delete(session.id);

  if (activeSessionId === session.id) {
    activeSessionId = null;
  }

  await session.browser.close().catch(() => undefined);
}

export async function createKoperLoginSession(): Promise<KoperLoginSessionCreated> {
  if (activeSessionId) {
    const previous = sessions.get(activeSessionId);

    if (previous) {
      await disposeSession(previous);
    }
  }

  const { browser, context, page } = await connectBrowserless();

  try {
    await page.goto(env.KOPER_LOGIN_URL, {
      waitUntil: "domcontentloaded",
    });
    await page.bringToFront();

    const playwrightCdpSession = await context.newCDPSession(page);
    const browserlessCdpSession =
      playwrightCdpSession as unknown as BrowserlessCdpSession;
    const result = (await browserlessCdpSession.send("Browserless.liveURL", {
      timeout: env.KOPER_LOGIN_SESSION_TIMEOUT_MS,
      interactable: true,
      type: "jpeg",
      quality: 60,
      resizable: true,
      showBrowserInterface: false,
      compressed: true,
      emulateComponents: true,
    })) as { liveURL?: unknown };

    if (typeof result.liveURL !== "string" || result.liveURL.length === 0) {
      throw new Error("O Browserless não retornou um link visual de login.");
    }

    const id = randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + env.KOPER_LOGIN_SESSION_TIMEOUT_MS,
    );

    const cleanupTimer = setTimeout(() => {
      const session = sessions.get(id);

      if (session) {
        void disposeSession(session);
      }
    }, env.KOPER_LOGIN_SESSION_TIMEOUT_MS);
    cleanupTimer.unref();

    const session: ActiveKoperLoginSession = {
      id,
      browser,
      context,
      page,
      liveUrl: result.liveURL,
      createdAt,
      expiresAt,
      cleanupTimer,
    };

    sessions.set(id, session);
    activeSessionId = id;

    return {
      ok: true,
      sessionId: id,
      liveUrl: session.liveUrl,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

export async function getKoperLoginSessionStatus(
  sessionId: string,
): Promise<KoperLoginSessionStatus | null> {
  const session = sessions.get(sessionId);

  if (!session) {
    return null;
  }

  if (!session.browser.isConnected() || Date.now() >= session.expiresAt.getTime()) {
    await disposeSession(session);
    return null;
  }

  const currentUrl = session.page.url();
  const title = await session.page.title().catch(() => "");

  return {
    ok: true,
    sessionId,
    active: true,
    authenticated: currentUrl !== "about:blank" && !isLoginPage(currentUrl),
    currentUrl,
    title,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  };
}

export async function closeKoperLoginSession(
  sessionId: string,
): Promise<boolean> {
  const session = sessions.get(sessionId);

  if (!session) {
    return false;
  }

  await disposeSession(session);
  return true;
}
