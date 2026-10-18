/**
 * Descoberta (somente leitura) das telas de Vendas, Diário de obra e Transferências do Koper.
 *
 * Faz login, entra na empresa Flow Aptos, visita as telas candidatas e grava em staging cada
 * resposta GET da API do Koper que a tela carregou (entity "probe.api", payload sanitizado),
 * além dos links do menu (entity "probe.links"). Nenhuma escrita no Koper: o interceptor só
 * deixa passar GET/HEAD/OPTIONS e a troca de empresa allowlisted.
 *
 *   node dist/probe-koper-commercial.js            # grava em staging
 *   node dist/probe-koper-commercial.js --plan     # só registra no log
 *
 *   KOPER_PROBE_ROUTES=/comercial/vendas,/engenharia/diario  (opcional: substitui a lista padrão)
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { Page, Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import {
  COMPANIES, captureApiSession, isAllowedCompanySwitch, readActiveEnterpriseId, sanitizeKoperPayload, switchCompanyByInterface,
} from "./mirror-koper.js";
import { createKoperStagingRecord } from "./sync/staging-record.js";

const DEFAULT_ROUTES = [
  "/comercial", "/comercial/vendas", "/comercial/contratos", "/comercial/clientes", "/comercial/unidades", "/comercial/distratos",
  "/vendas", "/crm", "/incorporacao", "/incorporacao/vendas", "/imoveis",
  "/engenharia/diario_obra", "/engenharia/diario-obra", "/engenharia/diario", "/obras/diario", "/diario_obra",
  "/financeiro/transferencias", "/financeiro/movimentacao", "/financeiro/extrato", "/financeiro/contas", "/financeiro/fluxo_caixa",
  "/financeiro/contas_receber",
];
const KEYWORDS = /(vend|comerc|contrat|client|unidad|imov|distrat|diar|transfer|movim|extrato|conta)/i;
const MAX_BODY_CHARS = 1_500_000;

type Captured = { method: string; path: string; query: Record<string, string>; status: number; route: string; body: unknown };

function stripSecrets(url: URL): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (/token|cb$|^_$/i.test(key)) continue;
    query[key] = value;
  }
  return query;
}

async function collectLinks(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll("a[href]"))
    .map((a) => (a as HTMLAnchorElement).href)
    .filter((href) => href.includes("koper.com.br")));
}

export async function probeKoperCommercial(write: boolean): Promise<void> {
  const routes = (process.env.KOPER_PROBE_ROUTES ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  const targets = routes.length ? routes : DEFAULT_ROUTES;
  const captured: Captured[] = [];
  const links = new Set<string>();
  const visits: Array<{ route: string; finalUrl: string; title: string; text: string }> = [];

  await withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) throw new Error(`KOPER_AUTH_FAILED: ${login.message ?? "unknown"}`);
    let blocked = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (isKoper && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !isAllowedCompanySwitch(url, request.method(), request.postData())) {
          blocked += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch { /* segue */ }
      await route.continue();
    });

    const target = COMPANIES.flow.enterpriseId;
    let session = await captureApiSession(page);
    let active = await readActiveEnterpriseId(page, session);
    for (let attempt = 0; attempt < 2 && active !== target; attempt += 1) {
      const activeLabel = Object.values(COMPANIES).find((item) => item.enterpriseId === active)?.label ?? null;
      await switchCompanyByInterface(page, "flow", activeLabel);
      session = await captureApiSession(page);
      active = await readActiveEnterpriseId(page, session);
    }
    if (active !== target) throw new Error("KOPER_PROBE_FLOW_NOT_SELECTED");

    let currentRoute = "";
    page.on("response", (response: Response) => {
      void (async () => {
        try {
          const url = new URL(response.url());
          if (url.hostname !== "api.koper.com.br" || response.request().method() !== "GET") return;
          const text = await response.text().catch(() => "");
          if (!text || text.length > MAX_BODY_CHARS) return;
          let body: unknown = null;
          try { body = JSON.parse(text); } catch { return; }
          captured.push({ method: "GET", path: url.pathname, query: stripSecrets(url), status: response.status(), route: currentRoute, body });
        } catch { /* ignora */ }
      })();
    });

    for (const link of await collectLinks(page).catch(() => [])) links.add(link);
    for (const route of targets) {
      currentRoute = route;
      await page.goto(`https://app.koper.com.br${route}`, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(6_000);
      await page.mouse.wheel(0, 4000).catch(() => undefined);
      await page.waitForTimeout(2_000);
      for (const link of await collectLinks(page).catch(() => [])) links.add(link);
      const text = (await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")).replace(/\s+/g, " ").slice(0, 600);
      visits.push({ route, finalUrl: page.url(), title: await page.title().catch(() => ""), text });
    }
    // Segunda passada: links do menu com cara de vendas/diário/transferência que não estavam na lista.
    const extra = [...links].map((href) => { try { return new URL(href).pathname; } catch { return ""; } })
      .filter((path) => path && KEYWORDS.test(path) && !targets.includes(path)).slice(0, 25);
    for (const route of extra) {
      currentRoute = route;
      await page.goto(`https://app.koper.com.br${route}`, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(6_000);
      const text = (await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")).replace(/\s+/g, " ").slice(0, 600);
      visits.push({ route, finalUrl: page.url(), title: await page.title().catch(() => ""), text });
    }
    console.log("KOPER_PROBE_VISITS", JSON.stringify({ blocked, visits: visits.map((v) => ({ route: v.route, finalUrl: v.finalUrl, title: v.title, text: v.text.slice(0, 200) })) }));
  }, { sessionTimeoutMs: 600_000 });

  const summary = captured.map((c) => ({ route: c.route, path: c.path, keys: Object.keys(c.query), status: c.status }));
  console.log("KOPER_PROBE_API", JSON.stringify(summary));
  if (!write) return;

  const seenAt = new Date();
  const records = captured.map((c) => createKoperStagingRecord({
    companyId: env.BOSSA_COMPANY_ID,
    entity: "probe.api",
    koperId: createHash("sha256").update(`${c.path}?${JSON.stringify(c.query)}`).digest("hex").slice(0, 32),
    sanitizedPayload: { route: c.route, path: c.path, query: c.query, status: c.status, body: sanitizeKoperPayload(c.body) },
    mappingVersion: 1,
    seenAt,
  }));
  records.push(createKoperStagingRecord({
    companyId: env.BOSSA_COMPANY_ID, entity: "probe.links", koperId: seenAt.toISOString(),
    sanitizedPayload: { links: [...links].sort(), visits }, mappingVersion: 1, seenAt,
  }));
  const unique = new Map(records.map((r) => [`${r.entity}:${r.koper_id}`, r]));
  for (const record of unique.values()) {
    await requestSupabase("koper_staging_records", {
      method: "POST",
      body: [{ ...record, sync_state: "present" }],
      prefer: "resolution=merge-duplicates,return=minimal",
      query: new URLSearchParams({ on_conflict: "company_id,source,entity,koper_id" }),
      timeoutMs: 60_000,
    });
  }
  console.log("KOPER_PROBE_DONE", JSON.stringify({ saved: unique.size }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  probeKoperCommercial(!process.argv.includes("--plan")).catch((error: unknown) => {
    console.error("KOPER_PROBE_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }));
    process.exitCode = 1;
  });
}
