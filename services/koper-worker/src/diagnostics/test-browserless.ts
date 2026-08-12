import { env } from "../config/env.js";
import { withBrowserless } from "../browser/browserless.js";
import { dryRunStockRequestPromotion } from "./dry-run-stock-request-promotion.js";

export type BrowserlessDiagnostic = {
  ok: true;
  status: number | null;
  title: string;
  finalUrl: string;
  checkedAt: string;
};

if (process.env.KOPER_DRY_RUN_MARKER) {
  void dryRunStockRequestPromotion()
    .then((result) => {
      console.log("KOPER_DRY_RUN_RESULT", JSON.stringify(result));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      console.error(`KOPER_DRY_RUN_FAILED ${message}`);
    });
}

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
