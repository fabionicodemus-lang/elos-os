import test from "node:test";
import assert from "node:assert/strict";
import { fixture, applyMigration, confirmSyntheticUnitDecisions, setTenant, A, B, PA, PA2, PB, UA, UB } from "./eobra-snapshot-fixture.mjs";

const entities = ["project", "person", "unit", "sale", "receivable", "payable", "settlement", "bank_account", "bank_transaction", "correction_index", "index_value"];
const projectEntities = ["unit", "sale", "receivable", "payable", "settlement"];

test("historical account without exposed status preserves payments without activating a native account", async () => {
  const db = await fixture();
  try {
    for (const suffix of ["_finance_partial_settlements.sql", "_eobra_snapshot_promotion.sql", "_commercial_sale_units_eobra.sql", "_eobra_snapshot_resumable.sql", "_eobra_snapshot_parts.sql", "_eobra_snapshot_unit_mapping.sql", "_eobra_unknown_source_account_status.sql", "_eobra_resolve_native_targets_once.sql"]) await applyMigration(db, suffix);
    const items = records("history");
    items.push(record("bank_account", "source-account", { name: "Historical account", currency: "BRL", status: "unknown", status_provenance: "not_exposed_by_source" }));
    items.push(financial("receivable", "historical-title", { status: "paid", paid_amount: "100.00", balance_amount: "0.00" }, [{ entity: "sale", sourceId: "salehistory", role: "sale" }]));
    items.push(record("settlement", "historical-payment", { kind: "payment", amount: "100.00", occurred_on: "2026-10-10", medium: "bank" }, [{ entity: "receivable", sourceId: "historical-title", role: "installment" }, { entity: "bank_account", sourceId: "source-account", role: "account" }], "p1"));
    const id = await stage(db, items);
    assert.equal((await run(db, id)).status, "ready");
    await promote(db, id);
    assert.equal(await count(db, "finance_bank_accounts"), 0);
    assert.equal(await count(db, "finance_bank_transactions"), 0);
    assert.equal(await count(db, "eobra_source_events"), 1);
    assert.equal((await db.query("select details->>'status' status from public.eobra_source_accounts")).rows[0].status, "unknown");
    const invalid = records("invalid");
    invalid.push(record("bank_account", "unknown-unproven", { name: "Unproven", currency: "BRL", status: "unknown" }));
    const bad = await stage(db, invalid);
    assert.equal((await run(db, bad)).status, "review");
    await assert.rejects(promote(db, bad), /pendências/);
  } finally { await db.close(); }
});
function record(entity, sourceId, normalized, links = [], project = null) {
  return { entity, sourceId, ...(project ? { sourceProjectId: project } : {}), raw: { source: sourceId, observed: normalized }, normalized, links };
}

test("resolved ledger lookups preserve tenant, project, permission and source identity checks", async () => {
  const db = await fixture();
  try {
    for (const suffix of ["_finance_partial_settlements.sql", "_eobra_snapshot_promotion.sql", "_commercial_sale_units_eobra.sql", "_eobra_snapshot_resumable.sql", "_eobra_snapshot_parts.sql", "_eobra_snapshot_unit_mapping.sql", "_eobra_resolve_native_targets_once.sql"]) await applyMigration(db, suffix);
    const id = await stage(db, records("lookup"));
    await promote(db, id);
    const source = (await db.query("select id from public.eobra_migration_records where run_id=$1 and entity='sale'", [id])).rows[0].id;
    const unit = (await db.query("select id,targets->>'units' unit_id from public.eobra_migration_ledger where run_id=$1 and entity='unit'", [id])).rows[0];
    const lookup = async () => (await db.query("select public.eobra_snapshot_link_ledger($1,'unit','unit') ledger_id,public.eobra_snapshot_link_target($1,'unit','unit','units') unit_id", [source])).rows[0];
    assert.deepEqual(await lookup(), { ledger_id: unit.id, unit_id: unit.unit_id });
    assert.equal((await db.query("select public.eobra_snapshot_link_ledger($1,'unit','person') id", [source])).rows[0].id, null);
    await setTenant(db, B, UB);
    assert.deepEqual(await lookup(), { ledger_id: null, unit_id: null });
    await setTenant(db, A, UA);
    await db.query("select set_config('test.denied','sales.manage',false)");
    assert.deepEqual(await lookup(), { ledger_id: null, unit_id: null });
    await db.query("select set_config('test.denied','',false),set_config('test.hidden_project',$1,false)", [PA]);
    assert.deepEqual(await lookup(), { ledger_id: null, unit_id: null });
    await db.query("select set_config('test.hidden_project','',false)");
    assert.deepEqual(await lookup(), { ledger_id: unit.id, unit_id: unit.unit_id });
  } finally { await db.close(); }
});
function records(suffix = "") {
  return [
    record("project", "p1", { name: "Obra sintética" }),
    record("person", `buyer${suffix}`, { name: `Pessoa sintética${suffix}`, person_type: "PF", roles: ["client", "supplier"], status: "active", tax_id: null }),
    record("unit", `unit${suffix}`, { code: `U${suffix || "1"}`, status: "available" }, [{ entity: "project", sourceId: "p1", role: "project" }], "p1"),
    record("sale", `sale${suffix}`, { number: `S${suffix || "1"}`, sale_date: "2026-10-01", total_amount: "100.00", status: "active" }, [{ entity: "unit", sourceId: `unit${suffix}`, role: "unit" }, { entity: "person", sourceId: `buyer${suffix}`, role: "buyer" }], "p1"),
  ];
}
function financial(entity, id, extra = {}, links = []) {
  return record(entity, id, {
    description: `Parcela ${id}`, document: id, due_date: "2026-12-01", original_amount: "100.00", current_amount: "100.00", paid_amount: "0.00", balance_amount: "100.00",
    interest_amount: "0.00", penalty_amount: "0.00", correction_amount: "0.00", other_accrual_amount: "0.00", discount_amount: "0.00", status: "open", correction_locked: true, correction: { mode: "none" },
    sequence_number: 1, sequence_total: 1, category: "monthly", ...extra,
  }, links, "p1");
}
function snapshot(items, { capturedAt = "2026-11-26T00:00:00Z", scope = { projectIds: ["p1"], allProjects: true }, coverage, archiveTypes = [] } = {}) {
  const groups = new Map();
  for (const entity of entities) {
    if (projectEntities.includes(entity)) for (const id of scope.projectIds) groups.set(`${entity}|${id}|`, { entity, sourceProjectId: id });
    else groups.set(`${entity}||`, { entity, sourceProjectId: null });
  }
  for (const item of items) groups.set(`${item.entity}|${item.sourceProjectId ?? ""}|${item.archiveType ?? ""}`, { entity: item.entity, sourceProjectId: item.sourceProjectId ?? null, ...(item.archiveType ? { archiveType: item.archiveType } : {}) });
  return { format: "elos.eobra.snapshot.v1", source: { host: "fixture.eobra.com.br", capturedAt, referenceDate: "2026-11-26" }, scope, records: items, archiveTypes,
    coverage: coverage ?? [...groups.values()].map(group => {
      const rows = items.filter(item => item.entity === group.entity && (item.sourceProjectId ?? null) === group.sourceProjectId && (item.archiveType ?? "") === (group.archiveType ?? ""));
      return { ...group, expectedCount: rows.length, expectedPages: 1, collectedPages: [1], detailsExpected: rows.length, detailsCollected: rows.map(item => item.sourceId), complete: true, filters: { status: "all" } };
    }),
  };
}
async function stage(db, items, options = {}) {
  const pack = items.format ? items : snapshot(items, options);
  const id = (await db.query("select public.stage_eobra_snapshot($1,$2,$3) id", [options.company ?? A, pack, options.map ?? { p1: PA }])).rows[0].id;
  await confirmSyntheticUnitDecisions(db,id);
  let progress=(await db.query("select public.eobra_snapshot_progress($1) progress",[id])).rows[0].progress;
  while(progress.next_step==='validate')progress=(await db.query("select public.validate_eobra_snapshot_chunk($1,100) progress",[id])).rows[0].progress;
  if(progress.next_step==='seal')await db.query("select public.seal_eobra_snapshot($1)",[id]);
  return id;
}
async function run(db, id) { return (await db.query("select * from public.eobra_migration_runs where id=$1", [id])).rows[0]; }
async function promote(db, id, hash) { return (await db.query("select public.promote_eobra_snapshot($1,$2) result", [id, hash ?? (await run(db, id)).preview_hash])).rows[0].result; }
async function count(db, table) { return (await db.query(`select count(*)::int n from public.${table}`)).rows[0].n; }

test("complete eObra package: isolated staging, provenance, transactional promotion", async t => {
  const db = await fixture();
  try {
    await applyMigration(db, "_finance_partial_settlements.sql");
    await applyMigration(db, "_eobra_snapshot_promotion.sql");
    await applyMigration(db, "_commercial_sale_units_eobra.sql");
    await applyMigration(db, "_eobra_snapshot_resumable.sql");
    await applyMigration(db, "_eobra_snapshot_parts.sql");
    await applyMigration(db, "_eobra_snapshot_unit_mapping.sql");
    await applyMigration(db, "_eobra_resolve_native_targets_once.sql");

    await t.test("order-independent commercial promotion creates every role and relation", async () => {
      const items = records();
      items.push(financial("receivable", "r1", {}, [{ entity: "sale", sourceId: "sale", role: "sale" }]));
      const before = await count(db, "clients");
      const id = await stage(db, [...items].reverse());
      const b = await run(db, id);
      assert.equal(b.status, "ready"); assert.equal(b.summary.coverage_complete, true);
      assert.equal(await count(db, "clients"), before);
      await assert.rejects(promote(db, id, "0".repeat(64)), /revisão mudou/);
      assert.deepEqual(await promote(db, id), { total: 5, created: 5, reused: 1, archived: 0, duplicates: 0 });
      assert.equal(await count(db, "clients"), before + 1);
      const title = (await db.query("select * from public.receivables where source_system='eobra_snapshot'")).rows[0];
      assert.equal(title.amount, "100.00"); assert.equal(title.adjusted_amount, "100.00"); assert.equal(title.correction_locked, true);
      assert.equal(title.sequence_number, 1); assert.equal(title.sequence_total, 1);
      assert.equal((await db.query("select count(*)::int n from public.commercial_sale_parties where sale_id=$1", [title.sale_id])).rows[0].n, 1);
      assert.deepEqual(await promote(db, id, "replayed after import"), (await run(db, id)).promotion_result);
      assert.equal(await count(db, "eobra_migration_ledger"), 5);
      assert.equal(await stage(db, [...items].reverse()), id);
    });

    await t.test("new captures reuse unchanged identities and preserve changed versions as conflicts", async () => {
      const items = records(); items.push(financial("receivable", "r1", {}, [{ entity: "sale", sourceId: "sale", role: "sale" }]));
      const id = await stage(db, items, { capturedAt: "2026-11-26T01:00:00Z" });
      assert.equal((await run(db, id)).summary.duplicates, 5);
      assert.deepEqual(await promote(db, id), { total: 5, created: 0, reused: 0, archived: 0, duplicates: 5 });
      items[1].normalized.name = "Alterado depois";
      const changed = await stage(db, items, { capturedAt: "2026-11-26T02:00:00Z" });
      assert.equal((await run(db, changed)).status, "review"); assert.equal((await run(db, changed)).summary.conflicts, 1);
      await assert.rejects(promote(db, changed), /pendências/);
      assert.equal((await db.query("select name from public.clients where source_id='fixture.eobra.com.br|person|buyer'")).rows[0].name, "Pessoa sintética");
    });

    await t.test("coverage, references and totals include blocked rows and never treat unknown as zero", async () => {
      const items = [records()[0], financial("payable", "invalid", { current_amount: "not-money", counterparty_name: "Favorecido" })];
      const pack = snapshot(items); pack.coverage.find(item => item.entity === "payable").expectedCount = 2;
      const id = await stage(db, pack); const b = await run(db, id);
      assert.equal(b.status, "review"); assert.equal(b.summary.blocked, 1); assert.equal(b.summary.coverage_complete, false);
      assert.equal(b.summary.totals.payable.original_amount, "100.00"); assert.equal(b.summary.totals.payable.complete, false);
      await assert.rejects(promote(db, id), /pendências/);
      const missing = records("missing"); missing.find(row => row.entity === "sale").links[0].sourceId = "absent";
      const badRef = await stage(db, missing); assert.equal((await run(db, badRef)).summary.blocked, 1);
    });

    await t.test("RLS isolates companies and native permissions apply to raw archives and direct reads", async () => {
      const archive = { ...record("raw_archive", "a1", { note: "Documentos de origem" }), archiveType: "other" };
      const pack = snapshot([records()[0], archive], { archiveTypes: [{ key: "other", description: "Complemento" }] });
      const id = await stage(db, pack);
      await db.query("select set_config('test.denied','payables.manage',false)");
      assert.equal((await db.query("select * from public.eobra_migration_runs where id=$1", [id])).rows.length, 0);
      assert.equal((await db.query("select * from public.eobra_migration_records where run_id=$1", [id])).rows.length, 0);
      await assert.rejects(stage(db, pack), /Permissões nativas/);
      await setTenant(db, B, UB);
      assert.equal(await count(db, "eobra_migration_runs"), 0); assert.equal(await count(db, "eobra_migration_ledger"), 0);
      await assert.rejects(promote(db, id, "fake"), /indisponível/);
      await setTenant(db, A, UA);
      await db.query("select set_config('test.hidden_project',$1,false)", [PA]);
      assert.equal((await db.query("select * from public.eobra_migration_runs where id=$1", [id])).rows.length, 0);
      assert.equal((await db.query("select * from public.eobra_migration_records where run_id=$1", [id])).rows.length, 0);
      await db.query("select set_config('test.hidden_project','',false)");
      assert.equal((await db.query("select * from public.eobra_migration_records where run_id=$1", [id])).rows.length, pack.records.length);
      await assert.rejects(stage(db, [records()[0]], { map: { p1: PB } }), /De-para/);
      const { rows } = await db.query("select prosecdef from pg_proc where proname in('stage_eobra_snapshot','promote_eobra_snapshot','cancel_eobra_snapshot')");
      assert.ok(rows.every(row => row.prosecdef === false));
    });

    await t.test("sealed source, permissions and reviewed totals cannot be forged", async () => {
      const id = await stage(db, records("immutable")); const b = await run(db, id);
      await assert.rejects(db.query("update public.eobra_migration_runs set required_permissions='{}' where id=$1", [id]), /imutáveis/);
      await assert.rejects(db.query("update public.eobra_migration_records set normalized_data='{}',record_hash=repeat('0',64) where run_id=$1", [id]), /imutáveis/);
      await assert.rejects(db.query("update public.eobra_migration_records set errors='[]',status='imported' where run_id=$1", [id]), /imutáveis|ledger/);
      await assert.rejects(db.query("update public.eobra_migration_coverage set verified=true,actual_count=999 where run_id=$1", [id]), /imutável/);
      await db.query("update public.eobra_migration_runs set summary='{}',preview_hash=repeat('0',64) where id=$1", [id]);
      assert.deepEqual((await run(db, id)).summary, b.summary); assert.equal((await run(db, id)).preview_hash, b.preview_hash);
      await db.query("update public.eobra_migration_runs set status='promoting' where id=$1", [id]);
      await assert.rejects(db.query("insert into public.eobra_migration_ledger(company_id,project_id,source_host,entity,source_id,record_hash,targets,disposition,run_id,record_id,required_permissions) select company_id,project_id,'fixture.eobra.com.br',entity,source_id,record_hash,jsonb_build_object('clients',$2::uuid),'canonical',run_id,id,'{}' from public.eobra_migration_records where run_id=$1 and entity='person'", [id, PB]), /Identidade ou permissões/);
    });

    await t.test("set validation rejects records forged through direct building-table writes", async () => {
      const original = await stage(db, [records()[0], records("direct")[1]]);
      const copied = (await db.query("insert into public.eobra_migration_runs(company_id,source_host,format,captured_at,reference_date,scope,archive_types,project_map,required_permissions,snapshot_hash,fingerprint,expected_records) select company_id,source_host,format,captured_at,reference_date,scope,archive_types,project_map,required_permissions,snapshot_hash,fingerprint,expected_records from public.eobra_migration_runs where id=$1 returning id", [original])).rows[0].id;
      await db.query("insert into public.eobra_migration_snapshots(run_id,company_id,document,snapshot_hash) select $2,company_id,document,snapshot_hash from public.eobra_migration_snapshots where run_id=$1", [original, copied]);
      await db.query("insert into public.eobra_migration_records(run_id,company_id,project_id,source_ordinal,entity,source_id,source_project_id,archive_type,parent_source_id,links,raw_data,normalized_data,source_errors,record_hash,status,review_status,expected_targets) select $2,company_id,project_id,source_ordinal,entity,source_id,source_project_id,archive_type,parent_source_id,links,raw_data,case when entity='person' then normalized_data||'{\"name\":\"Forged\"}'::jsonb else normalized_data end,source_errors,record_hash,status,review_status,expected_targets from public.eobra_migration_records where run_id=$1", [original, copied]);
      await db.query("insert into public.eobra_migration_coverage(run_id,company_id,project_id,entity,source_project_id,archive_type,declared,expected_count,actual_count,verified,errors) select $2,company_id,project_id,entity,source_project_id,archive_type,declared,expected_count,actual_count,verified,errors from public.eobra_migration_coverage where run_id=$1", [original, copied]);
      await assert.rejects(db.query("update public.eobra_migration_runs set stage_phase='validating' where id=$1", [copied]), /Registro diverge do documento/);
      await assert.rejects(promote(db, copied), /pendências/);
      const underScoped = (await db.query("insert into public.eobra_migration_runs(company_id,source_host,format,captured_at,reference_date,scope,archive_types,project_map,required_permissions,snapshot_hash,fingerprint,expected_records) select company_id,source_host,format,captured_at,reference_date,scope,archive_types,project_map,'{}',snapshot_hash,fingerprint,expected_records from public.eobra_migration_runs where id=$1 returning id", [original])).rows[0].id;
      await assert.rejects(db.query("insert into public.eobra_migration_snapshots(run_id,company_id,document,snapshot_hash) select $2,company_id,document,snapshot_hash from public.eobra_migration_snapshots where run_id=$1", [original, underScoped]), /Permissões do snapshot/);
    });

    await t.test("native counterparty changes and competing reviewed runs force a fresh review", async () => {
      const person = record("person", "late-person", { name: "Pessoa revisada", person_type: "PJ", roles: ["client"], status: "active", tax_id: "99000004000137" });
      const pack = snapshot([records()[0], person]); const id = await stage(db, pack);
      assert.equal((await run(db, id)).status, "ready");
      await db.query("insert into public.clients(company_id,person_type,name,tax_id,status) values($1,'PJ','Criado depois','99000004000137','active')", [A]);
      await assert.rejects(promote(db, id), /cadastro correspondente mudou/);
      const same1 = await stage(db, [records()[0], records("race")[1]], { capturedAt: "2026-11-26T04:00:00Z" });
      const same2 = await stage(db, [records()[0], records("race")[1]], { capturedAt: "2026-11-26T05:00:00Z" });
      await promote(db, same1); await assert.rejects(promote(db, same2), /revisão dos registros mudou/);
      assert.equal((await db.query("select count(*)::int n from public.clients where source_id='fixture.eobra.com.br|person|buyerrace'")).rows[0].n, 1);
    });

    await t.test("partial payments, reversals and adjusted payables reconcile without bank posting", async () => {
      const items = [records()[0], financial("payable", "partial", { current_amount: "110.00", correction_amount: "10.00", paid_amount: "50.00", balance_amount: "60.00", status: "partial", counterparty_name: "Fornecedor observado" })];
      const installment = { entity: "payable", sourceId: "partial", role: "installment" };
      items.push(record("bank_account", "account1", { name: "Conta histórica", currency: "BRL", status: "active" }));
      items.push(record("settlement", "payment1", { kind: "payment", occurred_on: "2026-11-01", amount: "70.00", medium: "bank" }, [installment, { entity: "bank_account", sourceId: "account1", role: "account" }], "p1"));
      items.push(record("settlement", "reversal1", { kind: "reversal", occurred_on: "2026-11-02", amount: "20.00", medium: "bank" }, [installment, { entity: "bank_account", sourceId: "account1", role: "account" }, { entity: "settlement", sourceId: "payment1", role: "reverses" }], "p1"));
      items.push(record("bank_transaction", "bank1", { occurred_on: "2026-11-01", direction: "debit", amount: "70.00", status: "posted" }, [{ entity: "bank_account", sourceId: "account1", role: "account" }, { entity: "settlement", sourceId: "payment1", role: "settlement" }], "p1"));
      const before = await count(db, "finance_bank_transactions"); const id = await stage(db, items);
      assert.equal((await run(db, id)).status, "ready");
      await promote(db, id);
      const title = (await db.query("select * from public.payables where source_id='fixture.eobra.com.br|payable|partial'")).rows[0];
      assert.equal(title.amount, "100.00"); assert.equal(title.adjusted_amount, "110.00"); assert.equal(title.paid_amount, "50.00"); assert.equal(title.status, "open");
      const events = (await db.query("select * from public.eobra_source_events where payable_id=$1 order by occurred_on", [title.id])).rows;
      assert.equal(events.length, 2); assert.equal(events[1].reverses_event_id, events[0].id); assert.ok(events.every(event => event.posting_policy === "historical_source_only" && event.bank_transaction_id === null));
      assert.equal(await count(db, "finance_bank_transactions"), before);
      const history = (await db.query("select * from public.finance_title_payment_events($1,$2,'payable',array[$3::uuid])", [A, PA, title.id])).rows;
      assert.equal(history.length, 2); assert.equal(history.reduce((sum, event) => sum + Number(event.amount), 0), 50);
      const invalid = structuredClone(items); invalid.find(item => item.sourceId === "reversal1").normalized.amount = "80.00";
      const bad = await stage(db, invalid, { capturedAt: "2026-11-26T03:00:00Z" });
      assert.equal((await run(db, bad)).status, "review");
    });

    await t.test("multi-unit and multi-buyer contracts preserve allocation without duplicating the contract total", async () => {
      const items = records("multi");
      items.push(record("unit", "unit-secondary", { code: "SECONDARY", status: "available" }, [{ entity: "project", sourceId: "p1", role: "project" }], "p1"));
      items.push(record("person", "buyer-secondary", { name: "Comprador secundário", person_type: "PF", roles: ["client"], status: "active" }));
      items.find(item => item.entity === "sale").links = [
        { entity: "unit", sourceId: "unitmulti", role: "unit", primary: true, allocated_amount: "60.00", source_relation_id: "relation-primary" },
        { entity: "unit", sourceId: "unit-secondary", role: "unit", primary: false, allocated_amount: "40.00", source_relation_id: "relation-secondary" },
        { entity: "person", sourceId: "buyermulti", role: "buyer", primary: true, ownership_percent: "60.0000" },
        { entity: "person", sourceId: "buyer-secondary", role: "buyer", primary: false, ownership_percent: "40.0000" },
      ];
      const id = await stage(db, items); assert.equal((await run(db, id)).status, "ready"); await promote(db, id);
      const sale = (await db.query("select * from public.sales where source_id='fixture.eobra.com.br|sale|salemulti'")).rows[0];
      assert.equal(sale.total_amount, "100.00");
      const links = (await db.query("select l.*,u.status unit_status from public.commercial_sale_units l join public.units u on u.id=l.unit_id where sale_id=$1 order by is_primary desc", [sale.id])).rows;
      assert.equal(links.length, 2); assert.equal(links[0].unit_id, sale.unit_id); assert.deepEqual(links.map(link => link.allocated_amount), ["60.00", "40.00"]); assert.ok(links.every(link => link.unit_status === "sold"));
      assert.equal((await db.query("select count(*)::int n from public.commercial_sale_parties where sale_id=$1", [sale.id])).rows[0].n, 2);
      await assert.rejects(db.query("insert into public.sales(company_id,project_id,unit_id,client_id,number,sale_date,total_amount,status) values($1,$2,$3,$4,'COLLISION','2026-11-26',1,'active')", [A, PA, links[1].unit_id, sale.client_id]), /outra venda ativa/);
      await assert.rejects(db.query("update public.units set status='available' where id=$1", [links[1].unit_id]), /permanecer vendida/);
      await db.query("update public.sales set status='cancelled' where id=$1", [sale.id]);
      assert.deepEqual((await db.query("select distinct status from public.commercial_sale_units where sale_id=$1", [sale.id])).rows, [{ status: "inactive" }]);
      assert.deepEqual((await db.query("select distinct status from public.units where id=any($1::uuid[])", [links.map(link => link.unit_id)])).rows, [{ status: "available" }]);
      await db.query("insert into public.sales(company_id,project_id,unit_id,client_id,number,sale_date,total_amount,status) values($1,$2,$3,$4,'LATER','2026-11-26',1,'active')", [A, PA, links[1].unit_id, sale.client_id]);
      await assert.rejects(db.query("update public.sales set status='active' where id=$1", [sale.id]), /indisponível/);
    });

    await t.test("voided originals retain evidence without inventing reversal dates or realized amounts", async () => {
      const titleLink = { entity: "payable", sourceId: "voided-title", role: "installment" };
      const archive = { ...record("raw_archive", "undated-reversal", { history_dates_complete: false, description: "Estorno com data de origem inválida" }, [{ entity: "settlement", sourceId: "voided-original", role: "original_payment" }], "p1"), archiveType: "undated_reversal", raw: { date: "-0001-11-30", kind: "reversal" } };
      const items = [records()[0], financial("payable", "voided-title", { paid_amount: "100.00", balance_amount: "0.00", status: "paid", counterparty_name: "Observado" }),
        record("settlement", "voided-original", { kind: "voided_payment", occurred_on: "2026-10-01", amount: "100.00", medium: "non_cash", voided_by_source_id: "undated-reversal", voided_date_unknown: true }, [titleLink, { entity: "raw_archive", sourceId: "undated-reversal", archiveType: "undated_reversal", role: "voided_by" }], "p1"),
        record("settlement", "effective-replacement", { kind: "payment", occurred_on: "2026-10-01", amount: "100.00", medium: "non_cash" }, [titleLink], "p1"), archive];
      const id = await stage(db, snapshot(items, { archiveTypes: [{ key: "undated_reversal", description: "Estorno sem data interpretável" }] }));
      const b = await run(db, id); assert.equal(b.status, "ready"); assert.equal(b.summary.history_dates_complete, false); assert.equal(b.summary.totals.payable.paid_amount, "100.00");
      await db.query("select public.promote_eobra_snapshot_chunk($1,$2,2)", [id,b.preview_hash]);
      const source = (await db.query("select * from public.eobra_migration_records where run_id=$1 and source_id='effective-replacement'", [id])).rows[0];
      await assert.rejects(db.query("insert into public.eobra_source_events(company_id,project_id,run_id,record_id,source_host,source_id,entity,kind,occurred_on,amount,medium,details) values($1,$2,$3,$4,'fixture.eobra.com.br','effective-replacement','settlement','payment','2026-10-01',999,'non_cash',$5)", [A, PA, id, source.id, source.normalized_data]), /Evento difere/);
      const before = await count(db, "finance_bank_transactions"); await promote(db, id);
      const events = (await db.query("select kind,amount,occurred_on,posting_policy from public.eobra_source_events where run_id=$1 order by kind", [id])).rows;
      assert.deepEqual(events.map(event => [event.kind, event.amount]), [["payment", "100.00"], ["voided_payment", "100.00"]]);
      assert.equal(await count(db, "finance_bank_transactions"), before);
      assert.equal((await db.query("select raw_data->>'date' date from public.eobra_migration_records where run_id=$1 and entity='raw_archive'", [id])).rows[0].date, "-0001-11-30");
    });

    await t.test("bounded preparation and promotion resume without upload or repeating committed chunks", async () => {
      const validTax = base => {
        const digit = (value, weights) => { const remainder = [...value].reduce((sum, char, index) => sum + Number(char) * weights[index], 0) % 11; return remainder < 2 ? "0" : String(11 - remainder); };
        const first = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); return base + first + digit(base + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
      };
      const lateTax = validTax("990000600001");
      const items = [records()[0], ...Array.from({ length: 120 }, (_, index) => record("person", `resume-${index}`, { name: `Pessoa resumível ${index}`, person_type: "PJ", roles: ["client"], status: "active", tax_id: index === 30 ? lateTax : null }))];
      const pack = snapshot(items, { capturedAt: "2026-11-26T06:00:00Z" });
      const begin = async () => (await db.query("select public.begin_eobra_snapshot($1,$2,$3) id", [A, pack, { p1: PA }])).rows[0].id;
      const id = await begin(); const step = async (fn, values = []) => (await db.query(`select public.${fn}($1${values.map((_, index) => `,$${index + 2}`).join("")}) progress`, [id, ...values])).rows[0].progress;
      assert.equal((await step("eobra_snapshot_progress")).next_step, "append");
      await assert.rejects(step("append_eobra_snapshot", [null]), /entre 1 e 500/);
      await assert.rejects(step("validate_eobra_snapshot_chunk", [null]), /entre 1 e 100/);
      await assert.rejects(step("promote_eobra_snapshot_chunk", [null, null]), /entre 1 e 50/);
      assert.equal((await step("append_eobra_snapshot", [37])).loaded_records, 37); assert.equal(await begin(), id);
      const partialReview = await step("review_eobra_snapshot"); assert.equal(partialReview.loaded_records, 37); assert.equal(partialReview.expected_records, 121);
      await assert.rejects(step("seal_eobra_snapshot"), /não conferidos/);
      while ((await step("eobra_snapshot_progress")).next_step === "append") await step("append_eobra_snapshot", [37]);
      assert.equal((await step("finish_eobra_snapshot_append")).stage, "validating");
      assert.equal((await step("append_eobra_snapshot", [37])).stage, "validating");
      await assert.rejects(db.query("update public.eobra_migration_runs set status='ready',stage_phase='sealed' where id=$1", [id]), /não conferidos/);
      while ((await step("eobra_snapshot_progress")).next_step === "validate") await step("validate_eobra_snapshot_chunk", [29]);
      const sealed = await step("seal_eobra_snapshot"); assert.equal(sealed.status, "ready"); const preview = sealed.preview_hash;
      await assert.rejects(promote(db, id), /acima de 100 registros/);
      const before = await count(db, "clients");
      const first = await step("promote_eobra_snapshot_chunk", [preview, 25]); assert.equal(first.status, "promoting"); assert.equal(first.promoted_records, 25); assert.equal(await count(db, "clients"), before + 24);
      await assert.rejects(step("cancel_eobra_snapshot"), /parcialmente promovida/);
      const late = (await db.query("insert into public.clients(company_id,person_type,name,tax_id,status) values($1,'PJ','Contato concorrente',$2,'active') returning id", [A, lateTax])).rows[0].id;
      const committed = await count(db, "clients");
      await assert.rejects(step("promote_eobra_snapshot_chunk", [preview, 50]), /mudou após a revisão/);
      assert.equal(await count(db, "clients"), committed); assert.equal((await step("eobra_snapshot_progress")).promoted_records, 25);
      // Restore the synthetic fixture's concurrent change; the migration itself
      // never rewrites the conflicting native record to make the chunk pass.
      await db.query("update public.clients set tax_id=null where id=$1", [late]);
      while ((await step("eobra_snapshot_progress")).next_step === "promote") await step("promote_eobra_snapshot_chunk", [preview, 17]);
      const done = await step("eobra_snapshot_progress"); assert.equal(done.status, "imported"); assert.equal(done.promoted_records, 121); assert.equal(done.promotion_result.created, 120);
      assert.equal((await step("promote_eobra_snapshot_chunk", ["replay", 17])).promoted_records, 121);
      assert.equal((await db.query("select count(*)::int n from public.clients where source_id like 'fixture.eobra.com.br|person|resume-%'")).rows[0].n, 120);
      const cancelPack = snapshot([records()[0], records("cancel-building")[1]], { capturedAt: "2026-11-26T07:00:00Z" });
      const cancelId = (await db.query("select public.begin_eobra_snapshot($1,$2,$3) id", [A, cancelPack, { p1: PA }])).rows[0].id;
      await db.query("select public.cancel_eobra_snapshot($1)", [cancelId]); assert.equal((await run(db, cancelId)).status, "cancelled");
    });

    await t.test("historical paid cancellation preserves cash history without an invented discount", async () => {
      const items = [records()[0], financial("payable", "cancelled-paid", { status: "cancelled", paid_amount: "100.00", balance_amount: "0.00", counterparty_name: "Histórico" }),
        record("settlement", "cancelled-paid-event", { kind: "payment", amount: "100.00", occurred_on: "2026-11-01", medium: "non_cash" }, [{ entity: "payable", sourceId: "cancelled-paid", role: "installment" }], "p1")];
      const id = await stage(db, items); assert.equal((await run(db, id)).status, "ready"); await promote(db, id);
      const title = (await db.query("select * from public.payables where source_id='fixture.eobra.com.br|payable|cancelled-paid'")).rows[0];
      assert.equal(title.status, "cancelled"); assert.equal(title.amount, "100.00"); assert.equal(title.adjusted_amount, "100.00"); assert.equal(title.paid_amount, "100.00"); assert.equal(title.discount_amount, "0.00");
      const history = (await db.query("select * from public.finance_title_payment_events($1,$2,'payable',array[$3::uuid])", [A, PA, title.id])).rows;
      assert.equal(history.length, 1); assert.equal(Number(history[0].amount), 100);
    });

    await t.test("cancelled titles retain historical residuals while collectible totals exclude them", async () => {
      const items = [records()[0], financial("payable", "cancelled-residual", { status: "cancelled", current_amount: "120.00", correction_amount: "20.00", paid_amount: "30.00", balance_amount: "90.00", counterparty_name: "Histórico cancelado" }),
        record("settlement", "cancelled-residual-payment", { kind: "payment", amount: "30.00", occurred_on: "2026-11-02", medium: "non_cash" }, [{ entity: "payable", sourceId: "cancelled-residual", role: "installment" }], "p1")];
      const id = await stage(db, items); const b = await run(db, id); assert.equal(b.status, "ready"); assert.equal(b.summary.totals.payable.balance_amount, "90.00"); assert.equal(b.summary.totals.payable.collectible_balance_amount, "0.00");
      await promote(db, id);
      const title = (await db.query("select * from public.payables where source_id='fixture.eobra.com.br|payable|cancelled-residual'")).rows[0];
      assert.equal(title.status, "cancelled"); assert.equal(title.amount, "100.00"); assert.equal(title.adjusted_amount, "120.00"); assert.equal(title.paid_amount, "30.00"); assert.equal(title.discount_amount, "0.00");
      assert.equal((await db.query("select public.finance_title_remaining(amount,adjusted_amount,paid_amount,status) remaining from public.payables where id=$1", [title.id])).rows[0].remaining, "0");
    });

    await t.test("native dependencies cannot change buyer, unit, fiscal identity or title values between chunks", async () => {
      const items = records("dependencies");
      items.push(financial("receivable", "dependency-title", { status: "partial", paid_amount: "50.00", balance_amount: "50.00" }, [{ entity: "sale", sourceId: "saledependencies", role: "sale" }]));
      items.push(record("settlement", "dependency-payment", { kind: "payment", occurred_on: "2026-11-01", amount: "50.00", medium: "non_cash" }, [{ entity: "receivable", sourceId: "dependency-title", role: "installment" }], "p1"));
      const id = await stage(db, items); const preview = (await run(db, id)).preview_hash;
      const chunk = async limit => (await db.query("select public.promote_eobra_snapshot_chunk($1,$2,$3) progress", [id, preview, limit])).rows[0].progress;
      assert.equal((await chunk(4)).promoted_records, 4);
      const sale = (await db.query("select * from public.sales where source_id='fixture.eobra.com.br|sale|saledependencies'")).rows[0];
      const alternate = (await db.query("insert into public.clients(company_id,person_type,name,status) values($1,'PF','Comprador alterado','active') returning id", [A])).rows[0].id;
      await db.query("update public.sales set client_id=$2 where id=$1", [sale.id, alternate]);
      await assert.rejects(chunk(1), /Vínculos ou valores da dependência sale/);
      assert.equal((await db.query("select count(*)::int n from public.receivables where source_id='fixture.eobra.com.br|receivable|dependency-title'")).rows[0].n, 0);
      await db.query("update public.sales set client_id=$2 where id=$1", [sale.id, sale.client_id]);
      const alternateUnit = (await db.query("select id from public.units where company_id=$1 and project_id=$2 and id<>$3 limit 1", [A, PA, sale.unit_id])).rows[0].id;
      await assert.rejects(db.query("update public.sales set unit_id=$2 where id=$1", [sale.id, alternateUnit]), /revisão de todos os vínculos/);
      await db.query("update public.units set project_id=$2 where id=$1", [sale.unit_id, PA2]);
      await assert.rejects(chunk(1), /Dependência mudou de empresa, obra/);
      await db.query("update public.units set project_id=$2 where id=$1", [sale.unit_id, PA]);
      // A second authorized operator may resume; creation audit is not compared
      // with the new operator's identity when validating prior dependencies.
      await setTenant(db, A, UB); assert.equal((await chunk(1)).promoted_records, 5);
      const title = (await db.query("select * from public.receivables where source_id='fixture.eobra.com.br|receivable|dependency-title'")).rows[0];
      assert.equal(title.created_by, UB); assert.equal(title.client_id, sale.client_id);
      await db.query("update public.receivables set amount=101,adjusted_amount=101 where id=$1", [title.id]);
      await assert.rejects(chunk(1), /Vínculos ou valores da dependência receivable/);
      await db.query("update public.receivables set amount=100,adjusted_amount=100,client_id=$2 where id=$1", [title.id, alternate]);
      await assert.rejects(chunk(1), /Vínculos ou valores da dependência receivable/);
      await db.query("update public.receivables set client_id=$2 where id=$1", [title.id, sale.client_id]);
      assert.equal((await chunk(1)).status, "imported"); await setTenant(db, A, UA);

      const supplierItems = [records()[0], record("person", "fiscal-supplier", { name: "Fornecedor fiscal sintético", roles: ["supplier"], person_type: "PJ", status: "active", tax_id: "99000003000192" }),
        financial("payable", "fiscal-payable", {}, [{ entity: "person", sourceId: "fiscal-supplier", role: "supplier" }])];
      const supplierRun = await stage(db, supplierItems); const supplierHash = (await run(db, supplierRun)).preview_hash;
      await db.query("select public.promote_eobra_snapshot_chunk($1,$2,2)", [supplierRun, supplierHash]);
      const supplier = (await db.query("select id from public.suppliers where source_id='fixture.eobra.com.br|person|fiscal-supplier'")).rows[0].id;
      await db.query("update public.suppliers set tax_id='99000004000137' where id=$1", [supplier]);
      await assert.rejects(db.query("select public.promote_eobra_snapshot_chunk($1,$2,1)", [supplierRun, supplierHash]), /CPF\/CNPJ da dependência/);
      await db.query("update public.suppliers set tax_id='99000003000192' where id=$1", [supplier]);
      assert.equal((await db.query("select public.promote_eobra_snapshot_chunk($1,$2,1) progress", [supplierRun, supplierHash])).rows[0].progress.status, "imported");
    });

    await t.test("index values reconcile with source monthly records while canonical correction stays locked", async () => {
      const items = records("indexed");
      items.push(record("correction_index", "index-fixture", { code: "SYN", name: "Índice sintético", value_type: "index_number" }));
      items.push(record("index_value", "index-september", { reference_month: "2026-09", value: "100.000000" }, [{ entity: "correction_index", sourceId: "index-fixture", role: "index" }]));
      items.push(record("index_value", "index-october", { reference_month: "2026-10", value: "125.000000" }, [{ entity: "correction_index", sourceId: "index-fixture", role: "index" }]));
      items.push(financial("receivable", "indexed-title", { current_amount: "125.00", balance_amount: "125.00", correction_amount: "25.00", correction_locked: false,
        correction: { mode: "index_number", base_month: "2026-09", base_value: "100.000000", reference_month: "2026-10", reference_value: "125.000000", negative_variation_policy: "use_negative" } },
      [{ entity: "sale", sourceId: "saleindexed", role: "sale" }, { entity: "correction_index", sourceId: "index-fixture", role: "correction_index" }]));
      const id = await stage(db, items); assert.equal((await run(db, id)).status, "ready"); await promote(db, id);
      const title = (await db.query("select * from public.receivables where source_id='fixture.eobra.com.br|receivable|indexed-title'")).rows[0];
      assert.equal(title.correction_locked, true); assert.equal(title.correction_index_id, null); assert.equal(Number(title.correction_base_value), 100); assert.equal(Number(title.correction_reference_value), 125); assert.equal(title.adjusted_amount, "125.00");
      assert.equal((await db.query("select count(*)::int n from public.eobra_source_indices where run_id=$1", [id])).rows[0].n, 3);
      items.at(-1).normalized.correction.base_value = "90.000000";
      const bad = await stage(db, items, { capturedAt: "2026-11-26T08:00:00Z" }); assert.equal((await run(db, bad)).status, "review");
      const errors = (await db.query("select errors from public.eobra_migration_records where run_id=$1 and entity='receivable'", [bad])).rows[0].errors;
      assert.ok(errors.some(message => message.includes("cadastro mensal")));
    });
  } finally { await db.close(); }
});
