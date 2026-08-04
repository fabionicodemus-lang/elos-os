import { createHash } from "node:crypto";
import type { Response } from "playwright-core";
import { env } from "./config/env.js";
import { requestSupabase } from "./elos/supabase.js";
import { performKoperLogin } from "./auth/koper-auto-login.js";
import { withBrowserless } from "./browser/browserless.js";
import { isAllowedFlowSwitch } from "./diagnostics/inspect-koper-engineering.js";
import { selectFlow } from "./diagnostics/collect-flow-stock-requests.js";

type Json = Record<string, unknown>;
type StagingRow = { koper_id: string; koper_parent_id: string | null; payload: unknown };
type Order = {
  id: string;
  source_id: string;
  supplier_id: string;
  project_id: string;
  order_number: string;
  status: string;
  received_amount: number;
};
type OrderItem = {
  id: string;
  order_id: string;
  input_id: string;
  source_id: string | null;
  input_code: string;
  input_name: string;
  unit_snapshot: string;
  cost_center_service_id: string | null;
  cost_center_code: string;
  cost_center_name: string;
  ordered_quantity: number;
  received_quantity: number;
  accepted_quantity: number;
  rejected_quantity: number;
  unit_price: number;
  delivered_unit_cost: number;
};
type Actor = { user_id: string };
type ExistingReceipt = {
  id: string;
  receipt_date: string;
  created_at: string;
  notes: string | null;
};
type ExistingReceiptItem = {
  receipt_id: string;
  order_item_id: string;
  accepted_quantity: number;
};
type Allocation = {
  orderId: string | null;
  orderProductId: string | null;
  productAmount: number | null;
  amountReceived: number | null;
  amount: number | null;
};
type FinancialProduct = {
  receiptId: string;
  receiptProductId: string | null;
  productId: string | null;
  mainProductId: string | null;
  genericProdSeq: string | null;
  inputId: string | null;
  productAmount: number | null;
  price: number | null;
  orders: Allocation[];
};
type FinancialReceipt = {
  receiptId: string;
  receiptNumber: string | null;
  receiptEmitDate: string | null;
  totalValue: number | null;
  products: FinancialProduct[];
};
type ResolvedItem = {
  entryItemId: string;
  sourcePayload: Json;
  financialProduct: FinancialProduct;
  allocation: Allocation;
  order: Order;
  orderItem: OrderItem;
  quantity: number;
  unitCost: number;
};
type PilotPlan = {
  entryId: string;
  order: Order;
  groupIndex: number;
  receiptId: string;
  receiptNumber: string;
  sequenceNo: number;
  receiptDate: string;
  receiptTimestamp: string;
  financialReceiptIds: string[];
  financialReceiptNumbers: string[];
  items: Array<{
    orderItem: OrderItem;
    movementIds: string[];
    deliveredQuantity: number;
    unitCost: number;
    acceptedAmount: number;
    previouslyAcceptedQuantity: number;
  }>;
};

const objectValue = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Json
    : {};

const identifier = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
};

const numberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};

const unique = (values: string[]): string[] => [...new Set(values)];
const approximatelyEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= Math.max(0.000001, Math.abs(right) * 0.000001);
const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function stableUuid(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest("hex").slice(0, 32), "hex");
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function quotedIn(values: string[]): string {
  return `in.(${values.map((value) => `\"${value.replaceAll("\"", "\\\"")}\"`).join(",")})`;
}

function dateOnly(value: unknown): string | null {
  const raw = identifier(value);
  if (!raw) return null;
  const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

function timestamp(value: unknown, fallbackDate: string): string {
  const raw = identifier(value);
  if (raw) {
    const parsed = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  return `${fallbackDate}T12:00:00.000Z`;
}

function baseSourceId(value: string | null): string | null {
  return identifier(value)?.split(":")[0] ?? null;
}

function receiptIds(payload: Json): string[] {
  const receipts = Array.isArray(payload.receipts) ? payload.receipts : [];
  return unique(receipts.flatMap((raw) => {
    const id = identifier(objectValue(raw).receiptId);
    return id ? [id] : [];
  }));
}

function productScore(source: Json, candidate: FinancialProduct): number {
  const productId = identifier(source.productId);
  const mainProductId = identifier(source.mainProductId);
  const genericProdSeq = identifier(source.genericProdSeq);
  const inputId = identifier(source.inputId);
  if (productId && candidate.productId === productId) return 120;
  if (mainProductId && candidate.productId === mainProductId) return 110;
  if (inputId && candidate.inputId === inputId) return 105;
  if (genericProdSeq && candidate.genericProdSeq === genericProdSeq) return 100;
  if (mainProductId && candidate.mainProductId === mainProductId) return 90;
  if (productId && candidate.mainProductId === productId) return 80;
  return 0;
}

function parseFinancialReceipt(receiptId: string, payload: Json): FinancialReceipt {
  const rawProducts = Array.isArray(payload.products) ? payload.products : [];
  return {
    receiptId,
    receiptNumber: identifier(payload.receiptNumber),
    receiptEmitDate: identifier(payload.receiptEmitDate),
    totalValue: numberValue(payload.totalValue),
    products: rawProducts.map((raw): FinancialProduct => {
      const product = objectValue(raw);
      const rawOrders = Array.isArray(product.orders) ? product.orders : [];
      return {
        receiptId,
        receiptProductId: identifier(product.receiptProductId),
        productId: identifier(product.productId),
        mainProductId: identifier(product.mainProductId),
        genericProdSeq: identifier(product.genericProdSeq),
        inputId: identifier(product.inputId),
        productAmount: numberValue(product.productAmount),
        price: numberValue(product.price),
        orders: rawOrders.map((rawOrder): Allocation => {
          const order = objectValue(rawOrder);
          return {
            orderId: identifier(order.orderId),
            orderProductId: identifier(order.orderProductId),
            productAmount: numberValue(order.productAmount),
            amountReceived: numberValue(order.amountReceived),
            amount: numberValue(order.amount),
          };
        }),
      };
    }),
  };
}

async function fetchFinancialReceipts(receiptIdsToFetch: string[]): Promise<{
  blockedWrites: number;
  receipts: FinancialReceipt[];
}> {
  let lastError = "unknown";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await withBrowserless(async ({ page }) => {
        const login = await performKoperLogin(page);
        if (!login.authenticated) throw new Error(login.message ?? "KOPER_LOGIN_FAILED");

        let blockedWrites = 0;
        await page.route("**/*", async (route) => {
          const request = route.request();
          try {
            const url = new URL(request.url());
            const isKoper = url.hostname === "koper.com.br" || url.hostname.endsWith(".koper.com.br");
            if (
              isKoper
              && !["GET", "HEAD", "OPTIONS"].includes(request.method())
              && !isAllowedFlowSwitch(url, request.method(), request.postData())
            ) {
              blockedWrites += 1;
              await route.abort("blockedbyclient");
              return;
            }
          } catch {
            // Ignore malformed URLs.
          }
          await route.continue();
        });

        if (!await selectFlow(page)) throw new Error("KOPER_FLOW_COMPANY_NOT_SELECTED");

        let headers: Record<string, string> | null = null;
        const capture = (response: Response): void => {
          try {
            const url = new URL(response.url());
            if (
              !headers
              && response.request().method() === "GET"
              && url.hostname === "api.koper.com.br"
              && url.pathname === "/financial/v1/receipt"
            ) headers = response.request().headers();
          } catch {
            // Ignore malformed URLs.
          }
        };

        page.on("response", capture);
        await page.goto("https://app.koper.com.br/financeiro/notas_manuais/view/458", {
          waitUntil: "domcontentloaded",
          timeout: 12_000,
        }).catch(() => undefined);
        for (let index = 0; index < 10 && !headers; index += 1) await page.waitForTimeout(350);
        page.off("response", capture);
        if (!headers) throw new Error("KOPER_FINANCIAL_RECEIPT_TRANSPORT_NOT_CAPTURED");

        const receipts: FinancialReceipt[] = [];
        for (const receiptId of receiptIdsToFetch) {
          const response = await page.request.get(
            `https://api.koper.com.br/financial/v1/receipt?receiptId=${encodeURIComponent(receiptId)}`,
            { headers, timeout: 8_000 },
          );
          if (response.status() !== 200) throw new Error(`KOPER_FINANCIAL_RECEIPT_${receiptId}_STATUS_${response.status()}`);
          receipts.push(parseFinancialReceipt(receiptId, objectValue(await response.json())));
        }
        return { blockedWrites, receipts };
      }, { sessionTimeoutMs: 58_000 });
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : "unknown";
      console.error("KOPER_FINANCIAL_RECEIPT_PILOT_RETRY", JSON.stringify({ attempt, message: lastError.slice(0, 500) }));
      if (attempt < 4) await sleep(attempt * 8_000);
    }
  }
  throw new Error(lastError);
}

async function verifyIds(resource: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await requestSupabase<Array<{ id: string }>>(resource, {
    query: new URLSearchParams({ select: "id", id: quotedIn(ids), limit: "1000" }),
  });
  return rows.length;
}

function orderInvariant(
  beforeOrders: Map<string, number>,
  beforeItems: Map<string, [number, number, number]>,
  afterOrders: Order[],
  afterItems: OrderItem[],
): void {
  for (const order of afterOrders) {
    const before = beforeOrders.get(order.id);
    if (before === undefined || !approximatelyEqual(before, Number(order.received_amount ?? 0))) {
      throw new Error(`Receipt pilot changed order ${order.id}`);
    }
  }
  for (const item of afterItems) {
    const before = beforeItems.get(item.id);
    if (!before) throw new Error(`Receipt pilot changed order item set at ${item.id}`);
    const current: [number, number, number] = [
      Number(item.received_quantity ?? 0),
      Number(item.accepted_quantity ?? 0),
      Number(item.rejected_quantity ?? 0),
    ];
    if (before.some((value, index) => !approximatelyEqual(value, current[index]!))) {
      throw new Error(`Receipt pilot changed quantities for order item ${item.id}`);
    }
  }
}

await import("./index.js");

try {
  const entryId = identifier(process.env.KOPER_FINANCIAL_RECEIPT_PILOT_ENTRY_ID);
  if (!entryId) throw new Error("KOPER_FINANCIAL_RECEIPT_PILOT_ENTRY_ID is required");
  const writeEnabled = process.env.KOPER_FINANCIAL_RECEIPT_PILOT_WRITE_ENABLED === "true";

  const [entries, items, actors, existingReceipts, existingReceiptItems] = await Promise.all([
    requestSupabase<StagingRow[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "koper_id,koper_parent_id,payload",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: "eq.stock_entry",
        sync_state: "eq.present",
        koper_id: `eq.${entryId}`,
        limit: "2",
      }),
    }),
    requestSupabase<StagingRow[]>("koper_staging_records", {
      query: new URLSearchParams({
        select: "koper_id,koper_parent_id,payload",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        source: "eq.koper",
        entity: "eq.stock_entry_item",
        sync_state: "eq.present",
        koper_parent_id: `eq.${entryId}`,
        order: "koper_id.asc",
        limit: "1000",
      }),
    }),
    requestSupabase<Actor[]>("company_memberships", {
      query: new URLSearchParams({
        select: "user_id",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        status: "eq.active",
        order: "created_at.asc",
        limit: "1",
      }),
    }),
    requestSupabase<ExistingReceipt[]>("procurement_material_receipts", {
      query: new URLSearchParams({
        select: "id,receipt_date,created_at,notes",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        order: "receipt_date.asc,created_at.asc",
        limit: "5000",
      }),
    }),
    requestSupabase<ExistingReceiptItem[]>("procurement_material_receipt_items", {
      query: new URLSearchParams({
        select: "receipt_id,order_item_id,accepted_quantity",
        company_id: `eq.${env.BOSSA_COMPANY_ID}`,
        limit: "10000",
      }),
    }),
  ]);

  const entry = entries[0];
  const actor = actors[0];
  if (!entry) throw new Error(`Koper stock entry ${entryId} not found`);
  if (!actor) throw new Error("No technical actor is available");
  if (identifier(objectValue(entry.payload).originType) !== "0") throw new Error(`Entry ${entryId} is not a programmed purchase entry`);
  if (!items.length) throw new Error(`Entry ${entryId} has no staged items`);

  const linkedReceiptIds = unique(items.flatMap((item) => receiptIds(objectValue(item.payload))));
  if (!linkedReceiptIds.length) throw new Error(`Entry ${entryId} has no financial receipt links`);
  const live = await fetchFinancialReceipts(linkedReceiptIds);
  const receiptById = new Map(live.receipts.map((receipt) => [receipt.receiptId, receipt]));

  const preliminary: Array<{
    item: StagingRow;
    payload: Json;
    product: FinancialProduct;
    allocation: Allocation;
    quantity: number;
    unitCost: number;
  }> = [];
  for (const item of items) {
    const payload = objectValue(item.payload);
    const itemReceiptIds = receiptIds(payload);
    const candidates = itemReceiptIds.flatMap((receiptId) =>
      (receiptById.get(receiptId)?.products ?? []).map((product) => ({
        product,
        score: productScore(payload, product),
      })),
    ).filter((candidate) => candidate.score > 0);
    if (!candidates.length) throw new Error(`Entry item ${item.koper_id} has no financial product match`);
    const bestScore = Math.max(...candidates.map((candidate) => candidate.score));
    const best = candidates.filter((candidate) => candidate.score === bestScore);
    if (best.length !== 1) throw new Error(`Entry item ${item.koper_id} has ambiguous financial product match`);
    const product = best[0]!.product;
    const allocations = product.orders.filter((allocation) => allocation.orderId && allocation.orderProductId);
    if (allocations.length !== 1) throw new Error(`Entry item ${item.koper_id} has ${allocations.length} order allocations`);
    const allocation = allocations[0]!;
    const quantity = numberValue(payload.productAmount);
    const allocationQuantity = allocation.productAmount ?? allocation.amountReceived ?? allocation.amount;
    if (quantity === null || quantity <= 0 || product.productAmount === null || allocationQuantity === null) {
      throw new Error(`Entry item ${item.koper_id} has invalid quantity`);
    }
    if (!approximatelyEqual(quantity, product.productAmount) || !approximatelyEqual(quantity, allocationQuantity)) {
      throw new Error(`Entry item ${item.koper_id} quantity mismatch`);
    }
    preliminary.push({
      item,
      payload,
      product,
      allocation,
      quantity,
      unitCost: Math.max(0,
        numberValue(payload.averageProductValue)
        ?? numberValue(payload.productValue)
        ?? product.price
        ?? 0,
      ),
    });
  }

  const orderSourceIds = unique(preliminary.map((row) => row.allocation.orderId!).filter(Boolean));
  const orders = await requestSupabase<Order[]>("procurement_purchase_orders", {
    query: new URLSearchParams({
      select: "id,source_id,supplier_id,project_id,order_number,status,received_amount",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      source_id: quotedIn(orderSourceIds),
      limit: "1000",
    }),
  });
  const orderBySource = new Map(orders.map((order) => [order.source_id, order]));
  const orderIds = orders.map((order) => order.id);
  const orderItems = await requestSupabase<OrderItem[]>("procurement_purchase_order_items", {
    query: new URLSearchParams({
      select: "id,order_id,input_id,source_id,input_code,input_name,unit_snapshot,cost_center_service_id,cost_center_code,cost_center_name,ordered_quantity,received_quantity,accepted_quantity,rejected_quantity,unit_price,delivered_unit_cost",
      company_id: `eq.${env.BOSSA_COMPANY_ID}`,
      source_system: "eq.koper",
      order_id: quotedIn(orderIds),
      limit: "5000",
    }),
  });
  const orderItemsByKey = new Map<string, OrderItem[]>();
  for (const orderItem of orderItems) {
    const sourceId = baseSourceId(orderItem.source_id);
    if (!sourceId) continue;
    const key = `${orderItem.order_id}:${sourceId}`;
    orderItemsByKey.set(key, [...(orderItemsByKey.get(key) ?? []), orderItem]);
  }

  const resolved: ResolvedItem[] = preliminary.map((row) => {
    const order = orderBySource.get(row.allocation.orderId!);
    if (!order) throw new Error(`Native order ${row.allocation.orderId} not found`);
    const nativeItems = orderItemsByKey.get(`${order.id}:${row.allocation.orderProductId}`) ?? [];
    if (nativeItems.length !== 1) throw new Error(`Native order item ${row.allocation.orderProductId} resolved ${nativeItems.length} rows`);
    const orderItem = nativeItems[0]!;
    return {
      entryItemId: row.item.koper_id,
      sourcePayload: row.payload,
      financialProduct: row.product,
      allocation: row.allocation,
      order,
      orderItem,
      quantity: row.quantity,
      unitCost: row.unitCost > 0 ? row.unitCost : Math.max(0, Number(orderItem.delivered_unit_cost ?? orderItem.unit_price ?? 0)),
    };
  });

  const entryPayload = objectValue(entry.payload);
  const receiptDate = dateOnly(entryPayload.movementDate) ?? dateOnly(entryPayload.entryDate);
  if (!receiptDate) throw new Error(`Entry ${entryId} has no valid date`);
  const receiptTimestamp = timestamp(entryPayload.movementDate ?? entryPayload.entryDate, receiptDate);

  const existingHeaderById = new Map(existingReceipts.map((receipt) => [receipt.id, receipt]));
  const priorAcceptedByOrderItem = new Map<string, number>();
  for (const priorItem of existingReceiptItems) {
    const header = existingHeaderById.get(priorItem.receipt_id);
    if (!header) continue;
    const priorTimestamp = `${header.receipt_date}T00:00:00.000Z`;
    if (priorTimestamp >= receiptTimestamp) continue;
    priorAcceptedByOrderItem.set(
      priorItem.order_item_id,
      (priorAcceptedByOrderItem.get(priorItem.order_item_id) ?? 0) + Number(priorItem.accepted_quantity ?? 0),
    );
  }

  const byOrder = new Map<string, ResolvedItem[]>();
  for (const item of resolved) {
    byOrder.set(item.order.id, [...(byOrder.get(item.order.id) ?? []), item]);
  }
  const plans: PilotPlan[] = [];
  const sortedGroups = [...byOrder.values()].sort((left, right) => Number(left[0]!.order.source_id) - Number(right[0]!.order.source_id));
  for (let groupIndex = 0; groupIndex < sortedGroups.length; groupIndex += 1) {
    const rows = sortedGroups[groupIndex]!;
    const order = rows[0]!.order;
    const aggregateByOrderItem = new Map<string, ResolvedItem[]>();
    for (const row of rows) {
      aggregateByOrderItem.set(row.orderItem.id, [...(aggregateByOrderItem.get(row.orderItem.id) ?? []), row]);
    }
    const planItems = [...aggregateByOrderItem.values()].map((group) => {
      const deliveredQuantity = group.reduce((sum, row) => sum + row.quantity, 0);
      const acceptedAmount = group.reduce((sum, row) => sum + row.quantity * row.unitCost, 0);
      return {
        orderItem: group[0]!.orderItem,
        movementIds: group.map((row) => row.entryItemId).sort((a, b) => Number(a) - Number(b)),
        deliveredQuantity,
        unitCost: deliveredQuantity > 0 ? acceptedAmount / deliveredQuantity : 0,
        acceptedAmount,
        previouslyAcceptedQuantity: priorAcceptedByOrderItem.get(group[0]!.orderItem.id) ?? 0,
      };
    }).sort((left, right) => left.orderItem.id.localeCompare(right.orderItem.id));
    const financialReceiptIds = unique(rows.map((row) => row.financialProduct.receiptId));
    const financialReceiptNumbers = unique(financialReceiptIds.flatMap((id) => {
      const value = receiptById.get(id)?.receiptNumber;
      return value ? [value] : [];
    }));
    plans.push({
      entryId,
      order,
      groupIndex,
      receiptId: stableUuid(`elos:koper:stock-entry:${entryId}:order:${order.id}`),
      receiptNumber: `KOPER-REC-${entryId}-${order.source_id}`,
      sequenceNo: 4_000_000 + Number(entryId) * 100 + groupIndex,
      receiptDate,
      receiptTimestamp,
      financialReceiptIds,
      financialReceiptNumbers,
      items: planItems,
    });
  }

  const existingPilotIds = new Set(existingReceipts.map((receipt) => receipt.id));
  const alreadyExists = plans.filter((plan) => existingPilotIds.has(plan.receiptId));
  console.log("KOPER_FINANCIAL_RECEIPT_PILOT_PLAN", JSON.stringify({
    ok: true,
    writeEnabled,
    readOnlyKoper: true,
    blockedWrites: live.blockedWrites,
    entryId,
    entryItems: items.length,
    financialReceiptIds: linkedReceiptIds,
    plans: plans.map((plan) => ({
      receiptId: plan.receiptId,
      receiptNumber: plan.receiptNumber,
      orderSourceId: plan.order.source_id,
      orderNumber: plan.order.order_number,
      items: plan.items.map((item) => ({
        orderItemId: item.orderItem.id,
        sourceOrderProductId: baseSourceId(item.orderItem.source_id),
        inputCode: item.orderItem.input_code,
        inputName: item.orderItem.input_name,
        quantity: item.deliveredQuantity,
        unitCost: item.unitCost,
        previouslyAcceptedQuantity: item.previouslyAcceptedQuantity,
      })),
    })),
    alreadyExists: alreadyExists.map((plan) => plan.receiptId),
  }));

  if (!writeEnabled) {
    console.log("KOPER_FINANCIAL_RECEIPT_PILOT_SKIPPED", JSON.stringify({ entryId, reason: "write_disabled" }));
  } else {
    const affectedOrderIds = unique(plans.map((plan) => plan.order.id));
    const beforeOrders = new Map(orders.map((order) => [order.id, Number(order.received_amount ?? 0)]));
    const beforeItems = new Map(orderItems.map((item) => [item.id, [
      Number(item.received_quantity ?? 0),
      Number(item.accepted_quantity ?? 0),
      Number(item.rejected_quantity ?? 0),
    ] as [number, number, number]]));
    const now = new Date().toISOString();
    const headers = plans.map((plan) => ({
      id: plan.receiptId,
      company_id: env.BOSSA_COMPANY_ID,
      project_id: plan.order.project_id,
      order_id: plan.order.id,
      supplier_id: plan.order.supplier_id,
      sequence_no: plan.sequenceNo,
      receipt_number: plan.receiptNumber,
      status: "draft",
      receipt_date: plan.receiptDate,
      arrival_time: null,
      invoice_number: plan.financialReceiptNumbers.join(", ") || null,
      invoice_series: null,
      invoice_access_key: null,
      invoice_date: plan.financialReceiptIds.map((id) => dateOnly(receiptById.get(id)?.receiptEmitDate)).find(Boolean) ?? null,
      invoice_amount: plan.items.reduce((sum, item) => sum + item.acceptedAmount, 0),
      carrier_name: null,
      vehicle_plate: null,
      driver_name: null,
      delivery_document: null,
      warehouse_location: "Estoque Flow Aptos",
      general_condition: null,
      notes: `Importado do Koper · Koper stockMovementId=${plan.entryId} · financialReceiptIds=${plan.financialReceiptIds.join(",")} · histórico em rascunho · não recalcular pedido`,
      receiver_user_id: actor.user_id,
      receiver_name: "Importação histórica Koper",
      created_by: actor.user_id,
      updated_by: actor.user_id,
      created_at: plan.receiptTimestamp,
      updated_at: now,
    }));
    const receiptItems = plans.flatMap((plan) => plan.items.map((item, index) => ({
      id: stableUuid(`elos:koper:receipt:${plan.receiptId}:movements:${item.movementIds.join(",")}:order-item:${item.orderItem.id}`),
      company_id: env.BOSSA_COMPANY_ID,
      project_id: plan.order.project_id,
      receipt_id: plan.receiptId,
      order_id: plan.order.id,
      order_item_id: item.orderItem.id,
      input_id: item.orderItem.input_id,
      cost_center_service_id: item.orderItem.cost_center_service_id,
      input_code: item.orderItem.input_code,
      input_name: item.orderItem.input_name,
      unit_snapshot: item.orderItem.unit_snapshot,
      cost_center_code: item.orderItem.cost_center_code,
      cost_center_name: item.orderItem.cost_center_name,
      ordered_quantity: Number(item.orderItem.ordered_quantity),
      previously_accepted_quantity: item.previouslyAcceptedQuantity,
      delivered_quantity: item.deliveredQuantity,
      accepted_quantity: item.deliveredQuantity,
      rejected_quantity: 0,
      unit_cost: item.unitCost,
      accepted_amount: item.acceptedAmount,
      batch_number: null,
      expiration_date: null,
      condition: "good",
      rejection_reason: null,
      destination_location: "Estoque Flow Aptos",
      notes: `Importado do Koper · productMovementIds=${item.movementIds.join(",")}`,
      sort_order: index,
      created_at: plan.receiptTimestamp,
      updated_at: now,
    })));

    await requestSupabase("procurement_material_receipts", {
      method: "POST",
      body: headers,
      prefer: "resolution=merge-duplicates,return=minimal",
      query: new URLSearchParams({ on_conflict: "id" }),
    });
    await requestSupabase("procurement_material_receipt_items", {
      method: "POST",
      body: receiptItems,
      prefer: "resolution=merge-duplicates,return=minimal",
      query: new URLSearchParams({ on_conflict: "id" }),
    });

    const [verifiedReceipts, verifiedItems, afterOrders, afterItems] = await Promise.all([
      verifyIds("procurement_material_receipts", headers.map((row) => row.id)),
      verifyIds("procurement_material_receipt_items", receiptItems.map((row) => row.id)),
      requestSupabase<Order[]>("procurement_purchase_orders", {
        query: new URLSearchParams({
          select: "id,source_id,supplier_id,project_id,order_number,status,received_amount",
          id: quotedIn(affectedOrderIds),
          limit: "1000",
        }),
      }),
      requestSupabase<OrderItem[]>("procurement_purchase_order_items", {
        query: new URLSearchParams({
          select: "id,order_id,input_id,source_id,input_code,input_name,unit_snapshot,cost_center_service_id,cost_center_code,cost_center_name,ordered_quantity,received_quantity,accepted_quantity,rejected_quantity,unit_price,delivered_unit_cost",
          order_id: quotedIn(affectedOrderIds),
          limit: "5000",
        }),
      }),
    ]);
    if (verifiedReceipts !== headers.length || verifiedItems !== receiptItems.length) {
      throw new Error(`Pilot verification failed: ${verifiedReceipts}/${headers.length}, ${verifiedItems}/${receiptItems.length}`);
    }
    orderInvariant(beforeOrders, beforeItems, afterOrders, afterItems);
    console.log("KOPER_FINANCIAL_RECEIPT_PILOT_RESULT", JSON.stringify({
      ok: true,
      entryId,
      receiptsCreatedOrUpdated: headers.length,
      itemsCreatedOrUpdated: receiptItems.length,
      verifiedReceipts,
      verifiedItems,
      affectedOrders: affectedOrderIds.length,
      orderQuantitiesUnchanged: true,
      inventoryMovementsCreated: 0,
    }));
  }
} catch (error: unknown) {
  console.error("KOPER_FINANCIAL_RECEIPT_PILOT_FAILED", JSON.stringify({
    message: error instanceof Error ? error.message.slice(0, 1_500) : "unknown",
  }));
}
