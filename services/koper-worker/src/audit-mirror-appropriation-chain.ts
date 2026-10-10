/**
 * Medição (somente leitura) da cadeia de apropriação na staging `mirror.*`.
 *
 * Para cada título a pagar de cada empresa do Koper, verifica até onde a cadeia chega:
 *
 *   título → nota (eletrônica ou manual) → compra → ordem de compra → solicitação de material
 *                                                 → ordem de serviço → contrato / medição
 *
 * e qual é a melhor evidência disponível para apropriar o custo:
 *   - "item do orçamento": algum elo traz `itemMonitInputId`, `itemMonitoringId`,
 *     `itemMonitContractId` ou `itemReference` (vínculo com item do acompanhamento da obra);
 *   - "serviço": só `serviceId`;
 *   - "obra": só `buildMonitoringId` / centro de custo;
 *   - "nenhuma".
 *
 * Não grava nada: lê `koper_staging_records` e imprime totais. Nomes e textos livres
 * não são impressos — só contagens, valores e nomes de campos.
 *
 *   node dist/audit-mirror-appropriation-chain.js
 *   KOPER_AUDIT_COMPANIES=alma,bossa   (padrão: bossa,flow,alma)
 */
import { pathToFileURL } from "node:url";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type Requester = typeof requestSupabase;
type Company = "bossa" | "flow" | "alma";

const asObject = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out === "" || out === "-" || out === "0" ? null : out;
};
const cents = (value: unknown): number => Math.round(Number(value ?? 0) * 100);
const money = (value: number): number => Math.round(value) / 100;

/** Coleta, em qualquer profundidade, os valores não vazios das chaves pedidas. */
export function collectByKeys(value: unknown, keys: ReadonlySet<string>, out: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 8) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectByKeys(item, keys, out, depth + 1);
    return out;
  }
  if (typeof value !== "object" || value === null) return out;
  for (const [key, item] of Object.entries(value as Json)) {
    if (keys.has(key)) {
      if (Array.isArray(item)) {
        for (const entry of item) {
          const id = typeof entry === "object" ? null : text(entry);
          if (id) out.add(id);
        }
      } else if (typeof item !== "object") {
        const id = text(item);
        if (id) out.add(id);
      }
    }
    collectByKeys(item, keys, out, depth + 1);
  }
  return out;
}

/** Nomes de campos (sem valores) de uma amostra, para documentar a estrutura. */
export function fieldPaths(value: unknown, prefix = "", out: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 5 || out.size > 150) return out;
  if (Array.isArray(value)) {
    if (value.length) fieldPaths(value[0], `${prefix}[]`, out, depth + 1);
    return out;
  }
  if (typeof value !== "object" || value === null) {
    if (prefix) out.add(prefix);
    return out;
  }
  for (const [key, item] of Object.entries(value as Json)) fieldPaths(item, prefix ? `${prefix}.${key}` : key, out, depth + 1);
  return out;
}

const BUDGET_ITEM_KEYS = new Set(["itemMonitInputId", "itemMonitoringId", "itemMonitContractId", "itemReference", "monItemReference", "item_monitoring_id"]);
const SERVICE_KEYS = new Set(["serviceId", "service_id"]);
const MONITORING_KEYS = new Set(["buildMonitoringId", "build_monitoring_id"]);
const REQUEST_KEYS = new Set(["requestId", "productRequestId", "request_id"]);
const CONTRACT_KEYS = new Set(["contractId", "contract_id"]);
const MEASUREMENT_KEYS = new Set(["measurementId", "measurement_id", "buildMeasurementId", "fncReleaseId", "fncStageReleaseId", "fnc_release_id", "fnc_stage_release_id"]);
const PURCHASE_ORDER_KEYS = new Set(["purchaseOrderId", "purchaseOrderIds"]);
const SERVICE_ORDER_KEYS = new Set(["serviceOrderId", "service_order_id"]);

type StageRow = { koper_id: string; payload: Json };

async function stage(request: Requester, entity: string, company: Company): Promise<Map<string, Json>> {
  const out = new Map<string, Json>();
  const pageSize = 300;
  for (let offset = 0; ; offset += pageSize) {
    const rows = await request<StageRow[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "koper_id,payload",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: `eq.${entity}`,
        koper_id: `like.${company}:*`,
        sync_state: "eq.present",
        order: "koper_id.asc",
        limit: String(pageSize),
        offset: String(offset),
      }),
      timeoutMs: 110_000,
    });
    for (const row of rows) out.set(row.koper_id.slice(company.length + 1), asObject(asObject(row.payload).data));
    if (rows.length < pageSize) return out;
  }
}

type Bucket = { count: number; cents: number };
const bump = (map: Map<string, Bucket>, key: string, valueCents: number) => {
  const bucket = map.get(key) ?? { count: 0, cents: 0 };
  bucket.count += 1;
  bucket.cents += valueCents;
  map.set(key, bucket);
};
const dump = (map: Map<string, Bucket>) =>
  Object.fromEntries([...map].sort((a, b) => b[1].cents - a[1].cents).map(([key, bucket]) => [key, { count: bucket.count, total: money(bucket.cents) }]));

export type ChainData = {
  bills: Map<string, Json>;
  billDetails: Map<string, Json>;
  purchases: Map<string, Json>;
  receipts: Map<string, Json>;
  invoices: Map<string, Json>;
  purchaseOrders: Map<string, Json>;
  serviceOrders: Map<string, Json>;
  requests: Map<string, Json>;
  contracts: Map<string, Json>;
  measurements: Map<string, Json>;
};

export function measureChain(data: ChainData) {
  // Índices por título: a compra, o recibo e a nota listam os títulos que geraram.
  const purchaseByBill = new Map<string, string>();
  for (const [purchaseId, purchase] of data.purchases) {
    for (const bill of asArray(purchase.bills)) {
      const billId = text(asObject(bill).billId);
      if (billId) purchaseByBill.set(billId, purchaseId);
    }
  }
  const receiptByBill = new Map<string, string>();
  for (const [receiptId, receipt] of data.receipts) {
    for (const bill of asArray(receipt.bills)) {
      const billId = text(asObject(bill).billId);
      if (billId) receiptByBill.set(billId, receiptId);
    }
  }
  const invoiceByBill = new Map<string, string>();
  for (const [invoiceId, invoice] of data.invoices) {
    for (const duplicate of asArray(asObject(invoice.bill).duplicates)) {
      const billId = text(asObject(duplicate).billId);
      if (billId) invoiceByBill.set(billId, invoiceId);
    }
  }
  const purchaseByReceipt = new Map<string, string>();
  const purchaseByInvoice = new Map<string, string>();
  for (const [purchaseId, purchase] of data.purchases) {
    const receiptId = text(purchase.receiptId);
    const invoiceId = text(purchase.xmlInvoiceId);
    if (receiptId) purchaseByReceipt.set(receiptId, purchaseId);
    if (invoiceId) purchaseByInvoice.set(invoiceId, purchaseId);
  }
  const contractIds = new Set(data.contracts.keys());
  const measurementIds = new Set(data.measurements.keys());
  // Contrato por fornecedor + item do acompanhamento (vínculo inferido: o Koper não devolve
  // o id do contrato na ordem de serviço).
  const contractBySupplierItem = new Map<string, string>();
  for (const [contractId, contract] of data.contracts) {
    const supplierId = text(contract.supplierId);
    for (const service of asArray(contract.services)) {
      const itemId = text(asObject(service).itemMonitoringId);
      if (supplierId && itemId) contractBySupplierItem.set(`${supplierId}:${itemId}`, contractId);
    }
  }
  const measuredContracts = new Set([...data.measurements.values()].map((row) => text(row.contractId)).filter((id): id is string => id !== null));
  const release = { receiptsWithRelease: 0, releaseIdIsMeasurement: 0, stageReleaseIdIsMeasurement: 0 };
  for (const receipt of data.receipts.values()) {
    const releaseId = text(receipt.fncReleaseId);
    const stageReleaseId = text(receipt.fncStageReleaseId);
    if (!releaseId && !stageReleaseId) continue;
    release.receiptsWithRelease += 1;
    if (releaseId && measurementIds.has(releaseId)) release.releaseIdIsMeasurement += 1;
    if (stageReleaseId && measurementIds.has(stageReleaseId)) release.stageReleaseIdIsMeasurement += 1;
  }

  const byDocument = new Map<string, Bucket>();
  const byEvidence = new Map<string, Bucket>();
  const byDocumentEvidence = new Map<string, Bucket>();
  const reach = new Map<string, Bucket>();
  const byCostCenter = new Map<string, Bucket>();
  const skipped = new Map<string, Bucket>();
  const noEvidenceExamples: string[] = [];
  let considered = 0;
  let consideredCents = 0;

  for (const [billId, bill] of data.bills) {
    const valueCents = cents(bill.billValue);
    const detail = data.billDetails.get(billId);
    if (!detail) { bump(skipped, "sem detalhe", valueCents); continue; }
    const billType = text(detail.bill_type);
    if (billType === "Grupo") { bump(skipped, "pai de agrupamento", valueCents); continue; }
    if (billType === "Crédito") { bump(skipped, "crédito de fornecedor", valueCents); continue; }
    considered += 1;
    consideredCents += valueCents;

    const origins = asObject(detail.origins);
    const receiptId = text(origins.receipt_id) ?? receiptByBill.get(billId) ?? null;
    const invoiceId = text(origins.invoice_id) ?? invoiceByBill.get(billId) ?? null;
    const receipt = receiptId ? data.receipts.get(receiptId) : undefined;
    const invoice = invoiceId ? data.invoices.get(invoiceId) : undefined;
    const purchaseId = purchaseByBill.get(billId)
      ?? (receipt ? text(receipt.purchaseId) : null)
      ?? (receiptId ? purchaseByReceipt.get(receiptId) : undefined)
      ?? (invoiceId ? purchaseByInvoice.get(invoiceId) : undefined)
      ?? null;
    const purchase = purchaseId ? data.purchases.get(purchaseId) : undefined;

    const document = invoiceId ? "nota eletrônica"
      : receiptId ? "nota manual / recibo"
        : text(origins.tax_id) ? "tributo"
          : text(origins.payroll_id) ? "folha"
            : text(origins.sales_id) ? "venda / devolução"
              : text(origins.commission_id) ? "comissão"
                : "sem documento";

    // Ordens de compra e de serviço ligadas ao título.
    const purchaseOrderIds = new Set<string>();
    for (const order of asArray(purchase?.purchaseOrders)) {
      const id = text(asObject(order).purchaseOrderId) ?? text(asObject(order).orderId);
      if (id) purchaseOrderIds.add(id);
    }
    collectByKeys(invoice?.purchaseOrders, new Set(["orderId", "purchaseOrderId"]), purchaseOrderIds);
    collectByKeys(invoice, PURCHASE_ORDER_KEYS, purchaseOrderIds);
    for (const order of asArray(origins.orders)) {
      const id = typeof order === "object" ? text(asObject(order).orderId) ?? text(asObject(order).purchaseOrderId) : text(order);
      if (id) purchaseOrderIds.add(id);
    }
    const serviceOrderIds = new Set<string>();
    const directServiceOrder = text(origins.service_order_id);
    if (directServiceOrder) serviceOrderIds.add(directServiceOrder);
    for (const source of [purchase?.servicesOrders, receipt?.servicesOrders]) {
      for (const order of asArray(source)) {
        const id = typeof order === "object" ? text(asObject(order).orderId) ?? text(asObject(order).serviceOrderId) : text(order);
        if (id) serviceOrderIds.add(id);
      }
    }
    collectByKeys([purchase, receipt], SERVICE_ORDER_KEYS, serviceOrderIds);

    const orderDetails = [...purchaseOrderIds].map((id) => data.purchaseOrders.get(id)).filter((item): item is Json => item !== undefined);
    const serviceOrderDetails = [...serviceOrderIds].map((id) => data.serviceOrders.get(id)).filter((item): item is Json => item !== undefined);

    // Solicitações de material citadas nas ordens de compra.
    const requestIds = new Set<string>();
    for (const order of orderDetails) {
      for (const product of asArray(order.products)) collectByKeys(asObject(product).requests, REQUEST_KEYS, requestIds);
    }
    const requestDetails = [...requestIds].map((id) => data.requests.get(id)).filter((item): item is Json => item !== undefined);

    const chain: unknown[] = [purchase, receipt, invoice, ...orderDetails, ...serviceOrderDetails, ...requestDetails];
    const contractRefs = collectByKeys(chain, CONTRACT_KEYS);
    const contractsFound = [...contractRefs].filter((id) => contractIds.has(id));
    const measurementRefs = collectByKeys(chain, MEASUREMENT_KEYS);
    for (const id of contractsFound) chain.push(data.contracts.get(id));

    const budgetItems = collectByKeys(chain, BUDGET_ITEM_KEYS);
    const services = collectByKeys(chain, SERVICE_KEYS);
    const monitorings = collectByKeys([...chain, origins], MONITORING_KEYS);

    const evidence = budgetItems.size > 0 ? "item do orçamento"
      : services.size > 0 ? "serviço"
        : monitorings.size > 0 ? "só obra"
          : "nenhuma";

    bump(byDocument, document, valueCents);
    bump(byEvidence, evidence, valueCents);
    bump(byDocumentEvidence, `${document} → ${evidence}`, valueCents);
    const costCenter = asObject(detail.cost_center);
    bump(byCostCenter, `${text(costCenter.id) ?? "sem"} → ${evidence}`, valueCents);

    if (purchase) bump(reach, "chega à compra", valueCents);
    if (orderDetails.length) bump(reach, "chega à ordem de compra", valueCents);
    if (requestDetails.length) bump(reach, "chega à solicitação de material", valueCents);
    if (purchaseOrderIds.size && !orderDetails.length) bump(reach, "cita ordem de compra que não está na staging", valueCents);
    if (requestIds.size && !requestDetails.length) bump(reach, "cita solicitação que não está na staging", valueCents);
    if (serviceOrderDetails.length) bump(reach, "chega à ordem de serviço", valueCents);
    if (serviceOrderIds.size && !serviceOrderDetails.length) bump(reach, "cita ordem de serviço que não está na staging", valueCents);
    if (contractsFound.length) bump(reach, "chega ao contrato", valueCents);
    const inferredContracts = new Set<string>();
    for (const order of serviceOrderDetails) {
      const supplierId = text(order.supplierId);
      for (const service of asArray(order.services)) {
        const itemId = text(asObject(service).itemMonitoringId);
        const contractId = supplierId && itemId ? contractBySupplierItem.get(`${supplierId}:${itemId}`) : undefined;
        if (contractId) inferredContracts.add(contractId);
      }
    }
    if (inferredContracts.size) bump(reach, "ordem de serviço bate com contrato (fornecedor + item)", valueCents);
    if ([...inferredContracts].some((id) => measuredContracts.has(id))) bump(reach, "contrato inferido tem medição", valueCents);
    if (measurementRefs.size) bump(reach, "cita medição / liberação", valueCents);
    if (evidence === "nenhuma" && noEvidenceExamples.length < 15) noEvidenceExamples.push(`${billId}:${document}`);
  }

  return {
    titles: data.bills.size,
    considered,
    consideredTotal: money(consideredCents),
    skipped: dump(skipped),
    byDocument: dump(byDocument),
    byEvidence: dump(byEvidence),
    byDocumentEvidence: dump(byDocumentEvidence),
    reach: dump(reach),
    byCostCenterEvidence: dump(byCostCenter),
    release,
    noEvidenceExamples,
  };
}

/** Estrutura (só nomes de campos) dos elos, a partir do primeiro registro "cheio" de cada um. */
function structures(data: ChainData): Json {
  const firstWith = (map: Map<string, Json>, pick: (row: Json) => unknown): string[] => {
    for (const row of map.values()) {
      const value = pick(row);
      if (Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== "") return [...fieldPaths(value)].slice(0, 60);
    }
    return [];
  };
  return {
    serviceOrderServices: firstWith(data.serviceOrders, (row) => row.services),
    serviceOrderInvoices: firstWith(data.serviceOrders, (row) => row.invoices),
    serviceOrderTop: firstWith(data.serviceOrders, (row) => ({ ...row, services: undefined, invoices: undefined, files: undefined, addressSupplier: undefined, address: undefined })),
    purchaseServicesOrders: firstWith(data.purchases, (row) => row.servicesOrders),
    receiptServicesOrders: firstWith(data.receipts, (row) => row.servicesOrders),
    receiptServices: firstWith(data.receipts, (row) => row.services),
    purchaseOrderProductRequests: firstWith(data.purchaseOrders, (row) => asArray(row.products).flatMap((product) => asArray(asObject(product).requests))),
    purchaseOrderProductServices: firstWith(data.purchaseOrders, (row) => asArray(row.products).flatMap((product) => asArray(asObject(product).services))),
    invoicePurchaseOrders: firstWith(data.invoices, (row) => row.purchaseOrders),
    invoiceProductApportionment: firstWith(data.invoices, (row) => asArray(row.products).map((product) => asObject(product).apportionment).filter((item) => item !== null && item !== undefined)),
    billOriginOrders: firstWith(data.billDetails, (row) => asObject(row.origins).orders),
    contractServices: firstWith(data.contracts, (row) => row.services),
    measurementTop: firstWith(data.measurements, (row) => row),
  };
}

export async function auditAppropriationChain(companies: Company[], request: Requester = requestSupabase) {
  for (const company of companies) {
    const started = Date.now();
    const [bills, billDetails, purchases, receipts, invoices, purchaseOrders, serviceOrders, requests, contracts, measurements] = [
      await stage(request, "mirror.bill_to_pay", company),
      await stage(request, "mirror.bill_to_pay_detail", company),
      await stage(request, "mirror.purchase_detail", company),
      await stage(request, "mirror.receipt", company),
      await stage(request, "mirror.xml_invoice", company),
      await stage(request, "mirror.purchase_order_detail", company),
      await stage(request, "mirror.service_order_detail", company),
      await stage(request, "mirror.stock_request_detail", company),
      await stage(request, "mirror.engineering_contract_detail", company),
      await stage(request, "mirror.build_measurement_detail", company),
    ];
    const data: ChainData = { bills, billDetails, purchases, receipts, invoices, purchaseOrders, serviceOrders, requests, contracts, measurements };
    const loaded = {
      bills: bills.size, billDetails: billDetails.size, purchases: purchases.size, receipts: receipts.size, invoices: invoices.size,
      purchaseOrders: purchaseOrders.size, serviceOrders: serviceOrders.size, requests: requests.size, contracts: contracts.size, measurements: measurements.size,
    };
    console.log("KOPER_CHAIN_AUDIT", JSON.stringify({ company, loaded, ...measureChain(data), seconds: Math.round((Date.now() - started) / 1000) }));
    console.log("KOPER_CHAIN_STRUCTURE", JSON.stringify({ company, ...structures(data) }));
  }
  console.log("KOPER_CHAIN_AUDIT_DONE", JSON.stringify({ companies }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const all: Company[] = ["bossa", "flow", "alma"];
  const wanted = (process.env.KOPER_AUDIT_COMPANIES ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const companies = wanted.length ? all.filter((company) => wanted.includes(company)) : all;
  auditAppropriationChain(companies).catch((error: unknown) => {
    console.error("KOPER_CHAIN_AUDIT_FAILED", JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }));
    process.exitCode = 1;
  });
}
