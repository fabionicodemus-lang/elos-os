import test from "node:test";
import assert from "node:assert/strict";
import {
  EOBRA_SNAPSHOT_FORMAT, EOBRA_PRIORITY_ENTITIES, MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_RECORDS, MAX_SNAPSHOT_DEPTH, canonicalEobraJson,
  hashEobraValue, inspectEobraSnapshot,
} from "../../lib/eobra-import/snapshot.mjs";

test("unknown source-account status is explicit and never weakens other status checks", () => {
  const pack = fixture();
  const account = pack.records.find(row => row.entity === "bank_account");
  account.normalized.status = "unknown";
  let result = inspectEobraSnapshot(pack);
  assert.ok(result.records.find(row => row.entity === "bank_account").errors.some(error => error.startsWith("status_provenance:")));
  account.normalized.status_provenance = "not_exposed_by_source";
  result = inspectEobraSnapshot(pack);
  assert.deepEqual(result.records.find(row => row.entity === "bank_account").errors, []);
  assert.equal(result.records.find(row => row.entity === "bank_account").disposition, "archived");
  pack.records.find(row => row.entity === "person").normalized.status = "unknown";
  assert.ok(inspectEobraSnapshot(pack).records.find(row => row.entity === "person").errors.some(error => error.startsWith("status:")));
});

// Entirely synthetic fixtures. No customer/export payloads or credentials.
const scoped = new Set(["unit", "sale", "receivable", "payable", "settlement"]);
const link = (entity, sourceId, role, extra = {}) => ({ entity, sourceId, role, ...extra });
const record = (entity, sourceId, normalized, sourceProjectId = null, links = []) => ({
  entity, sourceId, sourceProjectId, parentSourceId: null, links,
  raw: { source_id: sourceId, synthetic: true }, normalized,
});

function coverageFor(snapshot) {
  const groups = new Map();
  const key = (entity, project, archive = null) => JSON.stringify([entity, project, archive]);
  for (const entity of EOBRA_PRIORITY_ENTITIES) {
    for (const project of scoped.has(entity) ? snapshot.scope.projectIds : [null]) {
      groups.set(key(entity, project), { entity, sourceProjectId: project, records: [] });
    }
  }
  for (const item of snapshot.records) {
    const groupKey = key(item.entity, item.sourceProjectId ?? null, item.archiveType ?? null);
    if (!groups.has(groupKey)) groups.set(groupKey, { entity: item.entity, sourceProjectId: item.sourceProjectId ?? null, ...(item.archiveType ? { archiveType: item.archiveType } : {}), records: [] });
    groups.get(groupKey).records.push(item);
  }
  snapshot.coverage = [...groups.values()].map(({ records, ...group }) => {
    const ids = [...new Set(records.map(item => item.sourceId))];
    return {
      ...group, expectedCount: ids.length, expectedPages: ids.length ? 1 : 0,
      collectedPages: ids.length ? [1] : [], detailsExpected: ids.length,
      detailsCollected: ids, complete: true, filters: { status: "all" },
    };
  });
  return snapshot;
}

function fixture() {
  return coverageFor({
    format: EOBRA_SNAPSHOT_FORMAT,
    source: { host: "exemplo.eobra.com.br", capturedAt: "2026-11-26T12:00:00.000Z", referenceDate: "2026-11-26" },
    scope: { projectIds: ["project-001"], allProjects: false },
    archiveTypes: [],
    coverage: [],
    records: [
      record("project", "project-001", { name: "Obra sintética", code: "EX" }),
      record("person", "person-001", { name: "Pessoa sintética", person_type: "PF", roles: ["client"], status: "active" }),
      record("person", "person-002", { name: "Fornecedor sintético", person_type: "PJ", roles: ["supplier"], status: "active" }),
      record("unit", "unit-001", { code: "0001", status: "sold" }, "project-001", [link("project", "project-001", "project")]),
      record("sale", "sale-001", { number: "0007", sale_date: "2026-01-01", total_amount: "100.00", status: "active" }, "project-001", [link("unit", "unit-001", "unit"), link("person", "person-001", "buyer")]),
      record("receivable", "bill-001", {
        description: "Parcela sintética", due_date: "2026-12-10", status: "open", original_amount: "100.00",
        current_amount: "110.00", paid_amount: "0.00", balance_amount: "110.00", interest_amount: "0.00",
        penalty_amount: "0.00", correction_amount: "10.00", other_accrual_amount: "0.00", discount_amount: "0.00",
        sequence_number: 1, sequence_total: 1, correction_locked: false,
        correction: { mode: "index_number", base_month: "2026-01", base_value: "1000.000000", reference_month: "2026-11", reference_value: "1100.000000" },
      }, "project-001", [link("sale", "sale-001", "sale"), link("correction_index", "index-001", "correction_index")]),
      record("payable", "bill-001", {
        description: "Despesa sintética", due_date: "2026-12-10", status: "open", original_amount: "100.00",
        current_amount: "100.00", paid_amount: "0.00", balance_amount: "100.00", interest_amount: "0.00",
        penalty_amount: "0.00", correction_amount: "0.00", other_accrual_amount: "0.00", discount_amount: "0.00",
        correction_locked: false, correction: { mode: "none" },
      }, "project-001", [link("person", "person-002", "supplier")]),
      record("bank_account", "account-001", { name: "Conta sintética", status: "active", currency: "BRL" }),
      record("correction_index", "index-001", { name: "Índice sintético", code: "TEST", value_type: "index_number" }),
      record("index_value", "point-001", { reference_month: "2026-01", value: "1000.000000" }, null, [link("correction_index", "index-001", "index")]),
      record("index_value", "point-002", { reference_month: "2026-11", value: "1100.000000" }, null, [link("correction_index", "index-001", "index")]),
    ],
  });
}

function entry(snapshot, entity, sourceId) { return snapshot.records.find(item => item.entity === entity && (!sourceId || item.sourceId === sourceId)); }
function errors(report) { return [...report.errors, ...report.records.flatMap(item => item.errors), ...report.coverage.flatMap(item => item.errors)].join("\n"); }
function payment(snapshot, sourceId, amount, extra = {}) {
  snapshot.records.push(record("settlement", sourceId, { kind: "payment", amount, occurred_on: "2026-11-01", medium: "bank", ...extra }, "project-001", [link("receivable", "bill-001", "installment"), link("bank_account", "account-001", "account")]));
}

test("complete source graph has exact totals and never implies bank posting", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = inspectEobraSnapshot(input);
  assert.equal(result.ok, true, errors(result));
  assert.equal(result.complete, true);
  assert.equal(result.allProjectsComplete, false);
  assert.equal(result.summary.uniqueRecords, input.records.length);
  assert.equal(result.summary.financial.receivable.current_amount, "110.00");
  assert.equal(result.summary.financial.payable.current_amount, "100.00");
  assert.equal(result.summary.financial.receivable.totalsComplete, true);
  assert.equal(entry(result, "bank_account").disposition, "archived");
  assert.equal(entry(result, "receivable").disposition, "candidate");
  assert.match(result.snapshotHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(input, before);
});

test("object/key/record/link/page/detail order does not affect canonical hashes", () => {
  const original = fixture();
  const changed = structuredClone(original);
  changed.records.reverse(); changed.coverage.reverse();
  for (const item of changed.records) { item.links.reverse(); item.raw = Object.fromEntries(Object.entries(item.raw).reverse()); }
  for (const group of changed.coverage) group.detailsCollected.reverse();
  const a = inspectEobraSnapshot(original), b = inspectEobraSnapshot(changed);
  assert.equal(a.snapshotHash, b.snapshotHash);
  assert.deepEqual(a.records.map(item => item.recordHash).sort(), b.records.map(item => item.recordHash).sort());
  assert.equal(canonicalEobraJson({ z: 1, a: [2, 1] }), '{"a":[2,1],"z":1}');
  assert.notEqual(hashEobraValue([1, 2]), hashEobraValue([2, 1]));
});

test("raw evidence and source host remain in hashes; auxiliary IDs are never aliases", () => {
  const a = fixture();
  const b = structuredClone(a);
  entry(b, "receivable").raw.title_number = "7";
  entry(b, "receivable").raw.manager_id = "manager-layer-99";
  const x = inspectEobraSnapshot(a), y = inspectEobraSnapshot(b);
  assert.notEqual(x.snapshotHash, y.snapshotHash);
  assert.notEqual(entry(x, "receivable").recordHash, entry(y, "receivable").recordHash);
  assert.notEqual(entry(x, "receivable").identity, entry(x, "payable").identity);
  b.source.host = "outro.eobra.com.br";
  assert.notEqual(y.snapshotHash, inspectEobraSnapshot(b).snapshotHash);
});

test("UTF-8, UTF-8 BOM and direct JSON object yield the same inspection", () => {
  const data = fixture();
  const json = JSON.stringify(data);
  const direct = inspectEobraSnapshot(data);
  for (const input of [json, `\uFEFF${json}`, new TextEncoder().encode(json), new TextEncoder().encode(json).buffer]) {
    const result = inspectEobraSnapshot(input);
    assert.equal(result.ok, true, errors(result));
    assert.equal(result.snapshotHash, direct.snapshotHash);
  }
  assert.match(errors(inspectEobraSnapshot(new Uint8Array([0xff, 0xfe]))), /UTF-8/);
});

test("opaque string IDs preserve zeros; numeric IDs and unsafe raw integers fail", () => {
  const input = fixture();
  entry(input, "person", "person-001").sourceId = "0000001";
  entry(input, "sale").links.find(item => item.role === "buyer").sourceId = "0000001";
  coverageFor(input);
  assert.equal(inspectEobraSnapshot(input).ok, true);
  entry(input, "person", "0000001").sourceId = 1;
  assert.match(errors(inspectEobraSnapshot(input)), /sourceId/);
  assert.match(errors(inspectEobraSnapshot('{"raw":9007199254740993}')), /precisão/);
});

test("same-identity replay and conflicts are visible and never inflate totals", () => {
  const data = fixture();
  data.records.push(structuredClone(entry(data, "receivable")));
  let report = inspectEobraSnapshot(data);
  assert.equal(report.complete, false);
  assert.match(errors(report), /repetida/);
  assert.equal(report.summary.financial.receivable.current_amount, "110.00");
  assert.equal(report.summary.financial.receivable.totalsComplete, false);
  data.records.at(-1).raw.changed = true;
  report = inspectEobraSnapshot(data);
  assert.match(errors(report), /conflitante/);
});

test("dangling references and out-of-scope/cross-project relationships block capture", () => {
  const data = fixture();
  entry(data, "receivable").links[0].sourceId = "missing-sale";
  assert.match(errors(inspectEobraSnapshot(data)), /Referência ausente/);
  const other = fixture();
  other.scope.projectIds.push("project-002");
  other.records.push(record("project", "project-002", { name: "Outra obra sintética" }));
  entry(other, "unit").sourceProjectId = "project-002";
  entry(other, "unit").links[0].sourceId = "project-002";
  coverageFor(other);
  assert.match(errors(inspectEobraSnapshot(other)), /obras diferentes/);
  entry(other, "unit").sourceProjectId = "outside";
  assert.match(errors(inspectEobraSnapshot(other)), /fora do escopo/);
});

test("project is a relationship, not part of identity or a fallback for company cost centers", () => {
  const data = fixture();
  data.scope.projectIds.push("project-002");
  data.records.push(record("project", "project-002", { name: "Obra B" }));
  data.records.push({ ...structuredClone(entry(data, "unit")), sourceProjectId: "project-002", links: [link("project", "project-002", "project")] });
  coverageFor(data);
  assert.match(errors(inspectEobraSnapshot(data)), /conflitante/);
  const globalBill = fixture();
  entry(globalBill, "payable").sourceProjectId = null;
  assert.match(errors(inspectEobraSnapshot(globalBill)), /corporativos em raw_archive/);
});

test("missing parent link and cyclic archived hierarchies are detected", () => {
  const data = fixture();
  data.archiveTypes.push({ key: "payment_plan", description: "Plano sintético observado" });
  data.records.push({ ...record("raw_archive", "plan-001", {}, "project-001", [link("raw_archive", "plan-002", "parent", { archiveType: "payment_plan" })]), archiveType: "payment_plan", parentSourceId: "plan-002" });
  data.records.push({ ...record("raw_archive", "plan-002", {}, "project-001", [link("raw_archive", "plan-001", "parent", { archiveType: "payment_plan" })]), archiveType: "payment_plan", parentSourceId: "plan-001" });
  coverageFor(data);
  assert.match(errors(inspectEobraSnapshot(data)), /ciclo/);
  data.records.at(-1).parentSourceId = "different-parent";
  assert.match(errors(inspectEobraSnapshot(data)), /parentSourceId/);
});

test("coverage count is derived; false completeness, page gaps and wrong detail IDs fail", () => {
  for (const modify of [
    group => { group.collectedCount = 999; },
    group => { group.expectedCount++; },
    group => { group.expectedPages = 2; },
    group => { group.collectedPages = [1, 1]; },
    group => { group.detailsCollected = ["outside"]; },
    group => { group.detailsExpected = null; },
  ]) {
    const data = fixture();
    modify(data.coverage.find(item => item.entity === "sale"));
    const report = inspectEobraSnapshot(data);
    assert.equal(report.complete, false);
    assert.equal(report.ok, false, JSON.stringify(report.coverage));
    assert.equal(report.coverage.find(item => item.entity === "sale").collectedCount, 1);
  }
});

test("declared partial and unknown coverage never become complete", () => {
  const data = fixture();
  const group = data.coverage.find(item => item.entity === "person");
  group.expectedCount = 3; group.expectedPages = 2; group.detailsExpected = 3; group.complete = false;
  let report = inspectEobraSnapshot(data);
  assert.equal(report.ok, true, errors(report));
  assert.equal(report.complete, false);
  assert.match(report.coverage.find(item => item.entity === "person").warnings.join(" "), /faltam|parcial/);
  group.expectedCount = null; group.expectedPages = null; group.detailsExpected = null;
  report = inspectEobraSnapshot(data);
  assert.equal(report.complete, false);
  assert.equal(report.ok, true, errors(report));
});

test("explicit empty inventory is required; complete refers only to declared scope", () => {
  const data = fixture();
  data.coverage = data.coverage.filter(item => item.entity !== "bank_transaction");
  const partial = inspectEobraSnapshot(data);
  assert.equal(partial.complete, false);
  assert.equal(partial.summary.coverage.missing, 1);
  assert.match(partial.warnings.join(" "), /bank_transaction/);
  coverageFor(data); data.scope.allProjects = true;
  assert.equal(inspectEobraSnapshot(data).allProjectsComplete, true);
  data.coverage.find(item => item.entity === "project").expectedCount = 2;
  assert.equal(inspectEobraSnapshot(data).allProjectsComplete, false);
});

test("duplicate coverage entries cannot hide behind one complete declaration", () => {
  const data = fixture();
  data.coverage.push(structuredClone(data.coverage[0]));
  const report = inspectEobraSnapshot(data);
  assert.equal(report.complete, false);
  assert.equal(report.coverage.filter(item => item.entity === "project").every(item => !item.complete), true);
});

test("strict monetary strings, missing components, invalid dates and unknown status block", () => {
  for (const [key, value] of [["original_amount", 100], ["current_amount", "1.1e2"], ["paid_amount", "0.0000"], ["balance_amount", "-1.00"], ["due_date", "2026-02-30"], ["status", "unknown"]]) {
    const data = fixture(); entry(data, "receivable").normalized[key] = value;
    assert.equal(inspectEobraSnapshot(data).ok, false, key);
  }
  const data = fixture(); delete entry(data, "receivable").normalized.interest_amount;
  assert.match(errors(inspectEobraSnapshot(data)), /interest_amount/);
});

test("principal and adjustment evidence must reconcile; totals use exact cents", () => {
  const data = fixture();
  entry(data, "receivable").normalized.correction_amount = "9.99";
  assert.match(errors(inspectEobraSnapshot(data)), /correction_amount/);
  const exact = fixture();
  for (const [id, amount] of [["penny-001", "0.10"], ["penny-002", "0.20"]]) {
    const item = structuredClone(entry(exact, "payable"));
    item.sourceId = id;
    for (const key of ["original_amount", "current_amount", "balance_amount"]) item.normalized[key] = amount;
    exact.records.push(item);
  }
  coverageFor(exact);
  const report = inspectEobraSnapshot(exact);
  assert.equal(report.ok, true, errors(report));
  assert.equal(report.summary.financial.payable.current_amount, "100.30");
});

test("paid history requires real dated settlements and preserves locked amounts", () => {
  const data = fixture();
  Object.assign(entry(data, "receivable").normalized, { status: "paid", paid_amount: "110.00", balance_amount: "0.00", correction_locked: true });
  payment(data, "event-001", "110.00"); coverageFor(data);
  let report = inspectEobraSnapshot(data);
  assert.equal(report.ok, true, errors(report));
  assert.equal(report.summary.settlements.net_amount, "110.00");
  assert.equal(entry(report, "settlement").disposition, "archived");
  delete entry(data, "settlement").normalized.occurred_on;
  report = inspectEobraSnapshot(data);
  assert.equal(report.complete, false);
  assert.match(errors(report), /occurred_on/);
});

test("multiple payments and explicit reversal reconcile partial history without promotion", () => {
  const data = fixture();
  Object.assign(entry(data, "receivable").normalized, { status: "partial", paid_amount: "30.00", balance_amount: "80.00", correction_locked: true });
  payment(data, "event-001", "40.00"); payment(data, "event-002", "10.00");
  data.records.push(record("settlement", "event-003", { kind: "reversal", amount: "20.00", occurred_on: "2026-11-02", medium: "bank" }, "project-001", [link("receivable", "bill-001", "installment"), link("bank_account", "account-001", "account"), link("settlement", "event-001", "reverses")]));
  coverageFor(data);
  const report = inspectEobraSnapshot(data);
  assert.equal(report.ok, true, errors(report));
  assert.equal(report.complete, true);
  assert.equal(report.summary.settlements.payment_amount, "50.00");
  assert.equal(report.summary.settlements.reversal_amount, "20.00");
  assert.equal(report.summary.settlements.net_amount, "30.00");
  assert.equal(entry(report, "receivable").disposition, "blocked");
  assert.match(entry(report, "receivable").promotionBlockers.join(" "), /parcial/);
});

test("paid figures cannot be validated from incomplete settlement coverage", () => {
  const data = fixture();
  Object.assign(entry(data, "receivable").normalized, { status: "paid", paid_amount: "110.00", balance_amount: "0.00", correction_locked: true });
  payment(data, "event-001", "110.00"); coverageFor(data);
  data.coverage.find(item => item.entity === "settlement").complete = false;
  assert.match(errors(inspectEobraSnapshot(data)), /events_complete/);
});

function undatedVoidedFixture() {
  const data = fixture();
  Object.assign(entry(data, "receivable").normalized, { status: "partial", paid_amount: "30.00", balance_amount: "80.00", correction_locked: true });
  data.archiveTypes.push({ key: "settlement_reversal", description: "Estorno original com data inválida preservada" });
  payment(data, "event-voided", "80.00", { kind: "voided_payment", voided_by_source_id: "reversal-undated", voided_date_unknown: true });
  entry(data, "settlement", "event-voided").links.push(link("raw_archive", "reversal-undated", "voided_by", { archiveType: "settlement_reversal" }));
  const archive = record("raw_archive", "reversal-undated", { kind: "reversal", date_valid: false }, "project-001", [link("settlement", "event-voided", "original_payment")]);
  archive.archiveType = "settlement_reversal";
  archive.raw.occurred_on = "-0001-11-30";
  data.records.push(archive);
  payment(data, "event-replacement", "30.00", { medium: "non_cash" });
  entry(data, "settlement", "event-replacement").links = [link("receivable", "bill-001", "installment")];
  return coverageFor(data);
}

test("explicit voided payment has zero effect and preserves undated reversal evidence", () => {
  const data = undatedVoidedFixture();
  const before = structuredClone(data);
  const report = inspectEobraSnapshot(data);
  assert.equal(report.ok, true, errors(report));
  assert.equal(report.complete, true);
  assert.equal(report.summary.settlements.totalsComplete, true);
  assert.equal(report.summary.settlements.payment_amount, "30.00");
  assert.equal(report.summary.settlements.reversal_amount, "0.00");
  assert.equal(report.summary.settlements.net_amount, "30.00");
  assert.equal(report.summary.settlements.voided_amount, "80.00");
  assert.equal(report.summary.settlements.voided_count, 1);
  assert.equal(report.summary.settlements.history_dates_complete, false);
  assert.equal(report.summary.history_dates_complete, false);
  assert.equal(report.summary.financial.receivable.totalsComplete, true);
  assert.equal(entry(report, "settlement", "event-voided").normalized.occurred_on, "2026-11-01");
  assert.equal(entry(report, "raw_archive").raw.occurred_on, "-0001-11-30");
  assert.match(entry(report, "receivable").warnings.join(" "), /data|histórico/i);
  assert.deepEqual(data, before);
});

test("voided payments require typed captured evidence, matching IDs and original payment", () => {
  for (const variant of ["missing-link", "wrong-id", "untyped", "wrong-original", "missing-flag", "not-voided"]) {
    const data = undatedVoidedFixture();
    const original = entry(data, "settlement", "event-voided");
    const archive = entry(data, "raw_archive");
    const target = original.links.find(item => item.role === "voided_by");
    if (variant === "missing-link") original.links = original.links.filter(item => item.role !== "voided_by");
    if (variant === "wrong-id") original.normalized.voided_by_source_id = "another-reversal";
    if (variant === "untyped") delete target.archiveType;
    if (variant === "wrong-original") archive.links[0].sourceId = "event-replacement";
    if (variant === "missing-flag") delete original.normalized.voided_date_unknown;
    if (variant === "not-voided") original.normalized.kind = "payment";
    const report = inspectEobraSnapshot(data);
    assert.equal(report.ok, false, variant);
    assert.match(errors(report), /voided|raw_archive|original|anulação/, variant);
  }
});

test("undated ordinary reversal is never converted to an effective void automatically", () => {
  const data = undatedVoidedFixture();
  const original = entry(data, "settlement", "event-voided");
  original.normalized.kind = "payment";
  delete original.normalized.voided_by_source_id;
  delete original.normalized.voided_date_unknown;
  original.links = original.links.filter(item => item.role !== "voided_by");
  data.records.push(record("settlement", "ordinary-reversal", { kind: "reversal", amount: "80.00", occurred_on: "-0001-11-30", medium: "bank" }, "project-001", [link("receivable", "bill-001", "installment"), link("bank_account", "account-001", "account"), link("settlement", "event-voided", "reverses")]));
  coverageFor(data);
  const report = inspectEobraSnapshot(data);
  assert.equal(report.ok, false);
  assert.equal(report.summary.history_dates_complete, false);
  assert.match(errors(report), /occurred_on/);
  assert.equal(entry(report, "settlement", "ordinary-reversal").normalized.occurred_on, "-0001-11-30");
});

test("reversals cannot precede payment, exceed it, or change the installment", () => {
  for (const variant of ["earlier", "excess", "other-title"]) {
    const data = fixture();
    payment(data, "event-001", "20.00");
    data.records.push(record("settlement", "event-002", { kind: "reversal", amount: variant === "excess" ? "30.00" : "20.00", occurred_on: variant === "earlier" ? "2026-10-31" : "2026-11-02", medium: "bank" }, "project-001", [link(variant === "other-title" ? "payable" : "receivable", "bill-001", "installment"), link("bank_account", "account-001", "account"), link("settlement", "event-001", "reverses")]));
    coverageFor(data);
    assert.equal(inspectEobraSnapshot(data).ok, false, variant);
  }
});

test("a bank payment needs a real account; noncash settlement does not fabricate one", () => {
  const data = fixture();
  Object.assign(entry(data, "receivable").normalized, { status: "paid", paid_amount: "110.00", balance_amount: "0.00", correction_locked: true });
  payment(data, "event-001", "110.00");
  entry(data, "settlement").links = [link("receivable", "bill-001", "installment")];
  coverageFor(data);
  assert.match(errors(inspectEobraSnapshot(data)), /links.account/);
  entry(data, "settlement").normalized.medium = "non_cash";
  assert.equal(inspectEobraSnapshot(data).ok, true);
  entry(data, "settlement").normalized.medium = "unknown";
  assert.match(errors(inspectEobraSnapshot(data)), /medium/);
});

test("open status cannot conceal partial payment", () => {
  const data = fixture();
  Object.assign(entry(data, "receivable").normalized, { paid_amount: "10.00", balance_amount: "100.00", correction_locked: true });
  payment(data, "event-001", "10.00"); coverageFor(data);
  assert.match(errors(inspectEobraSnapshot(data)), /explicitamente partial/);
});

test("captured cancellation abatement requires explicit composition; original principal remains preserved", () => {
  const data = fixture();
  Object.assign(entry(data, "payable").normalized, { status: "cancelled", correction_locked: true, current_amount: "0.00", balance_amount: "0.00", discount_amount: "100.00" });
  let report = inspectEobraSnapshot(data);
  assert.equal(report.ok, true, errors(report));
  assert.equal(entry(report, "payable").normalized.original_amount, "100.00");
  entry(data, "payable").normalized.discount_amount = "0.00";
  report = inspectEobraSnapshot(data);
  assert.match(errors(report), /soma|componentes|confere/);
});

test("historically paid cancelled title remains eligible with reconciled events and zero balance", () => {
  const data = fixture();
  Object.assign(entry(data, "receivable").normalized, { status: "cancelled", paid_amount: "110.00", balance_amount: "0.00", correction_locked: true });
  payment(data, "cancelled-historical-payment", "110.00");coverageFor(data);
  const report = inspectEobraSnapshot(data);
  assert.equal(report.ok, true, errors(report));
  assert.equal(entry(report, "receivable").disposition, "candidate");
  assert.equal(entry(report, "receivable").normalized.original_amount, "100.00");
  assert.equal(entry(report, "receivable").normalized.discount_amount, "0.00");
  assert.equal(report.summary.settlements.net_amount, "110.00");
  assert.equal(report.summary.financial.receivable.balance_amount, "0.00");
  assert.equal(report.summary.financial.receivable.collectible_balance_amount, "0.00");
});

test("cancelled historical balance and dated payments stay preserved with zero collectible total", () => {
  const data = fixture();
  Object.assign(entry(data, "receivable").normalized, { status: "cancelled", paid_amount: "30.00", balance_amount: "80.00", correction_locked: true });
  Object.assign(entry(data, "payable").normalized, { status: "cancelled", correction_locked: true });
  payment(data, "cancelled-partial-payment", "30.00");coverageFor(data);
  const report = inspectEobraSnapshot(data);
  assert.equal(report.ok, true, errors(report));
  assert.equal(entry(report, "receivable").normalized.discount_amount, "0.00");
  assert.equal(entry(report, "receivable").normalized.status, "cancelled");
  assert.equal(report.summary.settlements.net_amount, "30.00");
  assert.equal(report.summary.financial.receivable.balance_amount, "80.00");
  assert.equal(report.summary.financial.receivable.collectible_balance_amount, "0.00");
  assert.equal(report.summary.financial.payable.balance_amount, "100.00");
  assert.equal(report.summary.financial.payable.collectible_balance_amount, "0.00");
  assert.equal(report.summary.financial.receivable.totalsComplete, true);
  assert.equal(report.summary.financial.payable.totalsComplete, true);
});

test("monthly index records must exist, agree with policy, and be unique per month", () => {
  const missing = fixture();
  missing.records = missing.records.filter(item => item.sourceId !== "point-002"); coverageFor(missing);
  assert.match(errors(inspectEobraSnapshot(missing)), /reference_month/);
  const wrong = fixture();
  entry(wrong, "index_value", "point-002").normalized.value = "1099.99";
  assert.match(errors(inspectEobraSnapshot(wrong)), /reference_value/);
  const duplicate = fixture();
  duplicate.records.push({ ...structuredClone(entry(duplicate, "index_value", "point-002")), sourceId: "point-conflict" }); coverageFor(duplicate);
  assert.match(errors(inspectEobraSnapshot(duplicate)), /Competência de índice repetida/);
});

test("maximum-of-period resolves the captured index series without repeating it in every parcel", () => {
  const data = fixture();
  const bill = entry(data, "receivable");
  bill.normalized.correction = { mode: "index_number", base_month: "2026-01", base_value: "1000.000000", reference_month: "2026-03", reference_value: "1100.000000", negative_variation_policy: "maximum_of_period" };
  Object.assign(bill.normalized, { current_amount: "120.00", correction_amount: "20.00", balance_amount: "120.00" });
  entry(data, "index_value", "point-002").normalized.reference_month = "2026-03";
  data.records.push(record("index_value", "point-003", { reference_month: "2026-02", value: "1200.000000" }, null, [link("correction_index", "index-001", "index")]));
  coverageFor(data);
  const before = structuredClone(data);
  let report = inspectEobraSnapshot(data);
  assert.equal(report.ok, true, errors(report));
  assert.equal(report.complete, true);
  assert.equal(entry(report, "receivable").normalized.correction.index_values, undefined);
  assert.equal(report.summary.financial.receivable.current_amount, "120.00");
  assert.deepEqual(data, before);
  bill.normalized.correction.index_values = [
    { reference_month: "2026-01", value: "1000.000000" },
    { reference_month: "2026-02", value: "1200.000000" },
    { reference_month: "2026-03", value: "1100.000000" },
  ];
  assert.equal(inspectEobraSnapshot(data).ok, true);
  entry(data, "index_value", "point-003").normalized.value = "1199.000000";
  assert.match(errors(inspectEobraSnapshot(data)), /index_values/);
  delete bill.normalized.correction.index_values;
  data.records = data.records.filter(item => item.sourceId !== "point-003"); coverageFor(data);
  report = inspectEobraSnapshot(data);
  assert.equal(report.complete, false);
  assert.match(errors(report), /incompleta|competência|lacuna|2026-02/);
});

test("locked unsupported correction remains explicit and never becomes none", () => {
  const data = fixture();
  const bill = entry(data, "receivable");
  bill.normalized.correction_locked = true;
  bill.normalized.correction = { mode: "fixed_percentage", rate: "0.700000", source_rule_id: "rule-example" };
  bill.links = bill.links.filter(item => item.role !== "correction_index");
  const report = inspectEobraSnapshot(data);
  assert.equal(report.ok, true, errors(report));
  assert.equal(entry(report, "receivable").normalized.correction.mode, "fixed_percentage");
  assert.match(entry(report, "receivable").promotionBlockers.join(" "), /não suportada/);
  bill.normalized.correction_locked = false;
  assert.equal(inspectEobraSnapshot(data).ok, false);
});

test("sale may have multiple units and buyers; source allocation and principal are preserved", () => {
  const data = fixture();
  data.records.push(record("unit", "unit-002", { code: "0002", status: "sold" }, "project-001", [link("project", "project-001", "project")]));
  data.records.push(record("person", "person-003", { name: "Segundo comprador sintético", person_type: "PF", roles: ["client"], status: "active" }));
  const sale = entry(data, "sale");
  sale.links = [link("unit", "unit-001", "unit", { primary: true, allocated_amount: "60.00", source_relation_id: "relation-001" }), link("unit", "unit-002", "unit", { primary: false, allocated_amount: "40.00", source_relation_id: "relation-002" }), link("person", "person-001", "buyer", { primary: true, ownership_percent: "70.0000" }), link("person", "person-003", "buyer", { primary: false, ownership_percent: "30.0000" })];
  sale.normalized.units = [{ source_id: "unit-001", primary: true, allocated_amount: "60.00" }, { source_id: "unit-002", primary: false, allocated_amount: "40.00" }];
  coverageFor(data);
  let report = inspectEobraSnapshot(data);
  assert.equal(report.ok, true, errors(report));
  assert.equal(entry(report, "sale").promotionBlockers.length, 0);
  sale.links[0].primary = false; sale.normalized.units[0].primary = false;
  report = inspectEobraSnapshot(data);
  assert.equal(report.ok, true, errors(report));
  assert.match(entry(report, "sale").promotionBlockers.join(" "), /principal/);
  sale.links[0].allocated_amount = "70.00";
  assert.match(errors(inspectEobraSnapshot(data)), /alocações|espelho/);
});

test("draft is archived, while dates that cannot be normalized stay in typed raw archive", () => {
  const data = fixture();
  const sale = entry(data, "sale");
  sale.normalized.status = "draft"; delete sale.normalized.sale_date;
  let report = inspectEobraSnapshot(data);
  assert.equal(report.ok, true, errors(report));
  assert.equal(entry(report, "sale").disposition, "archived");
  assert.match(entry(report, "receivable").promotionBlockers.join(" "), /rascunho/);
  data.archiveTypes.push({ key: "sale_draft", description: "Rascunho com data original não normalizável" });
  data.records.push({ ...record("raw_archive", "draft-002", { source_status: "draft" }), archiveType: "sale_draft", raw: { source_date: "00/00/00", arbitrary_source_fields: { kept: true } } });
  coverageFor(data);
  report = inspectEobraSnapshot(data);
  assert.equal(report.ok, true, errors(report));
  assert.equal(entry(report, "raw_archive").raw.source_date, "00/00/00");
  assert.equal(entry(report, "raw_archive").disposition, "archived");
});

test("undeclared archive types and missing inventories do not count as imported", () => {
  const data = fixture();
  data.records.push({ ...record("raw_archive", "extra-001", {}), archiveType: "company_cost_center" });
  coverageFor(data);
  assert.match(errors(inspectEobraSnapshot(data)), /archiveType/);
  data.archiveTypes.push({ key: "company_cost_center", description: "Centro corporativo sem obra" });
  const report = inspectEobraSnapshot(data);
  assert.equal(report.ok, true, errors(report));
  assert.equal(entry(report, "raw_archive").sourceProjectId, null);
  assert.equal(entry(report, "raw_archive").disposition, "archived");
});

test("CPF/CNPJ checksums and person roles are checked without name matching", () => {
  const data = fixture();
  entry(data, "person", "person-001").normalized.tax_id = "111.111.111-11";
  assert.match(errors(inspectEobraSnapshot(data)), /dígitos verificadores/);
  entry(data, "person", "person-001").normalized.tax_id = null;
  entry(data, "person", "person-001").normalized.roles = ["supplier"];
  assert.match(errors(inspectEobraSnapshot(data)), /papel client/);
  entry(data, "person", "person-001").normalized.roles = 3;
  assert.doesNotThrow(() => inspectEobraSnapshot(data));
  assert.match(errors(inspectEobraSnapshot(data)), /roles/);
});

test("malformed envelope, invalid timezone/date and unsupported entities are visible", () => {
  for (const data of [null, [], "{", { ...fixture(), format: "unknown" }]) assert.equal(inspectEobraSnapshot(data).ok, false);
  const data = fixture();
  data.source.host = "https://exemplo.eobra.com.br/Finance/Bills";
  data.source.capturedAt = "2026-02-30T12:00:00Z";
  data.source.referenceDate = "26/11/26";
  data.records.push(record("unregistered_entity", "unknown-001", {}));
  const report = inspectEobraSnapshot(data);
  assert.match(errors(report), /source.host/);
  assert.match(errors(report), /capturedAt/);
  assert.match(errors(report), /referenceDate/);
  assert.match(errors(report), /raw_archive/);
});

test("JSON safety rejects values serialization would erase or execute", () => {
  const cycle = {}; cycle.self = cycle;
  let accessed = false;
  const getter = Object.defineProperty({}, "x", { enumerable: true, get() { accessed = true; return 1; } });
  for (const data of [cycle, { x: undefined }, { x: () => 1 }, { x: 1n }, { x: Infinity }, getter, new Date(), new Array(3)]) assert.equal(inspectEobraSnapshot(data).ok, false);
  assert.equal(accessed, false);
  assert.throws(() => canonicalEobraJson({ x: NaN }), /não finito/);
});

test("byte, record-count and nesting limits fail closed without truncation", () => {
  assert.equal(MAX_SNAPSHOT_BYTES, 200 * 1024 * 1024);
  assert.equal(MAX_SNAPSHOT_RECORDS, 100000);
  assert.match(errors(inspectEobraSnapshot(new Uint8Array(MAX_SNAPSHOT_BYTES + 1))), /200 MiB/);
  assert.match(errors(inspectEobraSnapshot({ records: new Array(MAX_SNAPSHOT_RECORDS + 1).fill(null) })), /limite|itens demais/);
  let nested = {};
  for (let i = 0; i < MAX_SNAPSHOT_DEPTH + 1; i++) nested = { nested };
  assert.match(errors(inspectEobraSnapshot(nested)), /profundidade/);
});
