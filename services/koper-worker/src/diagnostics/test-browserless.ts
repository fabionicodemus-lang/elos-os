import { env } from "../config/env.js";
import { withBrowserless } from "../browser/browserless.js";

export type BrowserlessDiagnostic = {
  ok: true;
  status: number | null;
  title: string;
  finalUrl: string;
  checkedAt: string;
};

export async function testBrowserlessConnection(): Promise<BrowserlessDiagnostic> {
  return withBrowserless(async ({ page }) => {
    const response = await page.goto(env.KOPER_LOGIN_URL, {
      waitUntil: "domcontentloaded",
    });

    return {
      ok: true,
      status: response?.status() ?? null,
      title: await page.title(),
      finalUrl: page.url(),
      checkedAt: new Date().toISOString(),
    };
  });
}
