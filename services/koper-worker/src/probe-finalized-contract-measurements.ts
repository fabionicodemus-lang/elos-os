import type { Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Json : null;
const rows = (v: unknown): Json[] => {
  const r = obj(v);
  const a = r && Array.isArray(r.measurements) ? r.measurements : [];
  return a.map(obj).filter((x): x is Json => x !== null);
};

try {
  const result = await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) return { ok: false, message: login.message };
    let blockedWrites = 0;
    await page.route("**/*", async route => {
      const req = route.request();
      try {
        const u = new URL(req.url());
        const koper = u.hostname === "koper.com.br" || u.hostname.endsWith(".koper.com.br");
        if (koper && !["GET", "HEAD", "OPTIONS"].includes(req.method()) && !isAllowedFlowSwitch(u, req.method(), req.postData())) {
          blockedWrites += 1; await route.abort("blockedbyclient"); return;
        }
      } catch {}
      await route.continue();
    });
    if (!await selectFlow(page)) return { ok: false, message: "FLOW_NOT_SELECTED", blockedWrites };

    const seedPromise = page.waitForResponse((response: Response) => {
      try { const u = new URL(response.url()); return response.request().method() === "GET" && u.hostname === "api.koper.com.br" && u.pathname === "/engineering/v1/build_measurement"; }
      catch { return false; }
    }, { timeout: 20_000 }).catch(() => null);
    await page.goto("https://app.koper.com.br/engenharia/medicoes", { waitUntil: "domcontentloaded", timeout: 12_000 }).catch(() => undefined);
    const seed = await seedPromise;
    if (!seed) return { ok: false, message: "SEED_NOT_FOUND", blockedWrites };
    const sh = seed.request().headers();
    const headers: Record<string, string> = {};
    for (const key of ["accept", "origin", "referer", "x-accesstoken", "x-koper"]) if (sh[key]) headers[key] = sh[key]!;

    const variants: Array<{ label: string; params: Record<string, string> }> = [
      { label: "open-yes", params: { open: "yes" } },
      { label: "open-no", params: { open: "no" } },
      { label: "open-false", params: { open: "false" } },
      { label: "open-all", params: { open: "all" } },
      { label: "without-open", params: {} },
    ];
    const responses = [];
    for (const variant of variants) {
      const u = new URL("https://api.koper.com.br/engineering/v1/build_measurement");
      for (const [k, v] of Object.entries({ limit: "500", offset: "0", orderFlag: "desc", orderby: "measurementId", ...variant.params })) u.searchParams.set(k, v);
      u.searchParams.set("cb", String(Date.now()));
      const resp = await page.request.get(u.toString(), { headers, timeout: 10_000 });
      const body = await resp.json().catch(() => null);
      const list = rows(body);
      responses.push({
        label: variant.label,
        status: resp.status(),
        itemsAmount: obj(body)?.itemsAmount ?? null,
        rows: list.slice(0, 80).map(r => ({
          measurementId: r.measurementId ?? null,
          measurementOrder: r.measurementOrder ?? null,
          measContractOrder: r.measContractOrder ?? null,
          measurementDate: r.measurementDate ?? null,
          measurementStatus: r.measurementStatus ?? null,
          buildMonitoringId: r.buildMonitoringId ?? null,
        })),
      });
    }
    return { ok: true, readOnly: true, blockedWrites, responses };
  }, { sessionTimeoutMs: 58_000 });
  console.log("KOPER_FINALIZED_CONTRACT_MEASUREMENTS", JSON.stringify(result));
} catch (error: unknown) {
  console.error("KOPER_FINALIZED_CONTRACT_MEASUREMENTS_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 1000) : "unknown" }));
}
await import("./index.js");
