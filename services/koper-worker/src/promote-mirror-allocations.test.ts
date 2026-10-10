import assert from "node:assert/strict";
import { test } from "node:test";

process.env.WORKER_API_KEY = "x".repeat(40);
process.env.KOPER_LOGIN_URL = "https://app.koper.com.br/login";
process.env.KOPER_USERNAME = "u";
process.env.KOPER_PASSWORD = "p";
process.env.BOSSA_COMPANY_ID = "11111111-1111-4111-8111-111111111111";

const { buildContext, distribute, lineTotals, productTargets, resolveBill } = await import("./promote-mirror-allocations.js");
const { exactQuantity, planBudget, readMonitoringItems } = await import("./promote-mirror-budget.js");
type Row = Record<string, unknown>;
const map = (entries: Array<[string, Row]>) => new Map<string, Row>(entries);

const monitoring = {
  items: [
    { itemMonitoringId: 1, itemReference: "1", itemName: "Preliminares", serviceId: null, itemHasChildren: true, fatherItemId: null, monItemExpectedValue: 300 },
    { itemMonitoringId: 10, itemReference: "1.1", itemName: "Projeto", serviceId: 500, itemHasChildren: false, fatherItemId: 1, itemAmount: 1, monItemExpectedValue: 100 },
    { itemMonitoringId: 11, itemReference: "1.2", itemName: "Alvenaria A", serviceId: 600, itemHasChildren: false, fatherItemId: 1, itemAmount: 3, monItemExpectedValue: 100 },
    { itemMonitoringId: 12, itemReference: "1.3", itemName: "Alvenaria B", serviceId: 600, itemHasChildren: false, fatherItemId: 1, itemAmount: 4, monItemExpectedValue: 100 },
  ],
};

function context(inputServices: Array<[string, Row]> = [["133-70", { items: [{ itemMonitInputId: 900, itemMonitoringId: 11 }, { itemMonitInputId: 901, itemMonitoringId: 10 }] }]]) {
  return buildContext({
    company: "alma",
    receipts: map([
      ["1", { receiptId: 1, totalValue: 1000, buildMonitoringId: 133, bills: [{ billId: 101 }, { billId: 102 }], services: [{ serviceId: 500, serviceValue: 1000, serviceAmount: 1 }], products: [] }],
      ["2", { receiptId: 2, totalValue: 900, buildMonitoringId: 133, bills: [{ billId: 201 }], services: [{ serviceId: 500, serviceValue: 100, serviceAmount: 3 }, { serviceId: 600, serviceValue: 200, serviceAmount: 3 }], servicesOrders: [{ serviceOrderId: 7 }], products: [] }],
      ["3", { receiptId: 3, totalValue: 500, buildMonitoringId: 133, purchaseId: 30, bills: [{ billId: 301 }], services: [], products: [{ productId: 70, inputId: 70, price: 50, productAmount: 10 }] }],
      ["4", { receiptId: 4, totalValue: 999, buildMonitoringId: 133, bills: [{ billId: 401 }], services: [{ serviceId: 500, serviceValue: 100, serviceAmount: 1 }, { serviceId: 600, serviceValue: 200, serviceAmount: 1 }], products: [] }],
    ]),
    invoices: map([
      ["nf1", { invoiceId: "nf1", buildMonitoringId: 133, bill: { duplicates: [{ billId: 501 }] }, purchaseOrders: [{ orderId: 40 }], products: [{ productId: 70, inputId: 70, totalValue: 300, amount: 6, unitValue: 50 }] }],
    ]),
    purchases: map([["30", { purchaseId: 30, receiptId: 3, purchaseOrders: [{ purchaseOrderId: 40 }], bills: [{ billId: 301 }] }]]),
    purchaseOrders: map([["40", { orderId: 40, buildMonitoringId: 133, products: [{ productId: 70, inputId: 70, requests: [{ requestId: 80, productRequestId: 81 }] }] }]]),
    serviceOrders: map([["7", { orderId: 7, services: [{ serviceId: 600, itemMonitoringId: 12 }] }]]),
    requests: map([["80", { requestId: 80, buildMonitoringId: 133, products: [{ productRequestId: 81, inputId: 70, services: [{ itemMonitInputId: 900, inputAmount: 3 }, { itemMonitInputId: 901, inputAmount: 1 }] }] }]]),
    monitoringItemsPayloads: map([["133", monitoring]]),
    inputServices: map(inputServices),
  });
}

test("distribute fecha a soma ao centavo", () => {
  assert.deepEqual(distribute(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(distribute(1000, [1]), [1000]);
  assert.deepEqual(distribute(5, [0, 0]), [3, 2]);
  assert.equal(distribute(123457, [3.3, 2.2, 9.1]).reduce((a, b) => a + b, 0), 123457);
});

test("nota de serviço com um serviço: parcelas recebem o mesmo serviço, item único no acompanhamento", () => {
  const ctx = context();
  for (const billId of ["101", "102"]) {
    const result = resolveBill(ctx, billId, { origins: {} });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.method, "koper_receipt_purchase");
    assert.deepEqual(result.lines.map((line) => [line.serviceId, line.itemMonitoringId, line.itemResolution]), [["500", "10", "serviço com item único no acompanhamento"]]);
    assert.equal(result.evidence.weightBasis, "destino único");
  }
});

test("nota com dois serviços: peso valor × quantidade fecha com o total; item vem da ordem de serviço", () => {
  const result = resolveBill(context(), "201", { origins: { receipt_id: 2 } });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const byService = Object.fromEntries(result.lines.map((line) => [line.serviceId, line]));
  assert.equal(byService["500"]!.weight, 300);
  assert.equal(byService["600"]!.weight, 600);
  assert.equal(byService["600"]!.itemMonitoringId, "12", "serviço 600 tem dois itens; a ordem de serviço desempata");
  assert.equal(byService["600"]!.itemResolution, "ordem de serviço");
  assert.deepEqual(distribute(90000, result.lines.map((line) => line.weight)).sort(), [30000, 60000]);
  assert.deepEqual(result.evidence.serviceOrderIds, ["7"]);
});

test("linhas que não fecham com o total da nota não são rateadas", () => {
  const result = resolveBill(context(), "401", { origins: {} });
  assert.deepEqual(result, { ok: false, document: "nota manual / recibo", reason: "valores das linhas não fecham com o total da nota" });
});

test("material: produto → ordem de compra → solicitação → insumo → item → serviço", () => {
  const ctx = context();
  const manual = resolveBill(ctx, "301", { origins: {} });
  assert.equal(manual.ok, true);
  if (!manual.ok) return;
  assert.deepEqual(manual.lines.map((line) => [line.serviceId, line.itemMonitoringId, line.weight]).sort(), [["500", "10", 125], ["600", "11", 375]]);
  assert.deepEqual(manual.evidence.orderSourceIds, ["40"]);
  const invoice = resolveBill(ctx, "501", { origins: {} });
  assert.equal(invoice.ok, true);
  if (!invoice.ok) return;
  assert.equal(invoice.method, "koper_invoice_purchase_order");
  assert.deepEqual(invoice.lines.map((line) => [line.serviceId, line.weight]).sort(), [["500", 75], ["600", 225]]);
});

test("material sem de-para carregado ou sem ordem de compra fica pendente com motivo", () => {
  const pending = resolveBill(context([]), "301", { origins: {} });
  assert.deepEqual(pending, { ok: false, document: "nota manual / recibo", reason: "de-para de insumos ainda não carregado" });
  assert.deepEqual(productTargets(context(), { productId: "70", inputId: "70" }, []), { ok: false, reason: "produto sem ordem de compra" });
  assert.deepEqual(productTargets(context(), { productId: "70", inputId: "70" }, ["999"]), { ok: false, reason: "ordem de compra ainda fora da área de espera" });
  assert.deepEqual(productTargets(context([["133-70", { items: [{ itemMonitInputId: 900, itemMonitoringId: 11 }] }]]), { productId: "70", inputId: "70" }, ["40"]), { ok: false, reason: "insumo sem de-para no acompanhamento" });
});

test("tributo e título sem documento não são rateados", () => {
  assert.deepEqual(resolveBill(context(), "900", { origins: { tax_id: 5 } }), { ok: false, document: "tributo", reason: "tributo: o Koper não liga a um serviço" });
  assert.deepEqual(resolveBill(context(), "901", { origins: {} }), { ok: false, document: "sem documento", reason: "sem documento: o Koper não liga a um serviço" });
  assert.deepEqual(resolveBill(context(), "902", { origins: { receipt_id: 777 } }), { ok: false, document: "nota fora da área de espera", reason: "nota citada não está na área de espera" });
});

test("lineTotals escolhe a leitura que fecha com o total", () => {
  const lines = [
    { kind: "service" as const, unit: 900, amount: 3, explicitTotal: null, serviceId: "1", productId: null, inputId: null },
    { kind: "product" as const, unit: 10, amount: 10, explicitTotal: null, serviceId: null, productId: "2", inputId: null },
  ];
  const chosen = lineTotals(lines, 1000);
  assert.deepEqual(chosen.totals, [900, 100]);
  assert.equal(chosen.basis, "serviço:valor|produto:preço×qtd");
  assert.equal(chosen.relativeError, 0);
});

test("orçamento: grupos, folhas e quantidade exata", () => {
  const plan = planBudget(readMonitoringItems(monitoring));
  assert.deepEqual(plan.groups.map((group) => group.code), ["1"]);
  assert.deepEqual(plan.leaves.map((leaf) => leaf.reference), ["1.1", "1.2", "1.3"]);
  assert.equal(plan.leavesCents, 30000);
  assert.deepEqual(plan.oddItems, []);
  assert.deepEqual([plan.stageItems, plan.negativeStages, plan.rootsCents], [[], [], 30000]);
  // Previsto lançado na etapa: o que sobra além dos filhos vira item da etapa, sem serviço.
  const staged = planBudget(readMonitoringItems({ items: [
    { itemMonitoringId: 1, itemReference: "2", itemName: "Estrutura", serviceId: null, itemHasChildren: true, fatherItemId: null, monItemExpectedValue: 1000.5 },
    { itemMonitoringId: 2, itemReference: "2.1", itemName: "Fundação", serviceId: null, itemHasChildren: true, fatherItemId: 1, monItemExpectedValue: 400 },
    { itemMonitoringId: 3, itemReference: "2.1.1", itemName: "Estaca", serviceId: 9, itemHasChildren: false, fatherItemId: 2, monItemExpectedValue: 150 },
    { itemMonitoringId: 4, itemReference: "2.2", itemName: "Sem detalhe", serviceId: null, itemHasChildren: false, fatherItemId: 1, monItemExpectedValue: 100 },
  ] }));
  assert.deepEqual(staged.stageItems.map((item) => [item.reference, item.ownCents]), [["2", 50050], ["2.1", 25000], ["2.2", 10000]]);
  assert.equal(staged.leavesCents + staged.stageItems.reduce((sum, item) => sum + item.ownCents, 0), staged.rootsCents);
  assert.equal(staged.rootsCents, 100050);
  assert.deepEqual(exactQuantity(4, 10000), { quantity: 4, unitCost: 25, keptQuantity: true });
  assert.deepEqual(exactQuantity(3, 10000), { quantity: 1, unitCost: 100, keptQuantity: false });
  assert.deepEqual(exactQuantity(0, 10000), { quantity: 1, unitCost: 100, keptQuantity: false });
  assert.deepEqual(exactQuantity(1, 12345), { quantity: 1, unitCost: 123.45, keptQuantity: true });
});
