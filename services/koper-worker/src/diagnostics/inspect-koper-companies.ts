import type { Page, Response } from "playwright-core";
import { performKoperLogin } from "../auth/koper-auto-login.js";
import { withBrowserless } from "../browser/browserless.js";
import { collectFieldPaths } from "./discover-stock-route.js";

type CompanyOption = {
  text: string;
  tag: string;
  role: string | null;
  testId: string | null;
  href: string | null;
};

type CompanySummary = {
  enterpriseId: string | number | null;
  branchId: string | number | null;
  enterpriseName: string | null;
  fantasyName: string | null;
  stockPlaceName: string | null;
};

type CompanyApiRead = {
  method: string;
  status: number;
  endpoint: string;
  dataKeys: string[];
  fieldPaths: string[];
  companies: CompanySummary[];
};

export type KoperCompaniesDiagnostic = {
  ok: true;
  authenticated: boolean;
  activeCompanyLabel: string | null;
  companyOptions: CompanyOption[];
  companyReads: CompanyApiRead[];
  message: string | null;
  checkedAt: string;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const companyEndpointPaths = new Set([
  "/administrative/v1/enterprise",
  "/administrative/v1/multi_company",
]);

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value.slice(0, 200) : null;
}

function idValue(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function collectCompanies(body: unknown): CompanySummary[] {
  const items = Array.isArray(body) ? body : [body];

  return items
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
      enterpriseId: idValue(item.enterpriseId),
      branchId: idValue(item.branchId),
      enterpriseName: stringValue(item.enterpriseName),
      fantasyName: stringValue(item.fantasyName),
      stockPlaceName: stringValue(item.stockPlaceName),
    }));
}

async function readActiveCompanyLabel(page: Page): Promise<string | null> {
  const candidates = page.locator("button, [role='button'], [class*='company' i], [class*='enterprise' i]");
  const count = Math.min(await candidates.count(), 150);
  let best: { text: string; score: number } | null = null;

  for (let index = 0; index < count; index += 1) {
    const element = candidates.nth(index);

    if (!(await element.isVisible().catch(() => false))) {
      continue;
    }

    const metadata = await element
      .evaluate((node) => {
        const rect = (node as HTMLElement).getBoundingClientRect();
        return {
          text: ((node as HTMLElement).innerText || "").trim(),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          viewportWidth: window.innerWidth,
        };
      })
      .catch(() => null);

    if (!metadata || !metadata.text || metadata.text.length > 80) {
      continue;
    }

    let score = 0;

    if (metadata.y < 180) score += 5;
    if (metadata.x > metadata.viewportWidth * 0.6) score += 5;
    if (/empreend|bossa|flow|alma|ltda|s\.?a\.?/i.test(metadata.text)) score += 3;

    if (score > 0 && (!best || score > best.score)) {
      best = { text: normalizeText(metadata.text), score };
    }
  }

  return best && best.score >= 8 ? best.text : null;
}

async function openCompanySelectorAndCollectOptions(
  page: Page,
  activeCompanyLabel: string,
): Promise<CompanyOption[]> {
  const label = page.getByText(activeCompanyLabel, { exact: true }).last();
  const control = label.locator(
    "xpath=ancestor-or-self::*[self::button or self::a or @role='button'][1]",
  );

  if (!(await control.isVisible().catch(() => false))) {
    return [];
  }

  await control.click();
  await page.waitForTimeout(1_000);

  const changeCompany = page
    .getByText(/^Acessar outra empresa$/i, { exact: true })
    .last();

  if (await changeCompany.isVisible().catch(() => false)) {
    await changeCompany.click();
    await page.waitForTimeout(1_000);
  }

  return page
    .locator("body *")
    .evaluateAll((elements) => {
      const seen = new Set<string>();

      return elements.flatMap((element) => {
        const node = element as HTMLElement;
        const text = (node.innerText || "").replace(/\s+/g, " ").trim();
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden";

        if (
          !visible ||
          !/bossa|flow|alma/i.test(text) ||
          text.length > 100 ||
          seen.has(text)
        ) {
          return [];
        }

        seen.add(text);
        return [{
          text,
          tag: node.tagName.toLowerCase(),
          role: node.getAttribute("role"),
          testId: node.getAttribute("data-testid"),
          href: node instanceof HTMLAnchorElement ? node.getAttribute("href") : null,
        }];
      });
    });
}

export async function inspectKoperCompanies(): Promise<KoperCompaniesDiagnostic> {
  return withBrowserless(async ({ page }) => {
    const companyReads: CompanyApiRead[] = [];
    const pendingResponses: Promise<void>[] = [];

    const onResponse = (response: Response): void => {
      try {
        const parsedUrl = new URL(response.url());

        if (
          response.request().method() === "GET" &&
          parsedUrl.hostname === "api.koper.com.br" &&
          companyEndpointPaths.has(parsedUrl.pathname)
        ) {
          const task = response
            .json()
            .then((body: unknown) => {
              const object =
                typeof body === "object" && body !== null
                  ? (body as Record<string, unknown>)
                  : null;

              companyReads.push({
                method: "GET",
                status: response.status(),
                endpoint: parsedUrl.origin + parsedUrl.pathname,
                dataKeys: object ? Object.keys(object).slice(0, 50) : [],
                fieldPaths: collectFieldPaths(body).slice(0, 200),
                companies: collectCompanies(body),
              });
            })
            .catch(() => undefined);

          pendingResponses.push(task);
        }
      } catch {
        // Ignora respostas fora das APIs administrativas de empresa.
      }
    };

    page.on("response", onResponse);

    const login = await performKoperLogin(page);
    let activeCompanyLabel: string | null = null;
    let companyOptions: CompanyOption[] = [];

    if (login.authenticated) {
      await page.waitForTimeout(3_000);
      activeCompanyLabel = await readActiveCompanyLabel(page).catch(() => null);

      if (activeCompanyLabel) {
        companyOptions = await openCompanySelectorAndCollectOptions(
          page,
          activeCompanyLabel,
        ).catch(() => []);
      }
    }

    await Promise.allSettled(pendingResponses);
    page.off("response", onResponse);

    return {
      ok: true,
      authenticated: login.authenticated,
      activeCompanyLabel,
      companyOptions,
      companyReads,
      message: login.authenticated ? null : login.message,
      checkedAt: new Date().toISOString(),
    };
  });
}


type NetworkSummary = {
  method: string;
  resourceType: string;
  endpoint: string;
  queryKeys: string[];
};

type StockRequestSample = {
  requestId: string | number | null;
  requestAuxId: string | number | null;
  stockPlaceId: string | number | null;
  stockPlaceName: string | null;
  productAmount: number | null;
  requestDate: string | null;
  deadline: string | null;
  status: string | null;
  isUrgent: boolean | null;
  isDraft: boolean | null;
};

type StockRequestRead = NetworkSummary & {
  listMode: "active" | "active-page-2" | "finalized";
  statusCode: number;
  queryParams: Record<string, string>;
  itemsAmount: number | null;
  returnedRecords: number;
  requests: StockRequestSample[];
};

type ProductCatalogRead = {
  endpoint: string;
  statusCode: number;
  queryParams: Record<string, string>;
  dataKeys: string[];
  fieldPaths: string[];
  itemsAmount: number | null;
  returnedRecords: number;
  sample: Array<Record<string, unknown>>;
};

type FilterControl = {
  tag: string;
  text: string;
  className: string;
  role: string | null;
  type: string | null;
  ariaLabel: string | null;
  testId: string | null;
};

type QuotationSample = {
  budgetId: string | number | null;
  supplierId: string | number | null;
  buildMonitoringId: string | number | null;
  budgetDate: string | null;
  responseDate: string | null;
  productAmount: number | null;
  totalValue: number | null;
};

type QuotationRead = NetworkSummary & {
  statusCode: number;
  queryParams: Record<string, string>;
  dataKeys: string[];
  fieldPaths: string[];
  itemsAmount: number | null;
  budgetAmount: number | null;
  returnedRecords: number;
  budgets: QuotationSample[];
};

type QuotationRowTarget = {
  tag: string;
  className: string;
  href: string | null;
  ngClick: string | null;
  uiSref: string | null;
  role: string | null;
};

type QuotationDetailProduct = {
  productId: string | number | null;
  mainProductId: string | number | null;
  budgetProductId: string | number | null;
  selBudProdId: string | number | null;
  unitMeasureId: string | number | null;
  productAmount: number | null;
  deliveryAmount: number | null;
  price: number | null;
  priceWithDiscount: number | null;
  discount: number | null;
  deadline: number | null;
  measures: number | null;
  conversionFactor: number | null;
  prodCanceled: boolean | null;
  open: boolean | null;
};

type QuotationDetailSample = {
  budgetId: string | number | null;
  supplierId: string | number | null;
  costCenterId: string | number | null;
  buildMonitoringId: string | number | null;
  deliverySupplierId: string | number | null;
  budgetDate: string | null;
  expirationDate: string | null;
  requestDeadline: string | null;
  responseDate: string | null;
  totalProducts: number | null;
  totalValue: number | null;
  costShipping: number | null;
  typeShipping: string | null;
  showDeadline: boolean | null;
  paymentTotalDiscount: number | null;
  paymentMethodId: string | number | null;
  paymentConditions: string | number | null;
  paymentWay: string | number | null;
  products: QuotationDetailProduct[];
};

type QuotationDetailRead = NetworkSummary & {
  statusCode: number;
  dataKeys: string[];
  fieldPaths: string[];
  budget: QuotationDetailSample | null;
};

type PurchaseDetailBill = {
  billId: string | number | null;
  billToPayId: string | number | null;
  billValue: number | null;
  dueDate: string | null;
  joinBillId: string | number | null;
};

type PurchaseDetailService = {
  serviceId: string | number | null;
  serviceValue: number | null;
  serviceAmount: number | null;
};

type PurchaseDetailServiceOrder = {
  serviceOrderId: string | number | null;
  serviceOrderDate: string | null;
  serviceOrderStatus: string | null;
};

type PurchaseDetailSample = {
  purchaseId: string | number | null;
  costCenterId: string | number | null;
  supplierId: string | number | null;
  receiptId: string | number | null;
  xmlInvoiceId: string | number | null;
  invoiceNumber: string | number | null;
  receiptNumber: string | number | null;
  purchaseDate: string | null;
  othersValue: number | null;
  purchaseDiscount: number | null;
  purchaseValue: number | null;
  totalProducts: number | null;
  totalPurchase: number | null;
  totalServices: number | null;
  purchaseOrderCount: number;
  productCount: number;
  bills: PurchaseDetailBill[];
  services: PurchaseDetailService[];
  serviceOrders: PurchaseDetailServiceOrder[];
};

type PurchaseDetailRead = NetworkSummary & {
  statusCode: number;
  dataKeys: string[];
  fieldPaths: string[];
  purchase: PurchaseDetailSample | null;
};

type BillDetailRead = NetworkSummary & {
  statusCode: number;
  queryParams: Record<string, string>;
  dataKeys: string[];
  fieldPaths: string[];
  bill: {
    id: string | number | null;
    billId: string | number | null;
    billToPayId: string | number | null;
    supplierId: string | number | null;
    costCenterId: string | number | null;
    chartAccountId: string | number | null;
    itemChartAccountId: string | number | null;
    accountId: string | number | null;
    paymentId: string | number | null;
    billValue: number | null;
    paymentValue: number | null;
    discountValue: number | null;
    interestValue: number | null;
    lateFeeValue: number | null;
    otherAccruals: number | null;
    dueDate: string | null;
    paidAt: string | null;
    status: string | null;
    paymentType: string | null;
    isPaid: boolean | null;
    billReceiptNumber: string | number | null;
    proofPayFileId: string | number | null;
    bankSlipFileId: string | number | null;
    origins: Array<{
      invoiceId: string | number | null;
      invoiceNumber: string | number | null;
      receiptId: string | number | null;
      receiptNumber: string | number | null;
      serviceOrderId: string | number | null;
      buildMonitoringId: string | number | null;
    }>;
  } | null;
  events: Array<{
    billToPayEventId: string | number | null;
    billIdFk: string | number | null;
    userIdFk: string | number | null;
    registerDate: string | null;
  }>;
};

type MaterialFlowRead = NetworkSummary & {
  statusCode: number;
  queryParams: Record<string, string>;
  dataKeys: string[];
  fieldPaths: string[];
  order: {
    orderId: string | number | null;
    supplierId: string | number | null;
    costCenterId: string | number | null;
    buildMonitoringId: string | number | null;
    orderDate: string | null;
    deliveryDate: string | null;
    status: string | null;
    isDraft: boolean | null;
    costShipping: number | null;
    negotiatedDiscount: number | null;
    totalDiscount: number | null;
    products: Array<{
      productId: string | number | null;
      mainProductId: string | number | null;
      orderProductId: string | number | null;
      inputId: string | number | null;
      amount: number | null;
      amountReceived: number | null;
      price: number | null;
      finalPrice: number | null;
      discount: number | null;
      unitMeasureId: string | number | null;
      prodFinished: boolean | null;
      prodCanceled: boolean | null;
      requests: Array<{
        requestId: string | number | null;
        productRequestId: string | number | null;
        requestAmount: number | null;
        deliveryPlaceId: string | number | null;
      }>;
    }>;
  } | null;
  entry: {
    stockMovementId: string | number | null;
    itemsAmount: number | null;
    entryType: string | null;
    placeEntryId: string | number | null;
    movementDate: string | null;
    packingListId: string | number | null;
    totalProductValue: number | null;
    averageProductValue: number | null;
    products: Array<{
      productId: string | number | null;
      mainProductId: string | number | null;
      productMovementId: string | number | null;
      stockMovementId: string | number | null;
      productAmount: number | null;
      unitMeasureId: string | number | null;
      productValue: number | null;
      averageProductValue: number | null;
      totalProductValue: number | null;
      invoices: Array<{
        invoiceId: string | number | null;
        invoiceNumber: string | number | null;
      }>;
    }>;
  } | null;
  invoice: {
    invoiceId: string | number | null;
    invoiceNumber: string | number | null;
    stockPlaceId: string | number | null;
    costCenterId: string | number | null;
    buildMonitoringId: string | number | null;
    emitDate: string | null;
    situation: string | null;
    isDraft: boolean | null;
    totalValue: number | null;
    totalNF: number | null;
    supplierId: string | number | null;
    purchaseOrderIds: Array<string | number>;
    products: Array<{
      productId: string | number | null;
      mainProductId: string | number | null;
      amount: number | null;
      unitValue: number | null;
      totalValue: number | null;
    }>;
    bills: Array<{
      billId: string | number | null;
      billToPayId: string | number | null;
      billValue: number | null;
      dueDate: string | null;
      isPaid: boolean | null;
    }>;
  } | null;
};

type SwitchAttemptShape = {
  queryValueKind: "uuid" | "flag" | "other" | "missing";
  bodyKind: "json" | "form" | "text" | "empty";
  bodyKeys: string[];
  matchesFlowEnterpriseId: boolean;
  matchesFlowBranchId: boolean;
};

export type KoperFlowContextDiagnostic = {
  ok: true;
  authenticated: boolean;
  activeCompanyBefore: string | null;
  activeCompanyAfter: string | null;
  flowCardFound: boolean;
  flowSelected: boolean;
  stockListReached: boolean;
  finalizedControlFound: boolean;
  finalizedClicked: boolean;
  quotationListReached: boolean;
  quotationFinalizedClicked: boolean;
  stockRequestReads: StockRequestRead[];
  productCatalogReads: ProductCatalogRead[];
  quotationReads: QuotationRead[];
  quotationFilterControls: FilterControl[];
  quotationDetailReads: QuotationDetailRead[];
  quotationDetailUrl: string | null;
  quotationRowTargets: QuotationRowTarget[];
  purchaseDetailReads: PurchaseDetailRead[];
  purchaseDetailUrl: string | null;
  billDetailReads: BillDetailRead[];
  billDetailUrl: string | null;
  materialFlowReads: MaterialFlowRead[];
  materialFlowUrls: string[];
  finalUrl: string;
  network: NetworkSummary[];
  blockedWrites: NetworkSummary[];
  switchAttempts: SwitchAttemptShape[];
  storageKeysBefore: { local: string[]; session: string[] };
  storageKeysAfter: { local: string[]; session: string[] };
  message: string | null;
  checkedAt: string;
};

function sanitizeRequest(rawUrl: string, method: string, resourceType: string): NetworkSummary {
  const parsed = new URL(rawUrl);

  return {
    method,
    resourceType,
    endpoint: parsed.origin + parsed.pathname,
    queryKeys: [...new Set(parsed.searchParams.keys())].slice(0, 30),
  };
}

const flowEnterpriseId = "6d3b4724-5880-11ee-827d-1219c832db49";

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function safeIdentifier(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function safeText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function safeBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function collectSafeQuotationDetail(body: unknown): QuotationDetailSample | null {
  const value = typeof body === "object" && body !== null
    ? body as Record<string, unknown>
    : null;
  if (!value || value.budgetId === undefined) return null;
  const products = Array.isArray(value.products) ? value.products : [];

  return {
    budgetId: safeIdentifier(value.budgetId),
    supplierId: safeIdentifier(value.supplierId),
    costCenterId: safeIdentifier(value.costCenterId),
    buildMonitoringId: safeIdentifier(value.buildMonitoringId),
    deliverySupplierId: safeIdentifier(value.deliverySupplierId),
    budgetDate: safeText(value.budgetDate),
    expirationDate: safeText(value.expirationDate),
    requestDeadline: safeText(value.requestDeadline),
    responseDate: safeText(value.responseDate),
    totalProducts: safeNumber(value.totalProducts),
    totalValue: safeNumber(value.totalValue),
    costShipping: safeNumber(value.costShipping),
    typeShipping: safeText(value.typeShipping),
    showDeadline: safeBoolean(value.showDeadline),
    paymentTotalDiscount: safeNumber(
      typeof value.payments === "object" && value.payments !== null
        ? (value.payments as Record<string, unknown>).totalDiscount
        : null,
    ),
    paymentMethodId: safeIdentifier(
      typeof value.payments === "object" && value.payments !== null
        ? (value.payments as Record<string, unknown>).paymentMethodId
        : null,
    ),
    paymentConditions: safeIdentifier(
      typeof value.payments === "object" && value.payments !== null
        ? (value.payments as Record<string, unknown>).conditions
        : null,
    ),
    paymentWay: safeIdentifier(
      typeof value.payments === "object" && value.payments !== null
        ? (value.payments as Record<string, unknown>).way
        : null,
    ),
    products: products.slice(0, 50).map((item: unknown) => {
      const product = typeof item === "object" && item !== null
        ? item as Record<string, unknown>
        : {};
      return {
        productId: safeIdentifier(product.productId),
        mainProductId: safeIdentifier(product.mainProductId),
        budgetProductId: safeIdentifier(product.budgetProductId),
        selBudProdId: safeIdentifier(product.selBudProdId),
        unitMeasureId: safeIdentifier(product.unitMeasureId),
        productAmount: safeNumber(product.productAmount),
        deliveryAmount: safeNumber(product.deliveryAmount),
        price: safeNumber(product.price),
        priceWithDiscount: safeNumber(product.priceWithDiscount),
        discount: safeNumber(product.discount),
        deadline: safeNumber(product.deadline),
        measures: safeNumber(product.measures),
        conversionFactor: safeNumber(product.conversionFactor),
        prodCanceled: safeBoolean(product.prodCanceled),
        open: safeBoolean(product.open),
      };
    }),
  };
}

function collectSafePurchaseDetail(body: unknown): PurchaseDetailSample | null {
  const value = typeof body === "object" && body !== null
    ? body as Record<string, unknown>
    : null;
  if (!value || value.purchaseId === undefined) return null;

  const bills = Array.isArray(value.bills) ? value.bills : [];
  const services = Array.isArray(value.services) ? value.services : [];
  const serviceOrders = Array.isArray(value.serviceOrders) ? value.serviceOrders : [];

  return {
    purchaseId: safeIdentifier(value.purchaseId),
    costCenterId: safeIdentifier(value.costCenterId),
    supplierId: safeIdentifier(value.supplierId),
    receiptId: safeIdentifier(value.receiptId),
    xmlInvoiceId: safeIdentifier(value.xmlInvoiceId),
    invoiceNumber: safeIdentifier(value.invoiceNumber),
    receiptNumber: safeIdentifier(value.receiptNumber),
    purchaseDate: safeText(value.purchaseDate),
    othersValue: safeNumber(value.othersValue),
    purchaseDiscount: safeNumber(value.purchaseDiscount),
    purchaseValue: safeNumber(value.purchaseValue),
    totalProducts: safeNumber(value.totalProducts),
    totalPurchase: safeNumber(value.totalPurchase),
    totalServices: safeNumber(value.totalServices),
    purchaseOrderCount: Array.isArray(value.purchaseOrders) ? value.purchaseOrders.length : 0,
    productCount: Array.isArray(value.products) ? value.products.length : 0,
    bills: bills.slice(0, 50).map((item: unknown) => {
      const bill = typeof item === "object" && item !== null
        ? item as Record<string, unknown>
        : {};
      return {
        billId: safeIdentifier(bill.billId),
        billToPayId: safeIdentifier(bill.billToPayId),
        billValue: safeNumber(bill.billValue),
        dueDate: safeText(bill.dueDate),
        joinBillId: safeIdentifier(bill.joinBillId),
      };
    }),
    services: services.slice(0, 50).map((item: unknown) => {
      const service = typeof item === "object" && item !== null
        ? item as Record<string, unknown>
        : {};
      return {
        serviceId: safeIdentifier(service.serviceId),
        serviceValue: safeNumber(service.serviceValue),
        serviceAmount: safeNumber(service.serviceAmount),
      };
    }),
    serviceOrders: serviceOrders.slice(0, 50).map((item: unknown) => {
      const serviceOrder = typeof item === "object" && item !== null
        ? item as Record<string, unknown>
        : {};
      return {
        serviceOrderId: safeIdentifier(serviceOrder.serviceOrderId),
        serviceOrderDate: safeText(serviceOrder.serviceOrderDate),
        serviceOrderStatus: safeText(serviceOrder.serviceOrderStatus),
      };
    }),
  };
}

function collectSafeBillDetail(body: unknown): BillDetailRead["bill"] {
  const value = typeof body === "object" && body !== null
    ? body as Record<string, unknown>
    : null;
  if (!value || value.bill_id === undefined) return null;
  const costCenter = typeof value.cost_center === "object" && value.cost_center !== null
    ? value.cost_center as Record<string, unknown>
    : null;
  const origins = Array.isArray(value.origins) ? value.origins : [];

  return {
    id: safeIdentifier(value.id),
    billId: safeIdentifier(value.bill_id),
    billToPayId: safeIdentifier(value.bill_to_pay_id),
    supplierId: safeIdentifier(value.supplier_id),
    costCenterId: safeIdentifier(costCenter?.id),
    chartAccountId: safeIdentifier(value.chart_account_id),
    itemChartAccountId: safeIdentifier(value.item_chart_account_id),
    accountId: safeIdentifier(value.account_id),
    paymentId: safeIdentifier(value.payment_id),
    billValue: safeNumber(value.bill_value),
    paymentValue: safeNumber(value.payment_value),
    discountValue: safeNumber(value.discount_value),
    interestValue: safeNumber(value.interest_value),
    lateFeeValue: safeNumber(value.late_fee_value),
    otherAccruals: safeNumber(value.other_accruals),
    dueDate: safeText(value.due_date),
    paidAt: safeText(value.paid_at),
    status: safeText(value.status),
    paymentType: safeText(value.payment_type),
    isPaid: safeBoolean(value.is_paid),
    billReceiptNumber: safeIdentifier(value.bill_receipt_number),
    proofPayFileId: safeIdentifier(value.proofpay_file_id),
    bankSlipFileId: safeIdentifier(value.bank_slip_file_id),
    origins: origins.slice(0, 50).map((item: unknown) => {
      const origin = typeof item === "object" && item !== null
        ? item as Record<string, unknown>
        : {};
      return {
        invoiceId: safeIdentifier(origin.invoice_id),
        invoiceNumber: safeIdentifier(origin.invoice_number),
        receiptId: safeIdentifier(origin.receipt_id),
        receiptNumber: safeIdentifier(origin.receipt_number),
        serviceOrderId: safeIdentifier(origin.service_order_id),
        buildMonitoringId: safeIdentifier(origin.build_monitoring_id),
      };
    }),
  };
}

function collectSafeBillEvents(body: unknown): BillDetailRead["events"] {
  const value = typeof body === "object" && body !== null
    ? body as Record<string, unknown>
    : null;
  const events = Array.isArray(value?.events) ? value.events : [];

  return events.slice(0, 100).map((item: unknown) => {
    const event = typeof item === "object" && item !== null
      ? item as Record<string, unknown>
      : {};
    return {
      billToPayEventId: safeIdentifier(event.billToPayEventId),
      billIdFk: safeIdentifier(event.billIdFk),
      userIdFk: safeIdentifier(event.userIdFk),
      registerDate: safeText(event.registerDate),
    };
  });
}

function collectSafeMaterialOrder(body: unknown): MaterialFlowRead["order"] {
  const value = typeof body === "object" && body !== null
    ? body as Record<string, unknown>
    : null;
  if (!value || value.orderId === undefined) return null;
  const products = Array.isArray(value.products) ? value.products : [];

  return {
    orderId: safeIdentifier(value.orderId),
    supplierId: safeIdentifier(value.supplierId),
    costCenterId: safeIdentifier(value.costCenterId),
    buildMonitoringId: safeIdentifier(value.buildMonitoringId),
    orderDate: safeText(value.orderDate),
    deliveryDate: safeText(value.deliveryDate),
    status: safeText(value.status),
    isDraft: safeBoolean(value.isDraft),
    costShipping: safeNumber(value.costShipping),
    negotiatedDiscount: safeNumber(value.negotiatedDiscount),
    totalDiscount: safeNumber(value.totalDiscount),
    products: products.slice(0, 100).map((item: unknown) => {
      const product = typeof item === "object" && item !== null
        ? item as Record<string, unknown>
        : {};
      const requests = Array.isArray(product.requests) ? product.requests : [];
      return {
        productId: safeIdentifier(product.productId),
        mainProductId: safeIdentifier(product.mainProductId),
        orderProductId: safeIdentifier(product.orderProductId),
        inputId: safeIdentifier(product.inputId),
        amount: safeNumber(product.amount),
        amountReceived: safeNumber(product.amountReceived),
        price: safeNumber(product.price),
        finalPrice: safeNumber(product.finalPrice),
        discount: safeNumber(product.discount),
        unitMeasureId: safeIdentifier(product.unitMeasureId),
        prodFinished: safeBoolean(product.prodFinished),
        prodCanceled: safeBoolean(product.prodCanceled),
        requests: requests.slice(0, 100).map((requestItem: unknown) => {
          const request = typeof requestItem === "object" && requestItem !== null
            ? requestItem as Record<string, unknown>
            : {};
          return {
            requestId: safeIdentifier(request.requestId),
            productRequestId: safeIdentifier(request.productRequestId),
            requestAmount: safeNumber(request.requestAmount),
            deliveryPlaceId: safeIdentifier(request.deliveryPlaceId),
          };
        }),
      };
    }),
  };
}

function collectSafeMaterialEntry(body: unknown): MaterialFlowRead["entry"] {
  const value = typeof body === "object" && body !== null
    ? body as Record<string, unknown>
    : null;
  if (!value || value.stockMovementId === undefined) return null;
  const products = Array.isArray(value.products) ? value.products : [];

  return {
    stockMovementId: safeIdentifier(value.stockMovementId),
    itemsAmount: safeNumber(value.itemsAmount),
    entryType: safeText(value.entryType),
    placeEntryId: safeIdentifier(value.placeEntryId),
    movementDate: safeText(value.movementDate),
    packingListId: safeIdentifier(value.packingListId),
    totalProductValue: safeNumber(value.totalProductValue),
    averageProductValue: safeNumber(value.averageProductValue),
    products: products.slice(0, 100).map((item: unknown) => {
      const product = typeof item === "object" && item !== null
        ? item as Record<string, unknown>
        : {};
      const invoices = Array.isArray(product.invoices) ? product.invoices : [];
      return {
        productId: safeIdentifier(product.productId),
        mainProductId: safeIdentifier(product.mainProductId),
        productMovementId: safeIdentifier(product.productMovementId),
        stockMovementId: safeIdentifier(product.stockMovementId),
        productAmount: safeNumber(product.productAmount),
        unitMeasureId: safeIdentifier(product.unitMeasureId),
        productValue: safeNumber(product.productValue),
        averageProductValue: safeNumber(product.averageProductValue),
        totalProductValue: safeNumber(product.totalProductValue),
        invoices: invoices.slice(0, 50).map((invoiceItem: unknown) => {
          const invoice = typeof invoiceItem === "object" && invoiceItem !== null
            ? invoiceItem as Record<string, unknown>
            : {};
          return {
            invoiceId: safeIdentifier(invoice.invoiceId),
            invoiceNumber: safeIdentifier(invoice.invoiceNumber),
          };
        }),
      };
    }),
  };
}

function collectSafeMaterialInvoice(body: unknown): MaterialFlowRead["invoice"] {
  const value = typeof body === "object" && body !== null
    ? body as Record<string, unknown>
    : null;
  if (!value || value.invoiceId === undefined) return null;
  const total = typeof value.total === "object" && value.total !== null
    ? value.total as Record<string, unknown>
    : null;
  const supplier = typeof value.supplier === "object" && value.supplier !== null
    ? value.supplier as Record<string, unknown>
    : null;
  const bill = typeof value.bill === "object" && value.bill !== null
    ? value.bill as Record<string, unknown>
    : null;
  const products = Array.isArray(value.products) ? value.products : [];
  const duplicates = Array.isArray(bill?.duplicates) ? bill.duplicates : [];
  const purchaseOrders = Array.isArray(value.purchaseOrders) ? value.purchaseOrders : [];

  return {
    invoiceId: safeIdentifier(value.invoiceId),
    invoiceNumber: safeIdentifier(value.invoiceNumber),
    stockPlaceId: safeIdentifier(value.stockPlaceId),
    costCenterId: safeIdentifier(value.costCenterId),
    buildMonitoringId: safeIdentifier(value.buildMonitoringId),
    emitDate: safeText(value.emitDate),
    situation: safeText(value.situation),
    isDraft: safeBoolean(value.isDraft),
    totalValue: safeNumber(total?.totalValue),
    totalNF: safeNumber(total?.totalNF),
    supplierId: safeIdentifier(supplier?.supplierId),
    purchaseOrderIds: purchaseOrders.flatMap((item: unknown) => {
      const order = typeof item === "object" && item !== null
        ? item as Record<string, unknown>
        : {};
      const id = safeIdentifier(order.purchaseOrderId);
      return id === null ? [] : [id];
    }).slice(0, 100),
    products: products.slice(0, 100).map((item: unknown) => {
      const product = typeof item === "object" && item !== null
        ? item as Record<string, unknown>
        : {};
      return {
        productId: safeIdentifier(product.productId),
        mainProductId: safeIdentifier(product.mainProductId),
        amount: safeNumber(product.amount),
        unitValue: safeNumber(product.unitValue),
        totalValue: safeNumber(product.totalValue),
      };
    }),
    bills: duplicates.slice(0, 100).map((item: unknown) => {
      const duplicate = typeof item === "object" && item !== null
        ? item as Record<string, unknown>
        : {};
      return {
        billId: safeIdentifier(duplicate.billId),
        billToPayId: safeIdentifier(duplicate.billToPayId ?? bill?.billToPayId),
        billValue: safeNumber(duplicate.billValue),
        dueDate: safeText(duplicate.dueDate),
        isPaid: safeBoolean(duplicate.isPaid),
      };
    }),
  };
}

function collectSafeStockRequests(body: unknown): {
  itemsAmount: number | null;
  returnedRecords: number;
  requests: StockRequestSample[];
} {
  const object =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : null;
  const requests = Array.isArray(object?.requests) ? object.requests : [];

  return {
    itemsAmount: safeNumber(object?.itemsAmount),
    returnedRecords: requests.length,
    requests: requests.slice(0, 25).flatMap((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return [];
      }

      const record = item as Record<string, unknown>;

      return [{
        requestId: idValue(record.requestId),
        requestAuxId: idValue(record.requestAuxId),
        stockPlaceId: idValue(record.stockPlaceId),
        stockPlaceName: stringValue(record.stockPlaceName),
        productAmount: safeNumber(record.productAmount),
        requestDate: stringValue(record.requestDate),
        deadline: stringValue(record.deadline),
        status: stringValue(record.status),
        isUrgent: safeBoolean(record.isUrgent),
        isDraft: safeBoolean(record.isDraft),
      }];
    }),
  };
}

function safeStockQueryParams(parsedUrl: URL): Record<string, string> {
  const allowed = [
    "group",
    "limit",
    "offset",
    "open",
    "orderFlag",
    "orderby",
    "typeDate",
  ];

  return Object.fromEntries(
    allowed.flatMap((key) => {
      const value = parsedUrl.searchParams.get(key);
      return value === null ? [] : [[key, value]];
    }),
  );
}

function isAllowedFlowSwitchBody(postData: string | null): boolean {
  if (!postData) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(postData);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return false;
    }

    const body = parsed as Record<string, unknown>;
    const allowedKeys = new Set([
      "accessToken",
      "toEnterpriseId",
      "changeCompany",
    ]);
    const keys = Object.keys(body);

    return (
      keys.length === 3 &&
      keys.every((key) => allowedKeys.has(key)) &&
      typeof body.accessToken === "string" &&
      body.accessToken.length > 0 &&
      body.toEnterpriseId === flowEnterpriseId &&
      Object.hasOwn(body, "changeCompany")
    );
  } catch {
    return false;
  }
}

function inspectSwitchAttempt(
  rawUrl: string,
  postData: string | null,
): SwitchAttemptShape {
  const queryValue = new URL(rawUrl).searchParams.get("changeCompany");
  let bodyKind: SwitchAttemptShape["bodyKind"] = postData ? "text" : "empty";
  let bodyKeys: string[] = [];

  if (postData) {
    try {
      const parsed: unknown = JSON.parse(postData);
      bodyKind = "json";
      bodyKeys =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? Object.keys(parsed).slice(0, 30)
          : [];
    } catch {
      const form = new URLSearchParams(postData);
      const keys = [...new Set(form.keys())];

      if (keys.length > 0 && keys.some((key) => postData.includes("="))) {
        bodyKind = "form";
        bodyKeys = keys.slice(0, 30);
      }
    }
  }

  return {
    queryValueKind:
      queryValue === null
        ? "missing"
        : /^[0-9a-f-]{36}$/i.test(queryValue)
          ? "uuid"
          : /^(true|false|0|1)$/i.test(queryValue)
            ? "flag"
            : "other",
    bodyKind,
    bodyKeys,
    matchesFlowEnterpriseId:
      Boolean(postData?.includes("6d3b4724-5880-11ee-827d-1219c832db49")),
    matchesFlowBranchId:
      Boolean(postData?.includes("1c527099-2e63-465f-b97a-772e36a93d8c")),
  };
}

async function readStorageKeys(
  page: Page,
): Promise<{ local: string[]; session: string[] }> {
  return page.evaluate(() => ({
    local: Object.keys(localStorage).sort(),
    session: Object.keys(sessionStorage).sort(),
  }));
}

export async function inspectKoperFlowContext(): Promise<KoperFlowContextDiagnostic> {
  return withBrowserless(async ({ page }) => {
    const login = await performKoperLogin(page);
    const emptyStorage = { local: [], session: [] };

    if (!login.authenticated) {
      return {
        ok: true,
        authenticated: false,
        activeCompanyBefore: null,
        activeCompanyAfter: null,
        flowCardFound: false,
        flowSelected: false,
        stockListReached: false,
        finalizedControlFound: false,
        finalizedClicked: false,
        quotationListReached: false,
        quotationFinalizedClicked: false,
        stockRequestReads: [],
        productCatalogReads: [],
        quotationReads: [],
        quotationFilterControls: [],
        quotationDetailReads: [],
        quotationDetailUrl: null,
        quotationRowTargets: [],
        purchaseDetailReads: [],
        purchaseDetailUrl: null,
        billDetailReads: [],
        billDetailUrl: null,
        materialFlowReads: [],
        materialFlowUrls: [],
        finalUrl: login.finalUrl,
        network: [],
        blockedWrites: [],
        switchAttempts: [],
        storageKeysBefore: emptyStorage,
        storageKeysAfter: emptyStorage,
        message: login.message,
        checkedAt: new Date().toISOString(),
      };
    }

    await page.waitForTimeout(3_000);
    const quotationOnly = process.env.KOPER_QUOTATION_ONLY === "true";
    const quotationDetailOnly =
      process.env.KOPER_QUOTATION_DETAIL_ONLY === "true";
    const purchaseDetailOnly =
      process.env.KOPER_PURCHASE_DETAIL_ONLY === "true";
    const billDetailOnly =
      process.env.KOPER_BILL_DETAIL_ONLY === "true";
    const materialFlowOnly =
      process.env.KOPER_MATERIAL_FLOW_ONLY === "true";
    const productDiscoveryOnly =
      process.env.KOPER_PRODUCT_DISCOVERY_ONLY === "true";

    const activeCompanyBefore = await readActiveCompanyLabel(page).catch(() => null);
    const storageKeysBefore = await readStorageKeys(page).catch(() => emptyStorage);
    const network: NetworkSummary[] = [];
    const blockedWrites: NetworkSummary[] = [];
    const stockRequestReads: StockRequestRead[] = [];
    const productCatalogReads: ProductCatalogRead[] = [];
    const quotationReads: QuotationRead[] = [];
    const quotationDetailReads: QuotationDetailRead[] = [];
    const purchaseDetailReads: PurchaseDetailRead[] = [];
    const billDetailReads: BillDetailRead[] = [];
    const materialFlowReads: MaterialFlowRead[] = [];
    const switchAttempts: SwitchAttemptShape[] = [];
    let quotationDetailMode = false;
    let purchaseDetailMode = false;
    let billDetailMode = false;
    let materialFlowMode = false;
    let quotationDetailUrl: string | null = null;
    let purchaseDetailUrl: string | null = null;
    let billDetailUrl: string | null = null;
    const materialFlowUrls: string[] = [];
    let quotationRowTargets: QuotationRowTarget[] = [];
    const pendingStockResponses: Promise<void>[] = [];
    let stockListMode: "active" | "active-page-2" | "finalized" = "active";

    await page.route("**/*", async (route) => {
      const request = route.request();
      const method = request.method();

      try {
        const parsedUrl = new URL(request.url());
        const hostname = parsedUrl.hostname;
        const isKoper =
          hostname === "koper.com.br" || hostname.endsWith(".koper.com.br");
        const isSafeRead = ["GET", "HEAD", "OPTIONS"].includes(method);
        const isCompanySwitch =
          method === "POST" &&
          hostname === "api.koper.com.br" &&
          parsedUrl.pathname === "/login/change_company";

        if (isCompanySwitch) {
          switchAttempts.push(
            inspectSwitchAttempt(request.url(), request.postData()),
          );
        }

        const isAllowedFlowSwitch =
          isCompanySwitch && isAllowedFlowSwitchBody(request.postData());

        if (isKoper && !isSafeRead && !isAllowedFlowSwitch) {
          blockedWrites.push(
            sanitizeRequest(request.url(), method, request.resourceType()),
          );
          await route.abort("blockedbyclient");
          return;
        }
      } catch {
        // URLs inválidas seguem o fluxo normal do navegador.
      }

      await route.continue();
    });

    const onRequest = (request: { url(): string; method(): string; resourceType(): string }): void => {
      try {
        const hostname = new URL(request.url()).hostname;

        if (
          network.length < 150 &&
          (hostname === "koper.com.br" || hostname.endsWith(".koper.com.br"))
        ) {
          network.push(
            sanitizeRequest(request.url(), request.method(), request.resourceType()),
          );
        }
      } catch {
        // Ignora URLs que não possam ser sanitizadas.
      }
    };

    const onResponse = (response: Response): void => {
      try {
        const request = response.request();
        const parsedUrl = new URL(response.url());

        const productCatalogPaths = new Set([
          "/stock/v1/product",
          "/stock/v1/group",
          "/stock/v1/subgroup",
          "/stock/v1/unit_measure",
          "/stock/v1/packing",
        ]);

        if (
          productDiscoveryOnly
          && request.method() === "GET"
          && parsedUrl.hostname === "api.koper.com.br"
          && productCatalogPaths.has(parsedUrl.pathname)
        ) {
          const task = response.json().then((body: unknown) => {
            const object = typeof body === "object" && body !== null && !Array.isArray(body)
              ? body as Record<string, unknown>
              : null;
            const records = Array.isArray(body)
              ? body
              : Object.values(object ?? {}).find((value) => Array.isArray(value)) ?? [];
            const allowedFields = new Set([
              "productId", "productName", "productFullName", "mainProductId",
              "unitMeasureId", "symbol", "groupId", "groupName", "subgroupId",
              "subgroupName", "packingId", "packingName", "status", "active",
            ]);
            const sample = (records as unknown[]).slice(0, 25).flatMap((item) => {
              if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
              return [Object.fromEntries(
                Object.entries(item as Record<string, unknown>)
                  .filter(([key, value]) => allowedFields.has(key)
                    && ["string", "number", "boolean"].includes(typeof value)),
              )];
            });
            const queryParams = Object.fromEntries(
              ["limit", "offset", "subgroupId", "formatted", "allProducts", "groupId", "orderFlag", "orderby"]
                .flatMap((key) => parsedUrl.searchParams.has(key)
                  ? [[key, parsedUrl.searchParams.get(key) ?? ""] as const]
                  : []),
            );

            productCatalogReads.push({
              endpoint: parsedUrl.origin + parsedUrl.pathname,
              statusCode: response.status(),
              queryParams,
              dataKeys: object ? Object.keys(object).slice(0, 50) : [],
              fieldPaths: collectFieldPaths(body).slice(0, 200),
              itemsAmount: safeNumber(object?.itemsAmount ?? object?.total),
              returnedRecords: (records as unknown[]).length,
              sample,
            });
          }).catch(() => undefined);
          pendingStockResponses.push(task);
        } else if (
          request.method() === "GET" &&
          parsedUrl.hostname === "api.koper.com.br" &&
          parsedUrl.pathname === "/stock/v1/request"
        ) {
          const listMode = stockListMode;

          const summary = sanitizeRequest(
            response.url(),
            request.method(),
            request.resourceType(),
          );
          const task = response
            .json()
            .then((body: unknown) => {
              const safeBody = collectSafeStockRequests(body);

              stockRequestReads.push({
                ...summary,
                listMode,
                statusCode: response.status(),
                queryParams: safeStockQueryParams(parsedUrl),
                ...safeBody,
              });
            })
            .catch(() => undefined);

          pendingStockResponses.push(task);
        } else if (
          request.method() === "GET" &&
          parsedUrl.hostname === "api.koper.com.br" &&
          parsedUrl.pathname === "/purchase/v1/budget"
        ) {
          const summary = sanitizeRequest(
            response.url(),
            request.method(),
            request.resourceType(),
          );
          const task = response.json().then((body: unknown) => {
            const object =
              typeof body === "object" && body !== null
                ? (body as Record<string, unknown>)
                : null;
            const allowed = ["budgetId", "initialDate", "finalDate", "limit", "offset", "orderFlag", "orderby", "typeDate"];

            if (
              quotationDetailMode
              && parsedUrl.searchParams.get("budgetId") !== "all"
            ) {
              quotationDetailReads.push({
                ...summary,
                statusCode: response.status(),
                dataKeys: object ? Object.keys(object).slice(0, 50) : [],
                fieldPaths: collectFieldPaths(body).slice(0, 200),
                budget: collectSafeQuotationDetail(body),
              });
              return;
            }

            quotationReads.push({
              ...summary,
              statusCode: response.status(),
              queryParams: Object.fromEntries(allowed.flatMap((key) => {
                const value = parsedUrl.searchParams.get(key);
                return value === null ? [] : [[key, value]];
              })),
              dataKeys: object ? Object.keys(object).slice(0, 50) : [],
              fieldPaths: collectFieldPaths(body).slice(0, 200),
              itemsAmount: safeNumber(object?.itemsAmount),
              budgetAmount: safeNumber(object?.budgetAmount),
              returnedRecords: Array.isArray(object?.budgets) ? object.budgets.length : 0,
              budgets: Array.isArray(object?.budgets)
                ? object.budgets.slice(0, 25).map((item: unknown) => {
                    const budget =
                      typeof item === "object" && item !== null
                        ? (item as Record<string, unknown>)
                        : {};

                    return {
                      budgetId: safeIdentifier(budget.budgetId),
                      supplierId: safeIdentifier(budget.supplierId),
                      buildMonitoringId: safeIdentifier(budget.buildMonitoringId),
                      budgetDate: safeText(budget.budgetDate),
                      responseDate: safeText(budget.responseDate),
                      productAmount: safeNumber(budget.productAmount),
                      totalValue: safeNumber(budget.totalValue),
                    };
                  })
                : [],
            });
          }).catch(() => undefined);

          pendingStockResponses.push(task);
        } else if (
          materialFlowMode
          && request.method() === "GET"
          && parsedUrl.hostname === "api.koper.com.br"
          && (
            parsedUrl.pathname === "/purchase/v1/purchase_order"
            || parsedUrl.pathname === "/stock/v1/product_entry"
            || parsedUrl.pathname === "/stock/v1/entry"
            || parsedUrl.pathname === "/stock/v1/pending_entry"
            || parsedUrl.pathname === "/financial/v1/xml_invoice"
          )
        ) {
          const summary = sanitizeRequest(
            response.url(),
            request.method(),
            request.resourceType(),
          );
          const task = response.json().then((body: unknown) => {
            const object =
              typeof body === "object" && body !== null
                ? (body as Record<string, unknown>)
                : null;
            const allowed = [
              "orderId",
              "entryId",
              "pending",
              "invoiceId",
              "page",
              "limit",
              "offset",
              "open",
              "orderFlag",
              "orderby",
              "typeDate",
            ];

            materialFlowReads.push({
              ...summary,
              statusCode: response.status(),
              queryParams: Object.fromEntries(allowed.flatMap((key) => {
                const value = parsedUrl.searchParams.get(key);
                return value === null ? [] : [[key, value]];
              })),
              dataKeys: object ? Object.keys(object).slice(0, 100) : [],
              fieldPaths: collectFieldPaths(body).slice(0, 500),
              order:
                parsedUrl.pathname === "/purchase/v1/purchase_order"
                  ? collectSafeMaterialOrder(body)
                  : null,
              entry:
                parsedUrl.pathname === "/stock/v1/product_entry"
                  ? collectSafeMaterialEntry(body)
                  : null,
              invoice:
                parsedUrl.pathname === "/financial/v1/xml_invoice"
                  ? collectSafeMaterialInvoice(body)
                  : null,
            });
          }).catch(() => undefined);

          pendingStockResponses.push(task);
        } else if (
          billDetailMode
          && request.method() === "GET"
          && parsedUrl.hostname === "api.koper.com.br"
          && (
            parsedUrl.pathname.startsWith("/financial/v1/")
            || parsedUrl.pathname.startsWith("/financial/v2/")
          )
        ) {
          const summary = sanitizeRequest(
            response.url(),
            request.method(),
            request.resourceType(),
          );
          const task = response.json().then((body: unknown) => {
            const object =
              typeof body === "object" && body !== null
                ? (body as Record<string, unknown>)
                : null;
            const allowed = [
              "billId",
              "billToPayId",
              "allBills",
              "receiptId",
              "invoiceId",
              "limit",
              "offset",
              "orderFlag",
              "orderby",
              "typeDate",
            ];

            billDetailReads.push({
              ...summary,
              statusCode: response.status(),
              queryParams: Object.fromEntries(allowed.flatMap((key) => {
                const value = parsedUrl.searchParams.get(key);
                return value === null ? [] : [[key, value]];
              })),
              dataKeys: object ? Object.keys(object).slice(0, 80) : [],
              fieldPaths: collectFieldPaths(body).slice(0, 400),
              bill:
                parsedUrl.pathname === "/financial/v1/bills_to_pay"
                  ? collectSafeBillDetail(body)
                  : null,
              events:
                parsedUrl.pathname.endsWith("/events")
                  ? collectSafeBillEvents(body)
                  : [],
            });
          }).catch(() => undefined);

          pendingStockResponses.push(task);
        } else if (
          purchaseDetailMode
          && request.method() === "GET"
          && parsedUrl.hostname === "web.koper.com.br"
          && /\/financeiro\/contas-a-pagar\/15902\.json$/.test(parsedUrl.pathname)
        ) {
          const summary = sanitizeRequest(
            response.url(),
            request.method(),
            request.resourceType(),
          );
          const task = response.json().then((body: unknown) => {
            const object =
              typeof body === "object" && body !== null
                ? (body as Record<string, unknown>)
                : null;

            billDetailReads.push({
              ...summary,
              statusCode: response.status(),
              queryParams: {},
              dataKeys: object ? Object.keys(object).slice(0, 80) : [],
              fieldPaths: collectFieldPaths(body).slice(0, 400),
              bill: null,
              events: [],
            });
          }).catch(() => undefined);

          pendingStockResponses.push(task);
        } else if (
          purchaseDetailMode
          && request.method() === "GET"
          && parsedUrl.hostname === "api.koper.com.br"
          && parsedUrl.pathname === "/supply/v2/purchases/details/13667"
        ) {
          const summary = sanitizeRequest(
            response.url(),
            request.method(),
            request.resourceType(),
          );
          const task = response.json().then((body: unknown) => {
            const object =
              typeof body === "object" && body !== null
                ? (body as Record<string, unknown>)
                : null;

            purchaseDetailReads.push({
              ...summary,
              statusCode: response.status(),
              dataKeys: object ? Object.keys(object).slice(0, 80) : [],
              fieldPaths: collectFieldPaths(body).slice(0, 300),
              purchase: collectSafePurchaseDetail(body),
            });
          }).catch(() => undefined);

          pendingStockResponses.push(task);
        } else if (
          quotationDetailMode
          && request.method() === "GET"
          && parsedUrl.hostname === "api.koper.com.br"
          && parsedUrl.pathname.startsWith("/purchase/")
        ) {
          const summary = sanitizeRequest(
            response.url(),
            request.method(),
            request.resourceType(),
          );
          const task = response.json().then((body: unknown) => {
            const object =
              typeof body === "object" && body !== null
                ? (body as Record<string, unknown>)
                : null;

            quotationDetailReads.push({
              ...summary,
              statusCode: response.status(),
              dataKeys: object ? Object.keys(object).slice(0, 50) : [],
              fieldPaths: collectFieldPaths(body).slice(0, 200),
              budget: collectSafeQuotationDetail(body),
            });
          }).catch(() => undefined);

          pendingStockResponses.push(task);
        }
      } catch {
        // Ignora respostas que não possam ser sanitizadas.
      }
    };

    page.on("request", onRequest);
    page.on("response", onResponse);

    if (activeCompanyBefore) {
      await openCompanySelectorAndCollectOptions(page, activeCompanyBefore);
    }

    const flowCard = page
      .locator('[data-testid="multiCompaniesModal"]')
      .filter({
        has: page.getByText(/^FLOW APTOS - BOSSA$/i, { exact: true }),
      })
      .first();
    const flowCardFound = await flowCard.isVisible().catch(() => false);
    let flowSelected = false;
    let activeCompanyAfter: string | null = null;
    let message: string | null = null;

    if (flowCardFound) {
      const action = flowCard
        .getByText(/^Acessar esta empresa$/i, { exact: true })
        .last();

      if (await action.isVisible().catch(() => false)) {
        await action.click();
        flowSelected = true;
        await Promise.race([
          page.waitForLoadState("domcontentloaded", { timeout: 15_000 }),
          page.waitForTimeout(15_000),
        ]).catch(() => undefined);

        for (let attempt = 0; attempt < 10; attempt += 1) {
          await page.waitForTimeout(2_000);
          activeCompanyAfter = await readActiveCompanyLabel(page).catch(
            () => null,
          );

          if (/flow/i.test(activeCompanyAfter ?? "")) {
            break;
          }
        }
      } else {
        message = "KOPER_FLOW_ACCESS_ACTION_NOT_FOUND";
      }
    } else {
      message = "KOPER_FLOW_COMPANY_CARD_NOT_FOUND";
    }

    let stockListReached = false;
    let finalizedControlFound = false;
    let finalizedClicked = false;

    if (
      !quotationOnly
      && !purchaseDetailOnly
      && !billDetailOnly
      && !materialFlowOnly
      && !productDiscoveryOnly
      && /flow/i.test(activeCompanyAfter ?? "")
    ) {
      const supplies = page.locator('[data-testid="button-Suprimentos"]').first();

      if (await supplies.isVisible().catch(() => false)) {
        await supplies.click({ force: true });
        await page.waitForTimeout(1_500);

        const requests = page.getByText(/^Solicitações$/i, { exact: true });
        const count = Math.min(await requests.count(), 30);

        for (let index = 0; index < count; index += 1) {
          const item = requests.nth(index);

          if (await item.isVisible().catch(() => false)) {
            await item.click();
            await page.waitForTimeout(8_000);
            break;
          }
        }
      }

      stockListReached =
        page.url().includes("/suprimentos/solicitacoes") ||
        stockRequestReads.length > 0;

      if (stockListReached) {
        const activePage = page.locator("ul.pagination li.active").first();
        const nextPage = activePage
          .locator("xpath=following-sibling::li[1]/a")
          .first();

        stockListMode = "active-page-2";
        const pageTwoResponse = page.waitForResponse(
          (response) => {
            try {
              const url = new URL(response.url());
              return (
                response.request().method() === "GET" &&
                url.hostname === "api.koper.com.br" &&
                url.pathname === "/stock/v1/request" &&
                url.searchParams.get("offset") === "25"
              );
            } catch {
              return false;
            }
          },
          { timeout: 15_000 },
        );

        if (await nextPage.isVisible().catch(() => false)) {
          await nextPage.click();
        } else {
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);

            for (const element of document.querySelectorAll<HTMLElement>("body *")) {
              if (element.scrollHeight > element.clientHeight + 100) {
                element.scrollTop = element.scrollHeight;
                element.dispatchEvent(new Event("scroll"));
              }
            }
          });
          await page.mouse.wheel(0, 100_000);
        }

        await pageTwoResponse.catch(() => undefined);
        await page.waitForTimeout(2_000);
      }

      if (stockListReached) {
        const finalized = page
          .locator("button, a, [role='button'], input[type='button'], input[type='submit']")
          .filter({ hasText: /ver finalizad[oa]s/i })
          .last();
        const finalizedInput = page
          .locator("input[value*='FINALIZAD' i]")
          .last();
        const control =
          await finalized.isVisible().catch(() => false)
            ? finalized
            : finalizedInput;

        finalizedControlFound = await control.isVisible().catch(() => false);

        if (finalizedControlFound) {
          stockListMode = "finalized";
          const finalizedResponse = page.waitForResponse(
            (response) => {
              try {
                const url = new URL(response.url());
                return (
                  response.request().method() === "GET" &&
                  url.hostname === "api.koper.com.br" &&
                  url.pathname === "/stock/v1/request"
                );
              } catch {
                return false;
              }
            },
            { timeout: 15_000 },
          );

          await control.click();
          finalizedClicked = true;
          await finalizedResponse.catch(() => undefined);
          await page.waitForTimeout(2_000);
        }
      }
    }

    if (productDiscoveryOnly && /flow/i.test(activeCompanyAfter ?? "")) {
      await page.goto("https://web.koper.com.br/suprimentos/produtos", {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(12_000);
    }

    let quotationListReached = false;
    let quotationFinalizedClicked = false;
    let quotationFilterControls: FilterControl[] = [];

    if (purchaseDetailOnly && /flow/i.test(activeCompanyAfter ?? "")) {
      network.splice(0);
      purchaseDetailMode = true;
      await page.goto("https://web.koper.com.br/suprimentos/compras/13667", {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      }).catch(() => undefined);
      await page.waitForTimeout(7_000);
      purchaseDetailUrl = page.url();
    }

    if (billDetailOnly && /flow/i.test(activeCompanyAfter ?? "")) {
      network.splice(0);
      billDetailMode = true;
      await page.goto(
        "https://web.koper.com.br/financeiro/contas-a-pagar/15902?billToPayId=14525",
        {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        },
      ).catch(() => undefined);
      await page.waitForTimeout(7_000);
      billDetailUrl = page.url();
    }

    if (materialFlowOnly && /flow/i.test(activeCompanyAfter ?? "")) {
      network.splice(0);
      materialFlowMode = true;

      await page.goto(
        "https://app.koper.com.br/compras/ordens_compra/view/10455",
        {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        },
      ).catch(() => undefined);
      await page.waitForTimeout(5_000);
      materialFlowUrls.push(page.url());

      await page.goto(
        "https://app.koper.com.br/suprimentos/entradas/view/13373",
        {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        },
      ).catch(() => undefined);
      await page.waitForTimeout(5_000);
      materialFlowUrls.push(page.url());

      await page.goto(
        "https://app.koper.com.br/financeiro/notas_fiscais/view/d4360ae6-85f9-11f1-9cb1-86c46e718d59",
        {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        },
      ).catch(() => undefined);
      await page.waitForTimeout(5_000);
      materialFlowUrls.push(page.url());
    }

    if (
      !purchaseDetailOnly
      && !billDetailOnly
      && !materialFlowOnly
      && !productDiscoveryOnly
      && /flow/i.test(activeCompanyAfter ?? "")
    ) {
      network.splice(0);

      if (quotationOnly) {
        if (quotationDetailOnly) {
          quotationDetailMode = true;
          await page.goto("https://app.koper.com.br/compras/orcamentos/view/3268", {
            waitUntil: "domcontentloaded",
            timeout: 15_000,
          }).catch(() => undefined);
          await page.waitForTimeout(5_000);
          quotationDetailUrl = page.url();
        } else {
          await page.goto("https://app.koper.com.br/compras/orcamentos/finalizados", {
            waitUntil: "domcontentloaded",
            timeout: 15_000,
          }).catch(() => undefined);
        }
      } else {
        const purchasesButton = page.locator('[data-testid="button-Compras"]').first();
      const purchasesImage = page.locator('img[src*="purchase-"]').first();
      const purchases =
        await purchasesButton.isVisible().catch(() => false)
          ? purchasesButton
          : purchasesImage;

      if (await purchases.isVisible().catch(() => false)) {
        await purchases.evaluate((element) => {
          let current: HTMLElement | null = element as HTMLElement;

          for (let depth = 0; current && depth < 8; depth += 1) {
            if (
              current.tagName.toLowerCase() === "button" ||
              current.getAttribute("role") === "button" ||
              current.hasAttribute("onclick")
            ) {
              current.click();
              return;
            }

            current = current.parentElement;
          }

          (element as HTMLElement).click();
        });
        await page.waitForTimeout(1_500);

        const budgets = page.getByText(/^Orçamentos$/i, { exact: true });
        const count = Math.min(await budgets.count(), 30);

        for (let index = 0; index < count; index += 1) {
          const item = budgets.nth(index);

          if (await item.isVisible().catch(() => false)) {
            await Promise.all([
              page.waitForURL(/\/compras\/orcamentos/i, { timeout: 10_000 }).catch(() => undefined),
              item.click(),
            ]);
            break;
          }
        }
      }
      }

      quotationListReached = /\/compras\/orcamentos/i.test(page.url());

      if (quotationListReached) {
        const finalized = page
          .locator("button, a, [role='button'], input[type='button']")
          .filter({ hasText: /ver finalizad[oa]s/i })
          .last();

        const alreadyFinalized = /\/compras\/orcamentos\/finalizados/i.test(page.url());
        const finalizedVisible = await finalized.isVisible().catch(() => false);

        if (alreadyFinalized || finalizedVisible) {
          if (!alreadyFinalized) {
            await Promise.all([
              page.waitForURL(/\/compras\/orcamentos\/finalizados/i, { timeout: 10_000 }).catch(() => undefined),
              finalized.click(),
            ]);
            quotationFinalizedClicked = true;
          } else {
            await page.waitForTimeout(3_000);
          }

          quotationFilterControls = await page
            .locator("button, input, select, [role='button'], [role='combobox'], [class*='select' i], [class*='dropdown' i]")
            .evaluateAll((elements) => elements.flatMap((element) => {
              const node = element as HTMLElement;
              const rect = node.getBoundingClientRect();
              const style = window.getComputedStyle(node);

              if (rect.y < 70 || rect.y > 260 || rect.width === 0 || rect.height === 0 || style.display === "none") {
                return [];
              }

              return [{
                tag: node.tagName.toLowerCase(),
                text: (node.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
                className: node.className.toString().slice(0, 160),
                role: node.getAttribute("role"),
                type: node.getAttribute("type"),
                ariaLabel: node.getAttribute("aria-label"),
                testId: node.getAttribute("data-testid"),
              }];
            })).then((items) => items.slice(0, 80));

          const periodToggle = page
            .locator("div.input-default.dropdown-toggle")
            .filter({ hasText: /\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}/ })
            .last();

          if (await periodToggle.isVisible().catch(() => false)) {
            await periodToggle.click();
            await page.waitForTimeout(500);

            const toggleBox = await periodToggle.boundingBox();

            if (toggleBox) {
              const allPeriodResponse = page.waitForResponse(
                (response) => {
                  try {
                    const url = new URL(response.url());
                    return (
                      response.request().method() === "GET"
                      && url.hostname === "api.koper.com.br"
                      && url.pathname === "/purchase/v1/budget"
                    );
                  } catch {
                    return false;
                  }
                },
                { timeout: 15_000 },
              );

              await page.mouse.click(
                toggleBox.x + Math.min(30, toggleBox.width / 2),
                toggleBox.y + toggleBox.height + 18,
              );
              await allPeriodResponse.catch(() => undefined);
              await page.waitForTimeout(1_000);

              quotationRowTargets = await page.evaluate(() => {
                const exact = [...document.querySelectorAll<HTMLElement>("body *")]
                  .filter((element) => (element.innerText || "").trim() === "3268")
                  .slice(0, 5);
                const targets: Array<{
                  tag: string;
                  className: string;
                  href: string | null;
                  ngClick: string | null;
                  uiSref: string | null;
                  role: string | null;
                }> = [];

                for (const element of exact) {
                  let current: HTMLElement | null = element;

                  for (let depth = 0; current && depth < 6; depth += 1) {
                    targets.push({
                      tag: current.tagName.toLowerCase(),
                      className: current.className.toString().slice(0, 160),
                      href: current.getAttribute("href"),
                      ngClick: current.getAttribute("ng-click"),
                      uiSref: current.getAttribute("ui-sref"),
                      role: current.getAttribute("role"),
                    });
                    current = current.parentElement;
                  }
                }

                return targets.slice(0, 30);
              });

              const budgetRowOnFirstPage = page
                .getByText(/^3268$/, { exact: true })
                .first()
                .locator("xpath=ancestor::tr[1]");

              if (await budgetRowOnFirstPage.isVisible().catch(() => false)) {
                quotationDetailMode = true;
                await budgetRowOnFirstPage.click();
                await page.waitForTimeout(5_000);
                quotationDetailUrl = page.url();
              }

              if (!quotationDetailMode) {
              const pageTwoResponse = page.waitForResponse(
                (response) => {
                  try {
                    const url = new URL(response.url());
                    return (
                      response.request().method() === "GET"
                      && url.hostname === "api.koper.com.br"
                      && url.pathname === "/purchase/v1/budget"
                      && url.searchParams.get("offset") === "25"
                    );
                  } catch {
                    return false;
                  }
                },
                { timeout: 15_000 },
              );

              await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);

                for (const element of document.querySelectorAll<HTMLElement>("body *")) {
                  if (element.scrollHeight > element.clientHeight + 100) {
                    element.scrollTop = element.scrollHeight;
                    element.dispatchEvent(new Event("scroll"));
                  }
                }
              });
              await page.mouse.wheel(0, 100_000);
              await pageTwoResponse.catch(() => undefined);
              await page.waitForTimeout(1_000);

              await page.evaluate(() => {
                window.scrollTo(0, 0);

                for (const element of document.querySelectorAll<HTMLElement>("body *")) {
                  if (element.scrollHeight > element.clientHeight + 100) {
                    element.scrollTop = 0;
                    element.dispatchEvent(new Event("scroll"));
                  }
                }
              });
              await page.mouse.wheel(0, -100_000);
              await page.waitForTimeout(500);

              const budgetCode = page.getByText(/^3268$/, { exact: true }).first();

              if (await budgetCode.isVisible().catch(() => false)) {
                quotationDetailMode = true;
                await budgetCode.click();
                await page.waitForTimeout(5_000);
                quotationDetailUrl = page.url();
              }
              }
            }
          }
        }
      }
    }

    await Promise.allSettled(pendingStockResponses);
    page.off("request", onRequest);
    page.off("response", onResponse);
    await page.unroute("**/*").catch(() => undefined);

    activeCompanyAfter ??= await readActiveCompanyLabel(page).catch(() => null);
    const storageKeysAfter = await readStorageKeys(page).catch(() => emptyStorage);

    return {
      ok: true,
      authenticated: true,
      activeCompanyBefore,
      activeCompanyAfter,
      flowCardFound,
      flowSelected,
      stockListReached,
      finalizedControlFound,
      finalizedClicked,
      quotationListReached,
      quotationFinalizedClicked,
      stockRequestReads,
      productCatalogReads,
      quotationReads,
      quotationFilterControls,
      quotationDetailReads,
      quotationDetailUrl,
      quotationRowTargets,
      purchaseDetailReads,
      purchaseDetailUrl,
      billDetailReads,
      billDetailUrl,
      materialFlowReads,
      materialFlowUrls,
      finalUrl: page.url(),
      network,
      blockedWrites,
      switchAttempts,
      storageKeysBefore,
      storageKeysAfter,
      message,
      checkedAt: new Date().toISOString(),
    };
  });
}
