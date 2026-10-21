import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const migration=readFileSync(new URL('../../supabase/migrations/20261021173852_schedule_cer_ppo_linked_dates.sql',import.meta.url),'utf8');
const tracking=readFileSync(new URL('../../supabase/migrations/20260727_0031_execution_schedule_tracking.sql',import.meta.url),'utf8').split('insert into public.permissions')[0].replace('begin;','');
const audit=readFileSync(new URL('../../supabase/migrations/20261018113556_aurora_schedule_progress_audit.sql',import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const company=id(1),project=id(2),baseline=id(3),location=id(4),user=id(5),mat=id(6),labor=id(7),otherCompany=id(8),otherProject=id(9),otherBase=id(10);
async function setup({apply=true,flow=false}={}){
 const db=new PGlite();
 await db.exec(`
 create role authenticated; create role anon; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function public.has_company_permission(uuid,text) returns boolean language sql stable as $$select $1=nullif(current_setting('test.company',true),'')::uuid$$;
 create table public.companies(id uuid primary key,name text);
 create table public.projects(id uuid primary key,company_id uuid references companies(id),code text,name text);
 create table public.engineering_schedule_baselines(id uuid primary key,company_id uuid references companies(id),project_id uuid references projects(id),status text);
 create table public.engineering_schedule_activities(id uuid primary key,company_id uuid references companies(id),project_id uuid references projects(id),baseline_id uuid references engineering_schedule_baselines(id),location_id uuid,code text,name text,record_status text default 'active',planned_start date,planned_finish date,duration_days int default 5,planned_cost numeric default 100,quantity_snapshot numeric default 20,created_at timestamptz default now(),updated_at timestamptz default now(),unique(baseline_id,code));
 insert into auth.users values('${user}');
 insert into companies values('${company}','${flow?'Bossa Empreendimentos':'Fixture'}'),('${otherCompany}','Other');
 insert into projects values('${project}','${company}','${flow?'FLOW-AP':'TEST'}','Flow Test'),('${otherProject}','${otherCompany}','OTHER','Other');
 insert into engineering_schedule_baselines values('${baseline}','${company}','${project}','approved'),('${otherBase}','${otherCompany}','${otherProject}','approved');
 insert into engineering_schedule_activities(id,company_id,project_id,baseline_id,location_id,code,name,planned_start,planned_finish,planned_cost)
 values('${mat}','${company}','${project}','${baseline}','${location}','PPO-6','Porcelanato','2026-08-24','2026-09-11',500),
 ('${labor}','${company}','${project}','${baseline}','${location}','MO-PPO-6','M.O. Porcelanato','2026-08-24','2026-09-11',350),
 ('${id(11)}','${otherCompany}','${otherProject}','${otherBase}','${location}','PPO-6','Other','2026-08-24','2026-09-11',900),
 ('${id(12)}','${otherCompany}','${otherProject}','${otherBase}','${location}','MO-PPO-6','Other MO','2026-08-24','2026-09-11',800);
 select set_config('test.uid','${user}',false),set_config('test.company','${company}',false);
 `);
 await db.exec(tracking);await db.exec(audit);
 if(apply)await db.exec(migration);
 await db.exec(`grant usage on schema public,auth to authenticated;grant select,insert,update on all tables in schema public to authenticated;
 alter table engineering_schedule_activities enable row level security;
 alter table engineering_schedule_progress_measurements enable row level security;
 alter table engineering_schedule_activity_tracking enable row level security;
 create policy scoped_a on engineering_schedule_activities to authenticated using(company_id=nullif(current_setting('test.company',true),'')::uuid) with check(company_id=nullif(current_setting('test.company',true),'')::uuid);
 create policy scoped_m on engineering_schedule_progress_measurements to authenticated using(company_id=nullif(current_setting('test.company',true),'')::uuid) with check(company_id=nullif(current_setting('test.company',true),'')::uuid);
 create policy scoped_t on engineering_schedule_activity_tracking to authenticated using(company_id=nullif(current_setting('test.company',true),'')::uuid) with check(company_id=nullif(current_setting('test.company',true),'')::uuid);`);
 return db;
}
async function measure(db,activity,date,start,finish,{percent=0,cost=0,quantity=0}={}){
 await db.query(`insert into engineering_schedule_progress_measurements(company_id,project_id,baseline_id,activity_id,measurement_date,progress_percent,actual_quantity,actual_cost,current_start,current_finish,notes)values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'test measurement')`,[company,project,baseline,activity,date,percent,quantity,cost,start,finish]);
}
async function current(db,activity){return(await db.query(`select current_start::text,current_finish::text,progress_percent::float,actual_quantity::float,actual_cost::float from engineering_schedule_activity_tracking where activity_id=$1`,[activity])).rows[0];}
async function equalDates(db){const a=await current(db,mat),b=await current(db,labor);assert.equal(a.current_start,b.current_start);assert.equal(a.current_finish,b.current_finish);}

test('material replan creates a labor date snapshot with its own amounts and audit',async()=>{
 const db=await setup();try{
 await db.exec('set role authenticated');
 await measure(db,labor,'2026-08-31','2026-08-24','2026-09-11',{percent:40,cost:70,quantity:8});
 await measure(db,mat,'2026-10-06','2026-10-06','2026-10-26',{percent:1,cost:150,quantity:.2});
 await equalDates(db);const mo=await current(db,labor);
 assert.equal(mo.actual_cost,70);assert.equal(mo.progress_percent,40);assert.equal(mo.actual_quantity,8);
 const rows=(await db.query(`select count(*)::int n from engineering_schedule_progress_audit where new_value->>'notes' like 'DATAS_VINCULADAS%'`)).rows;
 assert.equal(rows[0].n,1);
 }finally{await db.close();}
});
test('editing labor reprograms material too without copying labor cost',async()=>{
 const db=await setup();try{
 await measure(db,mat,'2026-10-06','2026-10-06','2026-10-26',{cost:200});
 await measure(db,labor,'2026-10-21','2026-11-02','2026-11-20',{cost:80});
 await equalDates(db);assert.equal((await current(db,mat)).actual_cost,200);
 }finally{await db.close();}
});
test('retification on the same day preserves existing peer progress and quantities',async()=>{
 const db=await setup();try{
 await measure(db,labor,'2026-10-06','2026-08-24','2026-09-11',{percent:25,cost:37,quantity:5});
 await measure(db,mat,'2026-10-06','2026-10-06','2026-10-26',{percent:50,cost:150,quantity:10});
 await equalDates(db);assert.equal((await current(db,labor)).actual_cost,37);
 assert.equal((await current(db,labor)).progress_percent,25);
 }finally{await db.close();}
});
test('backdated imports do not overwrite later replans',async()=>{
 const db=await setup();try{
 await measure(db,mat,'2026-10-21','2026-11-02','2026-11-20');
 await measure(db,mat,'2026-09-30','2026-09-28','2026-10-16');
 await equalDates(db);assert.equal((await current(db,labor)).current_start,'2026-11-02');
 }finally{await db.close();}
});
test('void replan restores dates on both components without restoring the voided replan',async()=>{
 const db=await setup();try{
 await measure(db,mat,'2026-10-06','2026-10-06','2026-10-26');
 await measure(db,mat,'2026-10-21','2026-11-02','2026-11-20');
 await db.query(`update engineering_schedule_progress_measurements set voided_at=now(),void_reason='test void' where activity_id=$1 and measurement_date='2026-10-21'`,[mat]);
 await equalDates(db);assert.equal((await current(db,labor)).current_start,'2026-10-06');
 }finally{await db.close();}
});
test('voided companion snapshot is never silently resurrected',async()=>{
 const db=await setup();try{
 await measure(db,labor,'2026-10-06','2026-08-24','2026-09-11');
 await db.query(`update engineering_schedule_progress_measurements set voided_at=now(),void_reason='test void' where activity_id=$1`,[labor]);
 await assert.rejects(measure(db,mat,'2026-10-06','2026-11-02','2026-11-20'),/está anulada/);
 assert.equal((await db.query(`select count(*)::int n from engineering_schedule_progress_measurements where activity_id=$1`,[mat])).rows[0].n,0);
 }finally{await db.close();}
});
test('baseline editor moves both dates and durations but never budget amounts',async()=>{
 const db=await setup();try{
 await db.exec('set role authenticated');
 await db.query(`update engineering_schedule_activities set planned_start='2026-11-02',planned_finish='2026-11-27',duration_days=20 where id=$1`,[labor]);
 const rows=(await db.query(`select planned_start::text,planned_finish::text,duration_days,planned_cost::float from engineering_schedule_activities order by code`)).rows;
 assert.equal(rows.length,2);assert.equal(rows[0].planned_start,rows[1].planned_start);assert.equal(rows[0].duration_days,20);assert.equal(rows[1].duration_days,20);
 assert.deepEqual(rows.map(r=>r.planned_cost).sort((a,b)=>a-b),[350,500]);
 }finally{await db.close();}
});
test('cross-company identical codes and unpaired activities are not touched',async()=>{
 const db=await setup();try{
 await db.exec('set role authenticated');
 await measure(db,mat,'2026-10-06','2026-10-06','2026-10-26');
 await db.exec('reset role');
 assert.equal((await db.query(`select count(*)::int n from engineering_schedule_progress_measurements where company_id=$1`,[otherCompany])).rows[0].n,0);
 await db.exec(`update engineering_schedule_activities set location_id='${id(90)}' where id='${labor}'`);
 const before=await current(db,labor);
 await measure(db,mat,'2026-10-21','2026-11-02','2026-11-20');
 assert.deepEqual(await current(db,labor),before);
 }finally{await db.close();}
});
test('Flow backfill preserves history, baseline and own money; rerun is idempotent',async()=>{
 const db=await setup({apply:false,flow:true});try{
 await measure(db,labor,'2026-08-31','2026-08-24','2026-09-11',{percent:40,cost:70,quantity:8});
 await measure(db,mat,'2026-10-06','2026-10-06','2026-10-26',{percent:1,cost:150,quantity:.2});
 const before=(await db.query(`select md5(string_agg(to_jsonb(a)::text,'' order by id)) hash from engineering_schedule_activities a`)).rows[0].hash;
 await db.exec(migration);await equalDates(db);
 assert.equal((await current(db,labor)).actual_cost,70);
 assert.equal((await current(db,labor)).progress_percent,40);
 assert.equal((await db.query(`select count(*)::int n from engineering_schedule_progress_measurements`)).rows[0].n,3);
 await db.exec(migration);
 assert.equal((await db.query(`select count(*)::int n from engineering_schedule_progress_measurements`)).rows[0].n,3);
 assert.equal((await db.query(`select md5(string_agg(to_jsonb(a)::text,'' order by id)) hash from engineering_schedule_activities a`)).rows[0].hash,before);
 assert.equal((await db.query(`select tgenabled from pg_trigger where tgname='execution_progress_audit'`)).rows[0].tgenabled,'O');
 }finally{await db.close();}
});

test('bulk import of both components with different dates converges without duplicate rows',async()=>{
 const db=await setup();try{
 await db.exec('set role authenticated');
 await db.query(`insert into engineering_schedule_progress_measurements(company_id,project_id,baseline_id,activity_id,measurement_date,progress_percent,actual_quantity,actual_cost,current_start,current_finish,notes) values
 ($1,$2,$3,$4,'2026-10-06',10,2,100,'2026-10-06','2026-10-26','bulk source'),
 ($1,$2,$3,$5,'2026-10-06',20,4,50,'2026-08-24','2026-09-11','bulk labor')`,[company,project,baseline,mat,labor]);
 await equalDates(db);
 assert.equal((await current(db,mat)).actual_cost,100);
 assert.equal((await current(db,labor)).actual_cost,50);
 assert.equal((await db.query(`select count(*)::int n from engineering_schedule_progress_measurements`)).rows[0].n,2);
 }finally{await db.close();}
});
test('new labor activity inherits service baseline without copying its budget',async()=>{
 const db=await setup();try{
 await db.exec(`insert into engineering_schedule_activities(id,company_id,project_id,baseline_id,location_id,code,name,planned_start,planned_finish,planned_cost)
 values('${id(30)}','${company}','${project}','${baseline}','${location}','CER-20','Cerâmica','2027-04-20','2027-04-26',700),
 ('${id(31)}','${company}','${project}','${baseline}','${location}','MO-CER-20','M.O. Cerâmica','2026-01-01','2026-01-07',300)`);
 const rows=(await db.query(`select planned_start::text,planned_finish::text,planned_cost::float from engineering_schedule_activities where code in('CER-20','MO-CER-20') order by code`)).rows;
 assert.equal(rows[0].planned_start,rows[1].planned_start);assert.equal(rows[1].planned_start,'2027-04-20');
 assert.deepEqual(rows.map(x=>x.planned_cost),[700,300]);
 }finally{await db.close();}
});
