import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;

const object = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function summarizeBody(body: unknown): Json {
  if (Array.isArray(body)) {
    return {
      kind: "array",
      length: body.length,
      sampleKeys: object(body[0]) ? Object.keys(object(body[0]) ?? {}).slice(0, 30) : [],
    };
  }

  const data = object(body);
  if (!data) return { kind: typeof body };

  const summary: Json = {
    kind: "object",
    keys: Object.keys(data).slice(0, 50),
  };

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      summary[`array:${key}`] = {
        length: value.length,
        sampleKeys: object(value[0]) ? Object.keys(object(value[0]) ?? {}).slice(0, 30) : [],
      };
    }
  }

  return summary;
}

async function logApiResponse(response: Response): Promise<void> {
  try {
    const request = response.request();
    const url = new URL(response.url());
    if (request.method() !== "GET" || url.hostname !== "api.koper.com.br") return;

    const path = `${url.pathname}${url.search}`;
    const lower = path.toLowerCase();
    const relevant = ["meas", "med", "contract", "contr", "engineering", "engineer", "execution", "work"].some((term) => lower.includes(term));
    if (!relevant) return;

    const contentType = response.headers()["content-type"] ?? "";
    let bodySummary: Json = {};
    if (contentType.includes("application/json")) {
      const body = await response.json().catch(() => null);
      bodySummary = summarizeBody(body);
    }

    console.log("KOPER_MEASUREMENT_API", JSON.stringify({
      status: response.status(),
      url: path,
      body: bodySummary,
    }));
  } catch (error: unknown) {
    console.log("KOPER_MEASUREMENT_API_LOG_FAILED", JSON.stringify({
      message: error instanceof Error ? error.message.slice(0, 500) : "unknown",
    }));
  }
}

try {
  const result = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ok: false, message: login.message };

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
    if (!flowSelected) return { ok: false, message: "KOPER_FLOW_COMPANY_NOT_SELECTED", blockedWrites };

    page.on("response", (response) => {
      void logApiResponse(response);
    });

    const candidates = [
      "https://app.koper.com.br/engenharia/medicoes",
      "https://app.koper.com.br/engenharia/medicao",
      "https://app.koper.com.br/engineering/measurements",
      "https://app.koper.com.br/engineering/measurement",
    ];

    const attempts: Json[] = [];
    for (const url of candidates) {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => null);
      await sleep(3_000);
      const title = await page.title().catch(() => "");
      const bodyText = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
      attempts.push({ url, status: response?.status() ?? null, title, hasMedicoes: /Medições/i.test(bodyText), bodyPrefix: bodyText.slice(0, 300) });
      if (/Medições/i.test(bodyText)) break;
    }

    const bodyBefore = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");

    const finalizadasButton = page.getByText(/ver\s+finalizadas/i).first();
    const finalizadasCount = await finalizadasButton.count().catch(() => 0);
    let clickedFinalizadas = false;
    if (finalizadasCount > 0) {
      clickedFinalizadas = await finalizadasButton.click({ timeout: 5_000 }).then(() => true).catch(() => false);
      await sleep(5_000);
    }

    const bodyAfter = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");

    return {
      ok: true,
      readOnly: true,
      flowSelected: true,
      blockedWrites,
      currentUrl: page.url(),
      attempts,
      clickedFinalizadas,
      before: bodyBefore.slice(0, 1_500),
      after: bodyAfter.slice(0, 2_500),
    };
  }, { sessionTimeoutMs: 90_000 });

  console.log("KOPER_MEASUREMENT_DISCOVERY", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_MEASUREMENT_DISCOVERY_FAILED", JSON.stringify({
    message: error instanceof Error ? error.message.slice(0, 1_000) : "unknown",
  }));
}

await import("./index.js");
