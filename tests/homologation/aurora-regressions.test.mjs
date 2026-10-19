import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { allocateByWeight, paidTitleAmount } from '../../lib/cost-vs-budget/native-allocation.mjs';
const sql = (name) => readFileSync(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8');
const core=sql('20261018113325_aurora_feasibility_daily_integrity.sql');
const audit=sql('20261018113556_aurora_schedule_progress_audit.sql');
const company='11111111-1111-4111-8111-111111111111', project='22222222-2222-4222-8222-222222222222', uid='33333333-3333-4333-8333-333333333333';
async function base(db) {
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select '${uid}'::uuid$$;create table companies(id uuid primary key);create table projects(id uuid primary key);insert into auth.users values('${uid}');insert into companies values('${company}');insert into projects values('${project}');create function has_company_permission(uuid,text) returns boolean language sql as $$select $1='${company}'::uuid$$;`);
}
async function coreFixture(db) {
 await base(db);
 await db.exec(`create table commercial_feasibility_studies(id uuid primary key default gen_random_uuid(),company_id uuid,created_by uuid,sales_start_offset_months integer default -3,sales_velocity_units_month numeric default 2,unique(company_id,id));`);
 const managed=sql('20261014194000_feasibility_managed_assumptions.sql');
 await db.exec(managed.slice(managed.indexOf('create table if not exists public.commercial_feasibility_sales_velocities'),managed.indexOf('create index if not exists feasibility_sales_velocities_study_idx')));
 const integrity=sql('20261014195500_feasibility_managed_assumptions_integrity.sql');await db.exec(integrity.slice(integrity.indexOf('create or replace function public.commercial_seed'),integrity.indexOf('-- A simulação')));
 await db.exec(`create table execution_daily_logs(id uuid primary key,company_id uuid,project_id uuid,work_start time,work_end time,general_notes text,no_occurrences boolean,no_safety_events boolean,confirmed_by_filler boolean,completion_percent numeric,status text,updated_at timestamptz);create table execution_daily_log_settings(company_id uuid,project_id uuid,required_photo_count integer);create table execution_daily_log_weather(daily_log_id uuid);create table execution_daily_log_workforce(daily_log_id uuid,worker_count integer);create table execution_daily_log_services(daily_log_id uuid);create table execution_daily_log_occurrences(daily_log_id uuid,is_safety_event boolean,occurrence_type text);create table execution_daily_log_photos(daily_log_id uuid);`);
 await db.exec(sql('20261015184500_feasibility_sales_plan.sql'));
}
test('cadeia de fases reproduz falha antiga e migration corretiva cria estudo com inicialização única',async()=>{
 const db=new PGlite();try{
  await coreFixture(db);
  await assert.rejects(()=>db.exec(`insert into commercial_feasibility_studies(company_id,created_by) values('${company}','${uid}')`), /no unique or exclusion/);
  await db.exec(core);
  const [{id}]=(await db.query(`insert into commercial_feasibility_studies(company_id,created_by) values('${company}','${uid}') returning id`)).rows;
  assert.equal((await db.query('select count(*)::int as n from commercial_feasibility_sales_velocities where study_id=$1',[id])).rows[0].n,1);
  await db.query(`insert into commercial_feasibility_sales_velocities(company_id,study_id,name,start_offset_months,units_per_month,phase_key) values($1,$2,'Fase nova',-3,2,'launch')`,[company,id]);
  assert.equal((await db.query('select count(*)::int as n from commercial_feasibility_sales_velocities where study_id=$1',[id])).rows[0].n,2);
 }finally{await db.close();}
});
test('pendências e percentual usam mesma regra; chuva operacional não é acidente',async()=>{
 const db=new PGlite();try{
  await coreFixture(db);await db.exec(core);
  await db.exec(`insert into execution_daily_logs values('${uid}','${company}','${project}','07:00','17:00','Teste',false,true,true,0,'in_progress',now());insert into execution_daily_log_weather values('${uid}');insert into execution_daily_log_workforce values('${uid}',18);insert into execution_daily_log_services values('${uid}');insert into execution_daily_log_occurrences values('${uid}',true,'stoppage');`);
  assert.equal(Number((await db.query('select refresh_execution_daily_log_completion($1) as p',[uid])).rows[0].p),87.5);
  const requirements=(await db.query('select execution_daily_log_requirements($1) as r',[uid])).rows[0].r;
  assert.deepEqual(requirements.filter(x=>!x.complete).map(x=>x.key),['photos']);
  await db.exec(`insert into execution_daily_log_settings values('${company}','${project}',0)`);
  assert.equal(Number((await db.query('select refresh_execution_daily_log_completion($1) as p',[uid])).rows[0].p),100);
  await db.exec(`update execution_daily_logs set company_id='44444444-4444-4444-8444-444444444444'`);
  await assert.rejects(()=>db.query('select execution_daily_log_requirements($1)',[uid]),/sem permissão/);
 }finally{await db.close();}
});
test('rateio reconcilia bruto, líquido, pagamento parcial e centavos por serviço',()=>{
 const items=[{current_amount:153000},{current_amount:27000}];
 assert.deepEqual(allocateByWeight(171000,items),[145350,25650]);
 assert.deepEqual(allocateByWeight(85500,items),[72675,12825]);
 assert.equal(paidTitleAmount({amount:171000,status:'open',paid_amount:85500}),85500);
 assert.equal(paidTitleAmount({amount:171000,status:'paid',paid_amount:null}),171000);
 assert.deepEqual(allocateByWeight(.05,[{current_amount:1},{current_amount:1},{current_amount:1}]),[.02,.02,.01]);
});

test('retificação preserva antes/depois, anulação recalcula tracking e impede acesso a outra obra',async()=>{
 const db=new PGlite();const baseline='44444444-4444-4444-8444-444444444444',activity='55555555-5555-4555-8555-555555555555';
 try{
  await base(db);
  await db.exec(`create table engineering_schedule_baselines(id uuid primary key,company_id uuid,project_id uuid,status text);create table engineering_schedule_activities(id uuid primary key,company_id uuid,project_id uuid,baseline_id uuid,record_status text,planned_start date,planned_finish date);insert into engineering_schedule_baselines values('${baseline}','${company}','${project}','approved');insert into engineering_schedule_activities values('${activity}','${company}','${project}','${baseline}','active','2026-01-01','2026-12-31');`);
  const initial=sql('20260727_0031_execution_schedule_tracking.sql');await db.exec(initial.slice(initial.indexOf('create table if not exists'),initial.indexOf('create index if not exists')));
  await db.exec(audit);
  const record=async(date,progress,notes='Medição de teste')=>db.query('select record_execution_schedule_progress($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[company,project,baseline,activity,date,progress,progress/100,progress*100,1,'2026-01-01','2026-12-31',null,null,notes]);
  await record('2026-02-28',40);await record('2026-06-30',80);await record('2026-01-31',20);
  assert.equal(Number((await db.query('select progress_percent from engineering_schedule_activity_tracking')).rows[0].progress_percent),80,'lançamento retroativo não regride tracking');
  await assert.rejects(()=>record('2026-06-30',85,''),/justificativa/);
  await record('2026-06-30',85,'Retificação: conferência do quantitativo');
  const log=(await db.query("select * from engineering_schedule_progress_audit where action='corrected'")).rows[0];assert.equal(Number(log.previous_value.progress_percent),80);assert.equal(Number(log.new_value.progress_percent),85);
  const id=(await db.query("select id from engineering_schedule_progress_measurements where measurement_date='2026-06-30'")).rows[0].id;
  await assert.rejects(()=>db.query('select void_execution_schedule_progress($1,$2,$3,$4)',[company,baseline,id,'Teste']),/não encontrada/);
  await db.query('select void_execution_schedule_progress($1,$2,$3,$4)',[company,project,id,'Lançado na atividade incorreta']);
  assert.equal(Number((await db.query('select progress_percent from engineering_schedule_activity_tracking')).rows[0].progress_percent),40);
  assert.equal((await db.query('select count(*)::int as n from engineering_schedule_progress_measurements')).rows[0].n,3,'original não é excluído');
  assert.equal((await db.query("select count(*)::int as n from engineering_schedule_progress_audit where action='voided'")).rows[0].n,1);
 }finally{await db.close();}
});

test('carregador real de custos inclui título Elos sem duplicar medição ao gerar ou pagar',async()=>{
 const ts=await import('typescript');
 const moduleUrl=(source)=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
 const compile=(path,replacements={})=>{
  let source=ts.transpileModule(readFileSync(new URL('../../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  for(const [from,to] of Object.entries(replacements))source=source.replaceAll(from,to);
  return moduleUrl(source);
 };
 const pagination=compile('lib/supabase-pagination.ts');
 const native=compile('lib/cost-vs-budget/native-measurement-titles.ts',{'@/lib/supabase-pagination':pagination,'./native-allocation.mjs':new URL('../../lib/cost-vs-budget/native-allocation.mjs',import.meta.url).href});
 const server=await import(compile('lib/cost-vs-budget/server.ts',{'@/lib/supabase-pagination':pagination,'./native-measurement-titles':native}));
 const detail=await import(compile('lib/cost-vs-budget/title-details.ts',{'@/lib/supabase-pagination':pagination,'./native-measurement-titles':native}));
 const data={
  projects:[{id:project,company_id:company,name:'Aurora'}],
  engineering_budgets:[{id:'b',company_id:company,project_id:project,status:'approved',is_base:true}],
  engineering_services:[{id:'s',company_id:company,code:'01.02',description:'Fundações'}],
  engineering_budget_items:[{id:'bi',company_id:company,project_id:project,budget_id:'b',service_id:'s',status:'active',total_direct_cost:600000}],
  execution_contract_measurements:[{id:'m',company_id:company,project_id:project,status:'invoiced',payable_id:'p'}],
  execution_contract_measurement_items:[{id:'mi',company_id:company,project_id:project,measurement_id:'m',service_id:'s',service_code:'01.02',service_name:'Fundações',current_amount:180000}],
  payables:[{id:'p',company_id:company,project_id:project,source_system:'elos_os',amount:171000,paid_amount:0,status:'open',due_date:'2026-03-16',suppliers:{legal_name:'Teste'}}],
 };
 class Query {
  constructor(table){this.rows=[...(data[table]??[])];}
  select(){return this;}order(){return this;}
  eq(k,v){this.rows=this.rows.filter(x=>x[k]===v);return this;}
  neq(k,v){this.rows=this.rows.filter(x=>x[k]!==v);return this;}
  in(k,v){this.rows=this.rows.filter(x=>v.includes(x[k]));return this;}
  not(k,op,v){this.rows=this.rows.filter(x=>x[k]!==v);return this;}
  gt(k,v){this.rows=this.rows.filter(x=>x[k]>v);return this;}
  range(a,b){return Promise.resolve({data:this.rows.slice(a,b+1),error:null});}
  maybeSingle(){return Promise.resolve({data:this.rows[0]??null,error:null});}
 }
 const supabase={from:table=>new Query(table)};
 for(const paid of [0,85500,171000]){
  data.payables[0].paid_amount=paid;data.payables[0].status=paid===171000?'paid':'open';
  const context=await server.loadCostVsBudget({supabase,companyId:company,projectId:project,budgetId:'b'});
  assert.deepEqual(context.errors,[]);assert.equal(context.totals.forecast,180000);assert.equal(context.totals.paid,paid);assert.equal(context.totals.unpaid,180000-paid);
  const details=await detail.loadCostVsBudgetTitles({supabase,companyId:company,projectId:project,budgetId:'b'});
  assert.equal(details.titlesByRow.s.length,1);assert.equal(details.titlesByRow.s[0].paidAllocatedAmount,paid);assert.equal(details.titlesByRow.s[0].openAllocatedAmount,171000-paid);
 }
});
