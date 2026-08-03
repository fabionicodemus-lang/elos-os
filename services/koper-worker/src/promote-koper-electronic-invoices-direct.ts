import { createHash } from "node:crypto";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type Stage = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Order = {
  id: string; source_id: string | null; supplier_id: string; project_id: string;
  order_number: string; invoiced_amount: number;
};
type OrderItem = {
  id: string; order_id: string; input_id: string; source_id: string | null;
  ordered_quantity: number; unit_price: number; delivered_unit_cost: number;
  cost_center_service_id: string | null;
};
type Receipt = { id: string; order_id: string; receipt_number: string; notes: string | null };
type ReceiptItem = {
  id: string; receipt_id: string; order_item_id: string; input_id: string;
  accepted_quantity: number; unit_cost: number;
};
type Input = { id: string; source_id: string | null; description: string; unit: string };
type Supplier = {
  id: string; source_id: string | null; legal_name: string;
  trade_name: string | null; tax_id: string | null;
};

type ResolvedProduct = {
  stage: Stage;
  payload: Json;
  input: Input;
  orderItem: OrderItem;
  receiptItem: ReceiptItem;
  lineNumber: number;
  quantity: number;
  unitPrice: number;
  grossAmount: number;
  totalAmount: number;
};

type InvoicePlan = {
  sourceInvoiceId: string;
  sourceIndex: number;
  stage: Stage;
  payload: Json;
  order: Order;
  receipt: Receipt;
  supplier: Supplier;
  issueDate: string;
  issueTimestamp: string;
  invoiceNumber: string;
  invoiceTotal: number;
  products: ResolvedProduct[];
  nativeInvoiceId: string;
  accessKey: string;
};

const object = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};

const identifier = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const numeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const arrayObjects = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : [];

function uniqueIds(value: unknown, key: string): string[] {
  return [...new Set(arrayObjects(value).flatMap((row) => {
    const found = identifier(row[key]);
    return found ? [found] : [];
  }))];
}

function stableUuid(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0, 32), "hex");
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function syntheticDigits(seed: string, length: number): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  return BigInt(`0x${hex}`).toString(10).padStart(length, "0").slice(0, length);
}

function syntheticAccessKey(sourceInvoiceId: string): string {
  return syntheticDigits(`koper-access-key:${sourceInvoiceId}`, 44);
}

function syntheticTaxId(sourceSupplierId: string): string {
  return syntheticDigits(`koper-tax-id:${sourceSupplierId}`, 14);
}

function dateOnly(value: unknown): string | null {
  const raw = identifier(value);
  if (!raw) return null;
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

function sourceTimestamp(value: unknown, fallbackDate: string): string {
  const raw = identifier(value);
  if (raw) {
    const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  return `${fallbackDate}T12:00:00.000Z`;
}

async function readAll<T>(table: string, query: Record<string, string>): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await requestSupabase<T[]>(table, {
      query: new URLSearchParams({ ...query, limit: "1000", offset: String(offset) }),
    });
    result.push(...page);
    if (page.length < 1_000) return result;
  }
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function quotedIn(values: string[]): string {
  return `in.(${values.map((value) => `"${value.replaceAll("\"", "\\\"")}"`).join(",")})`;
}

function baseSourceId(sourceId: string | null): string | null {
  return identifier(sourceId)?.split(":")[0] ?? null;
}

function entryMarker(notes: string | null): string | null {
  return notes?.match(/Koper stockMovementId=(\d+)/i)?.[1] ?? null;
}

function sourceProductIds(payload: Json): string[] {
  return [...new Set([
    identifier(payload.inputId),
    identifier(payload.productId),
    identifier(payload.mainProductId),
    identifier(payload.genericProdSeq),
  ].filter((value): value is string => Boolean(value)))];
}

function invoiceTotal(payload: Json, products: Stage[]): number | null {
  const total = object(payload.total);
  for (const value of [payload.invoiceTotal, payload.totalValue, total.totalNF, total.totalValue, total.total]) {
    const parsed = numeric(value);
    if (parsed !== null && parsed > 0) return parsed;
  }
  const sum = products.reduce((totalValue, product) => totalValue + Math.max(0, numeric(object(product.payload).totalValue) ?? 0), 0);
  return sum > 0 ? sum : null;
}

function invoiceIdsFromStockItem(payload: Json): string[] {
  const nested = uniqueIds(payload.invoices, "invoiceId");
  if (nested.length > 0) return nested;
  if (!Array.isArray(payload.invoiceIds)) return [];
  return [...new Set(payload.invoiceIds.flatMap((value) => {
    const found = identifier(value);
    return found ? [found] : [];
  }))];
}

function equalNumber(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(0.000001, Math.abs(right) * 0.000001);
}

function summarize(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

async function verifyIds(table: string, ids: string[]): Promise<number> {
  let verified = 0;
  for (const batch of chunks(ids, 100)) {
    if (batch.length === 0) continue;
    const rows = await requestSupabase<Array<{ id: string }>>(table, {
      query: new URLSearchParams({ select: "id", id: quotedIn(batch), limit: String(batch.length + 10) }),
    });
    verified += rows.length;
  }
  return verified;
}

await import("./index.js");

try {
  const writeEnabled = process.env.KOPER_ELECTRONIC_INVOICE_BATCH_WRITE_ENABLED === "true";
  const batchOffset = Math.max(0, Number.parseInt(process.env.KOPER_ELECTRONIC_INVOICE_BATCH_OFFSET ?? "0", 10) || 0);
  const batchSize = Math.min(200, Math.max(1, Number.parseInt(process.env.KOPER_ELECTRONIC_INVOICE_BATCH_SIZE ?? "25", 10) || 25));

  const [invoiceStages, productStages, stockItemStages, orders, orderItems, receipts, receiptItems, inputs, suppliers, actors, existingInvoices] = await Promise.all([
    readAll<Stage>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper", entity: "eq.xml_invoice", sync_state: "eq.present", order: "koper_id.asc",
    }),
    readAll<Stage>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper", entity: "eq.xml_invoice_product", sync_state: "eq.present", order: "koper_parent_id.asc,koper_id.asc",
    }),
    readAll<Stage>("koper_staging_records", {
      select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source: "eq.koper", entity: "eq.stock_entry_item", sync_state: "eq.present", order: "koper_parent_id.asc,koper_id.asc",
    }),
    readAll<Order>("procurement_purchase_orders", {
      select: "id,source_id,supplier_id,project_id,order_number,invoiced_amount",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", order: "source_id.asc",
    }),
    readAll<OrderItem>("procurement_purchase_order_items", {
      select: "id,order_id,input_id,source_id,ordered_quantity,unit_price,delivered_unit_cost,cost_center_service_id",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", order: "order_id.asc,id.asc",
    }),
    readAll<Receipt>("procurement_material_receipts", {
      select: "id,order_id,receipt_number,notes", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc",
    }),
    readAll<ReceiptItem>("procurement_material_receipt_items", {
      select: "id,receipt_id,order_item_id,input_id,accepted_quantity,unit_cost",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "receipt_id.asc,id.asc",
    }),
    readAll<Input>("engineering_inputs", {
      select: "id,source_id,description,unit", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper", order: "source_id.asc",
    }),
    readAll<Supplier>("suppliers", {
      select: "id,source_id,legal_name,trade_name,tax_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper", order: "source_id.asc",
    }),
    requestSupabase<Array<{ user_id: string }>>("company_memberships", { query: new URLSearchParams({
      select: "user_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, status: "eq.active", order: "created_at.asc", limit: "1",
    }) }),
    readAll<{ id: string; access_key: string; registry_number: string }>("finance_electronic_invoices", {
      select: "id,access_key,registry_number", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc",
    }),
  ]);

  const actor = actors[0];
  if (!actor) throw new Error("No active company actor available");

  const productsByInvoice = new Map<string, Stage[]>();
  for (const product of productStages) {
    if (!product.koper_parent_id) continue;
    productsByInvoice.set(product.koper_parent_id, [...(productsByInvoice.get(product.koper_parent_id) ?? []), product]);
  }

  const entryIdsByInvoice = new Map<string, Set<string>>();
  for (const stockItem of stockItemStages) {
    if (!stockItem.koper_parent_id) continue;
    for (const invoiceId of invoiceIdsFromStockItem(object(stockItem.payload))) {
      const entries = entryIdsByInvoice.get(invoiceId) ?? new Set<string>();
      entries.add(stockItem.koper_parent_id);
      entryIdsByInvoice.set(invoiceId, entries);
    }
  }

  const orderBySource = new Map(orders.flatMap((order) => order.source_id ? [[order.source_id, order] as const] : []));
  const orderItemsByOrder = new Map<string, OrderItem[]>();
  for (const item of orderItems) orderItemsByOrder.set(item.order_id, [...(orderItemsByOrder.get(item.order_id) ?? []), item]);
  const inputBySource = new Map(inputs.flatMap((input) => input.source_id ? [[input.source_id, input] as const] : []));
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

  const receiptsByEntry = new Map<string, Receipt[]>();
  for (const receipt of receipts) {
    const entryId = entryMarker(receipt.notes);
    if (!entryId) continue;
    receiptsByEntry.set(entryId, [...(receiptsByEntry.get(entryId) ?? []), receipt]);
  }
  const receiptItemsByReceipt = new Map<string, ReceiptItem[]>();
  for (const item of receiptItems) receiptItemsByReceipt.set(item.receipt_id, [...(receiptItemsByReceipt.get(item.receipt_id) ?? []), item]);

  const exclusions: string[] = [];
  const examples: Array<{ invoiceId: string; reason: string }> = [];
  const plans: InvoicePlan[] = [];

  for (let sourceIndex = 0; sourceIndex < invoiceStages.length; sourceIndex += 1) {
    const stage = invoiceStages[sourceIndex]!;
    const payload = object(stage.payload);
    const productRows = productsByInvoice.get(stage.koper_id) ?? [];
    let reason: string | null = null;

    const sourceOrderIds = uniqueIds(payload.purchaseOrders, "purchaseOrderId");
    const nativeOrders = [...new Map(sourceOrderIds.flatMap((sourceId) => {
      const order = orderBySource.get(sourceId);
      return order ? [[order.id, order] as const] : [];
    })).values()];
    if (nativeOrders.length === 0) reason = "missing_order";
    else if (nativeOrders.length > 1) reason = "multiple_orders";
    const order = nativeOrders[0];

    const supplier = order ? supplierById.get(order.supplier_id) : null;
    if (!reason && !supplier) reason = "missing_supplier";

    const entryIds = [...(entryIdsByInvoice.get(stage.koper_id) ?? new Set<string>())];
    const candidateReceipts = order
      ? entryIds.flatMap((entryId) => (receiptsByEntry.get(entryId) ?? []).filter((receipt) => receipt.order_id === order.id))
      : [];
    const uniqueReceipts = [...new Map(candidateReceipts.map((receipt) => [receipt.id, receipt])).values()];
    if (!reason && uniqueReceipts.length === 0) reason = "missing_receipt";
    else if (!reason && uniqueReceipts.length > 1) reason = "multiple_receipts";
    const receipt = uniqueReceipts[0];

    const issueDate = dateOnly(payload.emitDate);
    const invoiceNumber = identifier(payload.invoiceNumber);
    const totalValue = invoiceTotal(payload, productRows);
    if (!reason && !issueDate) reason = "invalid_issue_date";
    if (!reason && !invoiceNumber) reason = "missing_invoice_number";
    if (!reason && totalValue === null) reason = "invalid_invoice_total";
    if (!reason && productRows.length === 0) reason = "missing_products";

    const resolvedProducts: ResolvedProduct[] = [];
    if (!reason && order && receipt) {
      const candidateOrderItems = orderItemsByOrder.get(order.id) ?? [];
      const candidateReceiptItems = receiptItemsByReceipt.get(receipt.id) ?? [];
      const usedLineNumbers = new Set<number>();

      for (let productIndex = 0; productIndex < productRows.length; productIndex += 1) {
        const productStage = productRows[productIndex]!;
        const product = object(productStage.payload);
        const nativeInputIds = new Set(sourceProductIds(product).flatMap((sourceId) => {
          const input = inputBySource.get(sourceId);
          return input ? [input.id] : [];
        }));
        if (nativeInputIds.size === 0) { reason = "missing_product_input"; break; }

        const sourceOrderItemId = identifier(product.orderProductId) ?? identifier(product.purchaseOrderItemId);
        const orderCandidates = candidateOrderItems.filter((item) => {
          if (sourceOrderItemId && baseSourceId(item.source_id) === sourceOrderItemId) return true;
          return nativeInputIds.has(item.input_id);
        });
        const sourceGroups = new Map<string, OrderItem[]>();
        for (const item of orderCandidates) {
          const groupKey = baseSourceId(item.source_id) ?? item.id;
          sourceGroups.set(groupKey, [...(sourceGroups.get(groupKey) ?? []), item]);
        }
        if (sourceGroups.size === 0) { reason = "missing_order_item"; break; }
        if (sourceGroups.size > 1) { reason = "ambiguous_order_item"; break; }
        const sourceGroup = [...sourceGroups.values()][0]!;
        if (sourceGroup.length !== 1) { reason = "allocation_split"; break; }
        const orderItem = sourceGroup[0]!;

        const matchingReceiptItems = candidateReceiptItems.filter((item) => item.order_item_id === orderItem.id);
        if (matchingReceiptItems.length === 0) { reason = "missing_receipt_item"; break; }
        if (matchingReceiptItems.length > 1) { reason = "ambiguous_receipt_item"; break; }
        const receiptItem = matchingReceiptItems[0]!;
        const input = inputs.find((row) => row.id === orderItem.input_id);
        if (!input) { reason = "missing_native_input"; break; }

        const quantity = numeric(product.amount) ?? 0;
        const unitPrice = numeric(product.unitValue) ?? 0;
        const totalAmount = numeric(product.totalValue) ?? quantity * unitPrice;
        const grossAmount = quantity * unitPrice;
        if (quantity <= 0 || unitPrice < 0 || totalAmount < 0) { reason = "invalid_product_values"; break; }

        const requestedLine = Number.parseInt(identifier(product.numberItem) ?? String(productIndex + 1), 10);
        const lineNumber = Number.isInteger(requestedLine) && requestedLine > 0 ? requestedLine : productIndex + 1;
        if (usedLineNumbers.has(lineNumber)) { reason = "duplicate_line_number"; break; }
        usedLineNumbers.add(lineNumber);

        resolvedProducts.push({
          stage: productStage,
          payload: product,
          input,
          orderItem,
          receiptItem,
          lineNumber,
          quantity,
          unitPrice,
          grossAmount,
          totalAmount,
        });
      }
    }

    if (!reason && resolvedProducts.length !== productRows.length) reason = "unresolved_products";

    if (reason || !order || !receipt || !supplier || !issueDate || !invoiceNumber || totalValue === null) {
      exclusions.push(reason ?? "unknown");
      if (examples.length < 40) examples.push({ invoiceId: stage.koper_id, reason: reason ?? "unknown" });
      continue;
    }

    plans.push({
      sourceInvoiceId: stage.koper_id,
      sourceIndex,
      stage,
      payload,
      order,
      receipt,
      supplier,
      issueDate,
      issueTimestamp: sourceTimestamp(payload.emitDate, issueDate),
      invoiceNumber,
      invoiceTotal: totalValue,
      products: resolvedProducts,
      nativeInvoiceId: stableUuid(`elos:koper:electronic-invoice:${stage.koper_id}`),
      accessKey: syntheticAccessKey(stage.koper_id),
    });
  }

  const selected = plans.slice(batchOffset, batchOffset + batchSize);
  const totalItems = plans.reduce((sum, plan) => sum + plan.products.length, 0);

  if (!writeEnabled) {
    console.log("KOPER_ELECTRONIC_INVOICE_BATCH_PLAN", JSON.stringify({
      ok: true,
      writeEnabled: false,
      source: {
        invoices: invoiceStages.length,
        products: productStages.length,
        stockEntryItems: stockItemStages.length,
      },
      eligibility: {
        safeInvoices: plans.length,
        safeItems: totalItems,
        excludedInvoices: invoiceStages.length - plans.length,
        exclusions: summarize(exclusions),
      },
      idempotency: {
        existingNativeInvoices: existingInvoices.length,
      },
      batch: {
        offset: batchOffset,
        size: batchSize,
        selectedInvoices: selected.length,
        selectedItems: selected.reduce((sum, plan) => sum + plan.products.length, 0),
        firstInvoiceId: selected[0]?.sourceInvoiceId ?? null,
        lastInvoiceId: selected.at(-1)?.sourceInvoiceId ?? null,
        nextOffset: batchOffset + selected.length,
        complete: batchOffset + selected.length >= plans.length,
      },
      examples,
    }));
  } else if (selected.length === 0) {
    console.log("KOPER_ELECTRONIC_INVOICE_BATCH_RESULT", JSON.stringify({
      ok: true, selectedInvoices: 0, selectedItems: 0,
      nextOffset: batchOffset, complete: true,
    }));
  } else {
    const affectedOrderIds = [...new Set(selected.map((plan) => plan.order.id))];
    const beforeOrderAmounts = new Map(orders.filter((order) => affectedOrderIds.includes(order.id)).map((order) => [order.id, Number(order.invoiced_amount ?? 0)]));
    const [payablesBefore, divergencesBefore, installmentsBefore] = await Promise.all([
      readAll<{ id: string }>("payables", { select: "id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
      readAll<{ id: string }>("finance_electronic_invoice_divergences", { select: "id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
      readAll<{ id: string }>("finance_electronic_invoice_installments", { select: "id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
    ]);

    const now = new Date().toISOString();
    const headers = selected.map((plan) => {
      const total = object(plan.payload.total);
      return {
        id: plan.nativeInvoiceId,
        company_id: env.BOSSA_COMPANY_ID,
        project_id: plan.order.project_id,
        legal_entity_id: null,
        supplier_id: plan.supplier.id,
        order_id: plan.order.id,
        receipt_id: plan.receipt.id,
        sequence_no: 6_000_000 + plan.sourceIndex,
        registry_number: `KOPER-NFE-${plan.sourceInvoiceId}`,
        access_key: plan.accessKey,
        model: identifier(plan.payload.invoiceType) ?? "KOPER-XML",
        series: null,
        invoice_number: plan.invoiceNumber,
        issue_date: plan.issueDate,
        issue_datetime: plan.issueTimestamp,
        operation_nature: null,
        issuer_tax_id: plan.supplier.tax_id ?? syntheticTaxId(plan.supplier.source_id ?? plan.supplier.id),
        issuer_name: plan.supplier.legal_name,
        issuer_trade_name: plan.supplier.trade_name,
        issuer_state_registration: null,
        recipient_tax_id: null,
        recipient_name: null,
        products_amount: numeric(total.totalValue) ?? plan.products.reduce((sum, product) => sum + product.totalAmount, 0),
        freight_amount: numeric(total.shippingValue) ?? 0,
        insurance_amount: 0,
        discount_amount: numeric(total.totalDiscount) ?? 0,
        import_tax_amount: 0,
        ipi_amount: numeric(total.ipi) ?? 0,
        pis_amount: numeric(total.pis) ?? 0,
        cofins_amount: numeric(total.cofins) ?? 0,
        icms_amount: 0,
        other_amount: (numeric(total.otherValues) ?? 0) + (numeric(total.st) ?? 0),
        invoice_total: plan.invoiceTotal,
        payment_total: 0,
        item_count: plan.products.length,
        mapped_item_count: plan.products.length,
        divergence_count: 0,
        xml_storage_path: `koper/xml-invoice/${plan.sourceInvoiceId}`,
        xml_file_name: `${plan.sourceInvoiceId}.json`,
        xml_hash: createHash("sha256").update(JSON.stringify(plan.stage.payload)).digest("hex"),
        imported_by: actor.user_id,
        imported_at: now,
        created_at: plan.issueTimestamp,
        updated_at: now,
      };
    });

    const items = selected.flatMap((plan) => plan.products.map((product) => ({
      id: stableUuid(`elos:koper:electronic-invoice:${plan.sourceInvoiceId}:product:${product.stage.koper_id}`),
      company_id: env.BOSSA_COMPANY_ID,
      project_id: plan.order.project_id,
      invoice_id: plan.nativeInvoiceId,
      line_number: product.lineNumber,
      supplier_product_code: identifier(product.payload.productId) ?? identifier(product.payload.inputId),
      ean: null,
      description: product.input.description,
      ncm: null,
      cfop: identifier(product.payload.invoiceCfop),
      unit_snapshot: identifier(product.payload.inputUnit) ?? product.input.unit,
      quantity: product.quantity,
      unit_price: product.unitPrice,
      gross_amount: product.grossAmount,
      discount_amount: Math.max(0, product.grossAmount - product.totalAmount),
      freight_amount: 0,
      other_amount: 0,
      total_amount: product.totalAmount,
      icms_amount: 0,
      ipi_amount: 0,
      pis_amount: 0,
      cofins_amount: 0,
      input_id: product.input.id,
      cost_center_service_id: product.orderItem.cost_center_service_id,
      order_item_id: product.orderItem.id,
      receipt_item_id: product.receiptItem.id,
      mapping_status: "matched",
      order_quantity: Number(product.orderItem.ordered_quantity),
      order_unit_price: Number(product.orderItem.delivered_unit_cost ?? product.orderItem.unit_price ?? 0),
      quantity_variance: product.quantity - Number(product.receiptItem.accepted_quantity),
      unit_price_variance: product.unitPrice - Number(product.orderItem.delivered_unit_cost ?? product.orderItem.unit_price ?? 0),
      notes: `Importado do Koper · sourceInvoiceProductId=${product.stage.koper_id} · access key técnica`,
      created_at: plan.issueTimestamp,
      updated_at: now,
      receipt_quantity: Number(product.receiptItem.accepted_quantity),
      receipt_unit_cost: Number(product.receiptItem.unit_cost),
      previously_invoiced_quantity: 0,
      invoiceable_quantity: Number(product.receiptItem.accepted_quantity),
      three_way_status: "pending",
    })));

    for (const batch of chunks(headers, 100)) await requestSupabase("finance_electronic_invoices", {
      method: "POST", body: batch,
      prefer: "resolution=merge-duplicates,return=minimal",
      query: new URLSearchParams({ on_conflict: "id" }),
    });
    for (const batch of chunks(items, 100)) await requestSupabase("finance_electronic_invoice_items", {
      method: "POST", body: batch,
      prefer: "resolution=merge-duplicates,return=minimal",
      query: new URLSearchParams({ on_conflict: "id" }),
    });

    const [verifiedInvoices, verifiedItems, savedInvoices, savedItems, payablesAfter, divergencesAfter, installmentsAfter, affectedOrdersAfter] = await Promise.all([
      verifyIds("finance_electronic_invoices", headers.map((row) => row.id)),
      verifyIds("finance_electronic_invoice_items", items.map((row) => row.id)),
      requestSupabase<Array<{ id: string; status: string; validation_status: string; three_way_status: string }>>("finance_electronic_invoices", {
        query: new URLSearchParams({
          select: "id,status,validation_status,three_way_status",
          id: quotedIn(headers.map((row) => row.id)), limit: String(headers.length + 10),
        }),
      }),
      requestSupabase<Array<{ id: string; mapping_status: string; three_way_status: string }>>("finance_electronic_invoice_items", {
        query: new URLSearchParams({
          select: "id,mapping_status,three_way_status",
          invoice_id: quotedIn(headers.map((row) => row.id)), limit: String(items.length + 10),
        }),
      }),
      readAll<{ id: string }>("payables", { select: "id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
      readAll<{ id: string }>("finance_electronic_invoice_divergences", { select: "id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
      readAll<{ id: string }>("finance_electronic_invoice_installments", { select: "id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
      requestSupabase<Order[]>("procurement_purchase_orders", {
        query: new URLSearchParams({
          select: "id,source_id,supplier_id,project_id,order_number,invoiced_amount",
          id: quotedIn(affectedOrderIds), limit: String(affectedOrderIds.length + 10),
        }),
      }),
    ]);

    if (verifiedInvoices !== headers.length || verifiedItems !== items.length) {
      throw new Error(`Invoice verification failed: ${verifiedInvoices}/${headers.length}, ${verifiedItems}/${items.length}`);
    }
    if (payablesAfter.length !== payablesBefore.length) throw new Error("Electronic invoice batch generated payables");
    if (installmentsAfter.length !== installmentsBefore.length) throw new Error("Electronic invoice batch generated installments");
    for (const order of affectedOrdersAfter) {
      const before = beforeOrderAmounts.get(order.id);
      if (before === undefined || !equalNumber(before, Number(order.invoiced_amount ?? 0))) {
        throw new Error(`Electronic invoice batch changed order ${order.id} invoiced amount`);
      }
    }

    const nextOffset = batchOffset + selected.length;
    console.log("KOPER_ELECTRONIC_INVOICE_BATCH_RESULT", JSON.stringify({
      ok: true,
      batchOffset,
      batchSize,
      totalSafeInvoices: plans.length,
      totalSafeItems: totalItems,
      selectedInvoices: headers.length,
      selectedItems: items.length,
      verifiedInvoices,
      verifiedItems,
      affectedOrders: affectedOrderIds.length,
      invoiceStatuses: summarize(savedInvoices.map((row) => row.status)),
      validationStatuses: summarize(savedInvoices.map((row) => row.validation_status)),
      invoiceThreeWayStatuses: summarize(savedInvoices.map((row) => row.three_way_status)),
      itemMappingStatuses: summarize(savedItems.map((row) => row.mapping_status)),
      itemThreeWayStatuses: summarize(savedItems.map((row) => row.three_way_status)),
      payablesCreated: 0,
      installmentsCreated: 0,
      divergencesCreated: divergencesAfter.length - divergencesBefore.length,
      orderInvoicedAmountsUnchanged: true,
      nextOffset,
      complete: nextOffset >= plans.length,
    }));
  }
} catch (error: unknown) {
  console.error("KOPER_ELECTRONIC_INVOICE_BATCH_FAILED", {
    message: error instanceof Error ? error.message.slice(0, 1_400) : "unknown",
  });
}
