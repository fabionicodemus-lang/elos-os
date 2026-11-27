import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fixture, applyMigration, confirmSyntheticUnitDecisions, setTenant, A, B, PA, UA, UB } from "./eobra-snapshot-fixture.mjs";

const entities = ["project", "person", "unit", "sale", "receivable", "payable", "settlement", "bank_account", "bank_transaction", "correction_index", "index_value"];
const projectEntities = ["unit", "sale", "receivable", "payable", "settlement"];
const sha = value => createHash("sha256").update(value, "utf8").digest("hex");
const record = (entity, sourceId, normalized, links = [], project = null) => ({ entity, sourceId, ...(project ? { sourceProjectId: project } : {}), raw: { observed: normalized }, normalized, links });
const archive = id => ({ ...record("raw_archive", id, { description: `Evidência ${id} 🏗` }), archiveType: "evidence" });
function commercial() {
  return [
    record("sale", "sale-parts", { number: "PARTS", sale_date: "2026-10-01", total_amount: "100.00", status: "active" }, [{ entity: "unit", sourceId: "unit-parts", role: "unit" }, { entity: "person", sourceId: "buyer-parts", role: "buyer" }], "p1"),
    record("project", "p1", { name: "Obra sintética" }),
    record("unit", "unit-parts", { code: "UNIT-PARTS", status: "available" }, [{ entity: "project", sourceId: "p1", role: "project" }], "p1"),
    record("person", "buyer-parts", { name: "Pessoa sintética", person_type: "OTHER", roles: ["client"], status: "active" }),
    archive("archive-parts"),
  ];
}
function bundle(items, { project = false, chunkSize = 2, capturedAt = "2026-11-26T00:00:00Z" } = {}) {
  const groups = new Map();
  for (const entity of entities) {
    const sourceProjectId = project && projectEntities.includes(entity) ? "p1" : null;
    groups.set(`${entity}|${sourceProjectId ?? ""}|`, { entity, sourceProjectId });
  }
  for (const item of items) groups.set(`${item.entity}|${item.sourceProjectId ?? ""}|${item.archiveType ?? ""}`, { entity: item.entity, sourceProjectId: item.sourceProjectId ?? null, ...(item.archiveType ? { archiveType: item.archiveType } : {}) });
  const bodies = [];
  const parts = [];
  for (let offset = 0; offset < items.length; offset += chunkSize) {
    const selected = items.slice(offset, offset + chunkSize);
    const body = JSON.stringify(selected);
    bodies.push(body);
    parts.push({ ordinal: parts.length + 1, firstRecord: offset + 1, recordCount: selected.length, byteLength: Buffer.byteLength(body), sha256: sha(body), name: `part-${String(parts.length + 1).padStart(6, "0")}.json` });
  }
  return { bodies, manifest: { format: "elos.eobra.snapshot.parts.v1", source: { host: "parts-fixture.eobra.com.br", capturedAt, referenceDate: "2026-11-26" }, scope: { projectIds: project ? ["p1"] : [], allProjects: project }, archiveTypes: [{ key: "evidence", description: "Evidência sintética" }], recordCount: items.length, parts,
    coverage: [...groups.values()].map(group => {
      const rows = items.filter(item => item.entity === group.entity && (item.sourceProjectId ?? null) === group.sourceProjectId && (item.archiveType ?? "") === (group.archiveType ?? ""));
      return { ...group, expectedCount: rows.length, expectedPages: 1, collectedPages: [1], detailsExpected: rows.length, detailsCollected: rows.map(item => item.sourceId), complete: true, filters: { status: "all" } };
    }),
  } };
}
const path = () => `${A}/${UA}/${randomUUID()}/manifest.json`;
async function begin(db, pack, storagePath = path(), map = {}) { return (await db.query("select public.begin_eobra_snapshot_parts($1,$2,$3,$4) id", [A, pack.manifest, map, storagePath])).rows[0].id; }
async function append(db, id, ordinal, body) { return (await db.query("select public.append_eobra_snapshot_part($1,$2,$3) progress", [id, ordinal, body])).rows[0].progress; }
async function count(db, table, id) { return (await db.query(`select count(*)::int n from public.${table} where run_id=$1`, [id])).rows[0].n; }
async function prepare(db, id) {
  await db.query("select public.finish_eobra_snapshot_append($1)", [id]);
  await confirmSyntheticUnitDecisions(db,id);
  let progress;
  do { progress = (await db.query("select public.validate_eobra_snapshot_chunk($1,100) progress", [id])).rows[0].progress; } while (progress.next_step === "validate");
  return (await db.query("select public.seal_eobra_snapshot($1) progress", [id])).rows[0].progress;
}

test("multipart snapshot transport binds every bounded part to one immutable manifest", async t => {
  const db = await fixture();
  try {
    for (const suffix of ["_finance_partial_settlements.sql", "_eobra_snapshot_promotion.sql", "_commercial_sale_units_eobra.sql", "_eobra_snapshot_resumable.sql", "_eobra_snapshot_parts.sql", "_eobra_snapshot_unit_mapping.sql"]) await applyMigration(db, suffix);

    await t.test("manifest rejects gaps, weak hashes, excessive size, wrong scope and foreign storage ownership", async () => {
      const initial = bundle([archive("boundary-a"), archive("boundary-b"), archive("boundary-c")]);
      const mutations = [
        value => { value.recordCount = 4; },
        value => { value.parts[1].firstRecord = 4; },
        value => { value.parts[1].ordinal = 3; },
        value => { value.parts[0].sha256 = "f".repeat(63); },
        value => { value.parts[0].name = "../escape.json"; },
        value => { value.parts[0].recordCount = 501; },
        value => { value.parts[0].byteLength = 2097153; },
        value => { value.records = []; },
        value => { value.source.capturedAt = "now"; },
        value => { value.recordCount = 100001; },
      ];
      for (const mutate of mutations) {
        const pack = structuredClone(initial);
        mutate(pack.manifest);
        await assert.rejects(begin(db, pack));
      }
      const tooLarge = structuredClone(initial);
      tooLarge.manifest.recordCount = 101;
      tooLarge.manifest.parts = Array.from({ length: 101 }, (_, i) => ({ ordinal: i + 1, firstRecord: i + 1, recordCount: 1, byteLength: 2097152, sha256: "a".repeat(64), name: `part-${String(i + 1).padStart(6, "0")}.json` }));
      await assert.rejects(begin(db, tooLarge), /200 MiB/);
      await assert.rejects(begin(db, initial, `${A}/${UB}/${randomUUID()}/manifest.json`), /usuário/);
      await assert.rejects(begin(db, initial, `${B}/${UA}/${randomUUID()}/manifest.json`), /empresa/);
      await assert.rejects(begin(db, initial, `${A}/${UA}/00000000-0000-0000-0000-000000000000/manifest.json`), /pacote identificado/);
      await assert.rejects(begin(db, initial, path(), { p1: PA }), /escopo|de-para/);
      await db.query("select set_config('test.denied','receivables.manage',false)");
      await assert.rejects(begin(db, initial), /permissões/);
      await setTenant(db, A, UA);
    });

    await t.test("ordered parts resume, exact replays are harmless, and cross-part commercial references promote only after seal", async () => {
      const pack = bundle(commercial(), { project: true });
      const storagePath = path();
      const id = await begin(db, pack, storagePath, { p1: PA });
      assert.equal(await begin(db, pack, storagePath, { p1: PA }), id);
      let progress = (await db.query("select public.eobra_snapshot_progress($1) progress", [id])).rows[0].progress;
      assert.equal(progress.next_step, "upload_part");
      assert.equal(progress.expected_parts, 3);
      await assert.rejects(append(db, id, 2, pack.bodies[1]), /ordem/);
      await assert.rejects(append(db, id, 1, pack.bodies[0].slice(0, -1)), /Hash|tamanho/);
      await assert.rejects(append(db, id, 1, pack.bodies[0].replace("PARTS", "OTHER")), /Hash/);
      assert.equal(await count(db, "eobra_migration_records", id), 0);
      progress = await append(db, id, 1, pack.bodies[0]);
      assert.equal(progress.loaded_records, 2);
      assert.equal(progress.next_part_ordinal, 2);
      const saleRecord = (await db.query("select id from public.eobra_migration_records where run_id=$1 and entity='sale'", [id])).rows[0].id;
      await assert.rejects(db.query("insert into public.eobra_migration_relations(run_id,record_id,company_id,project_id,ordinal,target_entity,target_source_id,role,attributes) values($1,$2,$3,$4,1,'unit','different-unit','unit','{\"entity\":\"unit\",\"sourceId\":\"unit-parts\",\"role\":\"unit\"}')", [id, saleRecord, A, PA]), /Relação diverge/);
      await assert.rejects(db.query("delete from public.eobra_migration_relations where record_id=$1", [saleRecord]), /permission denied/);
      assert.equal((await append(db, id, 1, pack.bodies[0])).loaded_records, 2);
      await assert.rejects(append(db, id, 1, `${pack.bodies[0]} `), /Hash|tamanho/);
      await assert.rejects(db.query("select public.finish_eobra_snapshot_append($1)", [id]), /todos os registros/);
      await assert.rejects(db.query("select public.append_eobra_snapshot($1,250)", [id]), /append_eobra_snapshot_part/);
      await assert.rejects(db.query("update public.eobra_migration_runs set source_storage_path=$2 where id=$1", [id, path()]), /imutáveis/);
      await append(db, id, 2, pack.bodies[1]);
      progress = await append(db, id, 3, pack.bodies[2]);
      assert.equal(progress.loaded_records, 5);
      assert.equal(progress.next_step, "finish_append");
      assert.equal(progress.uploaded_source_bytes, pack.manifest.parts.reduce((sum, part) => sum + part.byteLength, 0));
      assert.equal((await db.query("select count(*)::int n from public.sales where source_system='eobra_snapshot'")).rows[0].n, 0);
      progress = await prepare(db, id);
      assert.equal(progress.status, "ready");
      assert.equal(progress.summary.coverage_complete, true);
      const stored = (await db.query("select document from public.eobra_migration_snapshots where run_id=$1", [id])).rows[0].document;
      assert.ok(!("records" in stored));
      assert.deepEqual(stored, pack.manifest);
      progress = (await db.query("select public.promote_eobra_snapshot_chunk($1,$2,50) progress", [id, progress.preview_hash])).rows[0].progress;
      assert.equal(progress.status, "imported");
      assert.equal(progress.promotion_result.archived, 1);
      assert.equal((await append(db, id, 3, pack.bodies[2])).status, "imported");
      assert.equal((await db.query("select count(*)::int n from public.finance_bank_transactions")).rows[0].n, 0);
    });

    await t.test("part materialization is atomic and ignores forged receipt metadata", async () => {
      const invalid = bundle([archive("atomic-good"), { ...archive("atomic-bad"), entity: "unknown" }]);
      const failedId = await begin(db, invalid);
      await assert.rejects(append(db, failedId, 1, invalid.bodies[0]));
      assert.equal(await count(db, "eobra_migration_snapshot_parts", failedId), 0);
      assert.equal(await count(db, "eobra_migration_records", failedId), 0);
      const mismatch = bundle([archive("count-one")]);
      mismatch.bodies[0] = "[]";
      mismatch.manifest.parts[0].byteLength = 2;
      mismatch.manifest.parts[0].sha256 = sha("[]");
      const mismatchId = await begin(db, mismatch);
      await assert.rejects(append(db, mismatchId, 1, "[]"), /contagem/);
      const pack = bundle([archive("direct-part")]);
      const id = await begin(db, pack);
      await db.query("insert into public.eobra_migration_snapshot_parts(run_id,company_id,part_ordinal,first_record,record_count,byte_length,sha256,json_text,record_hashes) values($1,$2,1,900,499,1,$3,$4,array['forged'])", [id, A, "f".repeat(64), pack.bodies[0]]);
      const part = (await db.query("select first_record,record_count,byte_length,sha256,record_hashes from public.eobra_migration_snapshot_parts where run_id=$1", [id])).rows[0];
      assert.equal(part.first_record, 1);
      assert.equal(part.record_count, 1);
      assert.equal(part.sha256, pack.manifest.parts[0].sha256);
      assert.notEqual(part.record_hashes[0], "forged");
      assert.equal(await count(db, "eobra_migration_records", id), 1);
    });

    await t.test("direct staging writes cannot precede or differ from an immutable part", async () => {
      const pack = bundle([archive("direct-record")]);
      const id = await begin(db, pack);
      await assert.rejects(db.query("insert into public.eobra_migration_runs(company_id,source_host,format,captured_at,reference_date,scope,project_map,required_permissions,snapshot_hash,fingerprint,expected_records,source_storage_path,expected_parts,expected_source_bytes) values($1,'parts-fixture.eobra.com.br','elos.eobra.snapshot.parts.v1','2026-11-26T00:00:00Z','2026-11-26','{\"projectIds\":[],\"allProjects\":false}','{}',array[]::text[],$2,$2,1,$3,1,100)", [A, "a".repeat(64), path()]), /Permissões/);
      const insert = "insert into public.eobra_migration_records(run_id,company_id,source_ordinal,entity,source_id,archive_type,raw_data,normalized_data,record_hash) values($1,$2,1,'raw_archive','direct-record','evidence','{}','{}','forged')";
      await assert.rejects(db.query(insert, [id, A]), /parte/);
      await append(db, id, 1, pack.bodies[0]);
      await assert.rejects(db.query(insert, [id, A]), /parte/);
      await assert.rejects(db.query("update public.eobra_migration_snapshot_parts set json_text='[]' where run_id=$1", [id]), /permission denied/);
      await assert.rejects(db.query("update public.eobra_migration_snapshots set document='{}' where run_id=$1", [id]), /permission denied/);
      await assert.rejects(db.query("update public.eobra_migration_records set raw_data='{}' where run_id=$1", [id]), /carga|imutáveis/);
      await db.query("select public.cancel_eobra_snapshot($1)", [id]);
      assert.equal((await append(db, id, 1, pack.bodies[0])).status, "cancelled");
    });

    await t.test("company and native permissions protect part text; another authorized operator may resume", async () => {
      const pack = bundle([archive("tenant-one"), archive("tenant-two")], { chunkSize: 1 });
      const id = await begin(db, pack);
      await append(db, id, 1, pack.bodies[0]);
      await setTenant(db, B, UB);
      assert.equal(await count(db, "eobra_migration_snapshot_parts", id), 0);
      await assert.rejects(append(db, id, 2, pack.bodies[1]), /indisponível|permissão/);
      await setTenant(db, A, UA);
      await db.query("select set_config('test.denied','payables.manage',false)");
      assert.equal(await count(db, "eobra_migration_snapshot_parts", id), 0);
      await assert.rejects(append(db, id, 2, pack.bodies[1]), /indisponível|permissão/);
      await setTenant(db, A, UB);
      assert.equal((await append(db, id, 2, pack.bodies[1])).loaded_records, 2);
      assert.equal((await prepare(db, id)).status, "ready");
      await setTenant(db, A, UA);
    });

    await t.test("coverage and missing references remain blockers across received parts", async () => {
      const item = archive("missing-reference");
      item.links = [{ entity: "person", sourceId: "absent", role: "owner" }];
      const pack = bundle([item]);
      pack.manifest.coverage.find(row => row.entity === "raw_archive").detailsCollected = [];
      const id = await begin(db, pack);
      await append(db, id, 1, pack.bodies[0]);
      const progress = await prepare(db, id);
      assert.equal(progress.status, "review");
      assert.equal(progress.summary.blocked, 1);
      assert.equal(progress.summary.coverage_complete, false);
      await assert.rejects(db.query("select public.promote_eobra_snapshot_chunk($1,$2,50)", [id, progress.preview_hash]), /pendências/);
    });
  } finally { await db.close(); }
});
