import type { Locator, Page } from "playwright-core";
import { withBrowserless } from "../browser/browserless.js";
import { env } from "../config/env.js";

export type KoperAutomaticLoginResult = {
  ok: true;
  authenticated: boolean;
  finalUrl: string;
  title: string;
  message: string | null;
  checkedAt: string;
};

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    const locator = candidate.first();

    try {
      await locator.waitFor({ state: "visible", timeout: 1_500 });
      return locator;
    } catch {
      // Tenta o próximo seletor conhecido.
    }
  }

  return null;
}

function identifierCandidates(page: Page): Locator[] {
  return [
    page.getByLabel(/e-?mail|email|usuário|usuario|login|cpf|cnpj/i),
    page.getByPlaceholder(/e-?mail|email|usuário|usuario|login|cpf|cnpj/i),
    page.locator('input[type="email"]'),
    page.locator('input[name*="email" i]'),
    page.locator('input[name*="user" i]'),
    page.locator('input[name*="login" i]'),
    page.locator(
      'input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([disabled])',
    ),
  ];
}

function passwordCandidates(page: Page): Locator[] {
  return [
    page.getByLabel(/senha|password/i),
    page.getByPlaceholder(/senha|password/i),
    page.locator('input[type="password"]'),
    page.locator('input[name*="password" i]'),
    page.locator('input[name*="senha" i]'),
  ];
}

function submitCandidates(page: Page): Locator[] {
  return [
    page.getByRole("button", {
      name: /entrar|acessar|continuar|avançar|avancar|próximo|proximo|login|sign in/i,
    }),
    page.locator('button[type="submit"]'),
    page.locator('input[type="submit"]'),
  ];
}

async function clickSubmit(page: Page): Promise<void> {
  const submit = await firstVisible(submitCandidates(page));

  if (!submit) {
    throw new Error("KOPER_LOGIN_SUBMIT_NOT_FOUND");
  }

  await submit.click();
}

function isKoperLoginUrl(currentUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const login = new URL(env.KOPER_LOGIN_URL);

    return current.hostname === login.hostname;
  } catch {
    return true;
  }
}

async function readVisibleLoginMessage(page: Page): Promise<string | null> {
  const message = await firstVisible([
    page.getByRole("alert"),
    page.locator('[class*="error" i]'),
    page.locator('[class*="alert" i]'),
    page.locator('[data-testid*="error" i]'),
  ]);

  if (!message) {
    return null;
  }

  const text = (await message.innerText().catch(() => "")).trim();
  return text.length > 0 ? text.slice(0, 300) : null;
}

async function performLogin(page: Page): Promise<KoperAutomaticLoginResult> {
  await page.goto(env.KOPER_LOGIN_URL, {
    waitUntil: "domcontentloaded",
  });

  const identifier = await firstVisible(identifierCandidates(page));

  if (!identifier) {
    throw new Error("KOPER_LOGIN_IDENTIFIER_FIELD_NOT_FOUND");
  }

  await identifier.fill(env.KOPER_USERNAME);

  let password = await firstVisible(passwordCandidates(page));

  if (!password) {
    await clickSubmit(page);
    await page.waitForTimeout(1_000);
    password = await firstVisible(passwordCandidates(page));
  }

  if (!password) {
    throw new Error("KOPER_LOGIN_PASSWORD_FIELD_NOT_FOUND");
  }

  await password.fill(env.KOPER_PASSWORD);
  await clickSubmit(page);

  await Promise.race([
    page.waitForURL((url) => !isKoperLoginUrl(url.toString()), {
      timeout: 30_000,
    }),
    page.waitForLoadState("domcontentloaded", { timeout: 30_000 }),
  ]).catch(() => undefined);

  await page.waitForTimeout(1_500);

  const finalUrl = page.url();
  const title = await page.title().catch(() => "");
  const passwordStillVisible = Boolean(
    await firstVisible(passwordCandidates(page)),
  );
  const authenticated = !isKoperLoginUrl(finalUrl) && !passwordStillVisible;

  return {
    ok: true,
    authenticated,
    finalUrl,
    title,
    message: authenticated ? null : await readVisibleLoginMessage(page),
    checkedAt: new Date().toISOString(),
  };
}

export async function loginKoperAutomatically(): Promise<KoperAutomaticLoginResult> {
  return withBrowserless(async ({ page }) => performLogin(page));
}
