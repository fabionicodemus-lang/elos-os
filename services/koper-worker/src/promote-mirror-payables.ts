/**
 * Promoção das contas a pagar do espelho (staging `mirror.*`) para `public.payables`.
 *
 * Escopo: empresas do Koper **Bossa Empreendimentos** e **Alma Seahouses - Bossa**.
 * O Flow não entra aqui: ele já é promovido e mantido por `sync-koper-payables-daily.ts`
 * com `source_system = koper_flow`, e este script nunca lê nem altera esses títulos.
 *
 * Regra das obras (Fábio, 2026-10-10 — docs/koper-mirror.md, Seção 2):
 *   empresa Bossa: Matriz (3) e Escritório Central (135) → Escritório Bossa;
 *                  Soul Residence (102) → Soul; Jazz Residence (103) → Jazz;
 *                  Alma Seahouses (202) e Alma Seahouses - EMPRESA (201) → Alma.
 *   empresa Alma:  tudo → Alma.
 *
 * O que NÃO vira título no Elos OS (fica listado como exceção, nada é inventado):
 *   - título pai de agrupamento (`bill_type = "Grupo"`): os filhos já carregam valor e
 *     centro de custo; promover o pai contaria o custo em dobro;
 *   - título `bill_type = "Crédito"`: é crédito de fornecedor, não despesa;
 *   - título sem centro de custo mapeado, sem beneficiário identificável, sem vencimento
 *     ou pago sem data de pagamento.
 *
 * Beneficiário: fornecedor do Koper; se não houver, funcionário, cliente ou comissionado;
 * guia de tributo entra com um cadastro por tipo de tributo (`tax:<id>`), e folha por
 * modelo de folha (`payroll:<id>`). Nome sozinho nunca é usado como chave.
 *
 * Garantias: identidade estável (`source_system` + `source_id = koper_bill:<billId>` e UUID
 * determinístico), então reexecutar não duplica; nunca apaga; título já existente só recebe
 * baixa de pagamento (aberto → pago); divergência de valor ou vencimento vira exceção para
 * revisão humana. Apropriação: o título entra como "À Apropriar", com centro de custo e
 * plano de contas do Koper anotados; o rateio por serviço/WBS é etapa separada.
 *
 *   node dist/promote-mirror-payables.js            # plano (não grava)
 *   node dist/promote-mirror-payables.js --write    # grava
 *   KOPER_PROMOTE_LIMIT=5                           # limita a criação (piloto)
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { planProjects } from "./ensure-bossa-projects.js";

type Json = Record<string, unknown>;
type Requester = typeof requestSupabase;
type Company = "bossa" | "alma";
type ProjectKey = "alma" | "soul" | "jazz" | "office";

const SOURCE_SYSTEM: Record<Company, string> = { bossa: "koper_bossa", alma: "koper_alma" };
const COMPANY_LABEL: Record<Company, string> = { bossa: "Bossa Empreendimentos", alma: "Alma Seahouses - Bossa" };

/** Centro de custo (stockPlaceId) da empresa Bossa → obra no Elos OS. */
const BOSSA_COST_CENTER_PROJECT: Record<string, ProjectKey> = {
  "3": "office",
  "135": "office",
  "102": "soul",
  "103": "jazz",
  "201": "alma",
  "202": "alma",
};

const asObject = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {});
const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out === "" || out === "-" ? null : out;
};
const cents = (value: unknown): number => Math.round(Number(value ?? 0) * 100);
const money = (value: number): number => Math.round(value) / 100;
const isoDate = (value: unknown): string | null => {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
};
const normalizeName = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

export function stableUuid(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0, 32), "hex");
  bytes[6] = ((bytes[6] ?? 0) & 15) | 80;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

type StageRow = { koper_id: string; payload: Json };
type Supplier = { id: string; source_id: string | null; source_system: string | null; legal_name: string };
type Payable = { id: string; source_system: string | null; source_id: string | null; project_id: string; amount: number; due_date: string; status: string };

async function all<T>(request: Requester, table: string, query: Record<string, string>, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const rows = await request<T[]>(table, {
      query: new URLSearchParams({ ...query, limit: String(pageSize), offset: String(offset) }),
      timeoutMs: 90_000,
    });
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}

async function stage(request: Requester, entity: string, company: Company): Promise<Map<string, Json>> {
  const rows = await all<StageRow>(request, "koper_staging_records", {
    select: "koper_id,payload",
    company_id: `eq.${env.BOSSA_COMPANY_ID}`,
    source: "eq.koper",
    entity: `eq.${entity}`,
    koper_id: `like.${company}:*`,
    sync_state: "eq.present",
    order: "koper_id.asc",
  }, 400);
  return new Map(rows.map((row) => [row.koper_id.slice(company.length + 1), asObject(asObject(row.payload).data)]));
}

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

export type Beneficiary = { sourceId: string; name: string } | null;

/** Quem recebe o pagamento, com identidade estável no Koper. Nunca usa só o nome como chave. */
export function resolveBeneficiary(detail: Json, fallbackName: string | null = null): Beneficiary {
  const beneficiary = asObject(detail.beneficiary);
  const supplierId = text(detail.supplier_id) ?? text(beneficiary.supplier_id);
  const supplierName = text(detail.supplier_name) ?? text(beneficiary.supplier_name) ?? fallbackName;
  if (supplierId && supplierName) return { sourceId: supplierId, name: supplierName };
  const kinds: Array<[string, string, string]> = [
    ["employee", "employee_id", "employee_name"],
    ["customer", "customer_id", "customer_name"],
    ["commission", "commission_id", "commission_name"],
  ];
  for (const [kind, idKey, nameKey] of kinds) {
    const id = text(beneficiary[idKey]);
    const name = text(beneficiary[nameKey]);
    if (id && name) return { sourceId: `${kind}:${id}`, name };
  }
  // Guia de tributo não tem fornecedor no Koper: o beneficiário é o próprio tributo
  // (um cadastro por tipo, ex.: "PIS — Programa de Integração Social").
  const origins = asObject(detail.origins);
  const taxTypeId = text(origins.tax_type_id);
  const taxLabel = [text(origins.tax_abbreviation), text(origins.tax_name)].filter(Boolean).join(" — ");
  if (taxTypeId && taxLabel) return { sourceId: `tax:${taxTypeId}`, name: taxLabel };
  const payrollId = text(origins.payroll_model_id) ?? text(origins.payroll_id);
  const payrollName = text(origins.payroll_name);
  if (payrollId && payrollName) return { sourceId: `payroll:${payrollId}`, name: payrollName };
  return null;
}

export type Decision =
  | { action: "skip"; reason: string }
  | { action: "promote"; projectKey: ProjectKey; beneficiary: NonNullable<Beneficiary>; row: Json };

export function decide(company: Company, billId: string, bill: Json, detail: Json | undefined, parents: Map<string, Json>): Decision {
  if (!detail) return { action: "skip", reason: "detail_missing" };
  const billType = text(detail.bill_type);
  if (billType === "Grupo") return { action: "skip", reason: "group_parent" };
  if (billType === "Crédito") return { action: "skip", reason: "supplier_credit" };

  const costCenter = asObject(detail.cost_center);
  const costCenterId = text(costCenter.id);
  const costCenterName = text(costCenter.name);
  const projectKey: ProjectKey | undefined = company === "alma" ? "alma" : costCenterId ? BOSSA_COST_CENTER_PROJECT[costCenterId] : undefined;
  if (!projectKey) return { action: "skip", reason: costCenterId ? "cost_center_unmapped" : "cost_center_missing" };

  const beneficiary = resolveBeneficiary(detail, text(bill.originName));
  if (!beneficiary) return { action: "skip", reason: "beneficiary_unresolved" };

  const dueDate = isoDate(bill.dueDate);
  const amountCents = cents(bill.billValue);
  if (!dueDate || !Number.isFinite(amountCents) || amountCents < 0) return { action: "skip", reason: "invalid_amount_or_due_date" };

  // Filho de agrupamento é pago pelo título pai: herda a baixa do pai.
  let isPaid = bill.isPaid === true;
  let paymentDate = isoDate(bill.paymentDate);
  let paidCents = bill.paymentValue === null || bill.paymentValue === undefined ? amountCents : cents(bill.paymentValue);
  const joinId = text(detail.join_bill_id) ?? text(bill.joinBillId);
  if (!isPaid && joinId) {
    const parent = parents.get(joinId);
    if (parent && parent.isPaid === true && isoDate(parent.paymentDate)) {
      isPaid = true;
      paymentDate = isoDate(parent.paymentDate);
      paidCents = amountCents;
    }
  }
  if (isPaid && !paymentDate) return { action: "skip", reason: "paid_without_payment_date" };

  const billToPayId = text(bill.billToPayId);
  const invoiceNumber = text(bill.invoiceNumber);
  const receiptNumber = text(bill.receiptNumber);
  const chart = [text(detail.chart_account_name), text(detail.classification)].filter(Boolean).join(" / ");
  const notes = [
    "À Apropriar",
    "Sincronização Koper",
    `título ${billToPayId ?? billId}`,
    `parcela ${billId}`,
    `empresa ${COMPANY_LABEL[company]}`,
    costCenterName ? `centro de custo ${costCenterName}` : null,
    chart ? `plano de contas ${chart}` : null,
  ].filter(Boolean).join(" · ");

  return {
    action: "promote",
    projectKey,
    beneficiary,
    row: {
      id: stableUuid(`elos:koper:payable:${billId}`),
      company_id: env.BOSSA_COMPANY_ID,
      document: invoiceNumber ? `NF ${invoiceNumber}` : receiptNumber ? `Recibo ${receiptNumber}` : `Koper ${billToPayId ?? billId}`,
      due_date: dueDate,
      amount: money(amountCents),
      status: isPaid ? "paid" : "open",
      paid_at: isPaid ? paymentDate : null,
      paid_amount: isPaid ? money(Math.max(paidCents, 0)) : null,
      paid_account_name: isPaid ? "Koper (sincronização)" : null,
      notes,
      origin: "historical_import",
      source_system: SOURCE_SYSTEM[company],
      source_category: "daily_import",
      source_id: `koper_bill:${billId}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

type Bucket = { count: number; cents: number };
const add = (map: Map<string, Bucket>, key: string, valueCents: number) => {
  const bucket = map.get(key) ?? { count: 0, cents: 0 };
  bucket.count += 1;
  bucket.cents += valueCents;
  map.set(key, bucket);
};
const dump = (map: Map<string, Bucket>) => Object.fromEntries([...map].map(([key, bucket]) => [key, { count: bucket.count, total: money(bucket.cents) }]));

export async function promoteMirrorPayables(options: { write: boolean; limit: number }, request: Requester = requestSupabase) {
  const companyFilter = `eq.${env.BOSSA_COMPANY_ID}`;
  const projects = await request<Array<{ id: string; name: string; code: string | null; status: string; created_by: string }>>("projects", {
    query: new URLSearchParams({ select: "id,name,code,status,created_by", company_id: companyFilter, limit: "500" }),
  });
  const plan = planProjects(projects);
  const projectIdByKey = new Map(plan.existing.map((item) => [item.key, item.id]));
  if (plan.ambiguous.length || projectIdByKey.size !== 4) throw new Error(`KOPER_PROMOTE_PROJECTS_NOT_READY_${projectIdByKey.size}_${plan.ambiguous.length}`);

  const suppliers = await all<Supplier>(request, "suppliers", { select: "id,source_id,source_system,legal_name", company_id: companyFilter, order: "id.asc" });
  const supplierBySource = new Map(suppliers.filter((row) => row.source_system === "koper" && row.source_id).map((row) => [row.source_id as string, row]));
  const newSuppliers = new Map<string, Json>();

  const summary: Json = { write: options.write, limit: options.limit };
  const creates: Json[] = [];
  const paymentUpdates: Array<{ id: string; sourceSystem: string; sourceId: string; paidAt: string; paidAmount: number }> = [];
  const exceptionRows: Json[] = [];

  for (const company of ["bossa", "alma"] as Company[]) {
    const [bills, details, posted] = await Promise.all([
      stage(request, "mirror.bill_to_pay", company),
      stage(request, "mirror.bill_to_pay_detail", company),
      all<Payable>(request, "payables", {
        select: "id,source_system,source_id,project_id,amount,due_date,status",
        company_id: companyFilter,
        source_system: `eq.${SOURCE_SYSTEM[company]}`,
        order: "id.asc",
      }),
    ]);
    const postedBySource = new Map(posted.filter((row) => row.source_id).map((row) => [row.source_id as string, row]));
    const parents = new Map([...bills].filter(([id]) => text(asObject(details.get(id)).bill_type) === "Grupo"));

    const byProject = new Map<string, Bucket>();
    const skipped = new Map<string, Bucket>();
    const beneficiaryKinds = new Map<string, Bucket>();
    const groupChildren = { withPaidParent: 0, withOpenParent: 0, parentNotFound: 0 };
    for (const [billId, bill] of bills) {
      const joinId = text(asObject(details.get(billId)).join_bill_id) ?? text(bill.joinBillId);
      if (!joinId || parents.has(billId)) continue;
      const parent = parents.get(joinId);
      if (!parent) groupChildren.parentNotFound += 1;
      else if (parent.isPaid === true) groupChildren.withPaidParent += 1;
      else groupChildren.withOpenParent += 1;
    }
    let unchanged = 0;
    let conflicts = 0;
    let payments = 0;
    let toCreate = 0;

    for (const [billId, bill] of bills) {
      const valueCents = cents(bill.billValue);
      const decision = decide(company, billId, bill, details.get(billId), parents);
      if (decision.action === "skip") {
        add(skipped, decision.reason, valueCents);
        exceptionRows.push({ company, billId, reason: decision.reason, amount: money(valueCents) });
        continue;
      }
      add(byProject, decision.projectKey, valueCents);
      add(beneficiaryKinds, decision.beneficiary.sourceId.includes(":") ? (decision.beneficiary.sourceId.split(":")[0] ?? "other") : "supplier", valueCents);

      const row = decision.row;
      const existing = postedBySource.get(String(row.source_id));
      if (existing) {
        if (cents(existing.amount) !== cents(row.amount) || existing.due_date !== row.due_date) {
          conflicts += 1;
          exceptionRows.push({ company, billId, reason: "existing_value_or_due_date_conflict", amount: row.amount });
        } else if (existing.status === "open" && row.status === "paid") {
          payments += 1;
          paymentUpdates.push({ id: existing.id, sourceSystem: SOURCE_SYSTEM[company], sourceId: String(row.source_id), paidAt: String(row.paid_at), paidAmount: Number(row.paid_amount) });
        } else if (existing.status === "paid" && row.status === "open") {
          conflicts += 1;
          exceptionRows.push({ company, billId, reason: "payment_reversal_requires_review", amount: row.amount });
        } else {
          unchanged += 1;
        }
        continue;
      }

      let supplier = supplierBySource.get(decision.beneficiary.sourceId);
      if (!supplier) {
        const id = stableUuid(`elos:koper:supplier:${decision.beneficiary.sourceId}`);
        newSuppliers.set(decision.beneficiary.sourceId, {
          id,
          company_id: env.BOSSA_COMPANY_ID,
          legal_name: decision.beneficiary.name,
          person_type: "other",
          source_system: "koper",
          source_id: decision.beneficiary.sourceId,
          notes: "Cadastro vinculado à importação de contas a pagar do Koper",
        });
        supplier = { id, source_id: decision.beneficiary.sourceId, source_system: "koper", legal_name: decision.beneficiary.name };
        supplierBySource.set(decision.beneficiary.sourceId, supplier);
      }
      toCreate += 1;
      creates.push({ ...row, project_id: projectIdByKey.get(decision.projectKey), supplier_id: supplier.id });
    }

    summary[company] = {
      source: bills.size,
      details: details.size,
      alreadyPosted: posted.length,
      toCreate,
      paymentUpdates: payments,
      unchanged,
      conflicts,
      promotableByProject: dump(byProject),
      skipped: dump(skipped),
      beneficiaryKinds: dump(beneficiaryKinds),
      groupParents: parents.size,
      groupChildren,
    };
  }

  // Nomes repetidos entre cadastros novos e existentes são só informados; a chave é o id do Koper.
  const existingNames = new Set(suppliers.map((row) => normalizeName(row.legal_name)));
  summary.newSuppliers = newSuppliers.size;
  summary.newSuppliersWithExistingName = [...newSuppliers.values()].filter((row) => existingNames.has(normalizeName(String(row.legal_name)))).length;
  summary.toCreateTotal = creates.length;
  summary.paymentUpdatesTotal = paymentUpdates.length;
  summary.exceptionsTotal = exceptionRows.length;
  summary.exceptionExamples = exceptionRows.slice(0, 40);
  console.log("KOPER_PROMOTE_PLAN", JSON.stringify(summary));
  if (!options.write) return summary;

  const selected = options.limit > 0 ? creates.slice(0, options.limit) : creates;
  const neededSuppliers = new Set(selected.map((row) => String(row.supplier_id)));
  const supplierRows = [...newSuppliers.values()].filter((row) => neededSuppliers.has(String(row.id)));
  for (let index = 0; index < supplierRows.length; index += 100) {
    await request("suppliers", {
      method: "POST",
      body: supplierRows.slice(index, index + 100),
      prefer: "resolution=ignore-duplicates,return=minimal",
      query: new URLSearchParams({ on_conflict: "company_id,source_system,source_id" }),
      timeoutMs: 60_000,
    });
  }
  if (supplierRows.length) {
    const checked = await all<Supplier>(request, "suppliers", { select: "id,source_id,source_system,legal_name", company_id: companyFilter, source_system: "eq.koper", order: "id.asc" });
    const bySource = new Map(checked.filter((row) => row.source_id).map((row) => [row.source_id as string, row.id]));
    if (supplierRows.some((row) => bySource.get(String(row.source_id)) !== row.id)) throw new Error("KOPER_PROMOTE_SUPPLIER_VERIFICATION_FAILED");
  }

  for (let index = 0; index < selected.length; index += 50) {
    await request("payables", {
      method: "POST",
      body: selected.slice(index, index + 50),
      prefer: "resolution=ignore-duplicates,return=minimal",
      query: new URLSearchParams({ on_conflict: "id" }),
      timeoutMs: 60_000,
    });
  }
  for (const update of paymentUpdates) {
    await request("payables", {
      method: "PATCH",
      body: { status: "paid", paid_at: update.paidAt, paid_amount: update.paidAmount, paid_account_name: "Koper (sincronização)" },
      prefer: "return=minimal",
      query: new URLSearchParams({ id: `eq.${update.id}`, company_id: companyFilter, status: "eq.open", source_system: `eq.${update.sourceSystem}`, source_id: `eq.${update.sourceId}` }),
    });
  }

  // Conferência: tudo o que foi enviado precisa existir com o mesmo valor, obra e fornecedor.
  const verification: Json = {};
  let failed = 0;
  for (const company of ["bossa", "alma"] as Company[]) {
    const rows = await all<Payable & { supplier_id: string }>(request, "payables", {
      select: "id,source_system,source_id,project_id,supplier_id,amount,due_date,status",
      company_id: companyFilter,
      source_system: `eq.${SOURCE_SYSTEM[company]}`,
      order: "id.asc",
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const byProject = new Map<string, Bucket>();
    for (const row of rows) add(byProject, row.project_id, cents(row.amount));
    for (const row of selected.filter((item) => item.source_system === SOURCE_SYSTEM[company])) {
      const saved = byId.get(String(row.id));
      if (!saved || cents(saved.amount) !== cents(row.amount) || saved.project_id !== row.project_id || saved.supplier_id !== row.supplier_id || saved.source_id !== row.source_id) failed += 1;
    }
    verification[company] = { payables: rows.length, total: money(rows.reduce((sum, row) => sum + cents(row.amount), 0)), byProjectId: dump(byProject) };
  }
  if (failed) throw new Error(`KOPER_PROMOTE_POST_VERIFICATION_FAILED_${failed}`);
  const result = { created: selected.length, suppliersCreatedOrPresent: supplierRows.length, paymentsUpdated: paymentUpdates.length, verified: true, verification };
  console.log("KOPER_PROMOTE_RESULT", JSON.stringify(result));
  return { ...summary, result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const limit = Math.max(0, Number(process.env.KOPER_PROMOTE_LIMIT ?? "0") || 0);
  promoteMirrorPayables({ write: process.argv.includes("--write"), limit }).catch((error: unknown) => {
    console.error("KOPER_PROMOTE_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }));
    process.exitCode = 1;
  });
}
