import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { isAllowedFlowSwitch } from "./inspect-koper-engineering.js";
import { selectFlow } from "./collect-flow-stock-requests.js";

type Rec = Record<string, unknown>;
type Probe = {
  inputId: number;
  expectedItemMonitInputId: number;
  status: number;
  matched: boolean;
  options: Array<{ itemMonitInputId: number | null; itemMonitoringId: number | null; reference: string | null }>;
  errorMessage: string | null;
};

function rec(value: unknown): Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Rec : {};
}

function n(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

const samples = [
  [8537, 3644], [8532, 3631], [4404, 3566], [8466, 3565], [4057, 3532],
  [415, 3646], [215, 3641], [8005, 3071], [6754, 1719], [2167, 3661],
  [2893, 493], [2348, 3662], [2347, 3663], [8549, 3654], [8552, 3660],
] as const;

export async function inspectBuildMonitoringRoutes(): Promise<{
  ok: true;
  authenticated: boolean;
  flowSelected: boolean;
  probes: Probe[];
  matched: number;
  missing: number;
  failed: number;
  blockedWrites: number;
}> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) throw new Error(login.message ?? "Koper login failed");

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
    if (!flowSelected) throw new Error("KOPER_FLOW_COMPANY_NOT_SELECTED");

    let headers: Record<string, string> | null = null;
    const capture = (request: { method(): string; url(): string; headers(): Record<string, string> }) => {
      try {
        const url = new URL(request.url());
        if (request.method() === "GET" && url.hostname === "api.koper.com.br" && url.pathname === "/engineering/v1/item_monitoring" && headers === null) headers = request.headers();
      } catch {}
    };
    page.on("request", capture);
    await page.goto("https://app.koper.com.br/engenharia/acompanhamento_obra/view/67/cronograma_financeiro", { waitUntil: "domcontentloaded", timeout: 25_000 }).catch(() => undefined);
    for (let i = 0; i < 10 && !headers; i += 1) await page.waitForTimeout(750);
    page.off("request", capture);
    if (!headers) throw new Error("Koper headers not captured");
    const requestHeaders: Record<string, string> = headers;

    const probes: Probe[] = [];
    for (const [inputId, expectedItemMonitInputId] of samples) {
      const query = new URLSearchParams({ services: "yes", inputId: String(inputId), buildMonitoringId: "67", page: "stockRequest" });
      const response = await page.request.get(`https://api.koper.com.br/engineering/v1/monitoring_input?${query.toString()}`, { headers: requestHeaders, timeout: 10_000 }).catch(() => null);
      if (!response) {
        probes.push({ inputId, expectedItemMonitInputId, status: 0, matched: false, options: [], errorMessage: "request-failed" });
        continue;
      }
      const body: unknown = await response.json().catch(() => null);
      const rows = Array.isArray(body) ? body : [];
      const options = rows.map((raw) => {
        const row = rec(raw);
        return {
          itemMonitInputId: n(row.itemMonitInputId),
          itemMonitoringId: n(row.itemMonitoringId),
          reference: typeof row.monitItemReference === "string" ? row.monitItemReference : null,
        };
      });
      const object = rec(body);
      probes.push({
        inputId,
        expectedItemMonitInputId,
        status: response.status(),
        matched: options.some((option) => option.itemMonitInputId === expectedItemMonitInputId),
        options,
        errorMessage: typeof object.message === "string" ? object.message.slice(0, 200) : null,
      });
      await page.waitForTimeout(100);
    }

    return {
      ok: true,
      authenticated: true,
      flowSelected: true,
      probes,
      matched: probes.filter((probe) => probe.matched).length,
      missing: probes.filter((probe) => probe.status === 200 && !probe.matched).length,
      failed: probes.filter((probe) => probe.status !== 200).length,
      blockedWrites,
    };
  }, { sessionTimeoutMs: 60_000 });
}
