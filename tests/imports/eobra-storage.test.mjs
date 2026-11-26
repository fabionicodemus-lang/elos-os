import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherCompany = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = '11111111-1111-4111-8111-111111111111';
const otherUser = '22222222-2222-4222-8222-222222222222';
const file = '33333333-3333-4333-8333-333333333333.json';
const path = `${company}/${user}/${file}`;
const bucket = 'eobra-migration-snapshots';
const bundleBucket = 'eobra-migration-bundles';
const permissions = ['admin.company.manage','projects.manage','clients.manage','suppliers.manage','sales.manage','receivables.manage','payables.manage','finance.bank_accounts.manage'];

async function storageFixture() {
  const db = new PGlite();
  await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create function public.has_company_permission(company_id uuid, permission text) returns boolean language sql stable as $$
        select auth.uid() is not null and company_id::text=current_setting('test.company',true)
          and permission in ('admin.company.manage','projects.manage','clients.manage','suppliers.manage','sales.manage','receivables.manage','payables.manage','finance.bank_accounts.manage')
          and current_setting('test.denied',true)='false' and permission is distinct from current_setting('test.denied_permission',true)
      $$;
      create function storage.foldername(name text) returns text[] language sql immutable as $$
        select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]
      $$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
      create table public.eobra_migration_runs(id uuid primary key default gen_random_uuid(),company_id uuid not null,source_storage_path text);
      alter table public.eobra_migration_runs enable row level security;
      create policy test_visible_runs on public.eobra_migration_runs for select to authenticated
        using(company_id::text=current_setting('test.company',true) and current_setting('test.run_visible',true)='true');
      alter table storage.objects enable row level security;
      grant usage on schema storage,auth,public to authenticated,anon;
      grant all on storage.objects to authenticated,anon;
      grant select on public.eobra_migration_runs to authenticated;
  `);
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  for (const suffix of ['_eobra_snapshot_storage.sql','_eobra_snapshot_bundle_storage.sql']) {
    const migration = readdirSync(directory).find(name => name.endsWith(suffix));
    assert.ok(migration);
    await db.exec(readFileSync(new URL(migration, directory), 'utf8'));
  }
  return db;
}

test('private snapshot storage isolates uploader and company and refuses overwrite', async () => {
  const db = await storageFixture();
  try {
    const settings = (await db.query('select public,file_size_limit,allowed_mime_types from storage.buckets where id=$1', [bucket])).rows[0];
    assert.equal(settings.public, false);
    assert.equal(Number(settings.file_size_limit), 50 * 1024 * 1024);
    assert.deepEqual(settings.allowed_mime_types, ['application/json']);
    await db.exec('set role authenticated');
    await db.query("select set_config('test.uid',$1,false),set_config('test.company',$2,false),set_config('test.denied','false',false)", [user, company]);
    await db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [bucket, path]);
    assert.equal((await db.query('select * from storage.objects')).rows.length, 1);
    for (const invalid of [`${otherCompany}/${user}/${file}`, `${company}/${otherUser}/${file}`, `bad/${user}/${file}`, `${company}/${user}/../${file}`]) {
      await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [bucket, invalid]), /row-level security/);
    }
    assert.equal((await db.query("update storage.objects set name=name||'.changed' returning id")).rows.length, 0);
    assert.equal((await db.query('delete from storage.objects returning id')).rows.length, 0);
    await db.query("select set_config('test.uid',$1,false)", [otherUser]);
    assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
    await db.query("select set_config('test.uid',$1,false),set_config('test.denied','true',false)", [user]);
    assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
    await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [bucket, path.replace('33333333', '44444444')]), /row-level security/);
    await db.exec('reset role; set role anon');
    assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
    await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [bucket, path]), /row-level security/);
  } finally { await db.close(); }
});

test('bounded bundle storage supports authorized resume without weakening native domain permissions', async () => {
  const db = await storageFixture();
  const prefix = `${company}/${user}/${file.slice(0,-5)}/`;
  const manifest = prefix + 'manifest.json';
  try {
    const settings=(await db.query('select public,file_size_limit,allowed_mime_types from storage.buckets where id=$1',[bundleBucket])).rows[0];
    assert.equal(settings.public,false);assert.equal(Number(settings.file_size_limit),2*1024*1024);assert.deepEqual(settings.allowed_mime_types,['application/json']);
    await db.exec('set role authenticated');
    await db.query("select set_config('test.uid',$1,false),set_config('test.company',$2,false),set_config('test.denied','false',false),set_config('test.denied_permission','',false)",[user,company]);
    for (const name of ['manifest.json','part-000001.json','part-000010.json','part-000100.json','part-000999.json','part-001000.json']) await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bundleBucket,prefix+name]);
    assert.equal((await db.query('select count(*)::int n from storage.objects where bucket_id=$1',[bundleBucket])).rows[0].n,6);
    for (const invalid of [
      manifest.replace(company,otherCompany),manifest.replace(user,otherUser),
      prefix+'part-000000.json',prefix+'part-001001.json',prefix+'part-000001.json?x=1',
      prefix+'parts/part-000001.json',prefix+'../manifest.json',prefix+'notes.json',
      `${company}/${user}/not-a-uuid/manifest.json`,
    ]) await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bundleBucket,invalid]),/row-level security/);
    await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bundleBucket,manifest]),/unique|duplicate/);
    assert.equal((await db.query('update storage.objects set name=name returning id')).rows.length,0);
    assert.equal((await db.query('delete from storage.objects returning id')).rows.length,0);
    // A different operator cannot read an upload before it belongs to a visible run.
    await db.query("select set_config('test.uid',$1,false)",[otherUser]);
    assert.equal((await db.query('select count(*)::int n from storage.objects where bucket_id=$1',[bundleBucket])).rows[0].n,0);
    await db.exec('reset role');
    await db.query('insert into public.eobra_migration_runs(company_id,source_storage_path) values($1,$2)',[company,manifest]);
    await db.exec('set role authenticated');
    await db.query("select set_config('test.run_visible','true',false)");
    assert.equal((await db.query('select count(*)::int n from storage.objects where bucket_id=$1',[bundleBucket])).rows[0].n,6);
    // Project restrictions on the persisted run also restrict the associated files.
    await db.query("select set_config('test.run_visible','false',false)");
    assert.equal((await db.query('select count(*)::int n from storage.objects where bucket_id=$1',[bundleBucket])).rows[0].n,0);
    await db.query("select set_config('test.uid',$1,false)",[user]);
    assert.equal((await db.query('select count(*)::int n from storage.objects where bucket_id=$1',[bundleBucket])).rows[0].n,6);
    await db.query("select set_config('test.uid',$1,false),set_config('test.run_visible','true',false)",[otherUser]);
    await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bundleBucket,prefix+'part-000002.json']),/row-level security/);
    // Revocation must apply to both the creator and a resuming operator.
    for (const actor of [user,otherUser]) for (const denied of permissions) {
      await db.query("select set_config('test.uid',$1,false),set_config('test.denied_permission',$2,false)",[actor,denied]);
      assert.equal((await db.query('select count(*)::int n from storage.objects where bucket_id=$1',[bundleBucket])).rows[0].n,0,`${actor}: ${denied}`);
      await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bundleBucket,`${company}/${actor}/${file.slice(0,-5)}/part-000002.json`]),/row-level security/);
    }
    await db.query("select set_config('test.company',$1,false),set_config('test.denied_permission','',false)",[otherCompany]);
    assert.equal((await db.query('select * from storage.objects')).rows.length,0);
    await db.exec('reset role;set role anon');
    assert.equal((await db.query('select * from storage.objects')).rows.length,0);
    await assert.rejects(db.query('select public.eobra_bundle_storage_authorized($1)',[company]),/permission denied/);
  } finally { await db.close(); }
});
