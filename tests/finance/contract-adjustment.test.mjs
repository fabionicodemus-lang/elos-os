import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../../supabase/migrations/'+p,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const [company,other,project,otherProject,user,cub,ipca,otherIndex]=[1,2,3,4,5,6,7,8].map(id);
test('project defaults and versioned contract correction in PostgreSQL',async t=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema finance_private;
 create table auth.users(id uuid primary key);create table companies(id uuid primary key);create table projects(id uuid primary key,company_id uuid);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function has_company_permission(c uuid,p text) returns boolean language sql stable as $$select auth.uid() is not null and c=nullif(current_setting('test.company',true),'')::uuid and coalesce(current_setting('test.deny',true),'')<>p$$;
 create function test_now() returns timestamptz language sql stable as $$select current_setting('test.clock')::timestamptz$$;
 select set_config('test.clock','2026-11-15T12:00Z',false),set_config('test.uid','${user}',false),set_config('test.company','${company}',false);
 create table correction_indices(id uuid primary key,company_id uuid,code text,name text,value_type text,status text);
 create table correction_index_values(id uuid primary key default gen_random_uuid(),company_id uuid,correction_index_id uuid,reference_month date,value numeric,unique(company_id,correction_index_id,reference_month));
 create table sales(id uuid primary key,company_id uuid,project_id uuid,status text default 'active',source_system text,sale_date date,correction_start_month integer default 0,created_by uuid,updated_at timestamptz default now());
 create table engineering_budgets(id uuid primary key,company_id uuid,project_id uuid,reference_date date,status text default 'draft',source_system text,updated_at timestamptz default now());
 create table engineering_services(id uuid primary key);create table engineering_budget_items(id uuid primary key);
 create table receivables(id uuid primary key,company_id uuid,project_id uuid,sale_id uuid,due_date date,amount numeric,status text default 'open',source_system text,paid_amount numeric default 0,correction_locked boolean default false,correction_index_id uuid,adjustment_index text,correction_base_month date,correction_reference_month date,correction_base_value numeric,correction_reference_value numeric,correction_amount numeric default 0,installment_interest_amount numeric default 0,late_fee_amount numeric default 0,other_accrual_amount numeric default 0,discount_amount numeric default 0,adjusted_amount numeric default 0,updated_at timestamptz default now());
 create table finance_collections(id uuid primary key default gen_random_uuid(),company_id uuid,receivable_id uuid,status text,correction_snapshot jsonb);
 create function receivable_month_distance(a date,b date) returns integer language sql as $$select (extract(year from b)::int-extract(year from a)::int)*12+extract(month from b)::int-extract(month from a)::int$$;
 create function finance_private.collection_prepare(p_company uuid,p_receivable uuid) returns uuid language plpgsql security definer set search_path='' as $$declare r public.receivables;v uuid;begin
 select * into r from public.receivables where id=p_receivable and company_id=p_company for update;
 insert into public.finance_collections(company_id,receivable_id,status,correction_snapshot) values(p_company,r.id,'prepared',jsonb_build_object('locked',r.correction_locked)) returning id into v;return v;end$$;
 grant usage on schema public,auth,finance_private to authenticated,service_role;
 insert into companies values('${company}'),('${other}');insert into projects values('${project}','${company}'),('${otherProject}','${other}');insert into auth.users values('${user}');
 insert into correction_indices values('${cub}','${company}','CUB-SC','CUB','index_number','active'),('${ipca}','${company}','IPCA','IPCA','percentage','active'),('${otherIndex}','${other}','CUB-SC','CUB','index_number','active');
 insert into correction_index_values(company_id,correction_index_id,reference_month,value) values('${company}','${cub}','2026-09-01',100),('${company}','${cub}','2026-10-01',110),('${company}','${cub}','2026-11-01',115),('${company}','${ipca}','2026-11-01',1);
 insert into sales(id,company_id,project_id,sale_date) values('${id(10)}','${company}','${project}','2026-09-10');`);
 await db.exec(read('20261014091000_preconstruction_budget_indexation.sql'));
 const legacy=read('20260723_0013_open_receivables_use_latest_cub.sql');
 await db.exec(legacy.slice(legacy.indexOf('create or replace function'),legacy.indexOf('-- Recalcula imediatamente')).replaceAll('now()','public.test_now()'));
 await db.exec(`create trigger receivables_automatic_correction before insert or update on receivables for each row execute function set_receivable_automatic_correction();`);
 await db.exec(read('20261127145736_project_contract_adjustment_policies.sql').replaceAll('now()','public.test_now()'));
 await db.exec(`create trigger correction_values_refresh_receivables after insert or update or delete on correction_index_values for each row execute function refresh_receivables_after_index_change();`);
 const q=(s,p=[])=>db.query(s,p);const val=async(s,p=[])=>(await q(s,p)).rows[0]?.v;
 const role=async r=>db.exec(`reset role;set role ${r}`);
 const clock=async v=>q("select set_config('test.clock',$1,false)",[v]);
 const defaults=(budget=true,installments=true,apply=false,proj=project,idx=cub)=>val('select public.save_project_adjustment($1,$2,$3,$4,$5,$6,$7) v',[company,proj,budget,idx,'2026-09-01',installments,apply]);
 const policy=(extra={})=>({mode:'phased',base_month:'2026-09-01',keys_month:'2026-10-01',start_month:0,pre_index_id:cub,post_index_id:ipca,pre_interval:1,post_interval:1,pre_lag:0,post_lag:0,limit_rule:'current_month',reason:'Condições negociadas no contrato de teste',...extra});
 const save=(sale,pol,apply=false,expected=null)=>val('select public.save_contract_adjustment($1,$2,$3,$4,$5) v',[company,sale,pol,apply,expected]);
 const sale=async(n,source='elos_os')=>{await role('postgres');await q('insert into sales(id,company_id,project_id,sale_date,source_system,created_by) values($1,$2,$3,$4,$5,$6)',[id(n),company,project,'2026-09-10',source,user]);return id(n)};
 const installment=async(n,sale,extra={})=>{await role('postgres');await q('insert into receivables(id,company_id,project_id,sale_id,due_date,amount,source_system,correction_locked,paid_amount,status) values($1,$2,$3,$4,$5,1000,$6,$7,$8,$9)',[id(n),company,project,sale,extra.due??'2026-12-10',extra.source??'elos_os',extra.locked??false,extra.paid??0,extra.status??'open']);return id(n)};
 const row=async n=>(await q('select * from receivables where id=$1',[id(n)])).rows[0];
 let v1,v2;
 await t.test('permissions, cross-company references and read isolation',async()=>{
  await role('authenticated');await defaults();
  await assert.rejects(defaults(true,true,false,otherProject),/Empreendimento inválido/);
  await assert.rejects(defaults(true,true,false,project,otherIndex),/Índice do orçamento inválido/);
  await assert.rejects(q('update project_adjustment_settings set installments_enabled=false'),/permission denied/);
  await assert.rejects(q('select finance_private.contract_phase_factor($1,$2,$3,$4,1,0)',[company,cub,'2026-09-01','2026-11-01']),/permission denied/);
  await q("select set_config('test.company',$1,false)",[other]);assert.equal(Number(await val('select count(*) v from project_adjustment_settings')),0);
  await q("select set_config('test.company',$1,false)",[company]);
  await role('anon');await assert.rejects(defaults(),/permission denied/);
 });
 await t.test('new native records inherit defaults; existing and imported records stay unchanged',async()=>{
  await sale(11);await sale(12,'eobra');await role('postgres');
  assert.equal(await val('select adjustment_policy_id v from sales where id=$1',[id(10)]),null);
  assert.equal(await val('select adjustment_policy_id v from sales where id=$1',[id(12)]),null);
  assert.equal(await val('select mode v from contract_adjustment_versions where sale_id=$1',[id(11)]),'pending');
  await q('insert into engineering_budgets(id,company_id,project_id,reference_date,source_system) values($1,$2,$3,$4,$5)',[id(20),company,project,'2026-10-01','elos_os']);
  assert.equal(await val('select adjustment_enabled v from engineering_budgets where id=$1',[id(20)]),true);
  await role('authenticated');await defaults(false,false);
  await role('postgres');assert.equal(await val('select adjustment_enabled v from engineering_budgets where id=$1',[id(20)]),true);
  assert.equal(await val('select mode v from contract_adjustment_versions where sale_id=$1',[id(11)]),'pending');
  await sale(13);assert.equal(await val('select mode v from contract_adjustment_versions where sale_id=$1',[id(13)]),'none');
  await role('authenticated');assert.equal(await defaults(false,false,true),1);
 });
 await t.test('phases compound at keys without adding incompatible index numbers',async()=>{
  await role('authenticated');v1=await save(id(10),policy());
  await installment(30,id(10));
  const r=await row(30);assert.equal(Number(r.adjusted_amount),1111);assert.equal(Number(r.correction_amount),111);
  assert.equal(r.adjustment_calculation.pre.values.base,100);assert.equal(r.adjustment_calculation.pre.values.target,110);assert.equal(r.adjustment_calculation.post.factor,1.01);
  await q('update receivables set updated_at=now() where id=$1',[id(30)]);assert.equal(Number((await row(30)).adjusted_amount),1111);
  await clock('2026-10-10T12:00Z');await q('update receivables set updated_at=now() where id=$1',[id(30)]);assert.equal(Number((await row(30)).adjusted_amount),1100);
  await clock('2026-11-15T12:00Z');
 });
 await t.test('new contract revision does not rewrite old installments without an explicit request',async()=>{
  await role('authenticated');v2=await save(id(10),policy({mode:'none'}),false,v1.policy_id);
  await role('postgres');assert.equal((await row(30)).adjustment_policy_id,v1.policy_id);
  await installment(31,id(10));assert.equal(Number((await row(31)).adjusted_amount),1000);
  await assert.rejects(q('update sales set adjustment_policy_id=null where id=$1',[id(10)]),/Crie uma revisão/);
  assert.equal(await val('select mode v from contract_adjustment_versions where sale_id=$1',[id(13)]),'none');
  await role('authenticated');await assert.rejects(save(id(10),policy(),false,v1.policy_id),/outra pessoa/);
  await assert.rejects(save(id(10),policy({pre_index_id:otherIndex}),false,v2.policy_id),/Índice inválido/);
  await assert.rejects(save(id(10),policy({keys_month:'2026-08-01'}),false,v2.policy_id),/check constraint/);
 });
 await t.test('explicit review updates eligible rows, preserving paid, partial, locked, imported and issued rows',async()=>{
  await installment(32,id(10),{paid:20});await installment(33,id(10),{locked:true});await installment(34,id(10),{source:'eobra'});await installment(35,id(10),{status:'paid'});await installment(36,id(10));await installment(37,id(10),{status:'cancelled'});
  await q("insert into finance_collections(company_id,receivable_id,status) values($1,$2,'registered')",[company,id(36)]);
  const before=await q('select id,adjustment_policy_id,adjusted_amount from receivables where id=any($1::uuid[])',[[32,33,34,35,36,37].map(id)]);
  await role('authenticated');const result=await save(id(10),policy(),true,v2.policy_id);assert.equal(result.updated_installments,2);
  await role('postgres');const after=await q('select id,adjustment_policy_id,adjusted_amount from receivables where id=any($1::uuid[])',[[32,33,34,35,36,37].map(id)]);assert.deepEqual(after.rows,before.rows);
  assert.equal(Number((await row(30)).adjusted_amount),1111);
 });
 await t.test('missing month blocks bank preparation; publication resolves it and snapshot preserves phases',async()=>{
  await clock('2026-12-02T12:00Z');await installment(40,id(10));
  assert.equal((await row(40)).adjustment_calculation.ready,false);
  await assert.rejects(q('select finance_private.collection_prepare($1,$2)',[company,id(40)]),/Reajuste contratual pendente/);
  await q('insert into correction_index_values(company_id,correction_index_id,reference_month,value) values($1,$2,$3,2)',[company,ipca,'2026-12-01']);
  assert.equal(Number((await row(40)).adjusted_amount),1133.22);
  const charge=await val('select finance_private.collection_prepare($1,$2) v',[company,id(40)]);
  assert.ok(await val("select correction_snapshot->'contract_calculation'->>'policy_id' v from finance_collections where id=$1",[charge]));
  await q('update correction_index_values set value=3 where company_id=$1 and correction_index_id=$2 and reference_month=$3',[company,ipca,'2026-12-01']);
  assert.equal(Number((await row(40)).adjusted_amount),1133.22);
 });
 await t.test('annual interval, publication lag and due-month cap are independent choices',async()=>{
  await clock('2026-11-15T12:00Z');
  const current=await val('select adjustment_policy_id v from sales where id=$1',[id(10)]);
  await role('authenticated');const annual=await save(id(10),policy({keys_month:'2027-12-01',pre_interval:12}),false,current);
  await installment(50,id(10));assert.equal(Number((await row(50)).adjusted_amount),1000);
  await role('authenticated');const lag=await save(id(10),policy({base_month:'2026-10-01',keys_month:'2027-12-01',pre_lag:1}),false,annual.policy_id);
  await installment(51,id(10));assert.equal(Number((await row(51)).adjusted_amount),1100);
  await role('authenticated');await save(id(10),policy({keys_month:'2027-12-01',limit_rule:'due_month'}),false,lag.policy_id);
  await installment(52,id(10),{due:'2026-10-10'});assert.equal(Number((await row(52)).adjusted_amount),1100);
 });
 await t.test('no adjustment after keys keeps the accrued pre-keys value, with separate charges',async()=>{
  await role('postgres');const current=await val('select adjustment_policy_id v from sales where id=$1',[id(10)]);
  await role('authenticated');await save(id(10),policy({post_index_id:null}),false,current);
  await installment(60,id(10));assert.equal(Number((await row(60)).adjusted_amount),1100);
  await q('update receivables set installment_interest_amount=25,late_fee_amount=10,other_accrual_amount=5,discount_amount=2 where id=$1',[id(60)]);
  assert.equal(Number((await row(60)).adjusted_amount),1138);assert.equal(Number((await row(60)).correction_amount),100);
  await assert.rejects(q('update receivables set adjustment_policy_id=null where id=$1',[id(60)]),/regra/i);
 });
 await t.test('budget requires exact publications and complete percentage series',async()=>{
  await role('postgres');
  assert.equal(Number(await val('select engineering_correction_factor($1,$2,$3,$4,null) v',[company,cub,'2026-09-01','2026-11-01'])),1.15);
  assert.equal(await val('select engineering_correction_factor($1,$2,$3,$4,null) v',[company,cub,'2026-09-01','2026-12-01']),null);
  assert.equal(await val('select engineering_correction_factor($1,$2,$3,$4,null) v',[company,ipca,'2026-09-01','2026-11-01']),null);
  assert.equal(Number(await val('select engineering_correction_factor($1,$2,$3,$4,null) v',[company,ipca,'2026-10-01','2026-11-01'])),1.01);
 });
 }finally{await db.close()}
});
