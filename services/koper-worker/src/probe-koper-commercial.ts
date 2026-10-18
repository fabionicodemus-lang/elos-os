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

const DEFAULT_ROUTES_V1 = [
  "/comercial", "/comercial/vendas", "/comercial/contratos", "/comercial/clientes", "/comercial/unidades", "/comercial/distratos",
  "/vendas", "/crm", "/incorporacao", "/incorporacao/vendas", "/imoveis",
  "/engenharia/diario_obra", "/engenharia/diario-obra", "/engenharia/diario", "/obras/diario", "/diario_obra",
  "/financeiro/transferencias", "/financeiro/movimentacao", "/financeiro/extrato", "/financeiro/contas", "/financeiro/fluxo_caixa",
  "/financeiro/contas_receber",
];
// Segunda rodada: telas do app novo (web.koper.com.br) e créditos/débitos.
const DEFAULT_ROUTES = [
  "https://web.koper.com.br/financeiro/contas-bancarias",
  "https://web.koper.com.br/engenharia/diario-de-obras/133",
];
// Depois de abrir a tela, clica num texto visível (navegação somente leitura; escrita bloqueada pelo interceptor).
const CLICK_AFTER: Record<string, string[]> = {
  "https://web.koper.com.br/engenharia/diario-de-obras/133": ["Dia - 16/10/2026", "Dia - 02/10/2026"],
};
// Diário: lista completa dos registros e tentativas do endpoint do registro (somente GET).
const DIARY_GETS: string[] = [];
void DEFAULT_ROUTES_V1;
// GETs diretos (somente leitura). {SALE} é trocado pelos ids de venda lidos da listagem.
const DIRECT_GETS = [
  "/sales/v1/building?buildingId=133",
  "/sales/v1/building_unit?buildingId=133",
  "/sales/v1/unit?buildingId=133",
  "/sales/v1/units?buildingId=133",
  "/sales/v1/building/133",
  "/sales/v1/mirror?buildingId=133",
  "/sales/v1/sales?salesId={SALE}",
  "/sales/v1/sales/{SALE}",
  "/sales/v1/sales_detail?salesId={SALE}",
  "/sales/v1/sales_installments?salesId={SALE}",
  "/sales/v1/sales_cancel?salesId={SALE}",
  "/sales/v1/cancellation?salesId={SALE}",
  "/financial/v1/credit_debit?limit=200&offset=0",
  "/financial/v1/credits?limit=200&offset=0",
  "/financial/v1/transfer?limit=200&offset=0",
  "/financial/v1/account_transfer?limit=200&offset=0",
  "/financial/v1/bank_statement?limit=200&offset=0",
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

/**
 * CLAUDE.md 3.1: POST só para GraphQL de leitura. Aceita quando TODAS as operações do corpo têm
 * operationName começando por query/list/get/find/search/read e o texto não contém mutation/subscription.
 */
// O app novo nomeia as consultas com sufixo "Query" (ex.: CostCentersQuery). Aceito também esse sufixo,
// mas então o texto da operação precisa existir e começar com "query" (é consulta, não gravação).
const READ_OPERATION = /^(query|list|get|find|search|read)/i;
const READ_SUFFIX = /Query$/;
function isReadOnlyGraphql(url: URL, method: string, postData: string | null): boolean {
  if (method !== "POST" || url.hostname !== "graphql.koper.com.br" || !postData) return false;
  try {
    const parsed = JSON.parse(postData) as unknown;
    const ops = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ operationName?: unknown; query?: unknown }>;
    return ops.length > 0 && ops.every((op) => {
      if (typeof op.operationName !== "string") return false;
      const text = typeof op.query === "string" ? op.query : null;
      if (text && /\b(mutation|subscription)\b/i.test(text)) return false;
      if (READ_OPERATION.test(op.operationName)) return true;
      return READ_SUFFIX.test(op.operationName) && text !== null && /^\s*query\b/i.test(text);
    });
  } catch {
    return false;
  }
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
    const blockedPaths: string[] = [];
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (isKoper && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !isAllowedCompanySwitch(url, request.method(), request.postData())
            && !isReadOnlyGraphql(url, request.method(), request.postData())) {
          blocked += 1;
          // Só método + host + caminho (sem query, sem corpo): para saber o que a tela tentou gravar.
          let op = "";
          try { const b = JSON.parse(request.postData() ?? "{}") as { operationName?: string }; op = typeof b.operationName === "string" ? ` ${b.operationName}` : ""; } catch { /* sem corpo JSON */ }
          if (blockedPaths.length < 40) blockedPaths.push(`${request.method()} ${url.hostname}${url.pathname}${op}`);
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
    // O app novo (web.koper.com.br) autentica a API v3 por cabeçalho. Guardado só em memória; nunca é logado.
    let authHeader: string | null = null;
    page.on("request", (request) => {
      try {
        const url = new URL(request.url());
        const value = request.headers()["authorization"];
        if (url.hostname === "api.koper.com.br" && value) authHeader = value;
      } catch { /* ignora */ }
    });
    page.on("response", (response: Response) => {
      void (async () => {
        try {
          const url = new URL(response.url());
          if (url.hostname === "graphql.koper.com.br" && response.request().method() === "POST") {
            // Leitura GraphQL liberada pelo interceptor: guarda operação + variáveis + resposta.
            let op = "unknown"; let variables: Record<string, string> = {};
            try {
              const b = JSON.parse(response.request().postData() ?? "{}") as { operationName?: string; variables?: Record<string, unknown> };
              op = b.operationName ?? "unknown";
              variables = Object.fromEntries(Object.entries(b.variables ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
            } catch { /* ignora */ }
            const text = await response.text().catch(() => "");
            if (!text || text.length > MAX_BODY_CHARS) return;
            let body: unknown = null;
            try { body = JSON.parse(text); } catch { return; }
            captured.push({ method: "POST", path: `graphql:${op}`, query: variables, status: response.status(), route: currentRoute, body });
            return;
          }
          if (!url.hostname.endsWith("koper.com.br") || url.hostname.startsWith("files") || response.request().method() !== "GET") return;
          if (!(response.headers()["content-type"] ?? "").includes("json")) return;
          const text = await response.text().catch(() => "");
          if (!text || text.length > MAX_BODY_CHARS) return;
          let body: unknown = null;
          try { body = JSON.parse(text); } catch { return; }
          captured.push({ method: "GET", path: url.hostname === "api.koper.com.br" ? url.pathname : `${url.hostname}${url.pathname}`, query: stripSecrets(url), status: response.status(), route: currentRoute, body });
        } catch { /* ignora */ }
      })();
    });

    for (const link of await collectLinks(page).catch(() => [])) links.add(link);
    for (const route of targets) {
      currentRoute = route;
      await page.goto(route.startsWith("http") ? route : `https://app.koper.com.br${route}`, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(9_000);
      await page.mouse.wheel(0, 4000).catch(() => undefined);
      await page.waitForTimeout(2_000);
      for (const label of CLICK_AFTER[route] ?? []) {
        // Estrutura da linha (tags, classes, atributos — sem texto além do rótulo) para acertar o clique.
        const structure = await page.evaluate((needle) => {
          const el = Array.from(document.querySelectorAll("body *")).find((node) => node.childElementCount === 0 && (node.textContent ?? "").includes(needle));
          const chain: string[] = [];
          for (let node: Element | null = el ?? null, i = 0; node && i < 8; node = node.parentElement, i += 1) {
            const attrs = Array.from(node.attributes).map((a) => `${a.name}=${a.value.slice(0, 60)}`).join(" ");
            chain.push(`<${node.tagName.toLowerCase()} ${attrs}>`);
          }
          return chain;
        }, label).catch(() => []);
        console.log("KOPER_PROBE_CLICK_TARGET", JSON.stringify({ label, structure }));
        await page.getByText(label, { exact: false }).first().click({ timeout: 8_000 }).catch(() => undefined);
        await page.waitForTimeout(9_000);
        await page.mouse.wheel(0, 4000).catch(() => undefined);
        await page.waitForTimeout(3_000);
      }
      for (const link of await collectLinks(page).catch(() => [])) links.add(link);
      const text = (await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")).replace(/\s+/g, " ").slice(0, 4000);
      visits.push({ route, finalUrl: page.url(), title: await page.title().catch(() => ""), text });
    }
    // Segunda passada: links do menu com cara de vendas/diário/transferência que não estavam na lista.
    const extra = [...links].map((href) => { try { return new URL(href).pathname; } catch { return ""; } })
      .filter((path) => path && KEYWORDS.test(path) && !targets.includes(path) && process.env.KOPER_PROBE_EXTRA === "1").slice(0, 25);
    for (const route of extra) {
      currentRoute = route;
      await page.goto(`https://app.koper.com.br${route}`, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(6_000);
      const text = (await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")).replace(/\s+/g, " ").slice(0, 600);
      visits.push({ route, finalUrl: page.url(), title: await page.title().catch(() => ""), text });
    }
    // Leitura direta da API, sempre GET.
    const direct = async (pathWithQuery: string): Promise<void> => {
      const url = new URL(`https://api.koper.com.br${pathWithQuery}`);
      url.searchParams.set("accessToken", session.token);
      try {
        const headers: Record<string, string> = { ...session.headers };
        if (authHeader && url.pathname.includes("/v3/")) headers.authorization = authHeader;
        const response = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(60_000) });
        let body: unknown = null;
        const text = await response.text();
        try { body = JSON.parse(text); } catch { body = null; }
        captured.push({ method: "GET", path: url.pathname, query: stripSecrets(url), status: response.status, route: "direct", body: text.length > MAX_BODY_CHARS ? null : body });
      } catch { /* ignora */ }
    };
    const saleIds = new Set<string>();
    const cancelled: string[] = [];
    for (let offset = 0; offset < 400 && process.env.KOPER_PROBE_SALES === "1"; offset += 100) {
      await direct(`/sales/v1/sales?limit=100&offset=${offset}&orderby=salesDate&orderFlag=desc`);
      const last = captured[captured.length - 1]?.body as { sales?: Array<{ salesId: number; salesCanceled?: boolean }> } | null;
      for (const sale of last?.sales ?? []) { saleIds.add(String(sale.salesId)); if (sale.salesCanceled) cancelled.push(String(sale.salesId)); }
      if (!last?.sales || last.sales.length < 100) break;
    }
    void DIRECT_GETS;
    for (const id of saleIds) await direct(`/sales/v1/sales?salesId=${id}`);
    // Extrato completo de cada conta do Flow (somente leitura, páginas de 100).
    const accountIds = new Set<string>();
    for (const c of captured) {
      if (c.path !== "/financial/v3/bank_account") continue;
      const items = (c.body as { items?: Array<{ accounts?: Array<{ fncAccountId: number }> }> } | null)?.items ?? [];
      for (const group of items) for (const account of group.accounts ?? []) accountIds.add(String(account.fncAccountId));
    }
    let movementPages = 0;
    for (const path of DIARY_GETS) await direct(path);
    if (process.env.KOPER_PROBE_MOVEMENTS !== "1") accountIds.clear();
    for (const id of accountIds) {
      await direct(`/financial/v3/bank_account_details/${id}`);
      for (let pageNo = 1; pageNo <= 200; pageNo += 1) {
        await direct(`/financial/v3/bank-account-details/${id}/movements?page=${pageNo}&size=100&orderBy=move_date&orderFlag=asc`);
        movementPages += 1;
        const last = captured[captured.length - 1]?.body as { pages?: number } | null;
        if (!last || typeof last.pages !== "number" || pageNo >= last.pages) break;
      }
    }
    console.log("KOPER_PROBE_MOVEMENTS", JSON.stringify({ accounts: accountIds.size, pages: movementPages, auth: Boolean(authHeader) }));
    console.log("KOPER_PROBE_VISITS", JSON.stringify({ blocked, blockedPaths, visits: visits.map((v) => ({ route: v.route, finalUrl: v.finalUrl, title: v.title, text: v.text.slice(0, 200) })) }));
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
