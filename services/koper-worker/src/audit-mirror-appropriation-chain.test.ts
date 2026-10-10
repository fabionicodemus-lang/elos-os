import assert from "node:assert/strict";
import { test } from "node:test";

process.env.WORKER_API_KEY = "x".repeat(40);
process.env.KOPER_LOGIN_URL = "https://app.koper.com.br/login";
process.env.KOPER_USERNAME = "u";
process.env.KOPER_PASSWORD = "p";
process.env.BOSSA_COMPANY_ID = "11111111-1111-4111-8111-111111111111";

const { collectByKeys, measureChain } = await import("./audit-mirror-appropriation-chain.js");
type Row = Record<string, unknown>;
const map = (entries: Array<[string, Row]>) => new Map(entries);

test("collectByKeys acha ids em qualquer profundidade e ignora vazios", () => {
  const found = collectByKeys({ a: [{ requestId: 7, x: { requestId: "8" } }, { requestId: null }, { requestId: 0 }], purchaseOrderIds: [10, 11] }, new Set(["requestId", "purchaseOrderIds"]));
  assert.deepEqual([...found].sort(), ["10", "11", "7", "8"]);
});

test("mede até onde a cadeia de cada título chega", () => {
  const result = measureChain({
    bills: map([
      ["1", { billValue: 100 }], // NF-e → compra → OC → solicitação com item do orçamento
      ["2", { billValue: 50 }],  // recibo com serviço (sem item)
      ["3", { billValue: 30 }],  // tributo, sem nada
      ["4", { billValue: 20 }],  // pai de agrupamento
      ["5", { billValue: 70 }],  // OS → contrato com item
      ["6", { billValue: 10 }],  // nota manual só com obra
    ]),
    billDetails: map([
      ["1", { bill_type: "Original", cost_center: { id: 169 }, origins: { invoice_id: "inv-1" } }],
      ["2", { bill_type: "Original", cost_center: { id: 135 }, origins: { receipt_id: 20 } }],
      ["3", { bill_type: "Original", cost_center: { id: 3 }, origins: { tax_id: 9 } }],
      ["4", { bill_type: "Grupo", cost_center: { id: null }, origins: {} }],
      ["5", { bill_type: "Parcela", cost_center: { id: 169 }, origins: { receipt_id: 50 } }],
      ["6", { bill_type: "Original", cost_center: { id: 102 }, origins: { receipt_id: 60 } }],
    ]),
    purchases: map([
      ["p1", { xmlInvoiceId: "inv-1", receiptId: null, purchaseOrders: [{ purchaseOrderId: 900 }], servicesOrders: [], services: [], bills: [{ billId: 1 }] }],
      ["p2", { receiptId: 20, purchaseOrders: [], servicesOrders: [], services: [{ serviceId: 426 }], bills: [{ billId: 2 }] }],
      ["p5", { receiptId: 50, purchaseOrders: [], servicesOrders: [{ orderId: 700 }], services: [], bills: [{ billId: 5 }] }],
    ]),
    receipts: map([
      ["20", { purchaseId: "p2", services: [{ serviceId: 426 }], bills: [{ billId: 2 }], buildMonitoringId: 34 }],
      ["50", { purchaseId: "p5", servicesOrders: [], bills: [{ billId: 5 }], buildMonitoringId: 67 }],
      ["60", { purchaseId: null, services: [], bills: [{ billId: 6 }], buildMonitoringId: 1 }],
    ]),
    invoices: map([["inv-1", { bill: { duplicates: [{ billId: 1 }] }, purchaseOrders: null, buildMonitoringId: 67 }]]),
    purchaseOrders: map([["900", { buildMonitoringId: 67, products: [{ services: [], requests: [{ requestId: 55, productRequestId: 5501 }] }] }]]),
    serviceOrders: map([["700", { buildMonitoringId: 67, contractId: 826, services: [{ serviceId: 17 }] }]]),
    requests: map([["55", { buildMonitoringId: 67, products: [{ productRequestId: 5501, services: [{ itemMonitInputId: 10775 }] }] }]]),
    contracts: map([["826", { services: [{ serviceId: 17, itemMonitoringId: 3001, itemReference: "04.02" }] }]]),
    measurements: map([]),
  });
  assert.equal(result.titles, 6);
  assert.equal(result.considered, 5);
  assert.deepEqual(result.skipped, { "pai de agrupamento": { count: 1, total: 20 } });
  assert.deepEqual(result.byEvidence, {
    "item do orçamento": { count: 2, total: 170 },
    "serviço": { count: 1, total: 50 },
    "nenhuma": { count: 1, total: 30 },
    "só obra": { count: 1, total: 10 },
  });
  assert.deepEqual(result.reach["chega à solicitação de material"], { count: 1, total: 100 });
  assert.deepEqual(result.reach["chega à ordem de serviço"], { count: 1, total: 70 });
  assert.deepEqual(result.reach["chega ao contrato"], { count: 1, total: 70 });
  assert.deepEqual(result.reach["chega à compra"], { count: 3, total: 220 });
  assert.deepEqual(result.byDocument["nota eletrônica"], { count: 1, total: 100 });
  assert.deepEqual(result.byDocument["tributo"], { count: 1, total: 30 });
});
