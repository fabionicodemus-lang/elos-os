import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../../supabase/migrations/'+p,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('feasibility import is a reviewed, isolated, atomic and idempotent draft',async t=>{
 const db=new PGlite();const [uid,company,other,project,otherProject]=[1,2,3,4,5].map(id);
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table companies(id uuid primary key);create table legal_entities(id uuid primary key,company_id uuid,unique(company_id,id));
 create table projects(id uuid primary key,company_id uuid,name text);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key,bucket_id text,name text);alter table storage.objects enable row level security;
 create function has_company_permission(c uuid,p text) returns boolean language sql stable as $$select auth.uid() is not null and c=nullif(current_setting('test.company',true),'')::uuid and coalesce(current_setting('test.deny',true),'')<>p$$;
 grant usage on schema public,auth,storage to authenticated;
 insert into auth.users values('${uid}');insert into companies values('${company}'),('${other}');insert into projects values('${project}','${company}','Flow teste'),('${otherProject}','${other}','Outra obra');
 select set_config('test.uid','${uid}',false),set_config('test.company','${company}',false);`);
 for(const f of ['20261014062000_commercial_feasibility_studies.sql','20261014062100_commercial_feasibility_integrity.sql','20261014194000_feasibility_managed_assumptions.sql','20261014203000_feasibility_cub_baseline.sql','20261014100000_elos_ia_safe_write.sql','20261127201837_ai_feasibility_review.sql'])await db.exec(read(f));
 await db.exec('set role authenticated');
 const q=(s,p=[])=>db.query(s,p);const val=async(s,p=[])=>(await q(s,p)).rows[0]?.v;
 const prepare=(payload={},proj=project)=>val("insert into ai_action_proposals(company_id,project_id,turn_id,persona,action_type,required_permission,title,payload,preview,created_by) values($1,$2,gen_random_uuid(),'diretoria','commercial_feasibility_import','spoof','Teste',$3,'{}',$4) returning id v",[company,proj,payload,uid]);
 const basic={study:{name:'Viabilidade teste',land_cash_amount:100000},reported:{vgv:10000000,total_cost:8000000},unit_types:[],construction_areas:[]};
 const confirm=(p,data=basic,c=company)=>val('select ai_confirm_feasibility_import($1,$2,$3) v',[c,p,data]);
 let proposal,result;
 await t.test('prepare does not create a study and derives permission; tenant scope checked',async()=>{
  proposal=await prepare(basic);assert.equal(Number(await val('select count(*) v from commercial_feasibility_studies')),0);
  assert.equal(await val('select required_permission v from ai_action_proposals where id=$1',[proposal]),'commercial.incorporation.manage');
  await assert.rejects(prepare({},otherProject),/Empreendimento inválido/);
  await assert.rejects(confirm(proposal,basic,other),/permissão/);
 });
 await t.test('confirmation creates one draft with original and reviewed data, preserving missing values',async()=>{
  result=await confirm(proposal,{...basic,study:{...basic.study,land_cash_amount:120000}});
  const row=(await q('select * from commercial_feasibility_studies where id=$1',[result.study_id])).rows[0];assert.equal(row.status,'draft');assert.equal(row.converted_project_id,null);assert.equal(row.approved_metrics,null);assert.equal(Number(row.land_cash_amount),120000);
  const memory=(await q('select * from commercial_feasibility_imports where study_id=$1',[result.study_id])).rows[0];assert.equal(memory.extracted_payload.study.land_cash_amount,100000);assert.equal(memory.reviewed_payload.study.land_cash_amount,120000);assert.ok(!memory.applied_fields.includes('tax_rate_pct'));
  assert.deepEqual(await confirm(proposal),result);assert.equal(Number(await val('select count(*) v from commercial_feasibility_studies')),1);
  await assert.rejects(q('update commercial_feasibility_studies set status=$1 where id=$2',['converted',result.study_id]),/empreendimento existente/);
 });
 await t.test('complete rows map to module and incomplete rows stay in import memory',async()=>{
  const p=await prepare();const data={...basic,study:{name:'Outro',entry_pct:20},unit_types:[{name:'Tipo',quantity:2,private_area_m2:70,sale_price_m2:10000,barter_units:0},{name:'Sem preço',quantity:1}],construction_areas:[{name:'Lazer',area_m2:200,cost_m2:2500},{name:'Garagem',area_m2:100}]};
  const r=await confirm(p,data);assert.equal(r.unit_types,1);assert.equal(r.construction_areas,1);
  const memory=(await q('select * from commercial_feasibility_imports where study_id=$1',[r.study_id])).rows[0];assert.equal(memory.reviewed_payload.unit_types.length,2);assert.ok(!memory.applied_fields.includes('entry_pct'));
 });
 await t.test('failure rolls back study and rows; retry works',async()=>{
  const p=await prepare();const before=Number(await val('select count(*) v from commercial_feasibility_studies'));
  await assert.rejects(confirm(p,{...basic,unit_types:[{name:'Inválido',quantity:2,private_area_m2:70,sale_price_m2:-10,barter_units:0}]}),/check constraint/);
  assert.equal(Number(await val('select count(*) v from commercial_feasibility_studies')),before);assert.equal(await val('select status v from ai_action_proposals where id=$1',[p]),'pending_review');await confirm(p);
 });
 await t.test('forged fields, stale permission, expired and rejected proposals are blocked',async()=>{
  const p=await prepare();await assert.rejects(confirm(p,{...basic,study:{name:'Fraude',status:'converted'}}),/Campo não permitido/);
  await q("select set_config('test.deny','commercial.incorporation.manage',false)");await assert.rejects(confirm(p),/permissão/);await q("select set_config('test.deny','',false)");
  await db.exec('reset role');await q("update ai_action_proposals set expires_at=now()-interval '1 second' where id=$1",[p]);await db.exec('set role authenticated');await assert.rejects(confirm(p),/expirada/);
  const p2=await prepare();await db.exec('reset role');await q("update ai_action_proposals set status='rejected' where id=$1",[p2]);await db.exec('set role authenticated');await assert.rejects(confirm(p2),/encerrada/);
 });
 await t.test('source history cannot be mutated; other company cannot read it; anonymous cannot confirm',async()=>{
  await assert.rejects(q('delete from commercial_feasibility_imports'),/permission denied/);
  await q("select set_config('test.company',$1,false)",[other]);assert.equal(Number(await val('select count(*) v from commercial_feasibility_imports')),0);await q("select set_config('test.company',$1,false)",[company]);
  await db.exec('reset role;set role anon');await assert.rejects(confirm(proposal),/permission denied/);
 });
 }finally{await db.close()}
});
