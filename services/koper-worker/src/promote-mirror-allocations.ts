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
  TARGETS, allRows, asArray, asObject, cents, chunks, ensureKoperServices, idOf, loadMirror, money, num,
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

const normalizeName = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * De-para serviço do Koper → serviço do Elos OS aprendido dos rateios já homologados da obra:
 * só entra título em que a régua acha um único serviço do Koper e o rateio gravado tem um único
 * serviço. Vale apenas quando todos os votos de um serviço concordam.
 */
export function learnCrosswalk(samples: Array<{ koperServiceId: string; elosServiceId: string }>) {
  const votes = new Map<string, Map<string, number>>();
  for (const sample of samples) {
    const inner = votes.get(sample.koperServiceId) ?? new Map<string, number>();
    inner.set(sample.elosServiceId, (inner.get(sample.elosServiceId) ?? 0) + 1);
    votes.set(sample.koperServiceId, inner);
  }
  const agreed = new Map<string, { elosServiceId: string; votes: number }>();
  const conflicts = new Map<string, Array<{ elosServiceId: string; votes: number }>>();
  for (const [koperServiceId, inner] of votes) {
    const ranked = [...inner].map(([elosServiceId, count]) => ({ elosServiceId, votes: count })).sort((a, b) => b.votes - a.votes);
    if (ranked.length === 1 && ranked[0]) agreed.set(koperServiceId, ranked[0]);
    else conflicts.set(koperServiceId, ranked);
  }
  return { agreed, conflicts };
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
  })).filter((payable) => payable.source_system !== null && payable.source_system in target.payableSources && /^koper_bill:\d+$/.test(payable.source_id ?? ""));
  const existing = await allRows<ExistingAllocation>(request, "payable_cost_allocations", {
    select: "id,payable_id,service_id,budget_item_id,allocation_amount,source_system,source_id",
    company_id: company,
    project_id: `eq.${project.id}`,
    order: "id.asc",
  });
  const existingByPayable = new Map<string, ExistingAllocation[]>();
  for (const row of existing) existingByPayable.set(row.payable_id, [...(existingByPayable.get(row.payable_id) ?? []), row]);

  const allServices = await allRows<{ id: string; code: string; description: string; source_system: string | null; source_id: string | null }>(request, "engineering_services", {
    select: "id,code,description,source_system,source_id", company_id: company, order: "id.asc",
  });
  const serviceById = new Map(allServices.map((service) => [service.id, service]));
  const serviceCode = (id: string | null | undefined) => (id ? serviceById.get(id)?.code ?? id.slice(0, 8) : "—");

  // Orçamentos da obra: itens criados a partir do acompanhamento (marcador no item) e, para a
  // regra do Flow, o item de código único por serviço entre os orçamentos aprovados.
  const budgets = await allRows<{ id: string; source_id: string | null; source_system: string | null; status: string }>(request, "engineering_budgets", {
    select: "id,source_id,source_system,status", company_id: company, project_id: `eq.${project.id}`, order: "id.asc",
  });
  const budgetItemByKoper = new Map<string, { id: string; code: string | null }>();
  const targetMonitorings = new Set<string>();
  const approvedItemsByService = new Map<string, Array<{ id: string; code: string | null }>>();
  for (const budget of budgets) {
    const fromMonitoring = budget.source_system === "koper" && Boolean(budget.source_id?.startsWith("monitoring:"));
    if (!fromMonitoring && budget.status !== "approved") continue;
    if (fromMonitoring) targetMonitorings.add((budget.source_id ?? "").slice("monitoring:".length));
    const items = await allRows<{ id: string; code: string | null; notes: string | null; status: string; service_id: string | null }>(request, "engineering_budget_items", {
      select: "id,code,notes,status,service_id", company_id: company, budget_id: `eq.${budget.id}`, order: "id.asc",
    });
    for (const item of items) {
      if (item.status !== "active") continue;
      const match = fromMonitoring ? item.notes?.match(/Koper itemMonitoringId=(\d+)/) : null;
      if (match?.[1]) budgetItemByKoper.set(match[1], { id: item.id, code: item.code });
      if (budget.status === "approved" && item.service_id) approvedItemsByService.set(item.service_id, [...(approvedItemsByService.get(item.service_id) ?? []), { id: item.id, code: item.code }]);
    }
  }
  /** Item do orçamento aprovado quando o serviço tem um único código nele (regra já usada no Flow). */
  const approvedItemFor = (serviceId: string): { id: string; code: string | null } | undefined => {
    const items = approvedItemsByService.get(serviceId) ?? [];
    const codes = [...new Set(items.map((item) => item.code).filter((code): code is string => Boolean(code)))];
    return codes.length === 1 ? items.find((item) => item.code === codes[0]) : undefined;
  };

  const companies = [...new Set(payables.map((payable) => target.payableSources[payable.source_system ?? ""]).filter((item): item is KoperCompany => item !== undefined))];
  const contexts = new Map<KoperCompany, Awaited<ReturnType<typeof loadContext>>>();
  for (const koperCompany of companies) contexts.set(koperCompany, await loadContext(request, koperCompany));

  // 1) Resolve cada título pela cadeia do Koper.
  type Planned = { payable: Payable; billId: string; koperCompany: KoperCompany; resolution: Extract<Resolution, { ok: true }> };
  const planned: Planned[] = [];
  const unresolved = new Map<string, Bucket>();
  const unresolvedExamples = new Map<string, string[]>();
  const existingButUnresolved = new Map<string, Bucket>();
  const weightBases = new Map<string, Bucket>();
  const isNative = (rows: ExistingAllocation[]) => rows.length > 0 && rows.every((row) => row.source_system === ALLOCATION_SOURCE_SYSTEM);
  const fail = (payable: Payable, billId: string, key: string) => {
    const amountCents = cents(payable.amount);
    if ((existingByPayable.get(payable.id) ?? []).length) { bump(existingButUnresolved, key, amountCents); return; }
    bump(unresolved, key, amountCents);
    const examples = unresolvedExamples.get(key) ?? [];
    if (examples.length < 5) unresolvedExamples.set(key, [...examples, billId]);
  };
  for (const payable of payables) {
    const koperCompany = target.payableSources[payable.source_system ?? ""]!;
    const loaded = contexts.get(koperCompany)!;
    const billId = (payable.source_id ?? "").slice("koper_bill:".length);
    const detail = loaded.billDetails.get(billId);
    const resolution: Resolution = detail ? resolveBill(loaded.ctx, billId, detail) : { ok: false, document: "título fora da área de espera", reason: "título não está mais na área de espera" };
    if (!resolution.ok) { fail(payable, billId, `${resolution.document} · ${resolution.reason}`); continue; }
    bump(weightBases, resolution.evidence.weightBasis, cents(payable.amount));
    planned.push({ payable, billId, koperCompany, resolution });
  }

  // 2) Serviço do Koper → serviço do Elos OS.
  const crosswalk = learnCrosswalk(target.serviceCrosswalk !== "history" ? [] : planned.flatMap((item) => {
    const current = existingByPayable.get(item.payable.id) ?? [];
    if (!isNative(current)) return [];
    const mine = [...new Set(item.resolution.lines.map((line) => line.serviceId))];
    const stored = [...new Set(current.map((row) => row.service_id).filter((id): id is string => Boolean(id)))];
    return mine.length === 1 && stored.length === 1 && mine[0] && stored[0] ? [{ koperServiceId: mine[0], elosServiceId: stored[0] }] : [];
  }));
  const needed = new Map<string, KoperServiceInfo>();
  for (const item of planned) {
    const loaded = contexts.get(item.koperCompany)!;
    for (const line of item.resolution.lines) {
      if (needed.has(line.serviceId) || crosswalk.agreed.has(line.serviceId) || crosswalk.conflicts.has(line.serviceId)) continue;
      needed.set(line.serviceId, serviceInfoFromCatalog(loaded.catalog, line.serviceId)
        ?? { name: loaded.serviceNames.get(line.serviceId) ?? loaded.ctx.monitoringItems.get(line.itemMonitoringId ?? "")?.name ?? null, unit: null, categoryId: null, categoryName: null });
    }
  }
  const services = await ensureKoperServices(request, needed, write);
  type ElosTarget = { id: string; name: string | null; how: "histórico" | "catálogo Koper" } | { conflict: true } | null;
  const elosServiceFor = (koperServiceId: string): ElosTarget => {
    const learned = crosswalk.agreed.get(koperServiceId);
    if (learned) return { id: learned.elosServiceId, name: serviceById.get(learned.elosServiceId)?.description ?? null, how: "histórico" };
    if (crosswalk.conflicts.has(koperServiceId)) return { conflict: true };
    const catalog = services.byKoperId.get(koperServiceId);
    if (catalog) return { id: catalog.id, name: catalog.description, how: "catálogo Koper" };
    if (services.wouldCreate.includes(koperServiceId)) return { id: `novo:${koperServiceId}`, name: needed.get(koperServiceId)?.name ?? null, how: "catálogo Koper" };
    return null;
  };

  // 3) Monta as linhas e compara com o que já existe.
  type Row = Json & { id: string; payable_id: string; source_id: string; allocation_amount: number; service_id: string; budget_item_id: string | null };
  const rowsToInsert: Row[] = [];
  const stats = {
    comparison: new Map<string, Bucket>(), otherOrigin: new Map<string, Bucket>(), toWrite: new Map<string, Bucket>(), level: new Map<string, Bucket>(),
    byService: new Map<string, Bucket>(), serviceOrigin: new Map<string, Bucket>(),
  };
  const comparisonExamples: Record<string, Json[]> = {};
  const plannedPayables: Array<{ payableId: string; amountCents: number; rows: Row[] }> = [];
  for (const item of planned) {
    const amountCents = cents(item.payable.amount);
    const loaded = contexts.get(item.koperCompany)!;
    const label = item.resolution.route === "invoice" ? "nota eletrônica" : "nota manual / recibo";
    if (amountCents <= 0) { fail(item.payable, item.billId, "título com valor zero"); continue; }

    // Destinos no Elos OS; serviços do Koper que caem no mesmo serviço do Elos OS são somados.
    type Merged = { serviceId: string; serviceName: string | null; budgetItem: { id: string; code: string | null } | undefined; weight: number; koperServiceIds: string[]; itemMonitoringIds: string[]; itemResolutions: string[]; refs: string[]; how: string };
    const merged = new Map<string, Merged>();
    let failure: string | null = null;
    for (const line of item.resolution.lines) {
      const elos = elosServiceFor(line.serviceId);
      if (!elos) { failure = `${label} · serviço ${line.serviceId} sem nome para cadastrar`; break; }
      if ("conflict" in elos) { failure = `${label} · serviço do Koper com de-para divergente no histórico`; break; }
      const itemRef = line.itemMonitoringId ? loaded.ctx.monitoringItems.get(line.itemMonitoringId) : undefined;
      const fromMonitoring = itemRef && line.itemMonitoringId && targetMonitorings.has(itemRef.monitoringId) ? budgetItemByKoper.get(line.itemMonitoringId) : undefined;
      const budgetItem = fromMonitoring ?? (target.serviceCrosswalk === "history" ? approvedItemFor(elos.id) : undefined);
      const key = `${elos.id}|${budgetItem?.id ?? ""}`;
      const current = merged.get(key) ?? { serviceId: elos.id, serviceName: elos.name, budgetItem, weight: 0, koperServiceIds: [], itemMonitoringIds: [], itemResolutions: [], refs: [], how: elos.how };
      current.weight += line.weight;
      if (!current.koperServiceIds.includes(line.serviceId)) current.koperServiceIds.push(line.serviceId);
      if (line.itemMonitoringId && !current.itemMonitoringIds.includes(line.itemMonitoringId)) current.itemMonitoringIds.push(line.itemMonitoringId);
      if (line.itemResolution && !current.itemResolutions.includes(line.itemResolution)) current.itemResolutions.push(line.itemResolution);
      if (itemRef?.reference && !current.refs.includes(itemRef.reference)) current.refs.push(itemRef.reference);
      merged.set(key, current);
    }
    if (failure) { fail(item.payable, item.billId, failure); continue; }
    const targets = [...merged.values()];
    const parts = distribute(amountCents, targets.map((entry) => entry.weight));
    const rows: Row[] = [];
    targets.forEach((entry, entryIndex) => {
      const part = parts[entryIndex] ?? 0;
      if (part <= 0) return;
      const index = rows.length;
      rows.push({
        id: stableUuid(`elos:koper:payable-allocation:${item.billId}:${index}`),
        company_id: env.BOSSA_COMPANY_ID,
        project_id: project.id,
        payable_id: item.payable.id,
        service_id: entry.serviceId,
        budget_item_id: entry.budgetItem?.id ?? null,
        wbs_code_snapshot: entry.budgetItem ? entry.budgetItem.code ?? entry.refs[0] ?? null : null,
        service_name_snapshot: entry.serviceName,
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
            historicalWbsRefs: entry.refs,
            koperServiceId: entry.koperServiceIds[0] ?? null,
            koperServiceIds: entry.koperServiceIds,
            itemMonitoringId: entry.itemMonitoringIds[0] ?? null,
            itemResolution: entry.itemResolutions[0] ?? null,
            serviceCrosswalk: entry.how,
            weightBasis: item.resolution.evidence.weightBasis,
            sourceWeight: Math.round(entry.weight * 100) / 100,
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
    if (current.length) {
      if (!isNative(current)) { bump(stats.otherOrigin, label, amountCents); continue; }
      const group = (list: Array<{ service_id: string | null; budget_item_id: string | null; allocation_amount: number }>, withItem: boolean) => {
        const sums = new Map<string, number>();
        for (const row of list) {
          const key = withItem ? `${row.service_id}|${row.budget_item_id ?? ""}` : String(row.service_id);
          sums.set(key, (sums.get(key) ?? 0) + cents(row.allocation_amount));
        }
        return sums;
      };
      const same = (a: Map<string, number>, b: Map<string, number>, tolerance: number) => a.size === b.size && [...a].every(([key, value]) => b.has(key) && Math.abs((b.get(key) ?? 0) - value) <= tolerance);
      const sameKeys = (a: Map<string, number>, b: Map<string, number>) => a.size === b.size && [...a.keys()].every((key) => b.has(key));
      const verdict = same(group(current, true), group(rows, true), 0) ? "igual ao gravado"
        : same(group(current, false), group(rows, false), 1) ? "mesmo serviço e valor; item do orçamento diferente"
          : sameKeys(group(current, false), group(rows, false)) ? "mesmos serviços; divisão de valor diferente"
            : "serviços diferentes do gravado";
      bump(stats.comparison, `${verdict} · ${label}`, amountCents);
      if (verdict !== "igual ao gravado") {
        const list = comparisonExamples[verdict] ?? [];
        if (list.length < 6) {
          comparisonExamples[verdict] = [...list, {
            bill: item.billId,
            title: money(amountCents),
            koper: item.resolution.lines.map((line) => `${line.serviceId}:${Math.round(line.weight)}`).join(","),
            regua: rows.map((row) => `${serviceCode(row.service_id)}${row.budget_item_id ? "+item" : ""}=${row.allocation_amount}`).join(" | "),
            gravado: current.map((row) => `${serviceCode(row.service_id)}${row.budget_item_id ? "+item" : ""}=${row.allocation_amount}`).join(" | "),
            base: item.resolution.evidence.weightBasis,
          }];
        }
      }
      continue;
    }
    bump(stats.toWrite, `${label} · ${item.payable.status === "paid" ? "pago" : "em aberto"}`, amountCents);
    bump(stats.level, rows.every((row) => row.budget_item_id) ? "item do orçamento" : rows.some((row) => row.budget_item_id) ? "misto" : "serviço", amountCents);
    for (const entry of targets) bump(stats.serviceOrigin, entry.how, 0);
    for (const row of rows) bump(stats.byService, `${serviceCode(row.service_id)} ${String(row.service_name_snapshot ?? "")}`.slice(0, 44), cents(row.allocation_amount));
    plannedPayables.push({ payableId: item.payable.id, amountCents, rows });
  }

  // Diagnóstico do de-para (só quando a obra usa o histórico).
  if (target.serviceCrosswalk === "history") {
    const catalogByKoper = new Map(allServices.filter((service) => service.source_system === "koper" && service.source_id).map((service) => [String(service.source_id), service]));
    const officialByName = new Map<string, string[]>();
    for (const serviceId of approvedItemsByService.keys()) {
      const name = normalizeName(serviceById.get(serviceId)?.description ?? "");
      if (name) officialByName.set(name, [...(officialByName.get(name) ?? []), serviceId]);
    }
    const koperName = (koperServiceId: string): string => {
      for (const loaded of contexts.values()) {
        const name = serviceInfoFromCatalog(loaded.catalog, koperServiceId)?.name ?? loaded.serviceNames.get(koperServiceId);
        if (name) return name;
      }
      return catalogByKoper.get(koperServiceId)?.description ?? "";
    };
    let toSelf = 0;
    let toOfficial = 0;
    let nameRuleRight = 0;
    let nameRuleWrong = 0;
    let nameRuleSilent = 0;
    for (const [koperServiceId, learned] of crosswalk.agreed) {
      if (catalogByKoper.get(koperServiceId)?.id === learned.elosServiceId) toSelf += 1; else toOfficial += 1;
      const candidates = officialByName.get(normalizeName(koperName(koperServiceId))) ?? [];
      if (candidates.length !== 1) nameRuleSilent += 1;
      else if (candidates[0] === learned.elosServiceId) nameRuleRight += 1;
      else nameRuleWrong += 1;
    }
    const unseen = [...needed.keys()];
    const unseenWithNameMatch = unseen.filter((koperServiceId) => (officialByName.get(normalizeName(koperName(koperServiceId))) ?? []).length === 1);
    console.log("KOPER_ALLOC_CROSSWALK", JSON.stringify({
      target: options.target,
      learnedServices: crosswalk.agreed.size,
      learnedVotes: [...crosswalk.agreed.values()].reduce((sum, entry) => sum + entry.votes, 0),
      mapsToOwnCatalogService: toSelf,
      mapsToOtherService: toOfficial,
      conflicts: [...crosswalk.conflicts].slice(0, 12).map(([koperServiceId, ranked]) => ({ koper: koperServiceId, name: koperName(koperServiceId).slice(0, 30), votes: ranked.slice(0, 3).map((entry) => `${serviceCode(entry.elosServiceId)}×${entry.votes}`) })),
      conflictCount: crosswalk.conflicts.size,
      servicesWithoutHistory: unseen.length,
      servicesWithoutHistorySample: unseen.slice(0, 15).map((koperServiceId) => `${koperServiceId}:${koperName(koperServiceId).slice(0, 28)}`),
      nameRuleOnLearned: { right: nameRuleRight, wrong: nameRuleWrong, noUniqueMatch: nameRuleSilent },
      withoutHistoryButSameNameAsBudgetService: unseenWithNameMatch.length,
      approvedBudgetServices: approvedItemsByService.size,
      learnedSample: [...crosswalk.agreed].slice(0, 12).map(([koperServiceId, entry]) => `${koperServiceId} ${koperName(koperServiceId).slice(0, 22)} → ${serviceCode(entry.elosServiceId)} ×${entry.votes}`),
    }));
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
    comparedWithExisting: dump(stats.comparison),
    existingButChainDoesNotResolve: dump(existingButUnresolved),
    allocatedByOtherOrigin: dump(stats.otherOrigin),
    serviceOriginLines: Object.fromEntries([...stats.serviceOrigin].map(([key, bucket]) => [key, bucket.count])),
    unresolved: dump(unresolved),
    unresolvedExamples: Object.fromEntries(unresolvedExamples),
    servicesNeeded: needed.size,
    servicesCreated: services.created,
    servicesWouldCreate: services.wouldCreate,
    servicesWithoutName: services.unnamed,
  };
  console.log("KOPER_ALLOC_PLAN", JSON.stringify(plan));
  if (Object.keys(comparisonExamples).length) console.log("KOPER_ALLOC_COMPARE_EXAMPLES", JSON.stringify(comparisonExamples).slice(0, 9000));
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
