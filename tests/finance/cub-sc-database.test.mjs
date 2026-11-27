import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const [company, other, user, index, otherIndex] = [1,2,3,4,5].map(id);
test("CUB monthly automation — PostgreSQL lifecycle and isolation", async t => {
 const db = new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create schema auth;create schema finance_private;
   create table auth.users(id uuid primary key);create table public.companies(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
   create function public.has_company_permission(c uuid,p text) returns boolean language sql stable as $$select auth.uid() is not null and c=nullif(current_setting('test.company',true),'')::uuid and current_setting('test.allowed',true)='yes'$$;
   create function public.test_now() returns timestamptz language sql stable as $$select current_setting('test.clock')::timestamptz$$;
   select set_config('test.clock','2026-11-01T03:17:00Z',false),set_config('test.uid','${user}',false),set_config('test.company','${company}',false),set_config('test.allowed','yes',false);
   create table public.correction_indices(id uuid primary key,company_id uuid,code text,name text,source_name text,value_type text,status text,created_by uuid);
   create table public.correction_index_values(id uuid default gen_random_uuid(),company_id uuid,correction_index_id uuid,reference_month date,value numeric,notes text,created_by uuid,unique(company_id,correction_index_id,reference_month));
   create table public.receivables(id uuid primary key,company_id uuid,correction_index_id uuid,status text,correction_locked boolean,paid_amount numeric,source_system text,updated_at timestamptz);
   create table public.finance_collections(id uuid primary key,company_id uuid,receivable_id uuid,status text);
   grant usage on schema public,auth,finance_private to authenticated,service_role;
   insert into public.companies values('${company}'),('${other}'); insert into auth.users values('${user}');
   insert into public.correction_indices values('${index}','${company}','CUB-SC','CUB-SC Residencial Médio','Sinduscon Grande Florianópolis','index_number','active','${user}'),('${otherIndex}','${other}','CUB-SC','CUB-SC','Sinduscon/SC','index_number','active','${user}');`);
  // Clock injection is limited to this local fixture; no production caller can
  // supply a date or bypass the DB's America/Sao_Paulo window.
  const migration = readFileSync(new URL("../../supabase/migrations/20261127142911_cub_sc_monthly_automation.sql", import.meta.url), "utf8").replaceAll("now()", "public.test_now()");
  await db.exec(migration);
  await db.exec(`create trigger correction_values_refresh_receivables after insert or update or delete on public.correction_index_values for each row execute function public.refresh_receivables_after_index_change();`);
  const q = (s,p=[]) => db.query(s,p);
  const val = async(s,p=[]) => (await q(s,p)).rows[0]?.v;
  const role = async r => db.exec(`reset role;set role ${r}`);
  const clock = async value => q("select set_config('test.clock',$1,false)",[value]);
  const claim = () => val("select public.cub_sc_claim() v");
  const publication = month => ({ application_month: month, reference_month: month === '2026-11-01' ? '2026-10-01' : '2026-11-01', residential:3182.95,commercial:3385.25,source_url:'https://sinduscon-fpolis.org.br/servico/cub-mensal/',source_hash:'a'.repeat(64) });
  const finish = (c,p=publication(c.month),error=null) => val("select public.cub_sc_finish($1,$2,$3,$4) v",[c.month,c.token,p,error]);
  let lease;
  await t.test("only explicit existing series enrolled, RPCs and tenant rows restricted", async () => {
   assert.equal(Number(await val("select count(*) v from public.cub_sc_automation")),1);
   await role('authenticated');
   assert.equal(Number(await val("select count(*) v from public.cub_sc_automation")),1);
   await assert.rejects(claim(),/permission denied/);
   await assert.rejects(q("update public.cub_sc_automation set enabled=false"),/permission denied/);
   await assert.rejects(q("select public.cub_sc_configure($1,$2,'residential',true)",[company,otherIndex]),/Índice CUB inválido/);
   await assert.rejects(q("select public.cub_sc_configure($1,$2,'residential',true)",[other,otherIndex]),/Sem permissão/);
   await q("select set_config('test.company',$1,false)",[other]);
   assert.equal(Number(await val("select count(*) v from public.cub_sc_automation")),0);
   await q("select public.cub_sc_configure($1,$2,'commercial',true)",[other,otherIndex]);
   await role('anon'); await assert.rejects(claim(),/permission denied/);
   await role('service_role'); await assert.rejects(q("select * from finance_private.cub_sc_months"),/permission denied/);
  });
  await t.test("window boundary, one claim per hour and retry after failed lookup", async () => {
   await clock('2026-11-01T02:59:00Z'); assert.equal(await claim(),null);
   await clock('2026-11-01T03:17:00Z'); lease=await claim(); assert.ok(lease.token);
   assert.equal(await claim(),null);
   assert.equal(await finish(lease,null,'not_published'),'not_published');
   assert.equal(await claim(),null);
   await clock('2026-11-01T04:17:00Z'); lease=await claim(); assert.ok(lease.token);
   await assert.rejects(finish({...lease,token:id(99)}),/Reserva/);
   await assert.rejects(finish(lease,{...publication(lease.month),application_month:'2026-10-01'}),/Publicação/);
  });
  await t.test("publication updates eligible rows only and preserves manual conflicts", async () => {
   await role('postgres');
   await q("insert into correction_index_values(company_id,correction_index_id,reference_month,value) values($1,$2,'2026-11-01',3200)",[other,otherIndex]);
   for(let n=10;n<=17;n++) await q("insert into receivables values($1,$2,$3,$4,$5,$6,$7,'2026-01-01')",[id(n),company,index,n===11?'paid':'open',n===12,n===13?100:0,n===14?'eobra':null]);
   for(const [n,status] of [[15,'registered'],[16,'prepared'],[17,'cancelled']])await q("insert into finance_collections values($1,$2,$3,$4)",[id(n+10),company,id(n),status]);
   await role('service_role'); assert.equal(await finish(lease),'completed');
   await role('postgres');
   assert.equal(Number(await val("select value v from correction_index_values where company_id=$1",[company])),3182.95);
   assert.equal(Number(await val("select value v from correction_index_values where company_id=$1",[other])),3200);
   assert.equal(await val("select last_error v from cub_sc_automation where company_id=$1",[other]),'value_conflict');
   const changed=(await q("select id from receivables where updated_at>'2026-01-02' order by id")).rows.map(x=>x.id);
   assert.deepEqual(changed,[id(10),id(17)]);
   await role('service_role'); await assert.rejects(finish(lease),/Reserva/);
   assert.equal(await claim(),null);
  });
  await t.test("completed month never restarts; next month does, then day 4 closes", async () => {
   await clock('2026-11-03T12:17:00Z'); assert.equal(await claim(),null);
   await clock('2026-12-01T03:17:00Z'); const next=await claim(); assert.equal(next.month,'2026-12-01');
   await clock('2026-12-01T03:23:00Z'); await assert.rejects(finish(next),/Reserva/);
   await clock('2026-12-04T02:17:00Z'); const last=await claim(); assert.ok(last);
   await finish(last,null,'source_unavailable');
   await clock('2026-12-04T03:17:00Z'); assert.equal(await claim(),null);
  });
 } finally {await db.close();}
});
