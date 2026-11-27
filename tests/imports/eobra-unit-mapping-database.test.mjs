import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture, applyMigration, setTenant, A, B, PA, PA2, PB, UA, UB } from "./eobra-snapshot-fixture.mjs";

const entities = ["project", "person", "unit", "sale", "receivable", "payable", "settlement", "bank_account", "bank_transaction", "correction_index", "index_value"];
const projectEntities = new Set(["unit", "sale", "receivable", "payable", "settlement"]);
const record = (entity, sourceId, normalized, links = [], sourceProjectId) => ({ entity, sourceId, ...(sourceProjectId ? { sourceProjectId } : {}), normalized, raw: { observed: normalized }, links });
const project = () => record("project", "p1", { name: "Obra sintética" });
const unit = (id, code) => record("unit", id, { code, status: "available", private_area: "80.00", type: "apartment" }, [{ entity: "project", sourceId: "p1", role: "project" }], "p1");
function commercial(id, code, withTitle = false) {
  const items = [project(), unit(`unit-${id}`, code),
    record("person", `buyer-${id}`, { name: "Comprador sintético", person_type: "OTHER", roles: ["client"], status: "active" }),
    record("sale", `sale-${id}`, { number: `S-${id}`, sale_date: "2026-10-01", total_amount: "100.00", status: "active" }, [
      { entity: "unit", sourceId: `unit-${id}`, role: "unit" }, { entity: "person", sourceId: `buyer-${id}`, role: "buyer" },
    ], "p1")];
  if (withTitle) items.push(record("receivable", `title-${id}`, {
    description: "Parcela sintética", due_date: "2026-12-01", original_amount: "100.00", current_amount: "100.00", paid_amount: "0.00", balance_amount: "100.00",
    interest_amount: "0.00", penalty_amount: "0.00", correction_amount: "0.00", other_accrual_amount: "0.00", discount_amount: "0.00",
    status: "open", correction_locked: true, correction: { mode: "none" }, sequence_number: 1, sequence_total: 1, category: "monthly",
  }, [{ entity: "sale", sourceId: `sale-${id}`, role: "sale" }], "p1"));
  return items;
}
function snapshot(items) {
  return { format: "elos.eobra.snapshot.v1", source: { host: "unit-fixture.eobra.com.br", capturedAt: "2026-11-26T00:00:00Z", referenceDate: "2026-11-26" },
    scope: { projectIds: ["p1"], allProjects: true }, records: items, archiveTypes: [],
    coverage: entities.map(entity => {
      const rows = items.filter(item => item.entity === entity);
      return { entity, sourceProjectId: projectEntities.has(entity) ? "p1" : null, expectedCount: rows.length, expectedPages: 1,
        collectedPages: [1], detailsExpected: rows.length, detailsCollected: rows.map(row => row.sourceId), complete: true, filters: { status: "all" } };
    }),
  };
}
async function state(db, id) { return (await db.query("select * from public.eobra_migration_runs where id=$1", [id])).rows[0]; }
async function progress(db, id) { return (await db.query("select public.eobra_snapshot_progress($1) progress", [id])).rows[0].progress; }
async function begin(db, items, capturedAt) {
  const pack=snapshot(items);
  if(capturedAt)pack.source.capturedAt=capturedAt;
  return (await db.query("select public.begin_eobra_snapshot($1,$2,$3) id", [A, pack, { p1: PA }])).rows[0].id;
}
async function load(db, items, capturedAt) {
  const id = await begin(db, items, capturedAt);
  let p = await progress(db, id);
  while (p.next_step === "append") p = (await db.query("select public.append_eobra_snapshot($1,500) progress", [id])).rows[0].progress;
  if (p.next_step === "finish_append") await db.query("select public.finish_eobra_snapshot_append($1)", [id]);
  return id;
}
async function seedUnit(db, code, projectId = PA) {
  const id = randomUUID();
  await db.query("insert into public.units(id,company_id,project_id,code,status,type,private_area,total_area,source_system,source_id,notes,created_by) values($1,$2,$3,$4,'available','apartment',79.25,101.75,'dwv',null,'Cadastro anterior preservado',$5)", [id, A, projectId, code, UA]);
  return id;
}
async function options(db, id, projectId = PA, search = null) {
  return (await db.query("select public.eobra_snapshot_unit_options($1,$2,$3,50,0) result", [id, projectId, search])).rows[0].result;
}
async function reuse(db, id, targetId, search) {
  const option = (await options(db, id, PA, search)).items.find(item => item.id === targetId);
  assert.ok(option, "The explicitly selected native unit must be visible");
  return { action: "reuse", unit_id: targetId, expected_identity_hash: option.identity_hash };
}
async function confirm(db, id, map) { return (await db.query("select public.confirm_eobra_snapshot_unit_map($1,$2) progress", [id, map])).rows[0].progress; }
async function seal(db, id) {
  let p = await progress(db, id);
  while (p.next_step === "validate") p = (await db.query("select public.validate_eobra_snapshot_chunk($1,100) progress", [id])).rows[0].progress;
  assert.equal(p.next_step, "seal");
  return (await db.query("select public.seal_eobra_snapshot($1) progress", [id])).rows[0].progress;
}
async function promote(db, id, limit = 50) {
  const run = await state(db, id);
  return (await db.query("select public.promote_eobra_snapshot_chunk($1,$2,$3) progress", [id, run.preview_hash, limit])).rows[0].progress;
}
const identity = native => Object.fromEntries(Object.entries(native).filter(([key]) => !["status", "created_at", "updated_at", "created_by"].includes(key)));

test("explicit unit reconciliation binds physical identity without overwriting an existing catalog", async t => {
  const db = await fixture();
  try {
    for (const suffix of ["_finance_partial_settlements.sql", "_eobra_snapshot_promotion.sql", "_commercial_sale_units_eobra.sql", "_eobra_snapshot_resumable.sql", "_eobra_snapshot_parts.sql", "_eobra_snapshot_unit_mapping.sql", "_eobra_resolve_native_targets_once.sql"]) await applyMigration(db, suffix);

    await t.test("a label mismatch never implies CREATE and direct state writes cannot bypass the decision", async () => {
      await seedUnit(db, "701");
      const items = [project(), unit("unit-gate", "Ap 701")];
      const id = await begin(db, items);
      await assert.rejects(confirm(db, id, { "unit-gate": { action: "create" } }), /após carregar/);
      await db.query("select public.append_eobra_snapshot($1,500)", [id]);
      await db.query("select public.finish_eobra_snapshot_append($1)", [id]);
      const p = await progress(db, id);
      assert.equal(p.next_step, "map_units"); assert.equal(p.units_requiring_decision, 1); assert.equal(p.unit_map_confirmed, false);
      await assert.rejects(db.query("select public.validate_eobra_snapshot_chunk($1,100)", [id]), /de-para/);
      await assert.rejects(db.query("update public.eobra_migration_records set validated=true where run_id=$1", [id]), /de-para/);
      await assert.rejects(db.query("update public.eobra_migration_runs set status='ready',stage_phase='sealed' where id=$1", [id]), /de-para/);
      await assert.rejects(promote(db, id), /de-para/i);
      const legacy = (await db.query("select public.stage_eobra_snapshot($1,$2,$3) id", [A, snapshot(items), { p1: PA }])).rows[0].id;
      assert.equal(legacy,id); assert.equal((await progress(db,legacy)).next_step,"map_units");
      await assert.rejects(db.query("select public.promote_eobra_snapshot($1,null)",[legacy]),/de-para/i);
      assert.equal((await db.query("select count(*)::int n from public.units where project_id=$1 and code='Ap 701'", [PA])).rows[0].n, 0);
    });

    await t.test("confirmation requires every source ID, unique targets, same tenant/project and the displayed identity hash", async () => {
      const target = await seedUnit(db, "702");
      const wrongProject = await seedUnit(db, "702-other", PA2);
      const id = await load(db, [project(), unit("unit-shape-a", "Ap 702"), unit("unit-shape-b", "Sala 702")]);
      const selected = await reuse(db, id, target, "702");
      await assert.rejects(confirm(db, id, {}), /cada unidade/);
      await assert.rejects(confirm(db, id, { "unit-shape-a": selected, unknown: { action: "create" } }), /cada unidade/);
      await assert.rejects(confirm(db, id, { "unit-shape-a": selected, "unit-shape-b": selected }), /mesma unidade/);
      await assert.rejects(confirm(db, id, { "unit-shape-a": { ...selected, unit_id: target.toUpperCase() }, "unit-shape-b": selected }), /mesma unidade/);
      await assert.rejects(confirm(db, id, { "unit-shape-a": { ...selected, unit_id: wrongProject }, "unit-shape-b": { action: "create" } }), /outra empresa\/obra/);
      await assert.rejects(confirm(db, id, { "unit-shape-a": { action: "reuse", unit_id: target }, "unit-shape-b": { action: "create" } }), /hash exibido/);
      await db.query("update public.units set private_area=80 where id=$1", [target]);
      await assert.rejects(confirm(db, id, { "unit-shape-a": selected, "unit-shape-b": { action: "create" } }), /mudou desde a exibição/);
      assert.equal((await state(db, id)).unit_map_confirmed_at, null);
      await db.query("update public.units set private_area=79.25 where id=$1", [target]);
      const confirmed = await confirm(db, id, { "unit-shape-a": selected, "unit-shape-b": { action: "create" } });
      assert.equal(confirmed.next_step, "validate"); assert.equal(confirmed.units_requiring_decision, 0);
    });

    await t.test("reusing a catalog unit preserves its fields and provenance while an explicit sale may mark it sold", async () => {
      const target = await seedUnit(db, "703");
      const before = (await db.query("select * from public.units where id=$1", [target])).rows[0];
      const countBefore = (await db.query("select count(*)::int n from public.units")).rows[0].n;
      const id = await load(db, commercial("reuse", "Ap 703", true));
      const map = { "unit-reuse": await reuse(db, id, target, "703") };
      await confirm(db, id, map);
      const p = await seal(db, id); assert.equal(p.status, "ready");
      const unitRecord = (await db.query("select expected_targets from public.eobra_migration_records where run_id=$1 and entity='unit'", [id])).rows[0];
      assert.deepEqual(unitRecord.expected_targets, { units: target });
      const result = await promote(db, id);
      assert.equal(result.status, "imported"); assert.equal(result.promotion_result.reused, 2);
      assert.equal((await db.query("select count(*)::int n from public.units")).rows[0].n, countBefore);
      const after = (await db.query("select * from public.units where id=$1", [target])).rows[0];
      assert.deepEqual(identity(after), identity(before)); assert.equal(after.status, "sold");
      assert.equal(after.code, "703"); assert.equal(after.source_system, "dwv"); assert.equal(after.source_id, null); assert.equal(after.private_area, "79.25");
      assert.equal((await db.query("select unit_id from public.receivables where source_id='unit-fixture.eobra.com.br|receivable|title-reuse'")).rows[0].unit_id, target);
      assert.equal((await db.query("select targets->>'units' id from public.eobra_migration_ledger where run_id=$1 and entity='unit'", [id])).rows[0].id, target);
      assert.equal((await confirm(db, id, map)).status, "imported");
      await assert.rejects(confirm(db, id, { "unit-reuse": { action: "create" } }), /imutável/);
    });

    await t.test("source preservation and direct map writes remain authoritative and immutable", async () => {
      const target = await seedUnit(db, "704");
      const id = await load(db, [project(), unit("unit-direct", "Ap 704 DEVOLUÇÃO")]);
      const selected = await reuse(db, id, target, "704");
      await db.query("update public.eobra_migration_runs set unit_map=$2,unit_target_evidence='{\"forged\":true}',unit_map_confirmed_at=now(),unit_map_confirmed_by=$3 where id=$1", [id, { "unit-direct": selected }, UB]);
      const r = await state(db, id);
      assert.equal(r.unit_map_confirmed_by, UA);
      assert.equal(r.unit_target_evidence["unit-direct"].identity.code, "704");
      assert.equal(r.unit_target_evidence.forged, undefined);
      await assert.rejects(db.query("update public.eobra_migration_runs set unit_map='{}',unit_target_evidence='{}' where id=$1", [id]), /imutáveis/);
      await seal(db, id); const originalHash = (await state(db, id)).preview_hash;
      await db.query("update public.eobra_migration_runs set preview_hash=repeat('0',64),summary='{}' where id=$1", [id]);
      assert.equal((await state(db, id)).preview_hash, originalHash);
      await promote(db, id);
      assert.equal((await db.query("select normalized_data->>'code' code from public.eobra_migration_records where run_id=$1 and entity='unit'", [id])).rows[0].code, "Ap 704 DEVOLUÇÃO");
      assert.equal((await db.query("select code from public.units where id=$1", [target])).rows[0].code, "704");
    });

    await t.test("physical changes between chunks abort the next chunk and another authorized operator can resume after restoration", async () => {
      const target = await seedUnit(db, "705");
      const id = await load(db, commercial("changed", "Ap 705", true));
      await confirm(db, id, { "unit-changed": await reuse(db, id, target, "705") }); await seal(db, id);
      assert.equal((await promote(db, id, 3)).promoted_records, 3);
      await db.query("update public.units set private_area=80 where id=$1", [target]);
      await assert.rejects(promote(db, id, 1), /Cadastro físico/);
      assert.equal((await progress(db, id)).promoted_records, 3);
      assert.equal((await db.query("select count(*)::int n from public.sales where source_id='unit-fixture.eobra.com.br|sale|sale-changed'")).rows[0].n, 0);
      await db.query("update public.units set private_area=79.25 where id=$1", [target]);
      await setTenant(db, A, UB);
      assert.equal((await promote(db, id)).status, "imported");
      await setTenant(db, A, UA);
    });

    await t.test("explicit CREATE works and a later source identity cannot claim the same existing target", async () => {
      const createId = await load(db, [project(), unit("unit-create", "NEW-UNIT")]);
      await confirm(db, createId, { "unit-create": { action: "create" } }); await seal(db, createId); await promote(db, createId);
      assert.equal((await db.query("select count(*)::int n from public.units where code='NEW-UNIT' and source_system='eobra_snapshot'")).rows[0].n, 1);
      const target = await seedUnit(db, "706");
      const first = await load(db, [project(), unit("unit-race-a", "Ap 706")]);
      const second = await load(db, [project(), unit("unit-race-b", "Unidade 706")]);
      await confirm(db, first, { "unit-race-a": await reuse(db, first, target, "706") }); await seal(db, first);
      await confirm(db, second, { "unit-race-b": await reuse(db, second, target, "706") }); await seal(db, second);
      await promote(db, first);
      await assert.rejects(promote(db, second), /outro ID da origem/);
      assert.equal((await db.query("select count(*)::int n from public.eobra_migration_ledger where entity='unit' and targets->>'units'=$1", [target])).rows[0].n, 1);
    });

    await t.test("a duplicate source identity still rechecks its approved native evidence before completion", async () => {
      const target=await seedUnit(db,"709");
      const items=[project(),unit("unit-duplicate","Ap 709")];
      const first=await load(db,items);
      await confirm(db,first,{"unit-duplicate":await reuse(db,first,target,"709")});await seal(db,first);await promote(db,first);
      const repeated=await load(db,items,"2026-11-26T01:00:00Z");
      await confirm(db,repeated,{"unit-duplicate":await reuse(db,repeated,target,"709")});await seal(db,repeated);
      assert.equal((await state(db,repeated)).summary.duplicates,2);
      assert.equal((await promote(db,repeated,1)).promoted_records,1);
      await db.query("update public.units set private_area=80 where id=$1",[target]);
      await assert.rejects(promote(db,repeated,1),/Cadastro físico/);
      assert.equal((await progress(db,repeated)).promoted_records,1);
      await assert.rejects(db.query("update public.eobra_migration_records set promoted=true,status='duplicate',canonical_targets=jsonb_build_object('units',$2::uuid) where run_id=$1 and entity='unit'",[repeated,target]),/Cadastro físico/);
      await db.query("update public.units set private_area=79.25 where id=$1",[target]);
      const done=await promote(db,repeated);
      assert.equal(done.status,"imported");assert.equal(done.promotion_result.duplicates,2);
      assert.equal((await db.query("select count(*)::int n from public.eobra_migration_ledger where entity='unit' and targets->>'units'=$1",[target])).rows[0].n,1);
    });

    await t.test("an existing active native sale is visible as a review conflict before new promotion", async () => {
      const target = await seedUnit(db, "707");
      const client = (await db.query("select id from public.clients where company_id=$1 limit 1", [A])).rows[0].id;
      await db.query("insert into public.sales(company_id,project_id,unit_id,client_id,status,number,sale_date,total_amount) values($1,$2,$3,$4,'active','Existing synthetic','2026-01-01',100)", [A, PA, target, client]);
      const id = await load(db, commercial("occupied", "Ap 707"));
      await confirm(db, id, { "unit-occupied": await reuse(db, id, target, "707") });
      const p = await seal(db, id); assert.equal(p.status, "review"); assert.ok(p.summary.blocked > 0);
      assert.match((await db.query("select errors::text errors from public.eobra_migration_records where run_id=$1 and entity='unit'", [id])).rows[0].errors, /outra venda ativa/);
    });

    await t.test("options and map confirmation respect tenant, project visibility and permission revocation", async () => {
      const target = await seedUnit(db, "708");
      const id = await load(db, [project(), unit("unit-access", "Ap 708")]);
      const selected = await reuse(db, id, target, "708");
      await assert.rejects(options(db, id, PB), /indisponíveis/);
      await db.query("select set_config('test.hidden_project',$1,false)", [PA]);
      await assert.rejects(options(db, id), /indisponíveis/); await assert.rejects(confirm(db, id, { "unit-access": selected }), /indisponível/);
      await setTenant(db, B, UB); await assert.rejects(options(db, id), /indisponíveis/); await assert.rejects(confirm(db, id, { "unit-access": selected }), /indisponível/);
      await setTenant(db, A, UA); await db.query("select set_config('test.denied','sales.manage',false)");
      await assert.rejects(options(db, id), /indisponíveis/); await assert.rejects(confirm(db, id, { "unit-access": selected }), /indisponível/);
      await setTenant(db, A, UA);
      const flags = (await db.query("select proname,prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') anon from pg_proc where proname in('confirm_eobra_snapshot_unit_map','eobra_snapshot_unit_options','eobra_snapshot_multi_unit_supported')")).rows;
      assert.ok(flags.every(f => !f.prosecdef && !f.anon && f.proconfig?.some(value => value.startsWith("search_path="))));
    });
  } finally { await db.close(); }
});
