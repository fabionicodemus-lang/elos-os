import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { convertEobraCheckpoint, reconstructEobraCheckpoint, formatEobraCheckpointReview } from "../../lib/eobra-import/checkpoint.mjs";
import { hashEobraValue } from "../../lib/eobra-import/snapshot.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BILL_HEADERS = ["Título", "Status", "Vencimento", "Centro de custo", "Categoria", "Receber de/Pagar para", "Valor", "Valor original", "Valor pago", "Documento", "Vínculos", "Descrição", "Correção"];
const PAYMENT_HEADERS = ["Data", "Título", "Conta", "Forma", "Valor"];
const source = captures => ({ schema: "eobra.ui-checkpoint.v1", sourceHost: "synthetic.eobra.example", capturedAt: "2026-03-20T18:01:02Z", capturedOn: "2026-03-20", status: "partial", captures });
const wrap = value => ({ content: [{ type: "text", text: JSON.stringify(value) }, { type: "text", text: "Estado visual adicional intacto." }], structuredContent: null, isError: false });
const project = (id = "p1") => ({ id, name: `Obra sintética ${id}`, links: [{ route: `Construction/Manager/${id}` }] });
const record = (entity, sourceId, normalized, links = [], sourceProjectId = null) => ({ entity, sourceId, sourceProjectId, normalized, links });
const link = (entity, sourceId, role) => ({ entity, sourceId, role });
const plainMoney = (amount, paid = "0.00", status = "open") => ({ description: "Parcela sintética", due_date: "2026-04-10", original_amount: amount, current_amount: amount, paid_amount: paid, balance_amount: amount === paid ? "0.00" : amount, status, interest_amount: "0.00", penalty_amount: "0.00", correction_amount: "0.00", other_accrual_amount: "0.00", discount_amount: "0.00", correction: { mode: "none" }, sequence_number: 1, sequence_total: 1 });
function bill(id, { direction = "receivable", original = "100.0000", current = "110.0000", paid = "0.00", state = "Atrasado", personId = "c1", saleId = "s1", title = "0042" } = {}) {
  return { id, link: `Finance/Bills/showDetails/payment/${id}`, class: `ins ${direction === "payable" ? "pay" : "receive"}`, cells: [
    { value: title, installment: { text: "1 de 9", total: "9", type: "Parcela" } }, { tips: [state] }, { value: "2026-04-10" }, { value: "Nome de obra que não é ID" }, { value: "Categoria sintética" },
    { value: JSON.stringify({ id: personId, title: "Mesmo Nome" }), links: [`Person/Details/${personId}`] }, { value: current }, { value: original }, { value: paid }, { text: "" },
    { value: "Vínculo sintético", links: saleId ? [`Construction/Deals/GetSale/${saleId}`] : [] }, { text: "" }, { value: "CUB" },
  ] };
}
function payment(id, billId, { reversed = false, accountId = null, amount = "20.0000" } = {}) {
  return { id, link: `Finance/Bills/showDetails/payment/${billId}/${id}`, class: `pay${reversed ? " reversed" : ""}`, cells: [{ value: "2026-03-10" }, { value: "0042" }, { value: "Conta de mesmo nome", links: accountId ? [`Finance/Accounts/Settings/${accountId}`] : [] }, { value: "Dinheiro" }, { value: `-${amount}` }] };
}
function candidate(converted, entity, id) {
  const native = converted.snapshot.records.find(record => record.entity === entity && record.sourceId === id);
  if (native) return native;
  const pending = converted.snapshot.records.find(record => record.entity === "raw_archive" && record.sourceId === id && (record.archiveType === `ui_pending_${entity}` || record.archiveType === "sale_draft"));
  return pending ? { entity, sourceId: id, ...pending.normalized.candidate, raw: pending.raw, archiveType: pending.archiveType } : null;
}
function pending(converted, entity, id) { return converted.report.pendingDetails.find(record => record.entity === entity && record.sourceId === id); }
function coverageFor(records, projects = ["p1"]) {
  const scoped = new Set(["unit", "sale", "receivable", "payable", "settlement"]);
  const kinds = ["project", "person", "unit", "sale", "receivable", "payable", "settlement", "bank_account", "bank_transaction", "correction_index", "index_value"];
  return kinds.flatMap(entity => (scoped.has(entity) ? projects : [null]).map(sourceProjectId => {
    const subset = records.filter(record => record.entity === entity && (record.sourceProjectId ?? null) === sourceProjectId);
    return { entity, sourceProjectId, expectedCount: subset.length, expectedPages: 1, collectedPages: [1], detailsExpected: subset.length, detailsCollected: subset.map(record => record.sourceId), complete: true, filters: { synthetic_verified_scope: true } };
  }));
}
function completeFixture() {
  const rows = [
    record("project", "p1", { name: "Projeto sintético" }),
    record("person", "c1", { name: "Pessoa sintética", person_type: "OTHER", roles: ["client", "supplier"], status: "active" }),
    record("unit", "u1", { code: "001", status: "sold" }, [link("project", "p1", "project")], "p1"),
    record("sale", "s1", { number: "0041", sale_date: "2026-01-10", total_amount: "100.00", status: "active" }, [link("unit", "u1", "unit"), link("person", "c1", "buyer")], "p1"),
    record("receivable", "r1", plainMoney("100.00"), [link("sale", "s1", "sale")], "p1"),
    record("payable", "q1", plainMoney("20.00", "20.00", "paid"), [link("person", "c1", "supplier")], "p1"),
    record("bank_account", "a1", { name: "Conta sintética", status: "active", currency: "BRL" }),
    record("settlement", "e1", { kind: "payment", amount: "20.00", occurred_on: "2026-03-10", medium: "bank" }, [link("payable", "q1", "installment"), link("bank_account", "a1", "account")], "p1"),
    record("bank_transaction", "t1", { amount: "20.00", occurred_on: "2026-03-10", direction: "debit", status: "posted" }, [link("bank_account", "a1", "account"), link("settlement", "e1", "settlement")]),
    record("correction_index", "ix1", { code: "TEST", name: "Índice sintético", value_type: "index_number" }),
    record("index_value", "iv1", { reference_month: "2026-03", value: "1000.000000" }, [link("correction_index", "ix1", "index")]),
  ];
  return { ...source({ records: rows, coverage: coverageFor(rows) }), scope: { allProjects: true } };
}

function paymentUpdateFixture() {
  const base = completeFixture();
  const prior = candidate(convertEobraCheckpoint(base), "receivable", "r1");
  const event = record("settlement", "new-payment", { kind: "payment", amount: "40.00", occurred_on: "2026-03-21", medium: "bank" }, [link("receivable", "r1", "installment"), link("bank_account", "a1", "account")], "p1");
  const update = { entity: "receivable", sourceId: "r1", beforeHash: hashEobraValue(prior.normalized), observedAt: "2026-03-21T12:00:00Z", evidence: { sha256: "a".repeat(64) }, addedSettlementSourceIds: ["new-payment"], normalized: { ...plainMoney("100.00", "40.00", "partial"), balance_amount: "60.00" } };
  for (const key of ["description", "due_date", "correction", "sequence_number", "sequence_total"]) delete update.normalized[key];
  return { base, supplement: source({ settlementDetails: [event], financialObservationUpdates: [update] }), update, event };
}

test("explicit payment observation advances a hashed version and preserves both original captures", () => {
  const { base, supplement } = paymentUpdateFixture();
  const input = [base, supplement]; const before = JSON.stringify(input);
  const result = convertEobraCheckpoint(input);
  const row = candidate(result, "receivable", "r1");
  assert.equal(row.normalized.paid_amount, "40.00");
  assert.equal(row.normalized.balance_amount, "60.00");
  assert.deepEqual(row.normalized.financial_observation_resolution.added_settlement_source_ids, ["new-payment"]);
  assert.deepEqual(reconstructEobraCheckpoint(result.snapshot), input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.report.preserved.lossless, true);
  assert.ok(!pending(result, "receivable", "r1")?.reasons.some(x => x.startsWith("financial_observation:")));
});

test("an explicit review hold blocks a valid parent and propagates to financial dependents", () => {
  const base = completeFixture();
  const supplement = source({ reviewHolds: [{ entity: "sale", sourceId: "s1", reason: "Aguardando decisão sobre a obra do contrato." }] });
  const result = convertEobraCheckpoint([base, supplement]);
  assert.ok(pending(result, "sale", "s1").reasons.some(x => x.startsWith("review_hold:")));
  assert.ok(pending(result, "receivable", "r1").reasons.some(x => x.startsWith("references:")));
  assert.deepEqual(reconstructEobraCheckpoint(result.snapshot), [base, supplement]);
  const invalid = convertEobraCheckpoint([base, source({ reviewHolds: [{ entity: "sale", sourceId: "missing", reason: "Revisar" }] })]);
  assert.equal(invalid.report.readyForReview, false);
});

test("payment updates reject stale versions, duplicate selections, wrong links and inconsistent money", () => {
  const cases = [
    f => { f.update.beforeHash = "0".repeat(64); },
    f => { f.supplement.captures.financialObservationUpdates.push(structuredClone(f.update)); },
    f => { f.event.links[0].sourceId = "other-installment"; },
    f => { f.update.normalized.paid_amount = "50.00"; f.update.normalized.balance_amount = "50.00"; },
    f => { f.update.normalized.original_amount = "110.00"; f.update.normalized.current_amount = "110.00"; f.update.normalized.balance_amount = "70.00"; },
    f => { f.update.normalized.balance_amount = "61.00"; },
    f => { f.update.normalized.correction = { mode: "index" }; },
    f => { f.event.normalized.source_reversed = true; },
    f => { f.update.addedSettlementSourceIds.push("new-payment"); },
    f => { f.update.observedAt = "2026-03-21"; },
  ];
  for (const mutate of cases) {
    const f = paymentUpdateFixture(); mutate(f);
    const result = convertEobraCheckpoint([f.base, f.supplement]);
    assert.equal(candidate(result, "receivable", "r1").normalized.paid_amount, "0.00");
    assert.ok(pending(result, "receivable", "r1").reasons.some(x => x.startsWith("financial_observation:")));
  }
});

test("lossless source capture includes ToolResult text, HTML, unknown modules and duplicate observations", () => {
  const data = source({ projects: wrap([project()]), unknown: { html: "<div>&amp; intacto</div>", values: [null, true, ""] }, bills: [{ page: 1, headers: BILL_HEADERS, rows: [bill("0001")] }, { page: 1, headers: BILL_HEADERS, rows: [bill("0001")] }] });
  const before = JSON.stringify(data);
  const output = convertEobraCheckpoint(data);
  assert.deepEqual(reconstructEobraCheckpoint(output.snapshot), data);
  assert.equal(JSON.stringify(data), before);
  assert.equal(output.report.sourceHash, hashEobraValue(data));
  assert.equal(output.report.preserved.lossless, true);
  assert.equal(output.report.inventory.find(row => row.capture === "bills").uniqueIds, 1);
  assert.equal(output.report.inventory.find(row => row.capture === "bills").observations, 2);
});

test("dense capture arrays remain reconstructible with evidence pointers into encoded JSON", () => {
  const rows = Array.from({ length: 200 }, (_, i) => bill('dense-' + i));
  const data = source({ projects: [project()], bills: [{ page: 1, headers: BILL_HEADERS, rows }] });
  const result = convertEobraCheckpoint(data);
  assert.equal(result.inspection.ok, true);
  assert.deepEqual(reconstructEobraCheckpoint(result.snapshot), data);
  const row = candidate(result, "receivable", "dense-199");
  const evidence = row.raw.evidence.find(e => e.jsonPointer === '/0/rows/199');
  assert.ok(evidence);
  const fragment = result.snapshot.records.find(r => r.sourceId === evidence.sourceId);
  assert.equal(fragment.raw.encoding, 'json-value-v1');
  assert.equal(evidence.pointer, '/encodedValue');
  assert.deepEqual(JSON.parse(fragment.raw.encodedValue)[0].rows[199], rows[199]);
  fragment.raw.encodedValue = fragment.raw.encodedValue.replace('dense-199', 'changed-199');
  assert.throws(() => reconstructEobraCheckpoint(result.snapshot), /Fragmento/);
});

test("a missing capture timestamp remains a real package blocker", () => {
  const data = source({ projects: [project()] }); delete data.capturedAt;
  const output = convertEobraCheckpoint(data);
  assert.equal(output.report.capturedAt, null);
  assert.equal(output.report.readyForReview, false);
  assert.ok(output.report.errors.some(error => error.startsWith("capturedAt:")));
  const explicit = convertEobraCheckpoint(data, { capturedAt: "2026-03-20T18:02:00Z" });
  assert.equal(explicit.inspection.ok, true);
  const checkpointTime = convertEobraCheckpoint({ ...data, lastCheckpointAt: "2026-03-20T18:03:00Z" });
  assert.equal(checkpointTime.report.capturedAt, "2026-03-20T18:03:00Z");
});

test("financial list never manufactures missing components or assigns the difference to CUB", () => {
  const output = convertEobraCheckpoint(source({ projects: [project()], bills: [{ page: 1, headers: BILL_HEADERS, rows: [bill("0007")] }] }));
  const row = candidate(output, "receivable", "0007");
  assert.equal(row.normalized.original_amount, "100.00");
  assert.equal(row.normalized.current_amount, "110.00");
  assert.equal(row.normalized.paid_amount, "0.00");
  assert.equal(row.normalized.balance_amount, "110.00");
  assert.equal(row.normalized.balance_provenance, "current_amount_minus_paid_amount");
  for (const key of ["correction_amount", "interest_amount", "penalty_amount", "discount_amount", "other_accrual_amount", "correction"]) assert.equal(Object.hasOwn(row.normalized, key), false);
  assert.equal(row.sourceProjectId, null);
  assert.equal(output.inspection.ok, true);
  assert.equal(output.report.complete, false);
});

test("payable signs remain in raw and become explicit magnitudes only for a pay row", () => {
  const data = source({ bills: [{ page: 1, headers: BILL_HEADERS, rows: [bill("q1", { direction: "payable", original: "-100.0000", current: "-110.0000", paid: "-20.00", saleId: null })] }] });
  const output = convertEobraCheckpoint(data);
  const row = candidate(output, "payable", "q1");
  assert.equal(row.normalized.current_amount, "110.00");
  assert.equal(row.normalized.paid_amount, "20.00");
  assert.equal(row.normalized.balance_amount, "90.00");
  assert.equal(row.normalized.status, "partial");
  assert.equal(reconstructEobraCheckpoint(output.snapshot).captures.bills[0].rows[0].cells[6].value, "-110.0000");
});

test("cancelled titles preserve paid and residual history instead of forcing zero", () => {
  const row = bill("cancel", { current: "120.00", paid: "20.00", state: "Estornado" });
  row.class += " reversed paid";
  const output = convertEobraCheckpoint(source({ bills: [{ headers: BILL_HEADERS, rows: [row] }] }));
  const data = candidate(output, "receivable", "cancel").normalized;
  assert.equal(data.status, "cancelled"); assert.equal(data.balance_amount, "100.00"); assert.equal(data.paid_amount, "20.00");
  assert.equal(Object.hasOwn(data, "discount_amount"), false);
});

test("explicit partial marker treats Valor as the residual without subtracting payment twice", () => {
  for (const direction of ["receivable", "payable"]) {
    const sign = direction === "payable" ? "-" : "";
    const raw = bill("partial-residual", { direction, original: sign + "100.00", current: sign + "30.00", paid: sign + "80.00" });
    raw.cells[6].tips = ["Pago parcialmente"];
    const input = source({ bills: [{ headers: BILL_HEADERS, rows: [raw] }] });
    const output = convertEobraCheckpoint(input);
    const n = candidate(output, direction, "partial-residual").normalized;
    assert.equal(n.original_amount, "100.00");
    assert.equal(n.current_amount, "110.00");
    assert.equal(n.paid_amount, "80.00");
    assert.equal(n.balance_amount, "30.00");
    assert.equal(n.status, "partial");
    assert.equal(n.balance_provenance, "source_partial_residual");
    assert.equal(n.current_amount_provenance, "source_partial_residual_plus_paid_amount");
    assert.deepEqual(reconstructEobraCheckpoint(output.snapshot), input);
    assert.equal(Object.hasOwn(n, "correction_amount"), false);
  }
});

test("contradictory partial markers stay blocked and do not reinterpret paid or cancelled history", () => {
  for (const state of ["Pago", "Estornado"]) {
    const raw = bill("partial-conflict", { current: "100.00", paid: "80.00", state });
    raw.cells[6].tips = ["Pago parcialmente"];
    const output = convertEobraCheckpoint(source({ bills: [{ headers: BILL_HEADERS, rows: [raw] }] }));
    assert.equal(candidate(output, "receivable", "partial-conflict").normalized.current_amount, "100.00");
    assert.ok(pending(output, "receivable", "partial-conflict").reasons.some(reason => reason.includes("indicador de saldo parcial")));
  }
});

test("money precision, scientific notation and contradictory signs cannot become canonical values", () => {
  for (const invalid of ["100.0001", "1e3", "9007199254740990999999.00", "-100.00"]) {
    const output = convertEobraCheckpoint(source({ bills: [{ headers: BILL_HEADERS, rows: [bill("precision", { current: invalid })] }] }));
    assert.equal(Object.hasOwn(candidate(output, "receivable", "precision").normalized, "current_amount"), false);
    assert.ok(pending(output, "receivable", "precision").reasons.some(reason => reason.startsWith("current_amount:")));
  }
});

test("technical installment IDs retain zeros and repeated commercial numbers stay distinct", () => {
  const output = convertEobraCheckpoint(source({ bills: [{ headers: BILL_HEADERS, rows: [bill("00001"), bill("00002")] }] }));
  assert.ok(candidate(output, "receivable", "00001")); assert.ok(candidate(output, "receivable", "00002"));
  assert.equal(candidate(output, "receivable", "00001").normalized.title_number, "0042");
  assert.equal(candidate(output, "receivable", "0042"), null);
});

test("route and data-cod conflicts are retained and cannot choose an identity silently", () => {
  const row = bill("route-id"); row.id = "different-attribute";
  const output = convertEobraCheckpoint(source({ bills: [{ headers: BILL_HEADERS, rows: [row] }] }));
  assert.ok(pending(output, "receivable", "route-id").reasons.some(reason => reason.startsWith("sourceId:")));
  assert.equal(output.snapshot.records.some(record => record.entity === "receivable"), false);
});

test("compact cells and inherited headers work across appended checkpoints", () => {
  const first = source({ bills: [{ page: 1, headers: BILL_HEADERS, rows: [bill("r1")] }] });
  const second = source({ bills: [{ page: 2, rows: [bill("r2")] }] });
  const output = convertEobraCheckpoint([first, second]);
  assert.equal(candidate(output, "receivable", "r2").normalized.current_amount, "110.00");
  assert.deepEqual(reconstructEobraCheckpoint(output.snapshot), [first, second]);
});

test("people with the same display name remain separate source identities", () => {
  const output = convertEobraCheckpoint(source({ bills: [{ headers: BILL_HEADERS, rows: [bill("r1", { personId: "person-a" }), bill("r2", { personId: "person-b" })] }] }));
  assert.ok(candidate(output, "person", "person-a")); assert.ok(candidate(output, "person", "person-b"));
  assert.equal(candidate(output, "person", "person-a").normalized.person_type, undefined);
  assert.equal(candidate(output, "person", "person-a").normalized.status, undefined);
});

test("account names and expected accounts do not link settlements", () => {
  const data = source({ accounts: [{ html: '<tr lnkact="Finance/Accounts/setSelectedAccount/a1"><span class="textSize18">Conta de mesmo nome</span></tr>' }, { html: '<tr lnkact="Finance/Accounts/setSelectedAccount/a2"><span class="textSize18">Conta de mesmo nome</span></tr>' }], payments: [{ page: 1, headers: PAYMENT_HEADERS, rows: [payment("e1", "q1")] }] });
  const output = convertEobraCheckpoint(data);
  assert.equal(candidate(output, "settlement", "e1").links.some(link => link.role === "account"), false);
  assert.ok(candidate(output, "bank_account", "a1")); assert.ok(candidate(output, "bank_account", "a2"));
});

test("project resolution follows sale/unit IDs, never cost-center names or numbers", () => {
  const row = bill("r1"); row.cells[3] = { value: "cost-center-B" };
  const data = source({ projects: [project("construction-A")], bills: [{ headers: BILL_HEADERS, rows: [row] }], saleDetails: { s1: { sourceId: "s1", sourceProjectId: "construction-A", normalized: {}, links: [] } } });
  const output = convertEobraCheckpoint(data);
  assert.equal(candidate(output, "receivable", "r1").sourceProjectId, "construction-A");
  assert.equal(candidate(output, "receivable", "r1").normalized.source_cost_center_label, "cost-center-B");
  assert.equal(output.snapshot.scope.projectIds.includes("cost-center-B"), false);
});

test("payables and their settlements inherit only the explicit sale project, preserving scope conflicts", () => {
  const rows = [bill("q1", { direction: "payable", current: "-100.00", original: "-100.00", paid: "-20.00" }), bill("q-unlinked", { direction: "payable", saleId: null })];
  const data = source({ projects: [project("p1"), project("p2")], bills: [{ headers: BILL_HEADERS, rows }],
    saleDetails: [{ sourceId: "s1", sourceProjectId: "p1", normalized: {} }],
    payments: [{ headers: PAYMENT_HEADERS, rows: [payment("event-1", "q1")] }],
  });
  const output = convertEobraCheckpoint(data);
  assert.equal(candidate(output, "payable", "q1").sourceProjectId, "p1");
  assert.equal(candidate(output, "settlement", "event-1").sourceProjectId, "p1");
  assert.equal(candidate(output, "payable", "q-unlinked").sourceProjectId, null);
  assert.deepEqual(reconstructEobraCheckpoint(output.snapshot), data);
  data.captures.installmentDetails = [{ entity: "payable", sourceId: "q1", sourceProjectId: "p2", normalized: {} }];
  const conflicting = convertEobraCheckpoint(data);
  assert.ok(pending(conflicting, "payable", "q1").reasons.some(reason => reason.includes("obras diferentes")));
  assert.equal(candidate(conflicting, "payable", "q1").sourceProjectId, "p2");
});

test("sale detail preserves multiple units and buyers without assuming primary or allocations", () => {
  const detail = { title: "Negócio Nº 0041", status: "Venda - Concluído", fields: [{ name: "construction.sale.date", value: "10/01/2026" }], tables: [
    { headers: ["Compradores"], rows: [{ id: "rel-c1", cells: [{ links: [{ route: "Person/Details/c1" }] }] }, { id: "rel-c2", cells: [{ links: [{ route: "Person/Details/c2" }] }] }] },
    { headers: ["Unidades", "Valor"], rows: [{ id: "rel-u1", class: "principal", cells: [{ value: "001", links: [{ route: "Construction/Manager/p1/Units/u1" }] }, { value: "60.0000" }] }, { id: "rel-u2", class: "", cells: [{ value: "002", links: [{ route: "Construction/Manager/p1/Units/u2" }] }, { value: "40.0000" }] }] },
  ] };
  const output = convertEobraCheckpoint(source({ projects: [project()], saleDetails: { s1: detail } }));
  const sale = candidate(output, "sale", "s1");
  assert.equal(sale.normalized.number, "0041"); assert.equal(sale.sourceProjectId, "p1");
  const units = sale.links.filter(link => link.role === "unit");
  assert.equal(units.length, 2); assert.equal(units[0].primary, true); assert.equal(Object.hasOwn(units[1], "primary"), false);
  assert.deepEqual(units.map(link => link.allocated_amount), ["60.00", "40.00"]);
  assert.ok(sale.links.filter(link => link.role === "buyer").every(link => !Object.hasOwn(link, "primary")));
  assert.equal(sale.normalized.total_amount, undefined);
});

test("draft with an invalid source date becomes a typed archive", () => {
  const output = convertEobraCheckpoint(source({ saleDetails: { draft: { title: "Negócio Nº 77", status: "Venda - Rascunho", fields: [{ name: "construction.sale.date", value: "-0001-11-30" }] } } }));
  const row = candidate(output, "sale", "draft");
  assert.equal(row.archiveType, "sale_draft"); assert.equal(row.normalized.status, "draft"); assert.equal(row.normalized.sale_date, undefined);
  assert.equal(reconstructEobraCheckpoint(output.snapshot).captures.saleDetails.draft.fields[0].value, "-0001-11-30");
});

test("sales header capture supplies field names without borrowing its filtered count", () => {
  const rows = [{ id: "s1", link: "Construction/Deals/GetSale/s1", cells: [{ value: "0041" }, { tips: ["Concluído"] }, { value: "2026-01-10" }, { value: "100.0000" }, { links: ["Person/Details/c1"], value: JSON.stringify([{ id: "c1", title: "Cliente" }]) }] }];
  const data = source({ sales: rows, salesHeaderCapture: wrap({ headers: ["Nº", "Status", "Data", "Valor contrato", "Comp./Vend."], footer: "Exibindo 1-20 de 999 itens" }) });
  const output = convertEobraCheckpoint(data);
  const sale = candidate(output, "sale", "s1");
  assert.equal(sale.normalized.total_amount, "100.00"); assert.equal(sale.normalized.number, "0041");
  assert.equal(output.report.inventory.find(entry => entry.capture === "sales").expectedCount, null);
});

test("group rows are preserved but not misidentified as units without headers", () => {
  const group = { attrs: { "data-cod": "group1" }, cells: Array.from({ length: 6 }, () => ({ value: "grupo" })) };
  const unit = { attrs: { "data-cod": "u1" }, cells: Array.from({ length: 7 }, () => ({ value: "unidade" })) };
  const data = source({ projects: [project()], unitsp1: wrap({ footer: ["Exibindo 1-1 de 1 itens"], rows: [group, unit] }) });
  const output = convertEobraCheckpoint(data);
  assert.equal(candidate(output, "unit", "group1"), null); assert.ok(candidate(output, "unit", "u1"));
  assert.equal(candidate(output, "unit", "u1").normalized.status, undefined);
  assert.deepEqual(reconstructEobraCheckpoint(output.snapshot), data);
});

test("a collection named cub does not identify its parent or assume a century", () => {
  const output = convertEobraCheckpoint(source({ cub: wrap([{ id: "v1", effective_date: "01/03/26", value: "1000.12" }]) }));
  const value = candidate(output, "index_value", "v1");
  assert.deepEqual(value.links, []); assert.equal(value.normalized.reference_month, undefined);
  assert.equal(output.snapshot.records.some(record => record.entity === "correction_index"), false);
});

test("wrapped unit tables and page arrays retain source context and known inventory", () => {
  const headers = [["Nome", "Situação"]];
  const a = { attrs: { "data-cod": "u-a" }, cells: [{ value: "001" }, { value: "Disponível" }] };
  const b = { attrs: { "data-cod": "u-b" }, cells: [{ value: "002" }, { value: "Vendido" }] };
  const first = source({ projects: [project("11")], units11: wrap({ constructionId: "11", section: "units", capture: { headers, footer: ["Exibindo 1-1 de 2 itens\npor página\nde 2"], rows: [a] } }) });
  const second = source({ units11: wrap([{ headers, footer: ["Exibindo 1-1 de 2 itens\npor página\nde 2"], rows: [a] }, { headers, footer: ["Exibindo 1-2 de 2 itens\npor página\nde 2"], page: 2, rows: [b] }]) });
  const output = convertEobraCheckpoint([first, second]);
  assert.equal(candidate(output, "unit", "u-a").sourceProjectId, "11");
  assert.equal(candidate(output, "unit", "u-a").normalized.code, "001");
  assert.equal(candidate(output, "unit", "u-b").normalized.status, "sold");
  assert.deepEqual(reconstructEobraCheckpoint(output.snapshot), [first, second]);
});

test("people fields use source IDs and labelled documents; multiple contacts retain all values", () => {
  const row = { id: "person-a", attrs: { "data-cod": "person-a", lnksli: "Person/Details/person-a", class: "person" }, cells: [
    { value: "Pessoa sintética" },
    { value: JSON.stringify([{ title: "+55 11 90000-0000" }]) },
    { value: JSON.stringify([{ title: "first@example.test" }, { title: "second@example.test" }]) },
    { value: JSON.stringify([{ document_type_id: "opaque-tax-type", title: "52998224725" }, { document_type_id: "opaque-other-type", title: "123" }]), text: "CPF529.982.247-25\nRG123" },
  ] };
  const output = convertEobraCheckpoint(source({ people: [{ page: 1, headers: ["Nome", "Telefone", "E-mail", "Documento"], footer: "Exibindo 1-1 de 1 itens", rows: [row] }] }));
  const person = candidate(output, "person", "person-a").normalized;
  assert.equal(person.person_type, "PF"); assert.equal(person.tax_id, "52998224725"); assert.equal(person.phone, "+55 11 90000-0000");
  assert.equal(person.email, undefined); assert.equal(person.source_emails.length, 2); assert.equal(person.email_selection_required, true);
  assert.equal(person.status, undefined); assert.equal(person.roles, undefined);
  assert.equal(output.report.inventory.find(entry => entry.capture === "people").rowsComplete, true);
});

test("available stock routes prove unit status without converting asset rows into units", () => {
  const data = source({ stock: wrap({ rows: [
    { attrs: { "data-cod": "unit-available", lnksli: "Construction/Sales/Available/c/unit-available" }, cells: [] },
    { attrs: { "data-cod": "asset-available", lnksli: "Construction/Sales/Available/a/asset-available" }, cells: [] },
  ] }) });
  const output = convertEobraCheckpoint(data);
  assert.equal(candidate(output, "unit", "unit-available").normalized.status, "available");
  assert.equal(candidate(output, "unit", "asset-available"), null);
  assert.deepEqual(reconstructEobraCheckpoint(output.snapshot), data);
});

test("manager sale IDs prove a sole completed sale relationship without selecting list order", () => {
  const headers = ["Nº", "Status", "Data", "Valor contrato", "Comp./Vend."];
  const sale = { id: "sale-1", link: "Construction/Deals/GetSale/sale-1", cells: [{ value: "10" }, { tips: ["Concluído"] }, { value: "2026-01-10" }, { value: "100.0000" }, { links: ["Person/Details/client-1"] }] };
  const unit = { attrs: { "data-cod": "unit-1", "data-lnksli": "sale-1", class: "linked" }, cells: [{ value: "001" }] };
  const data = source({ projects: [project("11")], salesHeaders: headers, sales: [sale], units11: wrap({ headers: [["Nome"]], footer: ["Exibindo 1-1 de 1 itens"], rows: [unit] }), personDetails: { "client-1": { normalized: { name: "Cliente sintético", person_type: "OTHER", status: "active", roles: ["client"] } } } });
  const output = convertEobraCheckpoint(data);
  const normalizedSale = candidate(output, "sale", "sale-1");
  const normalizedUnit = candidate(output, "unit", "unit-1");
  assert.equal(normalizedSale.sourceProjectId, "11"); assert.equal(normalizedSale.normalized.primary_unit_basis, "sole_unit");
  assert.equal(normalizedSale.links.filter(link => link.role === "unit").length, 1);
  assert.equal(normalizedSale.links.find(link => link.role === "unit").primary, undefined);
  assert.equal(normalizedUnit.normalized.status, "sold");
  assert.equal(normalizedUnit.normalized.status_provenance, "sole_unit_completed_sale_relation");
});

test("manager ambiguity, cancelled sales and an available-stock contradiction do not invent sold status", () => {
  const headers = ["Nº", "Status", "Data", "Valor contrato"];
  const sale = { id: "sale-1", link: "Construction/Deals/GetSale/sale-1", cells: [{ value: "10" }, { tips: ["Concluído"] }, { value: "2026-01-10" }, { value: "100.0000" }] };
  const unit = id => ({ attrs: { "data-cod": id, "data-lnksli": "sale-1", class: "linked" }, cells: [{ value: id }] });
  const base = source({ projects: [project("11")], salesHeaders: headers, sales: [sale], units11: { headers: ["Nome"], footer: "Exibindo 1-1 de 1 itens", rows: [unit("u1")] } });
  const multi = structuredClone(base); multi.captures.units11.rows.push(unit("u2")); multi.captures.units11.footer = "Exibindo 1-2 de 2 itens";
  const multiple = convertEobraCheckpoint(multi);
  assert.equal(candidate(multiple, "unit", "u1").normalized.status, undefined);
  assert.equal(candidate(multiple, "sale", "sale-1").normalized.primary_unit_basis, undefined);
  const cancelled = structuredClone(base); cancelled.captures.sales[0].cells[1].tips = ["Estorno"];
  assert.equal(candidate(convertEobraCheckpoint(cancelled), "unit", "u1").normalized.status, undefined);
  const conflict = structuredClone(base); conflict.captures.stock = { rows: [{ attrs: { "data-cod": "u1", lnksli: "Construction/Sales/Available/c/u1" }, cells: [] }] };
  const conflicting = convertEobraCheckpoint(conflict);
  assert.ok(pending(conflicting, "unit", "u1").reasons.some(reason => reason.includes("disponibilidade observada conflita")));
  assert.equal(candidate(conflicting, "unit", "u1").normalized.status, "available");
});

test("index labels are retained as evidence, never used to join a series to a parent", () => {
  const output = convertEobraCheckpoint(source({ correctionRules: wrap({ headers: ["Índice de correção"], rows: [{ id: "rule-1", cells: [{ value: "index-1", text: "Índice sintético" }] }] }), allIndexSeries: wrap([{ gridHash: "grid-1", name: "Índice sintético", headers: ["Usar a partir", "Valor"], rows: [{ id: "v1", cells: [{ value: "2026-03-01" }, { value: "1000.00" }] }] }]) }));
  assert.ok(candidate(output, "correction_index", "index-1"));
  assert.deepEqual(candidate(output, "index_value", "v1").links, []);
  assert.equal(output.snapshot.records.find(record => record.archiveType === "source_correction_rule").normalized.source_index_reference.source_id, "index-1");
  assert.ok(output.snapshot.records.some(record => record.archiveType === "source_index_series"));
});

test("unknown and unvisited coverage is never replaced with an empty complete collection", () => {
  const output = convertEobraCheckpoint(source({ projects: [project()] }));
  const receiving = output.snapshot.coverage.find(entry => entry.entity === "receivable" && entry.sourceProjectId === "p1");
  assert.equal(receiving.expectedCount, null); assert.equal(receiving.detailsExpected, null); assert.equal(receiving.complete, false);
  assert.equal(output.snapshot.scope.allProjects, false); assert.equal(output.report.complete, false);
});

test("page inventories require counts, contiguous pages and stable filters", () => {
  const pages = [1, 3].map((page, index) => ({ page, footer: "Exibindo 1-1 de 3 itens\n por página\nde 3", filters: { active: index === 0 }, headers: BILL_HEADERS, rows: [bill(`r${page}`)] }));
  const output = convertEobraCheckpoint(source({ bills: pages }));
  const inventory = output.report.inventory.find(entry => entry.capture === "bills");
  assert.equal(inventory.expectedCount, 3); assert.equal(inventory.uniqueIds, 2); assert.equal(inventory.rowsComplete, false);
  assert.ok(inventory.issues.some(issue => issue.includes("Filtros")));
});

test("conflicting repeated pages preserve both observations and block changed fields", () => {
  const first = source({ bills: [{ page: 1, headers: BILL_HEADERS, rows: [bill("r1")] }] });
  const second = source({ bills: [{ page: 1, headers: BILL_HEADERS, rows: [bill("r1", { current: "120.00" })] }] });
  const output = convertEobraCheckpoint([first, second]);
  assert.ok(pending(output, "receivable", "r1").reasons.some(reason => reason.includes("conflitantes")));
  assert.ok(output.report.inventory.find(entry => entry.capture === "bills").issues.some(issue => issue.includes("Página 1")));
  assert.deepEqual(reconstructEobraCheckpoint(output.snapshot), [first, second]);
});

test("date-tie supplements close unique-ID coverage only as proven complete subsets", () => {
  const filters = { datetype: "1", startDate: "01/01/2026", endDate: "31/12/2026", checks: [["including_cancelled", true]] };
  const rows = [bill("r1"), bill("r2")];
  const data = source({
    bills: [
      { page: 1, headers: BILL_HEADERS, filters, footer: "Exibindo 1-1 de 2 itens\npor página\nde 2", rows: [rows[0]] },
      { page: 2, footer: "Exibindo 1-1 de 2 itens\npor página\nde 2", rows: [{ ...rows[0], class: `${rows[0].class} Odd` }] },
    ],
    billsSupplemental: [{ baseCapture: "bills", page: 1, filters: { ...filters, startDate: "10/04/2026", endDate: "10/04/2026" }, footer: "Exibindo 1-2 de 2 itens\npor página\nde 1", rows }],
  });
  const output = convertEobraCheckpoint(data);
  const inventory = output.report.inventory.find(entry => entry.capture === "bills");
  assert.equal(inventory.baseUniqueIds, 1); assert.equal(inventory.supplementalUniqueIds, 1);
  assert.equal(inventory.uniqueIds, 2); assert.equal(inventory.observations, 4); assert.equal(inventory.rowsComplete, true);
  assert.deepEqual(reconstructEobraCheckpoint(output.snapshot), data);
});

test("supplements with different predicates, missing pages or dates outside the query cannot close coverage", () => {
  const filters = { datetype: "1", startDate: "01/01/2026", endDate: "31/12/2026", checks: [["including_cancelled", true]] };
  const base = source({ bills: [{ page: 1, headers: BILL_HEADERS, filters, footer: "Exibindo 1-1 de 2 itens\npor página\nde 2", rows: [bill("r1")] }], billsSupplemental: [{ baseCapture: "bills", page: 1, filters: { ...filters, startDate: "10/04/2026", endDate: "10/04/2026" }, footer: "Exibindo 1-1 de 1 itens\npor página\nde 1", rows: [bill("r2")] }] });
  for (const change of [
    data => { data.captures.billsSupplemental[0].filters.datetype = "2"; },
    data => { data.captures.billsSupplemental[0].filters.checks = [["including_cancelled", false]]; },
    data => { data.captures.billsSupplemental[0].footer = "Exibindo 1-1 de 2 itens\npor página\nde 2"; },
    data => { data.captures.billsSupplemental[0].rows[0].cells[2].value = "2026-04-11"; },
    data => { data.captures.billsSupplemental[0].baseCapture = "different_query"; },
  ]) {
    const data = structuredClone(base); change(data);
    const output = convertEobraCheckpoint(data);
    const inventory = output.report.inventory.find(entry => entry.capture === "bills");
    assert.equal(inventory.uniqueIds, 1); assert.equal(inventory.rowsComplete, false);
    assert.ok(output.report.warnings.some(warning => warning.includes("suplemento não comprova")));
    assert.ok(candidate(output, "receivable", "r2"));
  }
});

test("completed structured observations and explicit coverage produce a valid complete package", () => {
  const output = convertEobraCheckpoint(completeFixture());
  assert.equal(output.inspection.ok, true, output.inspection.errors.join("\n"));
  assert.equal(output.report.pendingRecords, 0, JSON.stringify(output.report.pendingDetails));
  assert.equal(output.report.nativeRecords, 11);
  assert.equal(output.report.complete, true);
  assert.equal(output.inspection.allProjectsComplete, true);
});

test("declared complete coverage cannot override an observed incomplete financial list", () => {
  const data = completeFixture();
  const row = bill("r1", { current: "100.0000" });
  row.cells[0].installment.text = "1 de 1"; row.cells[0].installment.total = "1";
  row.cells[11] = { value: "Parcela sintética" }; row.cells[12] = { text: "" };
  data.captures.bills = [{ page: 1, headers: BILL_HEADERS, footer: "Exibindo 1-1 de 2 itens\npor página\nde 2", rows: [row] }];
  const output = convertEobraCheckpoint(data);
  assert.equal(output.report.pendingRecords, 0, JSON.stringify(output.report.pendingDetails));
  assert.equal(output.report.inventory.find(entry => entry.capture === "bills").rowsComplete, false);
  assert.equal(output.snapshot.coverage.find(entry => entry.entity === "receivable").complete, false);
  assert.equal(output.inspection.complete, false); assert.equal(output.inspection.allProjectsComplete, false); assert.equal(output.report.complete, false);
});

test("structured details also reject conflicting route and explicit sourceId", () => {
  const output = convertEobraCheckpoint(source({ saleDetails: { s1: { sourceId: "s1", route: "Construction/Deals/GetSale/s2", normalized: { number: "one", status: "draft" } } } }));
  assert.ok(pending(output, "sale", "s1").reasons.some(reason => reason.startsWith("sourceId:")));
});

test("appended details fill missing fields by source ID without editing the earlier checkpoint", () => {
  const full = completeFixture();
  const first = source({ records: full.captures.records.map(row => row.entity === "person" ? { ...row, normalized: {} } : row), coverage: full.captures.coverage });
  const second = source({ personDetails: { c1: { sourceId: "c1", normalized: { name: "Pessoa sintética", person_type: "OTHER", roles: ["client", "supplier"], status: "active" } } } });
  const output = convertEobraCheckpoint([first, second]);
  assert.equal(output.report.pendingRecords, 0, JSON.stringify(output.report.pendingDetails));
  assert.equal(output.report.complete, true);
  assert.deepEqual(reconstructEobraCheckpoint(output.snapshot), [first, second]);
});

test("conflicting structured details cannot silently override earlier observed money", () => {
  const full = completeFixture();
  const extra = source({ installmentDetails: { r1: { entity: "receivable", sourceId: "r1", sourceProjectId: "p1", normalized: { current_amount: "999.00" } } } });
  const output = convertEobraCheckpoint([full, extra]);
  assert.ok(pending(output, "receivable", "r1").reasons.some(reason => reason.includes("conflitantes")));
  const coverage = output.snapshot.coverage.find(entry => entry.entity === "receivable");
  assert.equal(coverage.expectedCount, 1); assert.equal(coverage.complete, false); assert.deepEqual(coverage.detailsCollected, []);
  assert.equal(output.report.complete, false);
});

test("explicit void evidence preserves an invalid reversal date without inventing one", () => {
  const event = payment("e1", "q1", { reversed: true });
  const detail = [{ tables: [{ headers: ["Tipo", "Data", "Valor"], rows: [
    { attrs: { "data-cod": "rev1", class: "notDetails" }, cells: [{ value: "105", text: "Estornado" }, { value: "-0001-11-30" }, { value: "-20.00" }] },
    { attrs: { "data-cod": "e1", class: "highlight rec rev" }, cells: [{ value: "100", text: "Dinheiro" }, { value: "2026-03-10" }, { value: "-20.00" }] },
  ] }] }];
  const output = convertEobraCheckpoint(source({ payments: [{ headers: PAYMENT_HEADERS, rows: [event] }], reversedPaymente1: wrap(detail) }));
  const original = candidate(output, "settlement", "e1");
  assert.equal(original.normalized.kind, "voided_payment"); assert.equal(original.normalized.amount, "20.00"); assert.equal(original.normalized.occurred_on, "2026-03-10");
  assert.equal(original.normalized.voided_by_source_id, "rev1");
  const archive = output.snapshot.records.find(row => row.archiveType === "undated_reversal");
  assert.equal(archive.normalized.occurred_on_raw, "-0001-11-30"); assert.equal(archive.normalized.history_dates_complete, false);
  assert.equal(output.report.history_dates_complete, false);
});

test("a reversed payment without explicit reversal evidence remains pending", () => {
  const output = convertEobraCheckpoint(source({ payments: [{ headers: PAYMENT_HEADERS, rows: [payment("e1", "q1", { reversed: true })] }] }));
  const event = candidate(output, "settlement", "e1");
  assert.equal(event.normalized.kind, undefined); assert.equal(event.normalized.voided_by_source_id, undefined);
  assert.ok(pending(output, "settlement", "e1"));
});

test("tampered preserved fragments cannot pass reconstruction", () => {
  const output = convertEobraCheckpoint(source({ projects: [project()] }));
  const fragment = output.snapshot.records.find(row => row.archiveType === "ui_capture_fragment");
  fragment.raw.value[0].name = "changed";
  assert.throws(() => reconstructEobraCheckpoint(output.snapshot), /alterado/);
});

test("incompatible hosts, unsafe JSON and tool errors remain explicit", () => {
  const wrong = source({}); wrong.sourceHost = "other.eobra.example";
  assert.equal(convertEobraCheckpoint([source({}), wrong]).report.readyForReview, false);
  assert.throws(() => convertEobraCheckpoint(source({ unsafe: Number.MAX_SAFE_INTEGER + 1 })), /precis/);
  const output = convertEobraCheckpoint(source({ failed: { isError: true, content: [{ type: "text", text: "{}" }] } }));
  assert.ok(output.report.errors.some(error => error.includes("registrou erro")));
  assert.match(formatEobraCheckpointReview(output.report), /coleta incompleta/);
});

test("CLI writes private review artifacts and refuses overwrites, repository paths and source replacement", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "eobra-checkpoint-"));
  try {
    const input = path.join(directory, "source.json");
    const out = path.join(directory, "snapshot.json");
    const report = path.join(directory, "review.json");
    await writeFile(input, JSON.stringify(source({ projects: [project()] })));
    const run = args => spawnSync(process.execPath, ["scripts/import-eobra-checkpoint.mjs", ...args], { cwd: ROOT, encoding: "utf8" });
    const args = ["--input", input, "--out", out, "--report", report];
    const created = run(args);
    assert.equal(created.status, 0, created.stderr);
    assert.equal(JSON.parse(await readFile(report, "utf8")).complete, false);
    assert.equal((await stat(out)).mode & 0o777, 0o600);
    assert.equal(run(args).status, 1);
    assert.equal(run([...args, "--overwrite", "--require-complete"]).status, 2);
    assert.equal(run(["--input", input, "--out", path.join(ROOT, "must-never-exist.json"), "--report", report, "--overwrite"]).status, 1);
    assert.equal(run(["--input", input, "--out", input, "--report", report, "--overwrite"]).status, 1);
    const repoLink = path.join(directory, "repo-link"); await symlink(ROOT, repoLink, "dir");
    assert.equal(run(["--input", input, "--out", path.join(repoLink, "must-never-exist.json"), "--report", report, "--overwrite"]).status, 1);
    const leafLink = path.join(directory, "leaf-link.json"); await symlink(input, leafLink, "file");
    assert.equal(run(["--input", input, "--out", leafLink, "--report", report, "--overwrite"]).status, 1);
    const bundle = path.join(directory, "bundle");
    const bundled = run(["--input", input, "--bundle", bundle, "--report", report, "--overwrite"]);
    assert.equal(bundled.status, 0, bundled.stderr);
    const manifest = JSON.parse(await readFile(path.join(bundle, "manifest.json"), "utf8"));
    assert.equal(manifest.format, "elos.eobra.snapshot.parts.v1");
    assert.equal(manifest.parts[0].name, "part-000001.json");
    assert.ok(Array.isArray(JSON.parse(await readFile(path.join(bundle, "part-000001.json"), "utf8"))));
    assert.equal(run(["--input", input, "--bundle", bundle, "--report", report, "--overwrite"]).status, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
