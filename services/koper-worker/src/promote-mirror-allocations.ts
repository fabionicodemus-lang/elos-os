/**
 * Rateio dos títulos a pagar por serviço (centro de custo), a partir da staging `mirror.*`.
 *
 * Para cada título já promovido da obra alvo (`payables`, origem `koper_alma` / `koper_bossa`)
 * segue a cadeia do próprio Koper e grava em `payable_cost_allocations` — a tabela que a tela
 * Engenharia › Custo x Orçamento lê — no mesmo formato do Flow (`source_system =
 * koper_native_resolution`, `source_id = <billId>:<n>`):
 *
 *   título → nota manual / recibo → linhas de serviço (`services[]`: serviço e valor)
 *                                 → linhas de produto → ordem de compra → solicitação
 *                                   → insumo do acompanhamento → item → serviço
 *   título → nota eletrônica      → produtos → ordem de compra → (mesmo caminho)
 *
 * Regras (nada é inventado):
 *   - só grava quando o título fica 100% resolvido; a soma do rateio é o valor do título;
 *   - parcelas da mesma nota recebem a mesma proporção entre os serviços da nota;
 *   - o item do orçamento (`budget_item_id`, código WBS) só é preenchido quando a ordem de
 *     serviço ligada aponta um único item, ou quando o serviço tem uma única linha no
 *     acompanhamento da obra; senão o rateio fica no nível do serviço;
 *   - tributo, folha, devolução e nota sem vínculo continuam "À Apropriar" e saem listados
 *     por motivo;
 *   - título que já tem rateio (manual ou de outra rotina) nunca é sobrescrito: divergência
 *     vira exceção para revisão.
 *
 *   KOPER_TOOL=allocations KOPER_TOOL_TARGET=alma                        # plano (não grava)
 *   KOPER_TOOL=allocations KOPER_TOOL_TARGET=alma KOPER_TOOL_WRITE=true  # grava
 *   KOPER_ALLOC_LIMIT=5                                                  # piloto: nº de títulos
 */
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import {
  type Json, type KoperCompany, type KoperServiceInfo, type Requester, type TargetKey,
  PAYABLE_SOURCE_COMPANY, TARGETS, allRows, asArray, asObject, cents, chunks, ensureKoperServices, idOf, loadMirror, money, num,
  resolveProject, serviceInfoFromCatalog, text,
} from "./mirror-shared.js";
import { budgetSourceId, readMonitoringItems } from "./promote-mirror-budget.js";
import { stableUuid } from "./promote-mirror-payables.js";

export const ALLOCATION_SOURCE_SYSTEM = "koper_native_resolution";
const RESOLUTION_VERSION = 3;

// ---------------------------------------------------------------------------
// Núcleo puro: da cadeia do Koper às linhas ponderadas por serviço
// ---------------------------------------------------------------------------

export type MonitoringItemRef = { serviceId: string | null; reference: string | null; name: string | null; monitoringId: string };

export type KoperContext = {
  company: KoperCompany;
  receipts: Map<string, Json>;
  invoices: Map<string, Json>;
  purchases: Map<string, Json>;
  purchaseOrders: Map<string, Json>;
  serviceOrders: Map<string, Json>;
  requests: Map<string, Json>;
  receiptByBill: Map<string, string>;
  invoiceByBill: Map<string, string>;
  purchaseByBill: Map<string, string>;
  purchaseByReceipt: Map<string, string>;
  purchaseByInvoice: Map<string, string>;
  monitoringItems: Map<string, MonitoringItemRef>;
  /** `<monitoringId>:<serviceId>` → itens folha daquele serviço. */
  itemsByService: Map<string, string[]>;
  /** `itemMonitInputId` → `itemMonitoringId` (de-para de insumos). */
  inputItem: Map<string, string>;
  inputMapLoaded: boolean;
};

export type ContextData = Pick<KoperContext, "company" | "receipts" | "invoices" | "purchases" | "purchaseOrders" | "serviceOrders" | "requests"> & {
  monitoringItemsPayloads: Map<string, Json>;
  inputServices: Map<string, Json>;
};

export function buildContext(data: ContextData): KoperContext {
  const receiptByBill = new Map<string, string>();
  for (const [receiptId, receipt] of data.receipts) {
    for (const bill of asArray(receipt.bills)) {
      const billId = idOf(asObject(bill).billId);
      if (billId) receiptByBill.set(billId, receiptId);
    }
  }
  const invoiceByBill = new Map<string, string>();
  for (const [invoiceId, invoice] of data.invoices) {
    for (const duplicate of asArray(asObject(invoice.bill).duplicates)) {
      const billId = idOf(asObject(duplicate).billId);
      if (billId) invoiceByBill.set(billId, invoiceId);
    }
  }
  const purchaseByBill = new Map<string, string>();
  const purchaseByReceipt = new Map<string, string>();
  const purchaseByInvoice = new Map<string, string>();
  for (const [purchaseId, purchase] of data.purchases) {
    for (const bill of asArray(purchase.bills)) {
      const billId = idOf(asObject(bill).billId);
      if (billId) purchaseByBill.set(billId, purchaseId);
    }
    const receiptId = idOf(purchase.receiptId);
    const invoiceId = idOf(purchase.xmlInvoiceId);
    if (receiptId) purchaseByReceipt.set(receiptId, purchaseId);
    if (invoiceId) purchaseByInvoice.set(invoiceId, purchaseId);
  }
  const monitoringItems = new Map<string, MonitoringItemRef>();
  const itemsByService = new Map<string, string[]>();
  for (const [monitoringId, payload] of data.monitoringItemsPayloads) {
    for (const item of readMonitoringItems(payload)) {
      monitoringItems.set(item.id, { serviceId: item.serviceId, reference: item.reference, name: item.name, monitoringId });
      if (item.serviceId && !item.hasChildren) {
        const key = `${monitoringId}:${item.serviceId}`;
        itemsByService.set(key, [...(itemsByService.get(key) ?? []), item.id]);
      }
    }
  }
  const inputItem = new Map<string, string>();
  for (const payload of data.inputServices.values()) {
    for (const row of asArray(payload.items)) {
      const link = idOf(asObject(row).itemMonitInputId);
      const item = idOf(asObject(row).itemMonitoringId);
      if (link && item) inputItem.set(link, item);
    }
  }
  return {
    company: data.company, receipts: data.receipts, invoices: data.invoices, purchases: data.purchases, purchaseOrders: data.purchaseOrders,
    serviceOrders: data.serviceOrders, requests: data.requests, receiptByBill, invoiceByBill, purchaseByBill, purchaseByReceipt, purchaseByInvoice,
    monitoringItems, itemsByService, inputItem, inputMapLoaded: data.inputServices.size > 0,
  };
}

export type Weighted = { serviceId: string; itemMonitoringId: string | null; itemResolution: string | null; weight: number };

export type Resolution =
  | {
      ok: true;
      route: "receipt" | "invoice";
      method: "koper_receipt_purchase" | "koper_invoice_purchase_order";
      lines: Weighted[];
      evidence: { receiptId: string | null; invoiceId: string | null; purchaseIds: string[]; orderSourceIds: string[]; serviceOrderIds: string[]; weightBasis: string };
    }
  | { ok: false; document: string; reason: string };

const idsFrom = (list: unknown, keys: string[]): string[] => {
  const out = new Set<string>();
  for (const row of asArray(list)) {
    const object = asObject(row);
    for (const key of keys) {
      const id = idOf(object[key]);
      if (id) out.add(id);
    }
  }
  return [...out];
};

/** Itens do acompanhamento ligados a um produto de ordem de compra (direto ou via solicitação). */
export function productTargets(
  ctx: KoperContext,
  product: { productId: string | null; inputId: string | null },
  purchaseOrderIds: string[],
): { ok: true; shares: Array<{ itemMonitoringId: string; weight: number }> } | { ok: false; reason: string } {
  if (purchaseOrderIds.length === 0) return { ok: false, reason: "produto sem ordem de compra" };
  const links: Array<{ link: string; amount: number }> = [];
  let missingOrder = false;
  let productFound = false;
  for (const orderId of purchaseOrderIds) {
    const order = ctx.purchaseOrders.get(orderId);
    if (!order) { missingOrder = true; continue; }
    const rows = asArray(order.products).map(asObject);
    let matches = rows.filter((row) => product.productId !== null && idOf(row.productId) === product.productId);
    if (matches.length === 0) matches = rows.filter((row) => product.inputId !== null && idOf(row.inputId) === product.inputId);
    for (const row of matches) {
      productFound = true;
      const direct = asArray(row.services).map(asObject);
      const sources = direct.length ? direct : asArray(row.requests).map(asObject).flatMap((requested) => {
        const request = ctx.requests.get(idOf(requested.requestId) ?? "");
        const requestedProduct = asArray(request?.products).map(asObject).find((item) => idOf(item.productRequestId) === idOf(requested.productRequestId));
        return asArray(requestedProduct?.services).map(asObject);
      });
      for (const source of sources) {
        const link = idOf(source.itemMonitInputId);
        if (link) links.push({ link, amount: Math.max(0, num(source.inputAmount)) });
      }
    }
  }
  if (links.length === 0) {
    if (missingOrder && !productFound) return { ok: false, reason: "ordem de compra ainda fora da área de espera" };
    if (!productFound) return { ok: false, reason: "produto não encontrado na ordem de compra" };
    return { ok: false, reason: "produto sem vínculo com item do acompanhamento" };
  }
  if (!ctx.inputMapLoaded) return { ok: false, reason: "de-para de insumos ainda não carregado" };
  const equal = links.every((item) => item.amount === 0);
  const shares = new Map<string, number>();
  for (const item of links) {
    const itemMonitoringId = ctx.inputItem.get(item.link);
    if (!itemMonitoringId) return { ok: false, reason: "insumo sem de-para no acompanhamento" };
    shares.set(itemMonitoringId, (shares.get(itemMonitoringId) ?? 0) + (equal ? 1 : item.amount));
  }
  return { ok: true, shares: [...shares].map(([itemMonitoringId, weight]) => ({ itemMonitoringId, weight })) };
}

type RawLine = { kind: "service" | "product"; unit: number; amount: number; explicitTotal: number | null; serviceId: string | null; productId: string | null; inputId: string | null };

/** Escolhe, entre "valor × quantidade" e "valor já é o total", a leitura que fecha com o total da nota. */
export function lineTotals(lines: RawLine[], documentTotal: number): { totals: number[]; basis: string; relativeError: number } {
  const candidates: Array<{ basis: string; totals: number[] }> = [];
  for (const serviceBasis of ["x", "t"] as const) {
    for (const productBasis of ["x", "t"] as const) {
      candidates.push({
        basis: `serviço:${serviceBasis === "x" ? "valor×qtd" : "valor"}|produto:${productBasis === "x" ? "preço×qtd" : "preço"}`,
        totals: lines.map((line) => {
          if (line.explicitTotal !== null) return line.explicitTotal;
          const basis = line.kind === "service" ? serviceBasis : productBasis;
          return basis === "x" ? line.unit * (line.amount || 1) : line.unit;
        }),
      });
    }
  }
  let best = candidates[0]!;
  let bestError = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const sum = candidate.totals.reduce((a, b) => a + b, 0);
    const error = documentTotal > 0 ? Math.abs(sum - documentTotal) / documentTotal : sum > 0 ? 0 : 1;
    if (error < bestError - 1e-9) { best = candidate; bestError = error; }
  }
  return { totals: best.totals, basis: best.basis, relativeError: bestError };
}

export function resolveBill(ctx: KoperContext, billId: string, detail: Json): Resolution {
  const origins = asObject(detail.origins);
  const invoiceId = idOf(origins.invoice_id) ?? ctx.invoiceByBill.get(billId) ?? null;
  const receiptId = idOf(origins.receipt_id) ?? ctx.receiptByBill.get(billId) ?? null;
  const invoice = invoiceId ? ctx.invoices.get(invoiceId) : undefined;
  const receipt = receiptId ? ctx.receipts.get(receiptId) : undefined;
  if (!invoice && !receipt) {
    const document = invoiceId || receiptId ? "nota fora da área de espera"
      : idOf(origins.tax_id) ? "tributo"
        : idOf(origins.payroll_id) ? "folha"
          : idOf(origins.sales_id) ? "venda / devolução"
            : idOf(origins.commission_id) ? "comissão"
              : "sem documento";
    return { ok: false, document, reason: document === "nota fora da área de espera" ? "nota citada não está na área de espera" : `${document}: o Koper não liga a um serviço` };
  }

  const route: "receipt" | "invoice" = invoice ? "invoice" : "receipt";
  const document = route === "invoice" ? "nota eletrônica" : "nota manual / recibo";
  const purchaseId = ctx.purchaseByBill.get(billId)
    ?? (receipt ? idOf(receipt.purchaseId) : null)
    ?? (receiptId ? ctx.purchaseByReceipt.get(receiptId) : undefined)
    ?? (invoiceId ? ctx.purchaseByInvoice.get(invoiceId) : undefined)
    ?? null;
  const purchase = purchaseId ? ctx.purchases.get(purchaseId) : undefined;
  const purchaseOrderIds = [...new Set([
    ...idsFrom(purchase?.purchaseOrders, ["purchaseOrderId", "orderId"]),
    ...idsFrom(invoice?.purchaseOrders, ["orderId", "purchaseOrderId"]),
  ])];
  const serviceOrderIds = [...new Set([
    ...(idOf(origins.service_order_id) ? [idOf(origins.service_order_id)!] : []),
    ...idsFrom(receipt?.servicesOrders, ["serviceOrderId", "orderId"]),
    ...idsFrom(purchase?.servicesOrders, ["serviceOrderId", "orderId"]),
  ])];
  const monitoringId = idOf((invoice ?? receipt)?.buildMonitoringId) ?? idOf(origins.build_monitoring_id);

  // Linhas do documento.
  let raw: RawLine[] = [];
  let documentTotal = 0;
  if (route === "invoice") {
    raw = asArray(invoice!.products).map(asObject).map((row) => ({
      kind: "product" as const, unit: num(row.unitValue), amount: num(row.amount), explicitTotal: row.totalValue === null || row.totalValue === undefined ? null : num(row.totalValue),
      serviceId: null, productId: idOf(row.productId), inputId: idOf(row.inputId),
    }));
  } else {
    const fromDocument = (source: Json): RawLine[] => [
      ...asArray(source.services).map(asObject).map((row) => ({
        kind: "service" as const, unit: num(row.serviceValue), amount: num(row.serviceAmount), explicitTotal: null, serviceId: idOf(row.serviceId), productId: null, inputId: null,
      })),
      ...asArray(source.products).map(asObject).map((row) => ({
        kind: "product" as const, unit: num(row.price), amount: num(row.productAmount), explicitTotal: null, serviceId: null, productId: idOf(row.productId), inputId: idOf(row.inputId),
      })),
    ];
    raw = fromDocument(receipt!);
    documentTotal = num(receipt!.totalValue);
    if (raw.length === 0 && purchase) {
      raw = fromDocument(purchase);
      documentTotal = num(purchase.purchaseValue);
    }
  }
  if (raw.length === 0) return { ok: false, document, reason: "nota sem linha de serviço nem de produto" };

  // Destino de cada linha.
  const serviceOrderItems = (serviceId: string): string[] => {
    const items = new Set<string>();
    for (const orderId of serviceOrderIds) {
      for (const row of asArray(ctx.serviceOrders.get(orderId)?.services).map(asObject)) {
        const itemId = idOf(row.itemMonitoringId);
        if (idOf(row.serviceId) === serviceId && itemId && ctx.monitoringItems.get(itemId)?.serviceId === serviceId) items.add(itemId);
      }
    }
    return [...items];
  };
  type Target = { serviceId: string; itemMonitoringId: string | null; itemResolution: string | null; share: number };
  const targetsPerLine: Target[][] = [];
  for (const line of raw) {
    if (line.kind === "service") {
      if (!line.serviceId) return { ok: false, document, reason: "linha de serviço sem serviço" };
      const viaOrder = serviceOrderItems(line.serviceId);
      const single = monitoringId ? ctx.itemsByService.get(`${monitoringId}:${line.serviceId}`) ?? [] : [];
      const item = viaOrder.length === 1 ? { id: viaOrder[0]!, how: "ordem de serviço" }
        : single.length === 1 ? { id: single[0]!, how: "serviço com item único no acompanhamento" }
          : null;
      targetsPerLine.push([{ serviceId: line.serviceId, itemMonitoringId: item?.id ?? null, itemResolution: item?.how ?? null, share: 1 }]);
      continue;
    }
    const found = productTargets(ctx, { productId: line.productId, inputId: line.inputId }, purchaseOrderIds);
    if (!found.ok) return { ok: false, document, reason: found.reason };
    const targets: Target[] = [];
    for (const share of found.shares) {
      const serviceId = ctx.monitoringItems.get(share.itemMonitoringId)?.serviceId;
      if (!serviceId) return { ok: false, document, reason: "item do acompanhamento sem serviço" };
      targets.push({ serviceId, itemMonitoringId: share.itemMonitoringId, itemResolution: "ordem de compra → solicitação → insumo", share: share.weight });
    }
    targetsPerLine.push(targets);
  }

  // Pesos: só importam quando há mais de um destino.
  const distinct = new Set(targetsPerLine.flat().map((target) => `${target.serviceId}|${target.itemMonitoringId ?? ""}`));
  let totals: number[];
  let weightBasis: string;
  if (distinct.size === 1) {
    totals = raw.map(() => 1);
    weightBasis = "destino único";
  } else {
    if (route === "invoice") documentTotal = raw.reduce((sum, line) => sum + (line.explicitTotal ?? line.unit * (line.amount || 1)), 0);
    const chosen = lineTotals(raw, documentTotal);
    if (route !== "invoice" && (documentTotal <= 0 || chosen.relativeError > 0.1)) return { ok: false, document, reason: "valores das linhas não fecham com o total da nota" };
    totals = chosen.totals;
    weightBasis = chosen.basis;
  }
  const merged = new Map<string, Weighted>();
  targetsPerLine.forEach((targets, index) => {
    const lineTotal = totals[index] ?? 0;
    const shareSum = targets.reduce((sum, target) => sum + target.share, 0) || 1;
    for (const target of targets) {
      const key = `${target.serviceId}|${target.itemMonitoringId ?? ""}`;
      const current = merged.get(key) ?? { serviceId: target.serviceId, itemMonitoringId: target.itemMonitoringId, itemResolution: target.itemResolution, weight: 0 };
      current.weight += lineTotal * target.share / shareSum;
      merged.set(key, current);
    }
  });
  const lines = [...merged.values()].filter((line) => line.weight > 0);
  if (lines.length === 0) return { ok: false, document, reason: "linhas da nota com valor zero" };
  return {
    ok: true,
    route,
    method: route === "invoice" ? "koper_invoice_purchase_order" : "koper_receipt_purchase",
    lines,
    evidence: { receiptId, invoiceId, purchaseIds: purchaseId ? [purchaseId] : [], orderSourceIds: purchaseOrderIds, serviceOrderIds, weightBasis },
  };
}

/** Divide `amountCents` na proporção dos pesos, fechando a soma ao centavo (maiores restos). */
export function distribute(amountCents: number, weights: number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  const safe = total > 0 ? weights.map((weight) => Math.max(0, weight)) : weights.map(() => 1);
  const safeTotal = total > 0 ? total : weights.length;
  const exact = safe.map((weight) => amountCents * weight / safeTotal);
  const out = exact.map((value) => Math.floor(value));
  let remaining = amountCents - out.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let cursor = 0; remaining > 0 && order.length > 0; cursor += 1, remaining -= 1) {
    const slot = order[cursor % order.length]!;
    out[slot.index] = (out[slot.index] ?? 0) + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Promoção
// ---------------------------------------------------------------------------

type Payable = { id: string; source_system: string | null; source_id: string | null; amount: number; status: string; notes: string | null };
type ExistingAllocation = { id: string; payable_id: string; service_id: string | null; budget_item_id: string | null; allocation_amount: number; source_system: string | null; source_id: string | null };
type Bucket = { count: number; cents: number };
const bump = (map: Map<string, Bucket>, key: string, valueCents: number) => {
  const bucket = map.get(key) ?? { count: 0, cents: 0 };
  bucket.count += 1;
  bucket.cents += valueCents;
  map.set(key, bucket);
};
const dump = (map: Map<string, Bucket>) =>
  Object.fromEntries([...map].sort((a, b) => b[1].cents - a[1].cents).map(([key, bucket]) => [key, { count: bucket.count, total: money(bucket.cents) }]));

async function loadContext(request: Requester, company: KoperCompany): Promise<{ ctx: KoperContext; billDetails: Map<string, Json>; catalog: Map<string, Json>; serviceNames: Map<string, string> }> {
  const billDetails = await loadMirror(request, "mirror.bill_to_pay_detail", company);
  const data: ContextData = {
    company,
    receipts: await loadMirror(request, "mirror.receipt", company),
    invoices: await loadMirror(request, "mirror.xml_invoice", company),
    purchases: await loadMirror(request, "mirror.purchase_detail", company),
    purchaseOrders: await loadMirror(request, "mirror.purchase_order_detail", company),
    serviceOrders: await loadMirror(request, "mirror.service_order_detail", company),
    requests: await loadMirror(request, "mirror.stock_request_detail", company),
    monitoringItemsPayloads: await loadMirror(request, "mirror.monitoring_items", company),
    inputServices: await loadMirror(request, "mirror.monitoring_input_services", company),
  };
  const catalog = await loadMirror(request, "mirror.service", company);
  // Nome do serviço como aparece nos documentos (usado só se o catálogo ainda não foi espelhado).
  const serviceNames = new Map<string, string>();
  const remember = (list: unknown) => {
    for (const row of asArray(list).map(asObject)) {
      const id = idOf(row.serviceId);
      const name = text(row.serviceName);
      if (id && name && !serviceNames.has(id)) serviceNames.set(id, name);
    }
  };
  for (const row of data.receipts.values()) remember(row.services);
  for (const row of data.purchases.values()) remember(row.services);
  for (const row of data.serviceOrders.values()) remember(row.services);
  return { ctx: buildContext(data), billDetails, catalog, serviceNames };
}

export async function promoteMirrorAllocations(options: { write: boolean; target: TargetKey; limit: number }, request: Requester = requestSupabase) {
  const { write } = options;
  const target = TARGETS[options.target];
  const project = await resolveProject(request, target);
  const company = `eq.${env.BOSSA_COMPANY_ID}`;

  const payables = (await allRows<Payable>(request, "payables", {
    select: "id,source_system,source_id,amount,status,notes",
    company_id: company,
    project_id: `eq.${project.id}`,
    order: "id.asc",
  })).filter((payable) => payable.source_system !== null && payable.source_system in PAYABLE_SOURCE_COMPANY && /^koper_bill:\d+$/.test(payable.source_id ?? ""));
  const existing = await allRows<ExistingAllocation>(request, "payable_cost_allocations", {
    select: "id,payable_id,service_id,budget_item_id,allocation_amount,source_system,source_id",
    company_id: company,
    project_id: `eq.${project.id}`,
    order: "id.asc",
  });
  const existingByPayable = new Map<string, ExistingAllocation[]>();
  for (const row of existing) existingByPayable.set(row.payable_id, [...(existingByPayable.get(row.payable_id) ?? []), row]);

  // Itens do orçamento da obra criados a partir do acompanhamento (para `budget_item_id`).
  const budgets = await allRows<{ id: string; source_id: string | null }>(request, "engineering_budgets", {
    select: "id,source_id", company_id: company, project_id: `eq.${project.id}`, source_system: "eq.koper", order: "id.asc",
  });
  const budgetItemByKoper = new Map<string, { id: string; code: string | null }>();
  const targetMonitorings = new Set<string>();
  for (const budget of budgets) {
    if (!budget.source_id?.startsWith("monitoring:")) continue;
    targetMonitorings.add(budget.source_id.slice("monitoring:".length));
    const items = await allRows<{ id: string; code: string | null; notes: string | null; status: string }>(request, "engineering_budget_items", {
      select: "id,code,notes,status", company_id: company, budget_id: `eq.${budget.id}`, order: "id.asc",
    });
    for (const item of items) {
      const match = item.notes?.match(/Koper itemMonitoringId=(\d+)/);
      if (match?.[1] && item.status === "active") budgetItemByKoper.set(match[1], { id: item.id, code: item.code });
    }
  }

  const companies = [...new Set(payables.map((payable) => PAYABLE_SOURCE_COMPANY[payable.source_system ?? ""]).filter((item): item is KoperCompany => item !== undefined))];
  const contexts = new Map<KoperCompany, Awaited<ReturnType<typeof loadContext>>>();
  for (const koperCompany of companies) contexts.set(koperCompany, await loadContext(request, koperCompany));

  // 1) Resolve cada título.
  type Planned = { payable: Payable; billId: string; koperCompany: KoperCompany; resolution: Extract<Resolution, { ok: true }> };
  const planned: Planned[] = [];
  const unresolved = new Map<string, Bucket>();
  const unresolvedExamples = new Map<string, string[]>();
  const weightBases = new Map<string, Bucket>();
  const needed = new Map<string, KoperServiceInfo>();
  for (const payable of payables) {
    const koperCompany = PAYABLE_SOURCE_COMPANY[payable.source_system ?? ""]!;
    const loaded = contexts.get(koperCompany)!;
    const billId = (payable.source_id ?? "").slice("koper_bill:".length);
    const amountCents = cents(payable.amount);
    const detail = loaded.billDetails.get(billId);
    const resolution: Resolution = detail ? resolveBill(loaded.ctx, billId, detail) : { ok: false, document: "título fora da área de espera", reason: "título não está mais na área de espera" };
    if (!resolution.ok) {
      const key = `${resolution.document} · ${resolution.reason}`;
      bump(unresolved, key, amountCents);
      const examples = unresolvedExamples.get(key) ?? [];
      if (examples.length < 5) unresolvedExamples.set(key, [...examples, billId]);
      continue;
    }
    bump(weightBases, resolution.evidence.weightBasis, amountCents);
    for (const line of resolution.lines) {
      if (needed.has(line.serviceId)) continue;
      needed.set(line.serviceId, serviceInfoFromCatalog(loaded.catalog, line.serviceId)
        ?? { name: loaded.serviceNames.get(line.serviceId) ?? loaded.ctx.monitoringItems.get(line.itemMonitoringId ?? "")?.name ?? null, unit: null, categoryId: null, categoryName: null });
    }
    planned.push({ payable, billId, koperCompany, resolution });
  }

  // 2) Serviços no catálogo do Elos OS.
  const services = await ensureKoperServices(request, needed, write);

  // 3) Monta as linhas e compara com o que já existe.
  type Row = Json & { id: string; payable_id: string; source_id: string; allocation_amount: number; service_id: string };
  const rowsToInsert: Row[] = [];
  const stats = { alreadyAllocatedSame: new Map<string, Bucket>(), divergent: new Map<string, Bucket>(), otherOrigin: new Map<string, Bucket>(), toWrite: new Map<string, Bucket>(), level: new Map<string, Bucket>(), byService: new Map<string, Bucket>() };
  const divergentExamples: string[] = [];
  const plannedPayables: Array<{ payableId: string; amountCents: number; rows: Row[] }> = [];
  for (const item of planned) {
    const amountCents = cents(item.payable.amount);
    const loaded = contexts.get(item.koperCompany)!;
    const missingService = item.resolution.lines.find((line) => !services.byKoperId.has(line.serviceId) && !services.wouldCreate.includes(line.serviceId));
    if (missingService) {
      bump(unresolved, `${item.resolution.route === "invoice" ? "nota eletrônica" : "nota manual / recibo"} · serviço ${missingService.serviceId} sem nome para cadastrar`, amountCents);
      continue;
    }
    if (amountCents <= 0) { bump(unresolved, "título com valor zero", amountCents); continue; }
    const parts = distribute(amountCents, item.resolution.lines.map((line) => line.weight));
    const rows: Row[] = [];
    item.resolution.lines.forEach((line, lineIndex) => {
      const part = parts[lineIndex] ?? 0;
      if (part <= 0) return;
      const index = rows.length;
      const service = services.byKoperId.get(line.serviceId);
      const itemRef = line.itemMonitoringId ? loaded.ctx.monitoringItems.get(line.itemMonitoringId) : undefined;
      const inTargetBudget = Boolean(itemRef && targetMonitorings.has(itemRef.monitoringId));
      const budgetItem = inTargetBudget && line.itemMonitoringId ? budgetItemByKoper.get(line.itemMonitoringId) : undefined;
      rows.push({
        id: stableUuid(`elos:koper:payable-allocation:${item.billId}:${index}`),
        company_id: env.BOSSA_COMPANY_ID,
        project_id: project.id,
        payable_id: item.payable.id,
        service_id: service?.id ?? `novo:${line.serviceId}`,
        budget_item_id: budgetItem?.id ?? null,
        wbs_code_snapshot: budgetItem ? budgetItem.code ?? itemRef?.reference ?? null : null,
        service_name_snapshot: service?.description ?? needed.get(line.serviceId)?.name ?? null,
        allocation_amount: part / 100,
        allocation_percent: Math.min(100, Math.max(0.00000001, Math.round(part / amountCents * 100 * 1e8) / 1e8)),
        resolution_method: item.resolution.method,
        source_system: ALLOCATION_SOURCE_SYSTEM,
        source_id: `${item.billId}:${index}`,
        evidence: {
          route: item.resolution.route,
          billId: item.billId,
          status: "exact_allocated",
          nativeMethod: item.resolution.method,
          nativeEvidence: {
            source: item.resolution.route,
            receiptId: item.resolution.evidence.receiptId,
            invoiceId: item.resolution.evidence.invoiceId,
            purchaseIds: item.resolution.evidence.purchaseIds,
            orderSourceIds: item.resolution.evidence.orderSourceIds,
            serviceOrderIds: item.resolution.evidence.serviceOrderIds,
            historicalWbsRefs: itemRef?.reference ? [itemRef.reference] : [],
            koperServiceId: line.serviceId,
            itemMonitoringId: line.itemMonitoringId,
            itemResolution: line.itemResolution,
            weightBasis: item.resolution.evidence.weightBasis,
            sourceWeight: Math.round(line.weight * 100) / 100,
          },
          resolutionVersion: RESOLUTION_VERSION,
          origin: "mirror",
          koperCompany: item.koperCompany,
        },
        created_by: null,
      });
    });
    if (rows.reduce((sum, row) => sum + cents(row.allocation_amount), 0) !== amountCents) throw new Error(`KOPER_ALLOC_SUM_GUARD_${item.billId}`);

    const current = existingByPayable.get(item.payable.id) ?? [];
    const label = `${item.resolution.route === "invoice" ? "nota eletrônica" : "nota manual / recibo"}`;
    if (current.length) {
      if (current.some((row) => row.source_system !== ALLOCATION_SOURCE_SYSTEM)) { bump(stats.otherOrigin, label, amountCents); continue; }
      const signature = (list: Array<{ service_id: string | null; budget_item_id: string | null; allocation_amount: number }>) =>
        list.map((row) => `${row.service_id}|${row.budget_item_id ?? ""}|${cents(row.allocation_amount)}`).sort().join(";");
      if (signature(current) === signature(rows as never)) bump(stats.alreadyAllocatedSame, label, amountCents);
      else {
        bump(stats.divergent, label, amountCents);
        if (divergentExamples.length < 10) divergentExamples.push(item.billId);
      }
      continue;
    }
    bump(stats.toWrite, `${label} · ${item.payable.status === "paid" ? "pago" : "em aberto"}`, amountCents);
    bump(stats.level, rows.every((row) => row.budget_item_id) ? "item do orçamento" : rows.some((row) => row.budget_item_id) ? "misto" : "serviço", amountCents);
    for (const row of rows) bump(stats.byService, String(row.service_name_snapshot ?? row.service_id).slice(0, 40), cents(row.allocation_amount));
    plannedPayables.push({ payableId: item.payable.id, amountCents, rows });
  }

  const selected = options.limit > 0 ? plannedPayables.slice(0, options.limit) : plannedPayables;
  for (const item of selected) rowsToInsert.push(...item.rows);
  const totalPayablesCents = payables.reduce((sum, payable) => sum + cents(payable.amount), 0);
  const plan = {
    write,
    target: options.target,
    project: project.name,
    limit: options.limit,
    payables: payables.length,
    payablesTotal: money(totalPayablesCents),
    koperCompanies: companies,
    inputMapLoaded: Object.fromEntries([...contexts].map(([key, value]) => [key, value.ctx.inputMapLoaded])),
    budgetItemsLinked: budgetItemByKoper.size,
    resolvable: planned.length,
    toWrite: dump(stats.toWrite),
    toWriteTitles: plannedPayables.length,
    toWriteTotal: money(plannedPayables.reduce((sum, item) => sum + item.amountCents, 0)),
    thisRunTitles: selected.length,
    thisRunRows: rowsToInsert.length,
    level: dump(stats.level),
    weightBasis: dump(weightBases),
    alreadyAllocatedSame: dump(stats.alreadyAllocatedSame),
    divergentFromExisting: dump(stats.divergent),
    divergentExamples,
    allocatedByOtherOrigin: dump(stats.otherOrigin),
    unresolved: dump(unresolved),
    unresolvedExamples: Object.fromEntries(unresolvedExamples),
    servicesNeeded: needed.size,
    servicesCreated: services.created,
    servicesWouldCreate: services.wouldCreate,
    servicesWithoutName: services.unnamed,
  };
  console.log("KOPER_ALLOC_PLAN", JSON.stringify(plan));
  console.log("KOPER_ALLOC_PLAN_SERVICES", JSON.stringify({ top: Object.fromEntries(Object.entries(dump(stats.byService)).slice(0, 40)) }));
  console.log("KOPER_ALLOC_PLAN_SAMPLE", JSON.stringify(selected.slice(0, 4).map((item) => ({
    title: money(item.amountCents),
    rows: item.rows.map((row) => ({ source_id: row.source_id, service: row.service_name_snapshot, wbs: row.wbs_code_snapshot, item: row.budget_item_id ? "sim" : "não", amount: row.allocation_amount, percent: row.allocation_percent, method: row.resolution_method })),
  }))));
  if (!write || rowsToInsert.length === 0) return { ...plan, inserted: 0, verified: !write ? null : true };
  if (rowsToInsert.some((row) => String(row.service_id).startsWith("novo:"))) throw new Error("KOPER_ALLOC_SERVICE_NOT_CREATED");

  // 4) Grava (lote inteiro por título; nunca atualiza nem apaga linha existente).
  const batches: Row[][] = [];
  let currentBatch: Row[] = [];
  for (const item of selected) {
    if (currentBatch.length + item.rows.length > 60 && currentBatch.length) { batches.push(currentBatch); currentBatch = []; }
    currentBatch.push(...item.rows);
  }
  if (currentBatch.length) batches.push(currentBatch);
  for (const batch of batches) {
    await request("payable_cost_allocations", {
      method: "POST",
      body: batch,
      prefer: "resolution=ignore-duplicates,return=minimal",
      query: new URLSearchParams({ on_conflict: "id" }),
      timeoutMs: 60_000,
    });
  }

  // 5) Conferência: relê e confere linha a linha e a soma por título.
  const after = await allRows<ExistingAllocation>(request, "payable_cost_allocations", {
    select: "id,payable_id,service_id,budget_item_id,allocation_amount,source_system,source_id",
    company_id: company,
    project_id: `eq.${project.id}`,
    order: "id.asc",
  });
  const afterById = new Map(after.map((row) => [row.id, row]));
  const sumByPayable = new Map<string, number>();
  for (const row of after) sumByPayable.set(row.payable_id, (sumByPayable.get(row.payable_id) ?? 0) + cents(row.allocation_amount));
  const missingRows = rowsToInsert.filter((row) => {
    const stored = afterById.get(row.id);
    return !stored || cents(stored.allocation_amount) !== cents(row.allocation_amount) || stored.service_id !== row.service_id || stored.payable_id !== row.payable_id;
  });
  const unbalanced = selected.filter((item) => sumByPayable.get(item.payableId) !== item.amountCents);
  const verified = missingRows.length === 0 && unbalanced.length === 0;
  const result = {
    target: options.target,
    project: project.name,
    titles: selected.length,
    rows: rowsToInsert.length,
    total: money(selected.reduce((sum, item) => sum + item.amountCents, 0)),
    allocationsInProject: after.length,
    payablesAllocatedInProject: sumByPayable.size,
    allocatedTotalInProject: money([...sumByPayable.values()].reduce((sum, value) => sum + value, 0)),
    missingRows: missingRows.length,
    unbalancedTitles: unbalanced.length,
    verified,
  };
  console.log("KOPER_ALLOC_RESULT", JSON.stringify(result));
  if (!verified) throw new Error("KOPER_ALLOC_POST_VERIFICATION_FAILED");
  return { ...plan, inserted: rowsToInsert.length, verified };
}
