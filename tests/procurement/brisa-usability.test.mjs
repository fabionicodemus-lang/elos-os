import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=name=>readFileSync(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8');
const fix=read('20261018234844_brisa_usability_complete.sql');
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tableFiles=['20260724_0015_engineering_services.sql','20260724_0014_engineering_budgets.sql','20260726_0023_engineering_schedule_baseline.sql','20260727_0025_engineering_supply_plan.sql','20260728_0033_execution_material_requests.sql','20260729_0041_procurement_material_quotations.sql','20260729_0042_procurement_purchase_orders.sql','20260729_0043_procurement_material_receipts.sql','20260729_0044_procurement_inventory.sql','20260804_0079_budget_item_compositions.sql'];
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.user',true),'')::uuid $$;
 create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
 create function public.has_company_permission(uuid,text) returns boolean language sql as $$ select auth.uid() is not null and $1='${uid(1)}'::uuid and coalesce(current_setting('test.denied',true),'')<>$2 $$;
 create table public.projects(id uuid primary key,company_id uuid);
 create table public.permissions(key text primary key,module text,action text,description text);
 create table public.roles(id uuid primary key,key text);
 create table public.role_permissions(role_id uuid,permission_key text,allowed boolean,unique(role_id,permission_key));
 create table public.profiles(id uuid primary key,full_name text);
 create table public.company_memberships(company_id uuid,user_id uuid,status text);
 create table public.suppliers(id uuid primary key,company_id uuid,status text,legal_name text,trade_name text);
 create table public.engineering_inputs(id uuid primary key,company_id uuid,status text,code text,description text,unit text);
 select set_config('test.user','${uid(9)}',false);
 `);
 for(const file of tableFiles){
  const source=read(file);
  for(const match of source.matchAll(/create table if not exists public\.\w+\s*\([\s\S]*?\n\);/g)){
   const ddl=match[0].replace(/ references (?:public|auth)\.\w+\(id\)(?: on delete (?:cascade|restrict|set null))?/g,'');
   await db.exec(ddl);
  }
 }
 await db.exec(`alter table engineering_budget_items add column service_id uuid;
 alter table execution_material_request_items add column stock_fulfilled_quantity numeric not null default 0;
 create function public.refresh_procurement_material_quotation(uuid) returns text language sql as $$ select 'draft'::text $$;
 insert into auth.users values('${uid(9)}');insert into profiles values('${uid(9)}','Responsável teste');insert into company_memberships values('${uid(1)}','${uid(9)}','active');
 insert into projects values('${uid(2)}','${uid(1)}');
 `);
 const receipt=read('20260729_0043_procurement_material_receipts.sql');
 await db.exec(receipt.slice(receipt.indexOf('create or replace function public.save_procurement_material_receipt('),receipt.indexOf('create or replace function public.submit_procurement_material_receipt(')));
 await db.exec(fix);
 return db;
}

test('complete usability migration applies twice without damaging existing schemas',async()=>{const db=await setup();try{await db.exec(fix);}finally{await db.close();}});

test('historical quotation requires permission and reason while normal quotation rejects past deadline',async()=>{
 const db=await setup();try{
  const args=`'${uid(1)}','${uid(2)}',null,'Teste','item',current_date-10,current_date-5,null,null,null,'[]'::jsonb,'[]'::jsonb`;
  await assert.rejects(db.exec(`select save_procurement_material_quotation_v2(${args},false,null,null)`),/igual ou posterior/);
  await db.exec(`select set_config('test.denied','procurement.quotations.history',false)`);
  await assert.rejects(db.exec(`select save_procurement_material_quotation_v2(${args},true,current_date-20,'Implantação')`),/Sem permissão para implantação/);
  await db.exec(`select set_config('test.denied','',false)`);
  await assert.rejects(db.exec(`select save_procurement_material_quotation_v2(${args},true,current_date-20,'')`),/justificativa/);
  await assert.rejects(db.exec(`select save_procurement_material_quotation_v2(${args},true,current_date-2,'Implantação')`),/anteceder/);
 }finally{await db.close();}
});

async function insertRow(db, table, values){
 const columns=(await db.query(`select column_name,data_type from information_schema.columns where table_schema='public' and table_name=$1 and is_nullable='NO' and column_default is null and is_generated='NEVER'`,[table])).rows;
 const data={...values};
 for(const column of columns){if(column.column_name in data)continue;data[column.column_name]=column.data_type==='uuid'?uid(90):column.data_type==='date'?'2026-01-01':column.data_type==='boolean'?false:['integer','bigint','numeric'].includes(column.data_type)?1:column.data_type==='jsonb'?{}:'Teste';}
 const names=Object.keys(data);await db.query(`insert into public.${table}(${names.join(',')}) values(${names.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(data));
}

test('historical creation keeps original dates and audit; cannot remove provenance',async()=>{
 const db=await setup();try{
  await db.exec('alter table execution_material_request_items add column cost_center_service_id uuid');
  await insertRow(db,'suppliers',{id:uid(80),company_id:uid(1),status:'active',legal_name:'Teste'});
  await insertRow(db,'execution_material_requests',{id:uid(30),company_id:uid(1),project_id:uid(2),status:'approved'});
  await insertRow(db,'execution_material_request_items',{id:uid(40),company_id:uid(1),project_id:uid(2),request_id:uid(30),requested_quantity:100,ordered_quantity:0,cost_center_service_id:null});
  const result=await db.query(`select save_procurement_material_quotation_v2($1,$2,null,'Histórico','item',current_date-10,current_date-5,null,null,null,$3::jsonb,$4::jsonb,true,current_date-20,'Implantação do legado') id`,[uid(1),uid(2),JSON.stringify([{request_item_id:uid(40),quantity_to_quote:10}]),JSON.stringify([{supplier_id:uid(80)}])]);
  const id=result.rows[0].id;
  assert.equal((await db.query('select is_historical from procurement_material_quotations where id=$1',[id])).rows[0].is_historical,true);
  assert.equal((await db.query("select count(*)::int n from procurement_material_quotation_audit where quotation_id=$1 and action='historical_implementation' and details->>'reason'='Implantação do legado'",[id])).rows[0].n,1);
  await assert.rejects(db.query('update procurement_material_quotations set is_historical=false where id=$1',[id]),/retirar a identificação/);
  await db.exec("select set_config('test.denied','procurement.quotations.history',false)");
  await assert.rejects(db.query("update procurement_material_quotations set title='Alteração indevida' where id=$1",[id]),/Sem permissão/);
 }finally{await db.close();}
});

test('initial supply synchronization uses physical, reserved and consumed stock with generated totals',async()=>{
 const db=await setup();try{
  await insertRow(db,'engineering_schedule_baselines',{id:uid(10),company_id:uid(1),project_id:uid(2)});
  await insertRow(db,'engineering_supply_plan_items',{id:uid(11),company_id:uid(1),project_id:uid(2),baseline_id:uid(10),input_id:uid(70),required_quantity:1000,planned_unit_cost:5,available_stock:0});
  await insertRow(db,'procurement_inventory_balances',{company_id:uid(1),project_id:uid(2),input_id:uid(70),quantity_on_hand:590,reserved_quantity:100});
  await insertRow(db,'procurement_inventory_movements',{company_id:uid(1),project_id:uid(2),input_id:uid(70),movement_type:'issue',from_location_id:uid(90),quantity:400});
  await db.exec(`select refresh_supply_plan_stock('${uid(1)}','${uid(2)}','${uid(10)}')`);
  assert.deepEqual((await db.query('select physical_stock::float8 physical,reserved_stock::float8 reserved,consumed_stock::float8 consumed,available_stock::float8 available,purchase_quantity::float8 purchase,planned_total_cost::float8 total from engineering_supply_plan_items')).rows,[{physical:590,reserved:100,consumed:400,available:490,purchase:10,total:50}]);
  await assert.rejects(db.exec(`select refresh_supply_plan_stock('${uid(99)}','${uid(2)}','${uid(10)}')`),/Sem permissão/);
 }finally{await db.close();}
});

test('discrepancy treatment requires own-company assignee and valid replacement and preserves rejection',async()=>{
 const db=await setup();try{
  for(const [id,sequence_no] of [[uid(31),1],[uid(32),2]]) await insertRow(db,'procurement_material_receipts',{id,sequence_no,receipt_number:`REC-${sequence_no}`,company_id:uid(1),project_id:uid(2),order_id:uid(30),status:'approved'});
  await insertRow(db,'procurement_material_receipt_items',{id:uid(41),receipt_id:uid(31),order_item_id:uid(60),company_id:uid(1),project_id:uid(2),order_id:uid(30),input_id:uid(70),ordered_quantity:5000,delivered_quantity:3000,accepted_quantity:2950,rejected_quantity:50,rejection_reason:'Avaria'});
  await insertRow(db,'procurement_material_receipt_items',{id:uid(42),receipt_id:uid(32),order_item_id:uid(60),company_id:uid(1),project_id:uid(2),order_id:uid(30),input_id:uid(70),ordered_quantity:5000,delivered_quantity:2050,accepted_quantity:2050,rejected_quantity:0});
  await insertRow(db,'procurement_material_receipt_discrepancies',{id:uid(50),company_id:uid(1),project_id:uid(2),receipt_id:uid(31),receipt_item_id:uid(41),discrepancy_type:'damage',description:'50kg avariados'});
  const call=(assignee,replacement,notes)=>db.query('select treat_procurement_receipt_discrepancy($1,$2,$3,$4,$5,$6,$7)',[uid(1),uid(2),uid(50),'resolved',assignee,replacement,notes]);
  await assert.rejects(call(uid(98),uid(32),'Reposição recebida'),/responsável ativo/);
  await assert.rejects(call(uid(9),uid(31),'Reposição recebida'),/outro recebimento/);
  await assert.rejects(call(uid(9),uid(32),''),/Descreva/);
  await call(uid(9),uid(32),'Reposição recebida');
  assert.equal((await db.query('select status from procurement_material_receipt_discrepancies')).rows[0].status,'resolved');
  assert.equal(Number((await db.query('select rejected_quantity from procurement_material_receipt_items where id=$1',[uid(41)])).rows[0].rejected_quantity),50);
  assert.equal((await db.query("select count(*)::int n from procurement_material_receipt_audit where action='discrepancy_treated'")).rows[0].n,1);
  await assert.rejects(call(uid(9),uid(32),'Repetição'),/já foi encerrada/);
 }finally{await db.close();}
});

test('catalog reconciliation refuses cross-unit reuse and preserves approved revisions',async()=>{
 const db=await setup();try{
  await insertRow(db,'engineering_budgets',{id:uid(10),company_id:uid(1),project_id:uid(2),status:'draft'});
  await insertRow(db,'engineering_services',{id:uid(20),company_id:uid(1),code:'01.01',description:'Fundação',unit:'un'});
  await insertRow(db,'engineering_budget_items',{id:uid(30),company_id:uid(1),project_id:uid(2),budget_id:uid(10),description:'Fundação',unit:'m3',service_id:null});
  const call=target=>db.query('select reconcile_engineering_budget_service($1,$2,$3,$4) id',[uid(1),uid(10),uid(30),target]);
  await assert.rejects(call(uid(20)),/incompatível/);
  const id=(await call(null)).rows[0].id;
  assert.notEqual(id,uid(20));
  assert.equal((await db.query('select unit from engineering_services where id=$1',[uid(20)])).rows[0].unit,'un');
  await db.exec(`update engineering_budgets set status='approved' where id='${uid(10)}'`);
  await assert.rejects(call(null),/em elaboração/);
 }finally{await db.close();}
});

test('receipt destination persists registered location id and rejects other-project location',async()=>{
 const db=await setup();try{
  await insertRow(db,'procurement_inventory_locations',{id:uid(10),company_id:uid(1),project_id:uid(2),code:'ALM',name:'Almoxarifado'});
  await insertRow(db,'procurement_inventory_locations',{id:uid(11),company_id:uid(1),project_id:uid(99),code:'ALM-OUTRA',name:'Outra obra'});
  await insertRow(db,'procurement_purchase_orders',{id:uid(30),company_id:uid(1),project_id:uid(2),supplier_id:uid(80),status:'confirmed'});
  await insertRow(db,'procurement_purchase_order_items',{id:uid(40),company_id:uid(1),project_id:uid(2),order_id:uid(30),ordered_quantity:100});
  const details={order_id:uid(30),receipt_date:'2026-10-18',general_condition:'good',delivery_instructions:'Portaria B',notes:'Teste'};
  const items=[{order_item_id:uid(40),delivered_quantity:10,accepted_quantity:10,rejected_quantity:0}];
  const call=location=>db.query('select save_procurement_material_receipt_at_location($1,$2,null,$3,$4::jsonb,$5::jsonb) id',[uid(1),uid(2),location,JSON.stringify(details),JSON.stringify(items)]);
  await assert.rejects(call(uid(11)),/própria obra/);
  const id=(await call(uid(10))).rows[0].id;
  assert.deepEqual((await db.query('select warehouse_location_id,warehouse_location,delivery_instructions from procurement_material_receipts where id=$1',[id])).rows,[{warehouse_location_id:uid(10),warehouse_location:'Almoxarifado',delivery_instructions:'Portaria B'}]);
 }finally{await db.close();}
});
