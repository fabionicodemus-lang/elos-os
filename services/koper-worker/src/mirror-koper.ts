/**
 * Espelho completo Koper → Elos OS (camada de staging), multiempresa.
 *
 * O que faz
 * ---------
 * Para cada empresa do Koper (Bossa Empreendimentos, Flow Aptos - Bossa e
 * Alma Seahouses - Bossa) lê, somente por GET, todas as listagens e detalhes
 * do catálogo `ENTITIES` e grava o JSON sanitizado em
 * `public.koper_staging_records`:
 *
 *   entity   = "mirror.<entidade>"            (ex.: mirror.bill_to_pay_detail)
 *   koper_id = "<empresa>:<id no Koper>"      (ex.: bossa:11983)
 *
 * O prefixo `mirror.` e o prefixo da empresa no `koper_id` mantêm este espelho
 * separado das entidades históricas do Flow (`bill_to_pay`, `stock_request`…),
 * que continuam sendo usadas pelos scripts de promoção já homologados.
 *
 * Regras da constituição (services/koper-worker/CLAUDE.md) respeitadas aqui
 * -----------------------------------------------------------------------
 * - Koper somente leitura: toda chamada de dados é GET. O único POST permitido
 *   é `POST /login/change_company`, com as três chaves esperadas e destino em
 *   uma das três empresas da allowlist (Seção 3.1). Essa troca devolve um
 *   accessToken novo, já no contexto da empresa escolhida; por isso o token e
 *   os cabeçalhos são recapturados depois de cada troca.
 * - Nenhum dado vai direto para tabela operacional: este script só escreve na
 *   staging (Seção 8). A promoção continua sendo um passo separado.
 * - Upsert idempotente por (company_id, source, entity, koper_id) com hash do
 *   payload normalizado (Seção 8.3). Nada é apagado; o que some da origem é
 *   marcado `missing_at_source` (Seção 8.4).
 * - CPF, telefone e e-mail são mascarados antes de gravar (Seções 3.3 e 10).
 *   Token, cabeçalhos e variáveis de ambiente nunca são impressos.
 *
 * Uso
 * ---
 *   node dist/mirror-koper.js                      # plano (não grava)
 *   node dist/mirror-koper.js --write              # incremental (rotina diária)
 *   node dist/mirror-koper.js --write --full       # relê todos os detalhes
 *
 * Variáveis opcionais:
 *   KOPER_MIRROR_COMPANIES=bossa,flow,alma   (padrão: as três)
 *   KOPER_MIRROR_ENTITIES=bill_to_pay,...    (padrão: catálogo inteiro)
 *   KOPER_MIRROR_CONCURRENCY=8               (1 a 16)
 *   KOPER_MIRROR_DETAIL_LIMIT=0              (0 = sem limite por entidade)
 */
import { pathToFileURL } from "node:url";
import type { Page, Response } from "playwright-core";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { createKoperStagingRecord, type KoperStagingRecord } from "./sync/staging-record.js";

type Json = Record<string, unknown>;

const MAPPING_VERSION = 1;
const API = "https://api.koper.com.br";

// ---------------------------------------------------------------------------
// Empresas autorizadas (CLAUDE.md, Seção 18)
// ---------------------------------------------------------------------------

type CompanyKey = "bossa" | "flow" | "alma";

const COMPANIES: Record<CompanyKey, { enterpriseId: string; label: string }> = {
  bossa: { enterpriseId: "1645acb2-de18-11ed-bf03-8af8dfac4eab", label: "Bossa Empreendimentos" },
  flow: { enterpriseId: "6d3b4724-5880-11ee-827d-1219c832db49", label: "Flow Aptos - Bossa" },
  alma: { enterpriseId: "ec9ed276-742a-11ef-8533-1219c832db49", label: "Alma Seahouses - Bossa" },
};

const ALLOWED_ENTERPRISE_IDS = new Set(Object.values(COMPANIES).map((company) => company.enterpriseId));

// ---------------------------------------------------------------------------
// Catálogo de entidades
// ---------------------------------------------------------------------------

type ListSpec = {
  path: string;
  params?: Record<string, string>;
  /** Uma leitura por variante (ex.: open=yes / open=no). */
  variants?: Array<Record<string, string>>;
  /** Chave do array na resposta; null quando a própria resposta é o array. */
  arrayKey: string | null;
  /** Chave com o total informado pelo Koper, quando existir. */
  totalKey?: string;
  /** 0 = sem paginação (uma única chamada). */
  pageSize: number;
  idKey: string;
  /** 404 do Koper significa "nenhum registro" nesta listagem. */
  emptyOn404?: boolean;
};

type DetailSpec = {
  /** Caminho fixo (id vai em `idParam`) ou função que monta o caminho com o id. */
  path: string | ((id: string) => string);
  idParam?: string;
  params?: Record<string, string>;
};

type DerivedSource = { entity: string; level: "list" | "detail"; path: string[] };

export type EntitySpec =
  | { name: string; list: ListSpec; detail?: DetailSpec; derivedFrom?: undefined }
  | { name: string; list?: undefined; detail: DetailSpec; derivedFrom: DerivedSource[] };

export const ENTITIES: EntitySpec[] = [
  // --- Cadastros-base -----------------------------------------------------
  {
    name: "stock_place",
    list: { path: "/stock/v1/stock_place", params: { page: "all" }, arrayKey: null, pageSize: 0, idKey: "stockPlaceId" },
  },
  {
    name: "account",
    list: { path: "/financial/v1/account", params: { page: "all" }, arrayKey: null, pageSize: 0, idKey: "accountId" },
  },
  {
    name: "supplier",
    list: {
      path: "/purchase/v1/supplier",
      params: { orderFlag: "asc", orderby: "supplierName", supplierId: "all", supplierType: "Fornecedor" },
      arrayKey: "suppliers",
      totalKey: "suppliersAmount",
      pageSize: 200,
      idKey: "supplierId",
      emptyOn404: true,
    },
  },
  // --- Financeiro a pagar -------------------------------------------------
  {
    name: "bill_to_pay",
    list: {
      path: "/financial/v1/bills_to_pay",
      params: { allBills: "yes", initialDate: "", finalDate: "", orderFlag: "asc", orderby: "dueDate", typeDate: "dueDate" },
      arrayKey: "bills",
      totalKey: "billsAmount",
      pageSize: 500,
      idKey: "billId",
      emptyOn404: true,
    },
    detail: { path: "/financial/v1/bills_to_pay", idParam: "billId" },
  },
  // --- Suprimentos --------------------------------------------------------
  {
    name: "stock_request",
    list: {
      path: "/stock/v1/request",
      params: { group: "request", orderFlag: "desc", orderby: "requestDate", typeDate: "requestDate" },
      variants: [{ open: "yes" }, { open: "no" }],
      arrayKey: "requests",
      totalKey: "itemsAmount",
      pageSize: 100,
      idKey: "requestId",
      emptyOn404: true,
    },
    detail: { path: "/stock/v1/product_request", idParam: "requestId", params: { group: "request" } },
  },
  {
    name: "purchase_budget",
    list: {
      path: "/purchase/v1/budget",
      params: { budgetId: "all", orderFlag: "desc", orderby: "budgetId" },
      arrayKey: "budgets",
      totalKey: "budgetAmount",
      pageSize: 100,
      idKey: "budgetId",
      emptyOn404: true,
    },
    detail: { path: "/purchase/v1/budget", idParam: "budgetId", params: { group: "request" } },
  },
  {
    name: "purchase_order",
    list: {
      path: "/purchase/v1/purchase_order",
      params: { orderId: "all", orderFlag: "desc", orderby: "orderDate", typeDate: "orderDate" },
      arrayKey: "orders",
      totalKey: "ordersAmount",
      pageSize: 100,
      idKey: "orderId",
      emptyOn404: true,
    },
    detail: { path: "/purchase/v1/purchase_order", idParam: "orderId" },
  },
  {
    name: "service_order",
    list: {
      path: "/purchase/v1/service_order",
      params: { orderId: "all", orderFlag: "desc", orderby: "orderDate" },
      arrayKey: "orders",
      totalKey: "itemsAmount",
      pageSize: 100,
      idKey: "orderId",
      emptyOn404: true,
    },
    detail: { path: "/purchase/v1/service_order", idParam: "orderId" },
  },
  {
    name: "purchase",
    list: {
      path: "/purchase/v1/purchase",
      params: { initialDate: "", finalDate: "", orderFlag: "desc", orderby: "purchaseDate" },
      arrayKey: "purchases",
      totalKey: "itemsAmount",
      pageSize: 200,
      idKey: "purchaseId",
      emptyOn404: true,
    },
    detail: { path: "/purchase/v1/purchase", idParam: "purchaseId" },
  },
  // --- Derivadas: o id vem de outra entidade (elo da apropriação) ----------
  {
    // Recibo / nota manual: centro de custo, plano de contas, serviços e produtos.
    name: "receipt",
    derivedFrom: [
      { entity: "purchase", level: "list", path: ["receiptId"] },
      { entity: "bill_to_pay", level: "detail", path: ["origins", "receipt_id"] },
    ],
    detail: { path: "/financial/v1/receipt", idParam: "receiptId" },
  },
  {
    // Nota fiscal eletrônica: produtos, duplicatas e pedidos de compra ligados.
    name: "xml_invoice",
    derivedFrom: [
      { entity: "purchase", level: "list", path: ["xmlInvoiceId"] },
      { entity: "bill_to_pay", level: "detail", path: ["origins", "invoice_id"] },
    ],
    detail: { path: "/financial/v1/xml_invoice", idParam: "invoiceId" },
  },
];

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

const asObject = (value: unknown): Json | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;

const asId = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

const digits = (value: string) => value.replace(/\D/g, "");

/** Mascara dados pessoais pelo nome do campo (Seção 3.3). CNPJ é preservado. */
function maskPersonalValue(key: string, value: unknown): unknown {
  if (typeof value !== "string" || value.trim() === "") return value;
  const lower = key.toLowerCase();
  if (lower.includes("cpf")) {
    const d = digits(value);
    // Campos mistos (ex.: customerCnpjCpf): 14 dígitos é CNPJ e fica como está.
    if (lower.includes("cnpj") && d.length !== 11) return value;
    return d.length >= 2 ? `***.***.***-${d.slice(-2)}` : "***";
  }
  if (lower.includes("cnpj")) return value;
  if (lower.includes("phone") || lower.includes("cellphone") || lower.includes("telefone") || lower.includes("celular")) {
    const d = digits(value);
    return d.length >= 4 ? `(XX) XXXXX-${d.slice(-4)}` : "(XX) XXXXX-XXXX";
  }
  if (lower.includes("email") || lower.includes("e_mail")) {
    const at = value.indexOf("@");
    return at > 0 ? `${value.slice(0, 1)}***${value.slice(at)}` : "***";
  }
  return value;
}

const SECRET_KEY_PATTERN = /token|password|senha|secret|authorization|cookie|apikey|api_key/i;

export function sanitizeKoperPayload(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeKoperPayload(item, key));
  const object = asObject(value);
  if (object) {
    const out: Json = {};
    for (const [childKey, childValue] of Object.entries(object)) {
      if (SECRET_KEY_PATTERN.test(childKey)) continue;
      out[childKey] = sanitizeKoperPayload(childValue, childKey);
    }
    return out;
  }
  return maskPersonalValue(key, value);
}

// ---------------------------------------------------------------------------
// Sessão do Koper: login pelo navegador remoto, dados por HTTP direto
// ---------------------------------------------------------------------------

export type KoperSession = { company: CompanyKey; token: string; headers: Record<string, string> };

/** Única escrita REST permitida no Koper: troca de empresa (Seção 3.1). */
export function isAllowedCompanySwitch(url: URL, method: string, postData: string | null): boolean {
  if (method !== "POST" || url.hostname !== "api.koper.com.br" || url.pathname !== "/login/change_company" || !postData) {
    return false;
  }
  try {
    const body = asObject(JSON.parse(postData));
    if (!body) return false;
    const keys = Object.keys(body);
    const allowedKeys = new Set(["accessToken", "toEnterpriseId", "changeCompany"]);
    return (
      keys.length === 3
      && keys.every((key) => allowedKeys.has(key))
      && typeof body.accessToken === "string"
      && body.accessToken.length > 0
      && typeof body.toEnterpriseId === "string"
      && ALLOWED_ENTERPRISE_IDS.has(body.toEnterpriseId)
    );
  } catch {
    return false;
  }
}

async function readActiveEnterpriseId(page: Page, session: { token: string; headers: Record<string, string> }): Promise<string | null> {
  const url = new URL(`${API}/administrative/v1/enterprise`);
  url.searchParams.set("accessToken", session.token);
  url.searchParams.set("page", "mirror");
  url.searchParams.set("cb", String(Date.now()));
  const response = await page.request.get(url.toString(), { headers: session.headers, timeout: 15_000 });
  if (!response.ok()) return null;
  return asId(asObject(await response.json().catch(() => null))?.enterpriseId);
}

/** Abre a tela de contas a pagar e copia token e cabeçalhos da primeira leitura da API. */
async function captureApiSession(page: Page): Promise<{ token: string; headers: Record<string, string> }> {
  const seedPromise = page.waitForResponse((response: Response) => {
    try {
      const url = new URL(response.url());
      return response.request().method() === "GET"
        && url.hostname === "api.koper.com.br"
        && url.pathname === "/financial/v1/bills_to_pay"
        && url.searchParams.has("accessToken");
    } catch {
      return false;
    }
  }, { timeout: 25_000 }).catch(() => null);
  await page.goto("https://app.koper.com.br/financeiro/contas_pagar", { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
  const seed = await seedPromise;
  if (!seed) throw new Error("KOPER_MIRROR_SEED_NOT_FOUND");
  const original = seed.request().headers();
  const headers: Record<string, string> = {};
  for (const key of ["accept", "origin", "referer", "x-accesstoken", "x-koper"]) {
    const value = original[key];
    if (value) headers[key] = value;
  }
  const token = new URL(seed.url()).searchParams.get("accessToken") ?? "";
  if (!token || !headers["x-koper"]) throw new Error("KOPER_MIRROR_SEED_INCOMPLETE");
  return { token, headers };
}

async function switchCompanyByInterface(page: Page, target: CompanyKey, activeLabel: string | null): Promise<void> {
  await page.goto("https://web.koper.com.br/", { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(2_500);
  const labels = activeLabel ? [activeLabel] : Object.values(COMPANIES).map((company) => company.label);
  const other = page.getByText(/^Acessar outra empresa$/i, { exact: true }).last();
  // O primeiro clique logo após o carregamento às vezes não abre o menu: repete até abrir.
  for (let attempt = 0; attempt < 4 && !(await other.isVisible().catch(() => false)); attempt += 1) {
    for (const label of labels) {
      const control = page.getByText(label, { exact: true }).last()
        .locator("xpath=ancestor-or-self::*[self::button or self::a or @role='button'][1]");
      if (await control.isVisible().catch(() => false)) {
        await control.click().catch(() => undefined);
        break;
      }
    }
    await page.waitForTimeout(1_500);
  }
  if (!(await other.isVisible().catch(() => false))) throw new Error("KOPER_MIRROR_COMPANY_SELECTOR_NOT_FOUND");
  await other.click();
  await page.waitForTimeout(1_500);
  const exact = new RegExp(`^${COMPANIES[target].label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  const card = page.locator('[data-testid="multiCompaniesModal"]').filter({ has: page.getByText(exact, { exact: true }) }).first();
  if (!(await card.isVisible().catch(() => false))) throw new Error(`KOPER_MIRROR_COMPANY_CARD_NOT_FOUND_${target}`);
  const action = card.getByText(/^Acessar esta empresa$/i, { exact: true }).last();
  if (!(await action.isVisible().catch(() => false))) throw new Error(`KOPER_MIRROR_COMPANY_ACTION_NOT_FOUND_${target}`);
  await action.click();
  await page.waitForTimeout(4_000);
}

/** Faz login, garante a empresa pedida e devolve as credenciais de leitura da API. */
async function openKoperSession(company: CompanyKey): Promise<KoperSession & { blockedWrites: number }> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    if (!login.authenticated) throw new Error(`KOPER_AUTH_FAILED: ${login.message ?? "unknown"}`);

    let blockedWrites = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
        if (isKoper && !["GET", "HEAD", "OPTIONS"].includes(request.method()) && !isAllowedCompanySwitch(url, request.method(), request.postData())) {
          blockedWrites += 1;
          await route.abort("blockedbyclient");
          return;
        }
      } catch {
        // URL malformada: segue o fluxo normal.
      }
      await route.continue();
    });

    const target = COMPANIES[company].enterpriseId;
    let session = await captureApiSession(page);
    let active = await readActiveEnterpriseId(page, session);
    for (let attempt = 0; attempt < 2 && active !== target; attempt += 1) {
      const activeLabel = Object.values(COMPANIES).find((item) => item.enterpriseId === active)?.label ?? null;
      await switchCompanyByInterface(page, company, activeLabel);
      session = await captureApiSession(page);
      active = await readActiveEnterpriseId(page, session);
    }
    if (active !== target) throw new Error(`KOPER_MIRROR_COMPANY_NOT_SELECTED_${company}`);
    return { company, ...session, blockedWrites };
  }, { sessionTimeoutMs: 170_000 });
}

class KoperHttpError extends Error {
  constructor(readonly status: number, path: string) {
    super(`KOPER_HTTP_${status}_${path}`);
  }
}

/** GET direto na API do Koper. Nunca envia outro método. */
async function koperGet(session: KoperSession, path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${API}${path}`);
  url.searchParams.set("accessToken", session.token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    url.searchParams.set("cb", `${Date.now()}-${attempt}`);
    try {
      const response = await fetch(url, { method: "GET", headers: session.headers, signal: AbortSignal.timeout(60_000) });
      if (response.status === 404) throw new KoperHttpError(404, path);
      if (response.status === 401 || response.status === 403) throw new KoperHttpError(response.status, path);
      if (!response.ok) {
        lastError = new KoperHttpError(response.status, path);
      } else {
        return await response.json();
      }
    } catch (error) {
      if (error instanceof KoperHttpError && [401, 403, 404].includes(error.status)) throw error;
      lastError = error;
    }
    await sleep(1_000 * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(`KOPER_GET_FAILED_${path}`);
}

// ---------------------------------------------------------------------------
// Leitura das entidades
// ---------------------------------------------------------------------------

type ListResult = { rows: Map<string, Json>; reportedTotal: number | null; complete: boolean };

async function readList(session: KoperSession, spec: ListSpec): Promise<ListResult> {
  const rows = new Map<string, Json>();
  let reportedTotal: number | null = null;
  let complete = true;
  for (const variant of spec.variants ?? [{}]) {
    let variantTotal: number | null = null;
    let variantRead = 0;
    for (let offset = 0; offset < 200_000; offset += Math.max(spec.pageSize, 1)) {
      const params: Record<string, string> = { ...(spec.params ?? {}), ...variant };
      if (spec.pageSize > 0) {
        params.limit = String(spec.pageSize);
        params.offset = String(offset);
      }
      let body: unknown;
      try {
        body = await koperGet(session, spec.path, params);
      } catch (error) {
        if (error instanceof KoperHttpError && error.status === 404 && (spec.emptyOn404 || offset > 0)) break;
        throw error;
      }
      const object = asObject(body);
      const list = spec.arrayKey === null ? body : object?.[spec.arrayKey];
      const items = Array.isArray(list) ? list.map(asObject).filter((item): item is Json => item !== null) : [];
      if (offset === 0 && spec.totalKey) {
        const total = Number(object?.[spec.totalKey]);
        if (Number.isFinite(total)) variantTotal = total;
      }
      for (const item of items) {
        const id = asId(item[spec.idKey]);
        if (id) rows.set(id, item);
      }
      variantRead += items.length;
      if (spec.pageSize === 0 || items.length < spec.pageSize) break;
      if (variantTotal !== null && variantRead >= variantTotal) break;
    }
    if (variantTotal !== null) {
      reportedTotal = (reportedTotal ?? 0) + variantTotal;
      if (variantRead < variantTotal) complete = false;
    }
  }
  return { rows, reportedTotal, complete };
}

async function readDetails(
  session: KoperSession,
  spec: DetailSpec,
  ids: string[],
  concurrency: number,
): Promise<{ details: Map<string, Json>; failures: number; notFound: number }> {
  const details = new Map<string, Json>();
  let failures = 0;
  let notFound = 0;
  let cursor = 0;
  let authError: KoperHttpError | null = null;
  const worker = async () => {
    while (!authError) {
      const index = cursor;
      cursor += 1;
      const id = ids[index];
      if (id === undefined) return;
      const path = typeof spec.path === "function" ? spec.path(id) : spec.path;
      const params: Record<string, string> = { ...(spec.params ?? {}) };
      if (spec.idParam) params[spec.idParam] = id;
      try {
        const body = await koperGet(session, path, params);
        const object = asObject(body);
        if (object) details.set(id, object);
        else if (Array.isArray(body)) details.set(id, { items: body });
        else failures += 1;
      } catch (error) {
        if (error instanceof KoperHttpError && (error.status === 401 || error.status === 403)) authError = error;
        else if (error instanceof KoperHttpError && error.status === 404) notFound += 1;
        else failures += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(ids.length, 1)) }, worker));
  if (authError) throw authError;
  return { details, failures, notFound };
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

type StagingIndexRow = { koper_id: string; payload_hash: string; sync_state: string };
type Requester = typeof requestSupabase;

async function loadStagingIndex(entity: string, company: CompanyKey, request: Requester): Promise<Map<string, StagingIndexRow>> {
  const index = new Map<string, StagingIndexRow>();
  for (let offset = 0; ; offset += 1000) {
    const rows = await request<StagingIndexRow[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "koper_id,payload_hash,sync_state",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: `eq.${entity}`,
        koper_id: `like.${company}:*`,
        order: "koper_id.asc",
        limit: "1000",
        offset: String(offset),
      }),
      timeoutMs: 60_000,
    });
    for (const row of rows) index.set(row.koper_id, row);
    if (rows.length < 1000) return index;
  }
}

type SaveSummary = { inserted: number; updated: number; unchanged: number; missingAtSource: number };

function buildRecords(entity: string, company: CompanyKey, rows: Map<string, Json>, seenAt: Date, parentOf?: (id: string) => string | null): KoperStagingRecord[] {
  const enterpriseId = COMPANIES[company].enterpriseId;
  return [...rows].map(([id, payload]) => createKoperStagingRecord({
    companyId: env.BOSSA_COMPANY_ID,
    entity,
    koperId: `${company}:${id}`,
    koperParentId: parentOf ? parentOf(id) : null,
    sanitizedPayload: { _enterprise: company, _enterpriseId: enterpriseId, data: sanitizeKoperPayload(payload) },
    mappingVersion: MAPPING_VERSION,
    seenAt,
  }));
}

function classify(records: KoperStagingRecord[], index: Map<string, StagingIndexRow>) {
  const inserted: KoperStagingRecord[] = [];
  const updated: KoperStagingRecord[] = [];
  let unchanged = 0;
  for (const record of records) {
    const current = index.get(record.koper_id);
    if (!current) inserted.push(record);
    else if (current.payload_hash !== record.payload_hash) updated.push(record);
    else unchanged += 1;
  }
  return { inserted, updated, unchanged };
}

async function saveStaging(
  entity: string,
  company: CompanyKey,
  records: KoperStagingRecord[],
  index: Map<string, StagingIndexRow>,
  options: { write: boolean; markMissing: boolean; seenAt: Date },
  request: Requester,
): Promise<SaveSummary> {
  const { inserted, updated, unchanged } = classify(records, index);
  const seen = new Set(records.map((record) => record.koper_id));
  const missing = options.markMissing
    ? [...index.values()].filter((row) => !seen.has(row.koper_id) && row.sync_state !== "missing_at_source").map((row) => row.koper_id)
    : [];
  const summary: SaveSummary = { inserted: inserted.length, updated: updated.length, unchanged, missingAtSource: missing.length };
  if (!options.write) return summary;

  const conflict = new URLSearchParams({ on_conflict: "company_id,source,entity,koper_id" });
  for (const batch of chunk(inserted, 200)) {
    await request("koper_staging_records", {
      method: "POST",
      body: batch.map((record) => ({ ...record, sync_state: "present" })),
      prefer: "resolution=ignore-duplicates,return=minimal",
      query: conflict,
      timeoutMs: 60_000,
    });
  }
  const seenAt = options.seenAt.toISOString();
  for (const batch of chunk(updated, 200)) {
    await request("koper_staging_records", {
      method: "POST",
      // first_seen_at e elos_id ficam de fora para não serem sobrescritos na atualização.
      body: batch.map((record) => ({
        company_id: record.company_id,
        source: record.source,
        entity: record.entity,
        koper_id: record.koper_id,
        koper_parent_id: record.koper_parent_id,
        payload: record.payload,
        payload_hash: record.payload_hash,
        last_seen_at: seenAt,
        processing_status: "pending",
        processing_error: null,
        mapping_version: record.mapping_version,
        sync_state: "present",
        updated_at: seenAt,
      })),
      prefer: "resolution=merge-duplicates,return=minimal",
      query: conflict,
      timeoutMs: 60_000,
    });
  }
  const scope = {
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: `eq.${entity}`,
  };
  for (const batch of chunk([...seen].filter((id) => index.has(id)), 150)) {
    await request("koper_staging_records", {
      method: "PATCH",
      body: { last_seen_at: seenAt, sync_state: "present" },
      prefer: "return=minimal",
      query: new URLSearchParams({ ...scope, koper_id: `in.(${batch.map((id) => `"${id}"`).join(",")})` }),
      timeoutMs: 60_000,
    });
  }
  for (const batch of chunk(missing, 150)) {
    await request("koper_staging_records", {
      method: "PATCH",
      body: { sync_state: "missing_at_source", updated_at: seenAt },
      prefer: "return=minimal",
      query: new URLSearchParams({ ...scope, koper_id: `in.(${batch.map((id) => `"${id}"`).join(",")})` }),
      timeoutMs: 60_000,
    });
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------------

type EntityReport = {
  company: CompanyKey;
  entity: string;
  listed: number;
  reportedTotal: number | null;
  listComplete: boolean;
  list: SaveSummary | null;
  detailsRequested: number;
  detailsRead: number;
  detailFailures: number;
  detailNotFound: number;
  detail: SaveSummary | null;
  seconds: number;
};

export type RunOptions = { write: boolean; full: boolean; concurrency: number; detailLimit: number };

/** O que foi lido nesta execução, por entidade — fonte dos ids das entidades derivadas. */
export type RunMemory = Map<string, { list: Map<string, Json>; details: Map<string, Json> }>;

function parseSelection<T extends string>(raw: string | undefined, all: readonly T[], label: string): T[] {
  if (!raw || raw.trim() === "") return [...all];
  const wanted = raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const unknown = wanted.filter((item) => !(all as readonly string[]).includes(item));
  if (unknown.length) throw new Error(`KOPER_MIRROR_UNKNOWN_${label}_${unknown.join("_")}`);
  return all.filter((item) => wanted.includes(item));
}

function valueAtPath(payload: Json, path: string[]): unknown {
  let current: unknown = payload;
  for (const key of path) {
    const object = asObject(current);
    if (!object) return null;
    current = object[key];
  }
  return current;
}

function derivedIds(sources: DerivedSource[], memory: RunMemory): string[] {
  const ids = new Set<string>();
  for (const source of sources) {
    const rows = source.level === "list" ? memory.get(source.entity)?.list : memory.get(source.entity)?.details;
    for (const payload of rows?.values() ?? []) {
      const id = asId(valueAtPath(payload, source.path));
      if (id && id !== "0") ids.add(id);
    }
  }
  return [...ids];
}

export async function mirrorEntity(
  session: KoperSession,
  spec: EntitySpec,
  options: RunOptions,
  memory: RunMemory,
  request: Requester = requestSupabase,
): Promise<EntityReport> {
  const started = Date.now();
  const seenAt = new Date();
  const company = session.company;
  const stored = { list: new Map<string, Json>(), details: new Map<string, Json>() };
  memory.set(spec.name, stored);

  const report: EntityReport = {
    company,
    entity: spec.name,
    listed: 0,
    reportedTotal: null,
    listComplete: true,
    list: null,
    detailsRequested: 0,
    detailsRead: 0,
    detailFailures: 0,
    detailNotFound: 0,
    detail: null,
    seconds: 0,
  };

  // Entidades com listagem gravam a linha da lista em mirror.<nome> e o detalhe em
  // mirror.<nome>_detail. Entidades derivadas só têm detalhe, gravado em mirror.<nome>.
  let candidateIds: string[];
  let changedIds = new Set<string>();
  const detailEntity = spec.derivedFrom ? `mirror.${spec.name}` : `mirror.${spec.name}_detail`;

  if (spec.list) {
    const listEntity = `mirror.${spec.name}`;
    const list = await readList(session, spec.list);
    stored.list = list.rows;
    const listIndex = await loadStagingIndex(listEntity, company, request);
    const listRecords = buildRecords(listEntity, company, list.rows, seenAt);
    const classified = classify(listRecords, listIndex);
    changedIds = new Set([...classified.inserted, ...classified.updated].map((record) => record.koper_id.slice(company.length + 1)));
    // Só marca "sumiu da origem" quando a listagem veio inteira.
    report.list = await saveStaging(listEntity, company, listRecords, listIndex, {
      write: options.write,
      markMissing: list.complete && list.rows.size > 0,
      seenAt,
    }, request);
    report.listed = list.rows.size;
    report.reportedTotal = list.reportedTotal;
    report.listComplete = list.complete;
    candidateIds = [...list.rows.keys()];
  } else {
    candidateIds = derivedIds(spec.derivedFrom, memory);
    report.listed = candidateIds.length;
  }

  if (spec.detail) {
    const detailIndex = await loadStagingIndex(detailEntity, company, request);
    let ids = candidateIds.filter((id) => options.full || changedIds.has(id) || !detailIndex.has(`${company}:${id}`));
    if (options.detailLimit > 0) ids = ids.slice(0, options.detailLimit);
    report.detailsRequested = ids.length;
    const result = await readDetails(session, spec.detail, ids, options.concurrency);
    stored.details = result.details;
    report.detailsRead = result.details.size;
    report.detailFailures = result.failures;
    report.detailNotFound = result.notFound;
    const detailRecords = buildRecords(detailEntity, company, result.details, seenAt, spec.derivedFrom ? undefined : (id) => `${company}:${id}`);
    report.detail = await saveStaging(detailEntity, company, detailRecords, detailIndex, {
      write: options.write,
      markMissing: false,
      seenAt,
    }, request);
  }

  report.seconds = Math.round((Date.now() - started) / 1000);
  return report;
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const full = process.argv.includes("--full");
  const companies = parseSelection(process.env.KOPER_MIRROR_COMPANIES, Object.keys(COMPANIES) as CompanyKey[], "COMPANY");
  const entityNames = parseSelection(process.env.KOPER_MIRROR_ENTITIES, ENTITIES.map((spec) => spec.name), "ENTITY");
  const concurrency = Math.max(1, Math.min(16, Number(process.env.KOPER_MIRROR_CONCURRENCY ?? "8") || 8));
  const detailLimit = Math.max(0, Number(process.env.KOPER_MIRROR_DETAIL_LIMIT ?? "0") || 0);
  const specs = ENTITIES.filter((spec) => entityNames.includes(spec.name));
  const options: RunOptions = { write, full, concurrency, detailLimit };

  console.log("KOPER_MIRROR_START", JSON.stringify({ write, full, companies, entities: specs.map((spec) => spec.name), concurrency, detailLimit }));
  const reports: EntityReport[] = [];
  const errors: Array<{ company: CompanyKey; entity: string; message: string }> = [];

  for (const company of companies) {
    let session: KoperSession;
    try {
      const opened = await openKoperSession(company);
      session = { company, token: opened.token, headers: opened.headers };
      console.log("KOPER_MIRROR_COMPANY", JSON.stringify({ company, blockedKoperWrites: opened.blockedWrites }));
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
      errors.push({ company, entity: "(sessão)", message });
      console.error("KOPER_MIRROR_COMPANY_FAILED", JSON.stringify({ company, message }));
      continue;
    }
    const memory: RunMemory = new Map();
    for (const spec of specs) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const report = await mirrorEntity(session, spec, options, memory);
          reports.push(report);
          console.log("KOPER_MIRROR_ENTITY", JSON.stringify(report));
          break;
        } catch (error) {
          const expired = error instanceof KoperHttpError && (error.status === 401 || error.status === 403);
          if (expired && attempt === 0) {
            // Sessão expirou no meio da carga: autentica de novo e repete a entidade.
            const reopened = await openKoperSession(company).catch(() => null);
            if (reopened) {
              session = { company, token: reopened.token, headers: reopened.headers };
              continue;
            }
          }
          const message = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
          errors.push({ company, entity: spec.name, message });
          console.error("KOPER_MIRROR_ENTITY_FAILED", JSON.stringify({ company, entity: spec.name, message }));
          break;
        }
      }
    }
  }

  const totals = reports.reduce(
    (acc, report) => {
      acc.listed += report.listed;
      acc.inserted += (report.list?.inserted ?? 0) + (report.detail?.inserted ?? 0);
      acc.updated += (report.list?.updated ?? 0) + (report.detail?.updated ?? 0);
      acc.missingAtSource += report.list?.missingAtSource ?? 0;
      acc.detailFailures += report.detailFailures;
      acc.incompleteLists += report.listComplete ? 0 : 1;
      return acc;
    },
    { listed: 0, inserted: 0, updated: 0, missingAtSource: 0, detailFailures: 0, incompleteLists: 0 },
  );
  console.log("KOPER_MIRROR_RESULT", JSON.stringify({ write, full, entitiesOk: reports.length, entitiesFailed: errors.length, ...totals, errors }));
  if (errors.length || totals.incompleteLists || totals.detailFailures) process.exitCode = 1;
}

// Só executa quando chamado diretamente (node dist/mirror-koper.js), não ao ser importado.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error("KOPER_MIRROR_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }));
    process.exitCode = 1;
  });
}
