import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { calculateIndexNumberAmount } from "../../lib/eobra-import/financial.mjs";

const dir = new URL("../../supabase/migrations/", import.meta.url);
const migration = readFileSync(new URL(readdirSync(dir).find(name => name.endsWith("_receivable_explicit_correction_policies.sql")), dir), "utf8");
const permissionsMigration = readFileSync(new URL(readdirSync(dir).find(name => name.endsWith("_receivable_correction_native_permissions.sql")), dir), "utf8");
const legacy = readFileSync(new URL("20260723_0013_open_receivables_use_latest_cub.sql", dir), "utf8").match(/create or replace function public\.set_receivable_automatic_correction\(\)[\s\S]*?\$\$;/)[0];
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PA = "11111111-1111-4111-8111-111111111111", PB = "22222222-2222-4222-8222-222222222222";
const UA = "12345678-1234-4234-8234-123456789abc", UB = "22345678-1234-4234-8234-123456789abc";
const IA = "33333333-3333-4333-8333-333333333333", IB = "44444444-4444-4444-8444-444444444444";
const RUN = "55555555-5555-4555-8555-555555555555", SRC = "66666666-6666-4666-8666-666666666666";
const REC = "77777777-7777-4777-8777-777777777777", SOURCE_INDEX = "88888888-8888-4888-8888-888888888888";
const INDEX_RECORD = "99999999-9999-4999-8999-999999999999", UNIT = "10101010-1010-4010-8010-101010101010", SALE = "20202020-2020-4020-8020-202020202020";

const data = () => ({
  status: "open", description: "Parcela sintética", due_date: "2031-05-01", original_amount: "100.00", current_amount: "128.00", paid_amount: "0.00", balance_amount: "128.00",
  interest_amount: "2.00", penalty_amount: "3.00", correction_amount: "20.00", other_accrual_amount: "4.00", discount_amount: "1.00",
  correction_locked: true,
  correction: { mode: "index_number", base_month: "2026-01", base_value: "1000.000000", reference_month: "2026-03", reference_value: "1100.000000", negative_variation_policy: "maximum_of_period", source_rule_id: "synthetic-rule", correct_until_settled: true, additional_rate: "0.000000", penalty_rate: "0.000000", interest_rate: "0.000000", compound_interest: false },
});

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key);insert into auth.users values('${UA}'),('${UB}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function public.is_company_member(p_company uuid) returns boolean language sql stable as $$select auth.uid() is not null and p_company=nullif(current_setting('test.company',true),'')::uuid$$;
    create function public.has_company_permission(p_company uuid,p_permission text) returns boolean language sql stable as $$select public.is_company_member(p_company) and p_permission<>coalesce(current_setting('test.denied',true),'') and (coalesce(current_setting('test.allowed',true),'')='' or p_permission=any(string_to_array(current_setting('test.allowed',true),',')))$$;
    create table public.companies(id uuid primary key,name text);
    create table public.projects(id uuid primary key,company_id uuid references public.companies(id),name text);
    create table public.units(id uuid primary key,company_id uuid references public.companies(id),project_id uuid references public.projects(id),code text);
    create table public.sales(id uuid primary key,company_id uuid references public.companies(id),project_id uuid references public.projects(id),sale_date date,correction_start_month int);
    create table public.correction_indices(id uuid primary key,company_id uuid not null references public.companies(id),code text,name text,value_type text,status text);
    create table public.correction_index_values(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),correction_index_id uuid not null references public.correction_indices(id),reference_month date not null,value numeric(18,6) not null,notes text,created_by uuid references auth.users(id),created_at timestamptz default now(),updated_at timestamptz default now(),unique(company_id,correction_index_id,reference_month));
    create table public.receivables(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid not null references public.projects(id),sale_id uuid references public.sales(id),unit_id uuid references public.units(id),description text,due_date date,
      amount numeric(16,2) not null,adjusted_amount numeric(16,2) not null,paid_amount numeric(16,2),status text not null,correction_locked boolean not null,
      correction_index_id uuid references public.correction_indices(id),adjustment_index text,correction_base_month date,correction_base_value numeric(18,6),correction_reference_month date,correction_reference_value numeric(18,6),
      installment_interest_amount numeric(16,2),correction_amount numeric(16,2),late_fee_amount numeric(16,2),other_accrual_amount numeric(16,2),discount_amount numeric(16,2),
      source_system text,source_id text,created_by uuid references auth.users(id),created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.eobra_migration_runs(id uuid primary key,company_id uuid references public.companies(id),source_host text,status text,reference_date date);
    create table public.eobra_migration_records(id uuid primary key,company_id uuid references public.companies(id),project_id uuid references public.projects(id),run_id uuid references public.eobra_migration_runs(id),entity text,source_id text,record_hash text,normalized_data jsonb);
    create table public.eobra_migration_ledger(id uuid primary key default gen_random_uuid(),company_id uuid references public.companies(id),run_id uuid references public.eobra_migration_runs(id),record_id uuid references public.eobra_migration_records(id),entity text,record_hash text,targets jsonb,disposition text);
    create table public.eobra_migration_relations(id uuid primary key default gen_random_uuid(),company_id uuid references public.companies(id),run_id uuid references public.eobra_migration_runs(id),record_id uuid references public.eobra_migration_records(id),role text,target_entity text,target_source_id text);
    create table public.eobra_source_indices(id uuid primary key default gen_random_uuid(),company_id uuid references public.companies(id),project_id uuid references public.projects(id),run_id uuid references public.eobra_migration_runs(id),record_id uuid references public.eobra_migration_records(id),entity text,source_host text,source_id text,parent_index_id uuid references public.eobra_source_indices(id),reference_month date,index_value numeric(24,10),details jsonb);
    create function public.receivable_month_distance(a date,b date) returns integer language sql immutable as $$select (extract(year from b)::int-extract(year from a)::int)*12+extract(month from b)::int-extract(month from a)::int$$;
    insert into public.companies values('${A}','Empresa sintética'),('${B}','Outra empresa');
    insert into public.projects values('${PA}','${A}','Obra sintética'),('${PB}','${B}','Outra obra');
    insert into public.units values('${UNIT}','${A}','${PA}','TEST-001');
    insert into public.sales values('${SALE}','${A}','${PA}','2001-01-01',4);
    insert into public.correction_indices values('${IA}','${A}','TEST','Índice sintético','index_number','active'),('${IB}','${B}','TEST','Índice de outra empresa','index_number','active');
    insert into public.eobra_migration_runs values('${RUN}','${A}','fixture.eobra.com.br','imported','2026-03-20');
    insert into public.eobra_migration_records values('${INDEX_RECORD}','${A}',null,'${RUN}','correction_index','index-source','hash-index','{"name":"Índice sintético","value_type":"index_number"}');
    insert into public.eobra_source_indices(id,company_id,run_id,record_id,entity,source_host,source_id,details) values('${SOURCE_INDEX}','${A}','${RUN}','${INDEX_RECORD}','correction_index','fixture.eobra.com.br','index-source','{"name":"Índice sintético","value_type":"index_number"}');
    insert into public.eobra_source_indices(company_id,run_id,record_id,entity,source_host,source_id,parent_index_id,reference_month,index_value,details)
      select '${A}','${RUN}','${INDEX_RECORD}','index_value','fixture.eobra.com.br','point-'||m,'${SOURCE_INDEX}',m::date,v,'{}' from(values('2026-01-01',1000),('2026-02-01',1200),('2026-03-01',1100),('2026-04-01',1300)) t(m,v);
    insert into public.receivables(id,company_id,project_id,sale_id,unit_id,description,due_date,amount,adjusted_amount,paid_amount,status,correction_locked,installment_interest_amount,correction_amount,late_fee_amount,other_accrual_amount,discount_amount,source_system,source_id,created_by)
      values('${REC}','${A}','${PA}','${SALE}','${UNIT}','Parcela sintética','2031-05-01',100,128,0,'open',true,2,20,3,4,1,'eobra_snapshot','fixture.eobra.com.br|receivable|receipt-source','${UA}');
    grant usage on schema public,auth to authenticated;
    grant select,insert,update,delete on public.correction_index_values to authenticated;
    grant select,update on public.receivables,public.correction_indices,public.sales to authenticated;
    grant select on public.projects,public.units to authenticated;
    do $$declare t text;begin foreach t in array array['correction_indices','correction_index_values','receivables','sales','projects','units'] loop
      execute format('alter table public.%I enable row level security',t);
      execute format('create policy tenant on public.%I for all to authenticated using(public.is_company_member(company_id)) with check(public.is_company_member(company_id))',t);
    end loop;end;$$;
    drop policy tenant on public.receivables;
    create policy native_receivable_read on public.receivables for select to authenticated using(public.has_company_permission(company_id,'receivables.view') or public.has_company_permission(company_id,'receivables.manage'));
    create policy native_receivable_update on public.receivables for update to authenticated using(public.has_company_permission(company_id,'receivables.manage')) with check(public.has_company_permission(company_id,'receivables.manage'));
  `);
  await db.query("insert into public.eobra_migration_records values($1,$2,$3,$4,'receivable','receipt-source','hash-receipt',$5)", [SRC, A, PA, RUN, data()]);
  await db.query("insert into public.eobra_migration_ledger(company_id,run_id,record_id,entity,record_hash,targets,disposition) values($1,$2,$3,'receivable','hash-receipt',$4,'canonical')", [A, RUN, SRC, { receivables: REC }]);
  await db.query("insert into public.eobra_migration_relations(company_id,run_id,record_id,role,target_entity,target_source_id) values($1,$2,$3,'correction_index','correction_index','index-source')", [A, RUN, SRC]);
  await db.exec(legacy);
  await db.exec("create trigger receivables_automatic_correction before insert or update on public.receivables for each row execute function public.set_receivable_automatic_correction()");
  await db.exec(migration);
  await db.exec(permissionsMigration);
  await month(db, "2026-03-01");
  await tenant(db, A, UA);
  return db;
}

async function tenant(db, company = A, user = UA) {
  await db.exec("reset role");
  await db.query("select set_config('test.company',$1,false),set_config('test.uid',$2,false),set_config('test.denied','',false),set_config('test.allowed','',false)", [company, user]);
  await db.exec("set role authenticated");
}

async function month(db, value) {
  assert.match(value, /^\d{4}-\d{2}-01$/);
  await db.exec("reset role");
  await db.exec(`create or replace function finance_correction_private.current_month() returns date language sql stable security invoker set search_path='' as $$select date '${value}'$$`);
  await db.exec("set role authenticated");
}

async function rpc(db, name, args) {
  return (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`, args)).rows[0].result;
}
async function permissionDenied(db, run) {
  await db.exec("savepoint permission_denial");
  try { await assert.rejects(run, /Sem permissão/); }
  finally { await db.exec("rollback to savepoint permission_denial; release savepoint permission_denial"); }
}
async function bind(db) {
  const preview = await rpc(db, "preview_eobra_correction_index", [A, SOURCE_INDEX, IA]);
  assert.equal(preview.ok, true, JSON.stringify(preview));
  return rpc(db, "bind_eobra_correction_index", [A, SOURCE_INDEX, IA, preview.preview_hash]);
}
async function activate(db) {
  await bind(db);
  const preview = await rpc(db, "preview_eobra_receivable_correction", [A, REC, SRC]);
  assert.equal(preview.ok, true, JSON.stringify(preview));
  return rpc(db, "activate_eobra_receivable_correction", [A, REC, SRC, preview.preview_hash]);
}
async function title(db) { return (await db.query("select * from public.receivables where id=$1", [REC])).rows[0]; }

test("explicit native correction engine, real triggers and tenant boundaries", async t => {
  const db = await fixture();
  async function isolated(name, fn) {
    await t.test(name, async () => {
      await db.exec("begin");
      try { await fn(); } finally { await db.exec("rollback"); await tenant(db); }
    });
  }
  try {
    await isolated("migration enables no policy; index mapping requires reviewed IDs and copies exact history", async () => {
      assert.equal((await db.query("select count(*)::int n from public.receivable_correction_policies")).rows[0].n, 0);
      const preview = await rpc(db, "preview_eobra_correction_index", [A, SOURCE_INDEX, IA]);
      assert.equal(preview.source_count, 4); assert.equal(preview.insert_count, 4);
      await assert.rejects(rpc(db, "bind_eobra_correction_index", [A, SOURCE_INDEX, IA, "wrong"]), /revisão/);
    });
    await isolated("valid bridge and activation preserve source amount and ignore future/sale-date rules", async () => {
      const id = await activate(db);
      const r = await title(db);
      assert.equal(r.adjusted_amount, "128.00"); assert.equal(r.correction_locked, true);
      assert.equal(r.correction_base_month.toISOString().slice(0, 10), "2026-01-01");
      assert.equal(r.correction_reference_month.toISOString().slice(0, 10), "2026-02-01");
      const policy = (await db.query("select * from public.receivable_correction_policies where id=$1", [id])).rows[0];
      assert.equal(policy.state, "active"); assert.equal(policy.base_value, "1000.000000");
      assert.equal(policy.reference_method, "current_month_sao_paulo");
      assert.equal((await db.query("select count(*)::int n from public.correction_index_value_history")).rows[0].n, 4);
      await db.query("update public.sales set sale_date='2030-01-01',correction_start_month=60 where id=$1", [SALE]);
      await db.query("update public.receivables set correction_locked=false where id=$1", [REC]);
      assert.equal((await title(db)).adjusted_amount, "128.00"); assert.equal((await title(db)).correction_locked, true);
    });
    await isolated("monthly refresh applies complete maximum series and preserves every component", async () => {
      await activate(db); await month(db, "2026-04-01");
      const result = await rpc(db, "refresh_receivable_correction_policies", [A, null, 500]);
      assert.equal(result.updated, 1); assert.equal(result.pending, 0);
      const r = await title(db);
      assert.equal(r.adjusted_amount, "138.00"); assert.equal(r.correction_amount, "30.00");
      assert.deepEqual([r.installment_interest_amount, r.late_fee_amount, r.other_accrual_amount, r.discount_amount], ["2.00", "3.00", "4.00", "1.00"]);
      assert.equal((await rpc(db, "refresh_receivable_correction_policies", [A, null, 500])).processed, 0);
    });
    await isolated("missing current month blocks without nominal fallback, insertion resumes a bounded batch", async () => {
      await activate(db); await month(db, "2026-05-01");
      let result = await rpc(db, "refresh_receivable_correction_policies", [A, IA, 500]);
      assert.equal(result.blocked, 1); assert.equal(result.total_blocked, 1);
      assert.equal((await title(db)).adjusted_amount, "128.00");
      await db.query("insert into public.correction_index_values(company_id,correction_index_id,reference_month,value,created_by) values($1,$2,'2026-05-01',1400,$3)", [A, IA, UA]);
      assert.equal((await title(db)).adjusted_amount, "148.00");
      result = await rpc(db, "receivable_correction_overview", [A]);
      assert.equal(result.blocked, 0); assert.equal(result.scheduler_configured, false);
    });
    await isolated("revising an applied month requires review and keeps historical valuation", async () => {
      await activate(db);
      await db.query("update public.correction_index_values set value=1190 where correction_index_id=$1 and reference_month='2026-02-01'", [IA]);
      assert.equal((await title(db)).adjusted_amount, "128.00");
      const policy = (await db.query("select state,enabled,last_error from public.receivable_correction_policies")).rows[0];
      assert.equal(policy.state, "review_required"); assert.equal(policy.enabled, false); assert.match(policy.last_error, /revisada/);
    });
    await isolated("partial and fully paid history immediately suspend correction", async () => {
      await activate(db);
      await db.query("update public.receivables set paid_amount=30,status='open',correction_locked=false where id=$1", [REC]);
      assert.equal((await title(db)).correction_locked, true);
      const policy = (await db.query("select state,enabled from public.receivable_correction_policies")).rows[0];
      assert.equal(policy.state, "suspended"); assert.equal(policy.enabled, false);
      await month(db, "2026-05-01");
      await db.query("insert into public.correction_index_values(company_id,correction_index_id,reference_month,value) values($1,$2,'2026-05-01',2000)", [A, IA]);
      assert.equal((await title(db)).adjusted_amount, "128.00");
    });
    await isolated("index metadata change produces explicit pending state", async () => {
      await activate(db);
      await db.query("update public.correction_indices set status='inactive' where id=$1", [IA]);
      assert.equal((await title(db)).adjusted_amount, "128.00");
      assert.equal((await rpc(db, "receivable_correction_overview", [A])).blocked, 1);
    });
    await isolated("unverified contract fields prevent activation while leaving imported history readable", async () => {
      await bind(db); await db.exec("reset role");
      await db.query("update public.eobra_migration_records set normalized_data=normalized_data #- '{correction,interest_rate}' where id=$1", [SRC]);
      await db.exec("set role authenticated");
      const preview = await rpc(db, "preview_eobra_receivable_correction", [A, REC, SRC]);
      assert.equal(preview.ok, false); assert.match(preview.errors.join(" "), /Regra incompleta/);
      assert.equal((await title(db)).adjusted_amount, "128.00");
    });
    await isolated("index conflicts are reviewed rather than overwritten", async () => {
      await db.query("insert into public.correction_index_values(company_id,correction_index_id,reference_month,value) values($1,$2,'2026-03-01',1101)", [A, IA]);
      const preview = await rpc(db, "preview_eobra_correction_index", [A, SOURCE_INDEX, IA]);
      assert.equal(preview.ok, false); assert.equal(preview.conflicts.length, 1);
      assert.equal((await db.query("select value from public.correction_index_values")).rows[0].value, "1101.000000");
    });
    await isolated("preview hash is revalidated after a title changes", async () => {
      await bind(db);
      const preview = await rpc(db, "preview_eobra_receivable_correction", [A, REC, SRC]);
      await db.query("update public.receivables set adjusted_amount=129,installment_interest_amount=3 where id=$1", [REC]);
      await assert.rejects(rpc(db, "activate_eobra_receivable_correction", [A, REC, SRC, preview.preview_hash]), /divergem|revisão/);
    });
    await isolated("public functions are invoker; worker, policy writes and evidence edits are not granted", async () => {
      const rows = (await db.query("select proname,prosecdef from pg_proc where proname in('activate_eobra_receivable_correction','bind_eobra_correction_index','refresh_receivable_correction_policies')")).rows;
      assert.equal(rows.length, 3); assert.ok(rows.every(row => row.prosecdef === false));
      await assert.rejects(db.query("select finance_correction_private.refresh_due_all(500)"), /permission denied/);
    });
    await isolated("cross-tenant identifiers cannot link or expose source evidence", async () => {
      await bind(db); await tenant(db, B, UB);
      assert.equal((await db.query("select count(*)::int n from public.correction_index_source_links")).rows[0].n, 0);
      await assert.rejects(rpc(db, "preview_eobra_correction_index", [B, SOURCE_INDEX, IB]), /indisponível/);
    });
    await isolated("revoked role permission cannot activate via private or public endpoint", async () => {
      await db.query("select set_config('test.denied','indices.manage',true)");
      await assert.rejects(rpc(db, "preview_eobra_correction_index", [A, SOURCE_INDEX, IA]), /Sem permissão/);
    });
    await isolated("index readers cannot read financial values through correction policies or events", async () => {
      await activate(db);
      await db.query("select set_config('test.allowed','indices.view',true)");
      for (const table of ["receivables", "receivable_correction_policies", "receivable_correction_events"]) {
        assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n, 0);
      }
      assert.equal((await db.query("select count(*)::int n from public.correction_index_source_links")).rows[0].n, 1);
      assert.equal((await db.query("select count(*)::int n from public.correction_index_value_history")).rows[0].n, 4);
    });
    await isolated("index managers cannot query financial overview or manually write receivables", async () => {
      await activate(db); await month(db, "2026-04-01");
      await db.query("select set_config('test.allowed','indices.manage',true)");
      assert.equal((await db.query("update public.receivables set description=description returning id")).rows.length, 0);
      await permissionDenied(db, () => rpc(db, "receivable_correction_overview", [A]));
      await permissionDenied(db, () => db.query("select finance_correction_private.overview($1)", [A]));
      await permissionDenied(db, () => rpc(db, "eobra_receivable_correction_candidates", [A, 20, 0]));
      await permissionDenied(db, () => rpc(db, "refresh_receivable_correction_policies", [A, null, 500]));
      await permissionDenied(db, () => db.query("select finance_correction_private.refresh_authorized($1,null,500)", [A]));
      await db.exec("reset role");
      assert.equal((await title(db)).adjusted_amount, "128.00");
      assert.equal((await db.query("select count(*)::int n from finance_correction_private.revaluation_intents")).rows[0].n, 0);
    });
    await isolated("financial read permission permits audit values but does not grant manual recalculation", async () => {
      await activate(db); await month(db, "2026-04-01");
      await db.query("select set_config('test.allowed','indices.manage,receivables.view',true)");
      assert.equal((await title(db)).adjusted_amount, "128.00");
      assert.equal((await db.query("select snapshot_current_amount::text amount from public.receivable_correction_policies")).rows[0].amount, "128.00");
      assert.equal((await rpc(db, "receivable_correction_overview", [A])).total, 1);
      assert.equal((await rpc(db, "eobra_receivable_correction_candidates", [A, 20, 0])).total, 1);
      await permissionDenied(db, () => rpc(db, "refresh_receivable_correction_policies", [A, null, 500]));
      await db.query("select set_config('test.allowed','receivables.manage',true)");
      assert.equal((await rpc(db, "refresh_receivable_correction_policies", [A, null, 500])).updated, 1);
      assert.equal((await title(db)).adjusted_amount, "138.00");
    });
    await isolated("financial permission in another company cannot read or refresh this company's policies", async () => {
      await activate(db); await tenant(db, B, UB);
      await db.query("select set_config('test.allowed','receivables.manage',true)");
      assert.equal((await db.query("select count(*)::int n from public.receivable_correction_policies")).rows[0].n, 0);
      assert.equal((await db.query("select count(*)::int n from public.receivable_correction_events")).rows[0].n, 0);
      await permissionDenied(db, () => rpc(db, "receivable_correction_overview", [A]));
      await permissionDenied(db, () => rpc(db, "refresh_receivable_correction_policies", [A, null, 500]));
    });
    await isolated("authorized index writes retain the approved trigger without granting manual financial access", async () => {
      await activate(db); await month(db, "2026-04-01");
      await db.query("select set_config('test.allowed','indices.manage',true)");
      await db.query("update public.correction_index_values set value=1400 where correction_index_id=$1 and reference_month='2026-04-01'", [IA]);
      assert.equal((await db.query("select count(*)::int n from public.receivable_correction_policies")).rows[0].n, 0);
      await db.exec("reset role");
      assert.equal((await title(db)).adjusted_amount, "148.00");
    });
    await isolated("a bounded trigger leaves a visible queue and the next RPC drains it without replay", async () => {
      await activate(db); await db.exec("reset role");
      // Trusted fixture provisioning reuses an already verified synthetic policy.
      // Every calculation below still uses the real SQL engine, triggers and locks.
      await db.exec(`do $$declare n integer;rid uuid;pid uuid;payload jsonb;begin
        for n in 1..104 loop
          rid:=gen_random_uuid();pid:=gen_random_uuid();
          select to_jsonb(r)||jsonb_build_object('id',rid,'source_id','fixture.eobra.com.br|receivable|batch-'||n) into payload from public.receivables r where id='${REC}';
          insert into public.receivables select (jsonb_populate_record(null::public.receivables,payload)).*;
          select to_jsonb(p)||jsonb_build_object('id',pid,'receivable_id',rid) into payload from public.receivable_correction_policies p where receivable_id='${REC}';
          insert into public.receivable_correction_policies select (jsonb_populate_record(null::public.receivable_correction_policies,payload)).*;
        end loop;
      end;$$;`);
      await tenant(db); await month(db, "2026-05-01");
      await db.query("insert into public.correction_index_values(company_id,correction_index_id,reference_month,value) values($1,$2,'2026-05-01',1400)", [A, IA]);
      const overview = await rpc(db, "receivable_correction_overview", [A]);
      assert.equal(overview.total, 105); assert.equal(overview.pending, 5);
      const tail = await rpc(db, "refresh_receivable_correction_policies", [A, null, 3]);
      assert.equal(tail.processed, 3); assert.equal(tail.pending, 2);
      const last = await rpc(db, "refresh_receivable_correction_policies", [A, null, 3]);
      assert.equal(last.processed, 2); assert.equal(last.pending, 0);
      assert.equal((await rpc(db, "refresh_receivable_correction_policies", [A, null, 3])).processed, 0);
      assert.equal((await db.query("select count(*)::int n from public.receivables where adjusted_amount=148")).rows[0].n, 105);
    });
    await isolated("policy and audit tables cannot be edited directly by authenticated users", async () => {
      await activate(db);
      await assert.rejects(db.query("update public.receivable_correction_policies set base_value=1"), /permission denied/);
    });
    await isolated("the source bridge remains immutable even for its internal owner", async () => {
      await bind(db); await db.exec("reset role");
      await assert.rejects(db.query("update public.correction_index_source_links set verified_hash='tampered'"), /imutável/);
    });
    await isolated("old forms cannot replace a reviewed base or move its company/project", async () => {
      await activate(db);
      await assert.rejects(db.query("update public.receivables set correction_base_value=1 where id=$1", [REC]), /política explicitamente/);
    });
    await isolated("no session and anonymous role cannot reach activation", async () => {
      await db.query("select set_config('test.uid','',true)");
      await assert.rejects(rpc(db, "preview_eobra_correction_index", [A, SOURCE_INDEX, IA]), /Sem permissão/);
    });
    await isolated("anonymous cannot call public correction RPCs", async () => {
      await db.exec("set role anon");
      await assert.rejects(rpc(db, "refresh_receivable_correction_policies", [A, null, 500]), /permission denied/);
    });
    await isolated("manual correction replacement cannot leave an active policy with a false valuation", async () => {
      await activate(db);
      await assert.rejects(db.query("update public.receivables set correction_amount=0,adjusted_amount=108 where id=$1", [REC]), /cálculo validado/);
    });
    await isolated("reviewed activation replay is idempotent even after a legitimate monthly update", async () => {
      await bind(db);
      const preview = await rpc(db, "preview_eobra_receivable_correction", [A, REC, SRC]);
      const id = await rpc(db, "activate_eobra_receivable_correction", [A, REC, SRC, preview.preview_hash]);
      await month(db, "2026-04-01"); await rpc(db, "refresh_receivable_correction_policies", [A, null, 500]);
      assert.equal(await rpc(db, "activate_eobra_receivable_correction", [A, REC, SRC, preview.preview_hash]), id);
      assert.equal((await title(db)).adjusted_amount, "138.00");
      assert.equal((await db.query("select count(*)::int n from public.receivable_correction_policies")).rows[0].n, 1);
      await db.exec("reset role");
      assert.equal((await db.query("select count(*)::int n from finance_correction_private.revaluation_intents")).rows[0].n, 0);
    });
    await isolated("null pagination cannot disable the server row limit", async () => {
      await assert.rejects(rpc(db, "eobra_receivable_correction_candidates", [A, null, null]), /Paginação inválida/);
    });
    await isolated("explicit component edits keep correction intact and are preserved in the next month", async () => {
      await activate(db);
      await db.query("update public.receivables set discount_amount=5,adjusted_amount=124 where id=$1", [REC]);
      await month(db, "2026-04-01"); await rpc(db, "refresh_receivable_correction_policies", [A, null, 500]);
      assert.equal((await title(db)).adjusted_amount, "134.00");
      assert.equal((await title(db)).discount_amount, "5.00");
    });
    await isolated("finance operations continue monthly batches without company-admin permission", async () => {
      await activate(db); await month(db, "2026-04-01");
      await db.query("select set_config('test.denied','admin.company.manage',true)");
      assert.equal((await rpc(db, "refresh_receivable_correction_policies", [A, null, 500])).updated, 1);
      assert.equal((await rpc(db, "eobra_receivable_correction_candidates", [A, 20, 0])).total, 1);
      await assert.rejects(rpc(db, "preview_eobra_correction_index", [A, SOURCE_INDEX, IA]), /Sem permissão/);
    });
    await isolated("São Paulo reference month and integer HALF_UP match the pure financial engine", async () => {
      await db.exec("reset role");
      const boundary = (await db.query("select finance_correction_private.reference_month('2027-02-01T02:59:59Z')::text a,finance_correction_private.reference_month('2027-02-01T03:00:00Z')::text b")).rows[0];
      assert.deepEqual(boundary, { a: "2027-01-01", b: "2027-02-01" });
      await tenant(db); await bind(db); await db.exec("reset role");
      const calc = (await db.query("select finance_correction_private.evaluate($1,$2,'2026-01-01',1000,'2026-03-01',0.05,0,0,0,0) result", [A, IA])).rows[0].result;
      const exact = calculateIndexNumberAmount({ original_amount: "0.05", base_value: "1000.000000", reference_value: "1200.000000" });
      assert.equal(calc.current_amount, exact.adjusted_principal_amount);
      assert.equal(calc.correction_amount, exact.correction_amount);
    });
  } finally { await db.close(); }
});
