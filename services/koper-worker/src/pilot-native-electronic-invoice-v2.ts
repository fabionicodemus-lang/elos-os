import { createHash } from "node:crypto";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";

type Json = Record<string, unknown>;
type Stage = { koper_id: string; koper_parent_id: string | null; payload: unknown };

type Order = {
  id: string; source_id: string; supplier_id: string; project_id: string;
  order_number: string; invoiced_amount: number;
};

type OrderItem = {
  id: string; order_id: string; input_id: string; source_id: string | null;
  ordered_quantity: number; unit_price: number; delivered_unit_cost: number;
};

type Receipt = { id: string; order_id: string; receipt_number: string; notes: string | null };
type ReceiptItem = {
  id: string; receipt_id: string; order_item_id: string; input_id: string;
  accepted_quantity: number; unit_cost: number;
};
type Input = { id: string; source_id: string | null; description: string; unit: string };
type Supplier = { id: string; source_id: string | null; legal_name: string; trade_name: string | null; tax_id: string | null };

const object = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {};

const id = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const num = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};

function stableUuid(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0, 32), "hex");
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function syntheticAccessKey(sourceInvoiceId: string): string {
  const hex = createHash("sha256").update(`koper-access-key:${sourceInvoiceId}`).digest("hex");
  const decimal = BigInt(`0x${hex}`).toString(10);
  return decimal.padStart(44, "0").slice(0, 44);
}

function dateOnly(value: unknown): string | null {
  const raw = id(value);
  if (!raw) return null;
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

function timestamp(value: unknown, fallbackDate: string): string {
  const raw = id(value);
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

const sourceProductIds = (payload: Json): string[] => [...new Set([
  id(payload.inputId), id(payload.productId), id(payload.mainProductId), id(payload.genericProdSeq),
].filter((value): value is string => Boolean(value)))];

const close = (left: number, right: number): boolean =>
  Math.abs(left - right) <= Math.max(0.000001, Math.abs(right) * 0.000001);

await import("./index.js");

try {
  if (process.env.KOPER_ELECTRONIC_INVOICE_PILOT_WRITE_ENABLED !== "true") {
    console.log("KOPER_ELECTRONIC_INVOICE_PILOT_V2_SKIPPED", JSON.stringify({ reason: "WRITE_DISABLED" }));
  } else {
    const sourceInvoiceId = "d4360ae6-85f9-11f1-9cb1-86c46e718d59";
    const sourceOrderId = "10455";
    const sourceEntryId = "13373";

    const [invoiceRows, productRows, orders, receipts, suppliers, inputs, actors, allInvoices] = await Promise.all([
      requestSupabase<Stage[]>("koper_staging_records", { query: new URLSearchParams({
        select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper", entity: "eq.xml_invoice", koper_id: `eq.${sourceInvoiceId}`,
        sync_state: "eq.present", limit: "1",
      }) }),
      requestSupabase<Stage[]>("koper_staging_records", { query: new URLSearchParams({
        select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper", entity: "eq.xml_invoice_product", koper_parent_id: `eq.${sourceInvoiceId}`,
        sync_state: "eq.present", order: "koper_id.asc", limit: "100",
      }) }),
      requestSupabase<Order[]>("procurement_purchase_orders", { query: new URLSearchParams({
        select: "id,source_id,supplier_id,project_id,order_number,invoiced_amount",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`, source_system: "eq.koper", source_id: `eq.${sourceOrderId}`, limit: "2",
      }) }),
      requestSupabase<Receipt[]>("procurement_material_receipts", { query: new URLSearchParams({
        select: "id,order_id,receipt_number,notes", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        notes: `like.*Koper stockMovementId=${sourceEntryId}*`, limit: "10",
      }) }),
      readAll<Supplier>("suppliers", {
        select: "id,source_id,legal_name,trade_name,tax_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper", order: "source_id.asc",
      }),
      readAll<Input>("engineering_inputs", {
        select: "id,source_id,description,unit", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source_system: "eq.koper", order: "source_id.asc",
      }),
      requestSupabase<Array<{ user_id: string }>>("company_memberships", { query: new URLSearchParams({
        select: "user_id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, status: "eq.active", order: "created_at.asc", limit: "1",
      }) }),
      readAll<Stage>("koper_staging_records", {
        select: "koper_id,koper_parent_id,payload", company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper", entity: "eq.xml_invoice", sync_state: "eq.present", order: "koper_id.asc",
      }),
    ]);

    const invoiceStage = invoiceRows[0];
    const order = orders[0];
    const receipt = receipts.find((row) => row.order_id === order?.id);
    const actor = actors[0];
    if (!invoiceStage || productRows.length !== 1 || orders.length !== 1 || !order || !receipt || !actor) {
      throw new Error("Pilot invoice context is not uniquely resolvable");
    }

    const invoice = object(invoiceStage.payload);
    const product = object(productRows[0]!.payload);
    const supplier = suppliers.find((row) => row.id === order.supplier_id);
    if (!supplier) throw new Error("Pilot supplier unavailable");

    const inputBySource = new Map(inputs.flatMap((row) => row.source_id ? [[row.source_id, row] as const] : []));
    const inputIds = new Set(sourceProductIds(product).flatMap((sourceId) => {
      const input = inputBySource.get(sourceId);
      return input ? [input.id] : [];
    }));
    const orderItems = await requestSupabase<OrderItem[]>("procurement_purchase_order_items", { query: new URLSearchParams({
      select: "id,order_id,input_id,source_id,ordered_quantity,unit_price,delivered_unit_cost",
      order_id: `eq.${order.id}`, order: "id.asc", limit: "100",
    }) });
    const candidates = orderItems.filter((item) => inputIds.has(item.input_id));
    const sourceGroups = new Map<string, OrderItem[]>();
    for (const item of candidates) {
      const key = id(item.source_id)?.split(":")[0] ?? item.id;
      sourceGroups.set(key, [...(sourceGroups.get(key) ?? []), item]);
    }
    if (sourceGroups.size !== 1 || [...sourceGroups.values()][0]!.length !== 1) {
      throw new Error("Pilot invoice order item is not uniquely resolvable");
    }
    const orderItem = [...sourceGroups.values()][0]![0]!;
    const input = inputs.find((row) => row.id === orderItem.input_id);
    if (!input) throw new Error("Pilot input unavailable");
    const receiptItems = await requestSupabase<ReceiptItem[]>("procurement_material_receipt_items", { query: new URLSearchParams({
      select: "id,receipt_id,order_item_id,input_id,accepted_quantity,unit_cost",
      receipt_id: `eq.${receipt.id}`, order_item_id: `eq.${orderItem.id}`, limit: "10",
    }) });
    if (receiptItems.length !== 1) throw new Error("Pilot receipt item is not uniquely resolvable");
    const receiptItem = receiptItems[0]!;

    const total = object(invoice.total);
    const issueDate = dateOnly(invoice.emitDate);
    const invoiceNumber = id(invoice.invoiceNumber);
    const quantity = num(product.amount) ?? 0;
    const unitPrice = num(product.unitValue) ?? 0;
    const itemTotal = num(product.totalValue) ?? quantity * unitPrice;
    const invoiceTotal = num(total.totalNF) ?? num(total.totalValue) ?? itemTotal;
    if (!issueDate || !invoiceNumber || quantity <= 0 || invoiceTotal <= 0) throw new Error("Pilot fiscal values are invalid");

    const sequenceIndex = allInvoices.findIndex((row) => row.koper_id === sourceInvoiceId);
    if (sequenceIndex < 0) throw new Error("Pilot sequence unavailable");
    const nativeInvoiceId = stableUuid(`elos:koper:electronic-invoice:${sourceInvoiceId}`);
    const nativeItemId = stableUuid(`elos:koper:electronic-invoice:${sourceInvoiceId}:product:${productRows[0]!.koper_id}`);
    const accessKey = syntheticAccessKey(sourceInvoiceId);
    const sourceTimestamp = timestamp(invoice.emitDate, issueDate);
    const now = new Date().toISOString();
    const xmlHash = createHash("sha256").update(JSON.stringify(invoiceStage.payload)).digest("hex");

    const [payablesBefore, divergencesBefore] = await Promise.all([
      readAll<{ id: string }>("payables", { select: "id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
      readAll<{ id: string }>("finance_electronic_invoice_divergences", { select: "id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
    ]);
    const orderInvoicedBefore = Number(order.invoiced_amount ?? 0);

    await requestSupabase("finance_electronic_invoices", {
      method: "POST",
      body: {
        id: nativeInvoiceId,
        company_id: env.BOSSA_COMPANY_ID,
        project_id: order.project_id,
        legal_entity_id: null,
        supplier_id: supplier.id,
        order_id: order.id,
        receipt_id: receipt.id,
        sequence_no: 6_000_000 + sequenceIndex,
        registry_number: `KOPER-NFE-${sourceInvoiceId}`,
        access_key: accessKey,
        model: id(invoice.invoiceType) ?? "KOPER-XML",
        series: null,
        invoice_number: invoiceNumber,
        issue_date: issueDate,
        issue_datetime: sourceTimestamp,
        operation_nature: null,
        issuer_tax_id: supplier.tax_id ?? `KOPER-${supplier.source_id ?? supplier.id}`,
        issuer_name: supplier.legal_name,
        issuer_trade_name: supplier.trade_name,
        issuer_state_registration: null,
        recipient_tax_id: null,
        recipient_name: null,
        products_amount: num(total.totalValue) ?? itemTotal,
        freight_amount: num(total.shippingValue) ?? 0,
        insurance_amount: 0,
        discount_amount: num(total.totalDiscount) ?? 0,
        import_tax_amount: 0,
        ipi_amount: num(total.ipi) ?? 0,
        pis_amount: num(total.pis) ?? 0,
        cofins_amount: num(total.cofins) ?? 0,
        icms_amount: 0,
        other_amount: (num(total.otherValues) ?? 0) + (num(total.st) ?? 0),
        invoice_total: invoiceTotal,
        payment_total: 0,
        item_count: 1,
        mapped_item_count: 1,
        divergence_count: 0,
        xml_storage_path: `koper/xml-invoice/${sourceInvoiceId}`,
        xml_file_name: `${sourceInvoiceId}.json`,
        xml_hash: xmlHash,
        imported_by: actor.user_id,
        imported_at: now,
        created_at: sourceTimestamp,
        updated_at: now,
      },
      prefer: "resolution=merge-duplicates,return=minimal",
      query: new URLSearchParams({ on_conflict: "id" }),
    });

    const mappingStatuses = ["mapped", "matched", "linked", "manual", "unmapped"];
    let acceptedMappingStatus: string | null = null;
    const rejectedStatuses: string[] = [];
    for (const mappingStatus of mappingStatuses) {
      try {
        await requestSupabase("finance_electronic_invoice_items", {
          method: "POST",
          body: {
            id: nativeItemId,
            company_id: env.BOSSA_COMPANY_ID,
            project_id: order.project_id,
            invoice_id: nativeInvoiceId,
            line_number: Number(id(product.numberItem) ?? 1),
            supplier_product_code: id(product.productId) ?? id(product.inputId),
            ean: null,
            description: input.description,
            ncm: null,
            cfop: id(product.invoiceCfop),
            unit_snapshot: id(product.inputUnit) ?? input.unit,
            quantity,
            unit_price: unitPrice,
            gross_amount: quantity * unitPrice,
            discount_amount: Math.max(0, quantity * unitPrice - itemTotal),
            freight_amount: 0,
            other_amount: 0,
            total_amount: itemTotal,
            icms_amount: 0,
            ipi_amount: 0,
            pis_amount: 0,
            cofins_amount: 0,
            input_id: input.id,
            cost_center_service_id: null,
            order_item_id: orderItem.id,
            receipt_item_id: receiptItem.id,
            mapping_status: mappingStatus,
            order_quantity: Number(orderItem.ordered_quantity),
            order_unit_price: Number(orderItem.delivered_unit_cost ?? orderItem.unit_price ?? 0),
            quantity_variance: quantity - Number(receiptItem.accepted_quantity),
            unit_price_variance: unitPrice - Number(orderItem.delivered_unit_cost ?? orderItem.unit_price ?? 0),
            notes: `Importado do Koper · sourceInvoiceProductId=${productRows[0]!.koper_id} · access key técnica`,
            created_at: sourceTimestamp,
            updated_at: now,
            receipt_quantity: Number(receiptItem.accepted_quantity),
            receipt_unit_cost: Number(receiptItem.unit_cost),
            previously_invoiced_quantity: 0,
            invoiceable_quantity: Number(receiptItem.accepted_quantity),
            three_way_status: "pending",
          },
          prefer: "resolution=merge-duplicates,return=minimal",
          query: new URLSearchParams({ on_conflict: "id" }),
        });
        acceptedMappingStatus = mappingStatus;
        break;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown";
        rejectedStatuses.push(`${mappingStatus}:${/23514/.test(message) ? "constraint" : "other"}`);
        if (!/23514/.test(message)) throw error;
      }
    }
    if (!acceptedMappingStatus) throw new Error(`No valid mapping status: ${rejectedStatuses.join(",")}`);

    const [savedInvoices, savedItems, payablesAfter, divergencesAfter, orderAfter] = await Promise.all([
      requestSupabase<Array<{ id: string; status: string; validation_status: string; three_way_status: string; access_key: string }>>(
        "finance_electronic_invoices",
        { query: new URLSearchParams({ select: "id,status,validation_status,three_way_status,access_key", id: `eq.${nativeInvoiceId}`, limit: "1" }) },
      ),
      requestSupabase<Array<{ id: string; mapping_status: string; three_way_status: string; order_item_id: string; receipt_item_id: string }>>(
        "finance_electronic_invoice_items",
        { query: new URLSearchParams({ select: "id,mapping_status,three_way_status,order_item_id,receipt_item_id", invoice_id: `eq.${nativeInvoiceId}`, limit: "10" }) },
      ),
      readAll<{ id: string }>("payables", { select: "id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
      readAll<{ id: string }>("finance_electronic_invoice_divergences", { select: "id", company_id: `eq.${env.BOSSA_COMPANY_ID}`, order: "id.asc" }),
      requestSupabase<Array<{ invoiced_amount: number }>>("procurement_purchase_orders", { query: new URLSearchParams({ select: "invoiced_amount", id: `eq.${order.id}`, limit: "1" }) }),
    ]);

    if (savedInvoices.length !== 1 || savedItems.length !== 1 || !orderAfter[0]) throw new Error("Pilot verification failed");
    if (!/^\d{44}$/.test(savedInvoices[0]!.access_key)) throw new Error("Saved access key is invalid");
    if (!close(orderInvoicedBefore, Number(orderAfter[0].invoiced_amount ?? 0))) throw new Error("Pilot changed order invoiced amount");
    if (payablesBefore.length !== payablesAfter.length) throw new Error("Pilot generated payables");
    if (divergencesBefore.length !== divergencesAfter.length) throw new Error("Pilot generated divergences");

    console.log("KOPER_ELECTRONIC_INVOICE_PILOT_V2_RESULT", JSON.stringify({
      ok: true,
      sourceInvoiceId,
      nativeInvoiceId,
      accessKeyType: "synthetic_44_digit",
      orderNumber: order.order_number,
      receiptNumber: receipt.receipt_number,
      status: savedInvoices[0]!.status,
      validationStatus: savedInvoices[0]!.validation_status,
      threeWayStatus: savedInvoices[0]!.three_way_status,
      mappingStatus: savedItems[0]!.mapping_status,
      itemThreeWayStatus: savedItems[0]!.three_way_status,
      orderLinked: savedItems[0]!.order_item_id === orderItem.id,
      receiptLinked: savedItems[0]!.receipt_item_id === receiptItem.id,
      payablesCreated: 0,
      divergencesCreated: 0,
      orderInvoicedAmountUnchanged: true,
      rejectedMappingStatuses: rejectedStatuses,
    }));
  }
} catch (error: unknown) {
  console.error("KOPER_ELECTRONIC_INVOICE_PILOT_V2_FAILED", {
    message: error instanceof Error ? error.message.slice(0, 1_200) : "unknown",
  });
}
