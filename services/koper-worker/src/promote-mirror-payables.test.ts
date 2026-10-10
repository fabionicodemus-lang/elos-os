import assert from "node:assert/strict";
import { test } from "node:test";

process.env.WORKER_API_KEY = "x".repeat(40);
process.env.KOPER_LOGIN_URL = "https://app.koper.com.br/login";
process.env.KOPER_USERNAME = "u";
process.env.KOPER_PASSWORD = "p";
process.env.BOSSA_COMPANY_ID = "11111111-1111-4111-8111-111111111111";

const { decide, promoteMirrorPayables, resolveBeneficiary, stableUuid } = await import("./promote-mirror-payables.js");
type Row = Record<string, unknown>;

const bill = (id: number, over: Row = {}): Row => ({ billId: id, billToPayId: id + 1000, billValue: 100, dueDate: "2025-03-10 23:59:59", isPaid: false, paymentDate: null, paymentValue: null, invoiceNumber: null, receiptNumber: "055", originName: "Fornecedor X", ...over });
const detail = (over: Row = {}): Row => ({ bill_type: "Original", cost_center: { id: 135, name: "Escritório Central" }, supplier_id: 38, supplier_name: "Fornecedor X", chart_account_name: "Despesas Administrativas", classification: "Material de escritório", ...over });

test("regras de obra, agrupamento, crédito e beneficiário", () => {
  const none = new Map<string, Row>();
  const office = decide("bossa", "1", bill(1), detail(), none);
  assert.equal(office.action, "promote");
  if (office.action === "promote") {
    assert.equal(office.projectKey, "office");
    assert.equal(office.row.source_system, "koper_bossa");
    assert.equal(office.row.source_id, "koper_bill:1");
    assert.equal(office.row.document, "Recibo 055");
    assert.equal(office.row.due_date, "2025-03-10");
    assert.match(String(office.row.notes), /^À Apropriar · Sincronização Koper · título 1001 · parcela 1 · empresa Bossa Empreendimentos · centro de custo Escritório Central · plano de contas Despesas Administrativas \/ Material de escritório$/);
    assert.equal(office.row.id, stableUuid("elos:koper:payable:1"));
  }
  const keyOf = (d: ReturnType<typeof decide>) => (d.action === "promote" ? d.projectKey : d.reason);
  assert.equal(keyOf(decide("bossa", "2", bill(2), detail({ cost_center: { id: 3, name: "Matriz" } }), none)), "office");
  assert.equal(keyOf(decide("bossa", "3", bill(3), detail({ cost_center: { id: 102, name: "Soul Residence" } }), none)), "soul");
  assert.equal(keyOf(decide("bossa", "4", bill(4), detail({ cost_center: { id: 103, name: "Jazz Residence" } }), none)), "jazz");
  assert.equal(keyOf(decide("bossa", "5", bill(5), detail({ cost_center: { id: 201, name: "Alma Seahouses - EMPRESA" } }), none)), "alma");
  assert.equal(keyOf(decide("bossa", "6", bill(6), detail({ cost_center: { id: 202, name: "Alma Seahouses" } }), none)), "alma");
  assert.equal(keyOf(decide("alma", "7", bill(7), detail({ cost_center: { id: 267, name: "Alma Seahouses" } }), none)), "alma");
  assert.equal(keyOf(decide("bossa", "8", bill(8), detail({ cost_center: { id: 999, name: "Outro" } }), none)), "cost_center_unmapped");
  assert.equal(keyOf(decide("bossa", "9", bill(9), detail({ bill_type: "Grupo", cost_center: { id: null, name: null } }), none)), "group_parent");
  assert.equal(keyOf(decide("bossa", "10", bill(10), detail({ bill_type: "Crédito" }), none)), "supplier_credit");
  assert.equal(keyOf(decide("bossa", "11", bill(11), undefined, none)), "detail_missing");
  assert.equal(keyOf(decide("bossa", "12", bill(12, { isPaid: true }), detail(), none)), "paid_without_payment_date");
  assert.equal(keyOf(decide("bossa", "13", bill(13, { originName: null }), detail({ supplier_id: null, supplier_name: null, beneficiary: {} }), none)), "beneficiary_unresolved");

  assert.deepEqual(resolveBeneficiary({ beneficiary: { employee_id: 7, employee_name: "Fulano" } }), { sourceId: "employee:7", name: "Fulano" });
  assert.deepEqual(resolveBeneficiary({ supplier_id: 5 }, "Nome da lista"), { sourceId: "5", name: "Nome da lista" });
  assert.equal(resolveBeneficiary({ beneficiary: { employee_name: "sem id" } }, "Nome"), null, "nome sozinho nunca é chave");
  assert.deepEqual(resolveBeneficiary({ origins: { tax_type_id: 5, tax_abbreviation: "PIS", tax_name: "Programa de Integração Social" } }), { sourceId: "tax:5", name: "PIS — Programa de Integração Social" });
  assert.deepEqual(resolveBeneficiary({ origins: { payroll_model_id: 3, payroll_name: "Folha mensal" } }), { sourceId: "payroll:3", name: "Folha mensal" });
});

test("pagamento: valor líquido e filho de agrupamento herda a baixa do pai", () => {
  const paid = decide("bossa", "1", bill(1, { isPaid: true, paymentDate: "2025-03-09 10:00:00", paymentValue: 0.09000000000000341, billValue: 81.45 }), detail(), new Map());
  assert.equal(paid.action, "promote");
  if (paid.action === "promote") assert.deepEqual([paid.row.status, paid.row.paid_at, paid.row.paid_amount, paid.row.amount], ["paid", "2025-03-09", 0.09, 81.45]);

  const parents = new Map<string, Row>([["900", bill(900, { isPaid: true, paymentDate: "2025-04-01 00:00:00" })]]);
  const child = decide("bossa", "2", bill(2, { billValue: 50 }), detail({ join_bill_id: 900 }), parents);
  assert.equal(child.action, "promote");
  if (child.action === "promote") assert.deepEqual([child.row.status, child.row.paid_at, child.row.paid_amount], ["paid", "2025-04-01", 50]);
});

function fakeDb(bills: Record<string, Array<[string, Row, Row | null]>>) {
  const payables: Row[] = [];
  const suppliers: Row[] = [{ id: "sup-38", source_id: "38", source_system: "koper", legal_name: "Fornecedor X" }];
  const projects = [
    { id: "p-flow", name: "Flow Aptos", code: "FLOW", status: "active", created_by: "u" },
    { id: "p-alma", name: "Alma Seahouses", code: null, status: "active", created_by: "u" },
    { id: "p-soul", name: "Soul Residence", code: null, status: "completed", created_by: "u" },
    { id: "p-jazz", name: "Jazz Residence", code: null, status: "completed", created_by: "u" },
    { id: "p-office", name: "Escritório Bossa", code: null, status: "active", created_by: "u" },
  ];
  const calls = { patch: 0 };
  const request = async (resource: string, o: { method?: string; query?: URLSearchParams; body?: unknown } = {}) => {
    const q = o.query ?? new URLSearchParams();
    const method = o.method ?? "GET";
    const page = <T>(rows: T[]) => rows.slice(Number(q.get("offset") ?? 0), Number(q.get("offset") ?? 0) + Number(q.get("limit") ?? 1000));
    if (resource === "projects") return projects;
    if (resource === "suppliers" && method === "GET") return page(suppliers);
    if (resource === "suppliers" && method === "POST") { for (const r of o.body as Row[]) if (!suppliers.some((s) => s.source_id === r.source_id)) suppliers.push(r); return undefined; }
    if (resource === "koper_staging_records") {
      const company = (q.get("koper_id") ?? "").slice(5).replace(":*", "");
      const entity = (q.get("entity") ?? "").slice(3);
      const rows = (bills[company] ?? []).flatMap(([id, b, d]) => {
        const data = entity === "mirror.bill_to_pay" ? b : d;
        return data ? [{ koper_id: `${company}:${id}`, payload: { _enterprise: company, data } }] : [];
      });
      return page(rows);
    }
    if (resource === "payables" && method === "GET") return page(payables.filter((p) => `eq.${p.source_system}` === q.get("source_system")));
    if (resource === "payables" && method === "POST") { for (const r of o.body as Row[]) if (!payables.some((p) => p.id === r.id)) payables.push({ ...r }); return undefined; }
    if (resource === "payables" && method === "PATCH") { calls.patch++; const p = payables.find((x) => `eq.${x.id}` === q.get("id") && x.status === "open"); if (p) Object.assign(p, o.body as Row); return undefined; }
    throw new Error(`chamada inesperada ${method} ${resource}`);
  };
  return { payables, suppliers, calls, request: request as never };
}

test("plano não grava; gravação é idempotente; baixa posterior atualiza; divergência vira exceção", async () => {
  const source = {
    bossa: [
      ["1", bill(1), detail()],
      ["2", bill(2, { billValue: 40 }), detail({ cost_center: { id: 102, name: "Soul Residence" }, supplier_id: 77, supplier_name: "Novo Fornecedor" })],
      ["3", bill(3, { billValue: 90 }), detail({ bill_type: "Grupo", cost_center: { id: null, name: null } })],
      ["4", bill(4, { billValue: 45 }), detail({ join_bill_id: 3 })],
    ] as Array<[string, Row, Row | null]>,
    alma: [["50", bill(50, { billValue: 1000 }), detail({ cost_center: { id: 267, name: "Alma Seahouses" } })]] as Array<[string, Row, Row | null]>,
  };
  const db = fakeDb(source);

  await promoteMirrorPayables({ write: false, limit: 0 }, db.request);
  assert.equal(db.payables.length, 0);

  await promoteMirrorPayables({ write: true, limit: 0 }, db.request);
  assert.equal(db.payables.length, 4, "o pai tipo Grupo não entra");
  assert.deepEqual(db.payables.map((p) => p.project_id).sort(), ["p-alma", "p-office", "p-office", "p-soul"]);
  assert.equal(db.payables.find((p) => p.source_id === "koper_bill:50")!.source_system, "koper_alma");
  assert.equal(db.payables.find((p) => p.source_id === "koper_bill:1")!.supplier_id, "sup-38");
  assert.equal(db.suppliers.length, 2);
  assert.equal(db.suppliers[1]!.id, stableUuid("elos:koper:supplier:77"));

  await promoteMirrorPayables({ write: true, limit: 0 }, db.request);
  assert.equal(db.payables.length, 4);
  assert.equal(db.suppliers.length, 2);
  assert.equal(db.calls.patch, 0);

  // título 1 foi pago no Koper; título 2 mudou de valor
  source.bossa[0]![1] = bill(1, { isPaid: true, paymentDate: "2025-05-05 00:00:00", paymentValue: 100 });
  source.bossa[1]![1] = bill(2, { billValue: 41 });
  const plan = await promoteMirrorPayables({ write: true, limit: 0 }, db.request) as Row;
  const p1 = db.payables.find((p) => p.source_id === "koper_bill:1")!;
  assert.deepEqual([p1.status, p1.paid_at, p1.paid_amount], ["paid", "2025-05-05", 100]);
  assert.equal(db.payables.find((p) => p.source_id === "koper_bill:2")!.amount, 40, "divergência não sobrescreve");
  assert.equal((plan.bossa as Row).conflicts, 1);
});

test("piloto com limite cria só N títulos e só os fornecedores deles", async () => {
  const db = fakeDb({
    bossa: Array.from({ length: 10 }, (_, i) => [String(i + 1), bill(i + 1), detail({ supplier_id: 500 + i, supplier_name: `F${i}` })] as [string, Row, Row | null]),
    alma: [],
  });
  await promoteMirrorPayables({ write: true, limit: 3 }, db.request);
  assert.equal(db.payables.length, 3);
  assert.equal(db.suppliers.length, 1 + 3);
});
