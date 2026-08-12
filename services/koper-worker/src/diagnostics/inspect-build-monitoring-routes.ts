import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type Hit = {
  script: string;
  term: string;
  snippets: string[];
};

const terms = [
  "itemMonitInputId",
  "monitInputPchId",
  "monitoring_input",
  "item_monitoring",
  "itemPlanningId",
  "item_planning",
];

function snippets(text: string, term: string): string[] {
  const result: string[] = [];
  let from = 0;
  while (result.length < 8) {
    const index = text.indexOf(term, from);
    if (index < 0) break;
    const start = Math.max(0, index - 260);
    const end = Math.min(text.length, index + term.length + 360);
    result.push(text.slice(start, end).replace(/\s+/g, " "));
    from = index + term.length;
  }
  return result;
}

export async function inspectBuildMonitoringRoutes(): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  scriptsSeen: string[];
  hits: Hit[];
  blockedWrites: number;
  message: string | null;
}> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ok: true, authenticated: false, flowSelected: false, scriptsSeen: [], hits: [], blockedWrites: 0, message: login.message };

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
    if (!flowSelected) return { ok: true, authenticated: true, flowSelected: false, scriptsSeen: [], hits: [], blockedWrites, message: "KOPER_FLOW_COMPANY_NOT_SELECTED" };

    const scripts = new Map<string, Promise<string>>();
    page.on("response", (response) => {
      try {
        const url = new URL(response.url());
        if (!url.hostname.endsWith("koper.com.br") || !url.pathname.endsWith(".js")) return;
        if (scripts.has(response.url())) return;
        scripts.set(
          response.url(),
          response.text().catch(() => ""),
        );
      } catch {}
    });

    await page.goto("https://app.koper.com.br/engenharia/acompanhamento_obra/view/67/cronograma_financeiro", {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    }).catch(() => undefined);
    await page.waitForTimeout(5_000);

    const scriptsSeen: string[] = [];
    const hits: Hit[] = [];
    for (const [rawUrl, bodyPromise] of scripts.entries()) {
      const body = await bodyPromise;
      let display = rawUrl;
      try {
        const url = new URL(rawUrl);
        display = `${url.hostname}${url.pathname}`;
      } catch {}
      scriptsSeen.push(display);
      if (!body) continue;
      for (const term of terms) {
        const found = snippets(body, term);
        if (found.length > 0) hits.push({ script: display, term, snippets: found });
      }
    }

    return {
      ok: true,
      authenticated: true,
      flowSelected: true,
      scriptsSeen: [...new Set(scriptsSeen)].slice(0, 80),
      hits: hits.slice(0, 40),
      blockedWrites,
      message: hits.length > 0 ? null : "KOPER_ALLOCATION_TERMS_NOT_FOUND_IN_LOADED_BUNDLES",
    };
  }, { sessionTimeoutMs: 60_000 });
}
