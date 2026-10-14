import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const stockMigration=readFileSync(new URL("../../supabase/migrations/20261014070000_procurement_request_stock_intelligence.sql",import.meta.url),"utf8");
const approvalMigration=readFileSync(new URL("../../supabase/migrations/20261014071000_procurement_purchase_approval_levels.sql",import.meta.url),"utf8");
const u1="11111111-1111-4111-8111-111111111111",u2="11111111-1111-4111-8111-222222222222",u3="11111111-1111-4111-8111-333333333333";
const company="22222222-2222-4222-8222-222222222222",project="33333333-3333-4333-8333-333333333333";
const input="44444444-4444-4444-8444-444444444444",service="55555555-5555-4555-8555-555555555555",location="66666666-6666-4666-8666-666666666666";
const request="77777777-7777-4777-8777-777777777777",requestItem="88888888-8888-4888-8888-888888888888",balance="99999999-9999-4999-8999-999999999999";
const supplier="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function bootstrap(db){
 await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
  create table public.companies(id uuid primary key);
  create table public.projects(id uuid primary key,company_id uuid not null);
  create table public.permissions(key text primary key,module text,action text,description text);
  create table public.roles(id uuid primary key default gen_random_uuid(),key text unique);
  create table public.role_permissions(role_id uuid,permission_key text,allowed boolean default true,primary key(role_id,permission_key));
  create function public.has_company_permission(target_company_id uuid,target_permission text) returns boolean language sql stable as $$select auth.uid() is not null and target_company_id=nullif(current_setting('test.company',true),'')::uuid$$;

  create table public.engineering_inputs(id uuid primary key,company_id uuid not null,status text default 'active');
  create table public.engineering_services(id uuid primary key,company_id uuid not null);
  create table public.engineering_supply_plan_items(id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,input_id uuid,available_stock numeric default 0,purchase_quantity numeric default 0,required_quantity numeric default 0,planned_unit_cost numeric default 0,planned_total_cost numeric default 0,record_status text default 'active');
  create table public.procurement_inventory_locations(id uuid primary key,company_id uuid,project_id uuid,name text);
  create table public.procurement_inventory_movements(id uuid primary key default gen_random_uuid());
  create table public.procurement_inventory_balances(
    id uuid primary key,company_id uuid not null,project_id uuid not null,input_id uuid not null,location_id uuid not null,
    input_code text,input_name text,unit_snapshot text,batch_number text default '',expiration_date date default '9999-12-31',
    quantity_on_hand numeric not null default 0,reserved_quantity numeric not null default 0,
    available_quantity numeric generated always as(quantity_on_hand-reserved_quantity) stored,
    average_unit_cost numeric not null default 0,total_value numeric not null default 0,updated_at timestamptz default now()
  );
  create table public.procurement_inventory_reservations(
    id uuid primary key default gen_random_uuid(),company_id uuid not null,project_id uuid not null,balance_id uuid not null,input_id uuid not null,location_id uuid not null,
    service_id uuid,supply_plan_item_id uuid,quantity numeric not null,required_date date,status text not null default 'active',notes text,
    created_by uuid,created_at timestamptz default now(),updated_by uuid,updated_at timestamptz default now(),released_by uuid,released_at timestamptz,consumed_movement_id uuid
  );
  create function public.sync_supply_plan_inventory_for_input(p_project_id uuid,p_input_id uuid) returns void language plpgsql security definer as $$begin return; end$$;
  create function public.post_procurement_inventory_movement(
    p_company_id uuid,p_project_id uuid,p_movement_type text,p_movement_date date,p_input_id uuid,p_from_location_id uuid,p_to_location_id uuid,
    p_quantity numeric,p_unit_cost numeric,p_batch_number text,p_expiration_date date,p_cost_center_service_id uuid,p_recipient_name text,
    p_source_type text,p_source_id uuid,p_source_reference text,p_notes text
  ) returns uuid language sql security definer as $$select gen_random_uuid()$$;

  create table public.execution_material_requests(
    id uuid primary key,company_id uuid not null,project_id uuid not null,budget_id uuid,request_number text,status text not null default 'requested',needed_date date,
    approved_at timestamptz,approved_by uuid,cancellation_reason text,cancelled_by uuid,cancelled_at timestamptz,updated_by uuid,updated_at timestamptz default now()
  );
  create table public.execution_material_request_items(
    id uuid primary key,company_id uuid not null,project_id uuid not null,request_id uuid not null,input_id uuid not null,input_code text,input_name text,unit_snapshot text,
    category_snapshot text,cost_center_service_id uuid,cost_center_code text,cost_center_name text,requested_quantity numeric not null,ordered_quantity numeric not null default 0,
    notes text,sort_order integer default 0,updated_at timestamptz default now(),constraint execution_material_request_item_quantity_check check(requested_quantity>0 and ordered_quantity>=0 and ordered_quantity<=requested_quantity)
  );

  create table public.procurement_integrated_supply_control(company_id uuid,project_id uuid,input_id uuid,supply_plan_item_id uuid);
  create table public.suppliers(id uuid primary key,company_id uuid,status text,trade_name text,legal_name text);
  create table public.procurement_material_quotations(
    id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,sequence_no integer,quotation_number text,title text,award_mode text,response_deadline date,desired_delivery_date date,
    payment_terms text,delivery_address text,notes text,status text default 'draft',created_by uuid,updated_by uuid,updated_at timestamptz default now()
  );
  create table public.procurement_material_quotation_requests(company_id uuid,project_id uuid,quotation_id uuid,request_id uuid,request_number text,needed_date date,unique(quotation_id,request_id));
  create table public.procurement_material_quotation_items(
    id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,quotation_id uuid,request_id uuid,request_item_id uuid,input_id uuid,cost_center_service_id uuid,request_number text,input_code text,input_name text,
    unit_snapshot text,category_snapshot text,cost_center_code text,cost_center_name text,requested_quantity numeric,previously_ordered_quantity numeric,quantity_to_quote numeric,notes text,sort_order integer,
    best_delivered_unit_cost numeric,best_total_cost numeric
  );
  create table public.procurement_material_quotation_suppliers(
    id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,quotation_id uuid,supplier_id uuid,supplier_name text,contact_name text,contact_email text,contact_phone text,notes text,status text default 'invited',sent_at timestamptz,updated_at timestamptz default now(),unique(quotation_id,supplier_id)
  );
  create table public.procurement_material_quotation_audit(id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,quotation_id uuid,action text,previous_status text,new_status text,reason text,details jsonb default '{}'::jsonb,changed_by uuid,changed_at timestamptz default now());
  create function public.refresh_procurement_material_quotation(p_quotation_id uuid) returns void language plpgsql security definer as $$begin return; end$$;

  create table public.procurement_purchase_orders(
    id uuid primary key default gen_random_uuid(),company_id uuid not null,project_id uuid not null,quotation_id uuid,supplier_id uuid,order_number text,status text not null default 'draft',
    expected_delivery_date date,delivery_address text,total_amount numeric not null default 0,issue_date date,issued_by uuid,issued_at timestamptz,created_by uuid,updated_by uuid,updated_at timestamptz default now()
  );
  create table public.procurement_purchase_order_items(
    id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,order_id uuid,request_id uuid,request_item_id uuid,input_code text,input_name text,ordered_quantity numeric,received_quantity numeric default 0,
    cancelled_quantity numeric default 0,sort_order integer default 0,updated_at timestamptz default now()
  );
  create table public.procurement_purchase_order_audit(id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,order_id uuid,action text,previous_status text,new_status text,reason text,details jsonb default '{}'::jsonb,changed_by uuid,changed_at timestamptz default now());

  insert into auth.users values('${u1}'),('${u2}'),('${u3}');
  insert into companies values('${company}');insert into projects values('${project}','${company}');
  insert into engineering_inputs values('${input}','${company}','active');insert into engineering_services values('${service}','${company}');
  insert into procurement_inventory_locations values('${location}','${company}','${project}','Almoxarifado');
  insert into procurement_inventory_balances(id,company_id,project_id,input_id,location_id,input_code,input_name,unit_snapshot,quantity_on_hand,reserved_quantity,average_unit_cost,total_value) values('${balance}','${company}','${project}','${input}','MAT-1','Material 1','un',10,0,5,50);
  insert into execution_material_requests(id,company_id,project_id,request_number,status,needed_date,approved_at) values('${request}','${company}','${project}','SM-0001','approved','2026-11-01',now());
  insert into execution_material_request_items(id,company_id,project_id,request_id,input_id,input_code,input_name,unit_snapshot,category_snapshot,cost_center_service_id,cost_center_code,cost_center_name,requested_quantity,ordered_quantity) values('${requestItem}','${company}','${project}','${request}','${input}','MAT-1','Material 1','un','material','${service}','01.01','Serviço',10,0);
  insert into procurement_integrated_supply_control values('${company}','${project}','${input}',null);
  insert into suppliers values('${supplier}','${company}','active','Fornecedor A','Fornecedor A Ltda');
  select set_config('test.uid','${u1}',false),set_config('test.company','${company}',false);
 `);
 await db.exec(stockMigration);
 await db.exec(approvalMigration);
 await db.exec(`grant usage on schema public,auth to authenticated; grant select on all tables in schema public to authenticated; set role authenticated;`);
}

test("Suprimentos 9.5 preserva saldo da solicitação e governança",async(t)=>{
 const db=new PGlite();
 try{
  await bootstrap(db);
  await t.test("estoque atende parte da solicitação e reserva saldo físico",async()=>{
    const reservation=(await db.query("select fulfill_execution_material_request_from_stock($1,$2,$3,$4,4,'uso na frente') id",[company,project,requestItem,balance])).rows[0].id;
    assert.ok(reservation);
    const item=(await db.query("select ordered_quantity,stock_fulfilled_quantity from execution_material_request_items where id=$1",[requestItem])).rows[0];
    assert.equal(Number(item.stock_fulfilled_quantity),4);assert.equal(Number(item.ordered_quantity),0);
    assert.equal((await db.query("select status from execution_material_requests where id=$1",[request])).rows[0].status,"partially_ordered");
    assert.equal(Number((await db.query("select reserved_quantity from procurement_inventory_balances where id=$1",[balance])).rows[0].reserved_quantity),4);
    await assert.rejects(()=>db.query("select fulfill_execution_material_request_from_stock($1,$2,$3,$4,7,null)",[company,project,requestItem,balance]),/superior ao saldo/i);
    await db.query("select change_procurement_inventory_reservation($1,$2,$3,'release','mudança de plano')",[company,project,reservation]);
    assert.equal(Number((await db.query("select stock_fulfilled_quantity from execution_material_request_items where id=$1",[requestItem])).rows[0].stock_fulfilled_quantity),0);
    assert.equal((await db.query("select status from execution_material_requests where id=$1",[request])).rows[0].status,"approved");
  });

  await t.test("cotação não ultrapassa saldo após estoque reservado",async()=>{
    await db.query("select fulfill_execution_material_request_from_stock($1,$2,$3,$4,4,null)",[company,project,requestItem,balance]);
    await assert.rejects(()=>db.query(`select save_procurement_material_quotation($1,$2,null,'Cotação','item','2026-10-20','2026-11-01',null,null,null,$3::jsonb,$4::jsonb)`,[company,project,JSON.stringify([{request_item_id:requestItem,quantity_to_quote:7}]),JSON.stringify([{supplier_id:supplier}])]),/ultrapassa o saldo pendente/i);
    const quote=(await db.query(`select save_procurement_material_quotation($1,$2,null,'Cotação','item','2026-10-20','2026-11-01',null,null,null,$3::jsonb,$4::jsonb) id`,[company,project,JSON.stringify([{request_item_id:requestItem,quantity_to_quote:6}]),JSON.stringify([{supplier_id:supplier}])])).rows[0].id;
    assert.ok(quote);
  });

  await t.test("pedido também bloqueia compra acima do saldo da solicitação",async()=>{
    const order=(await db.query("insert into procurement_purchase_orders(company_id,project_id,supplier_id,order_number,total_amount,expected_delivery_date,delivery_address,created_by) values($1,$2,$3,'PC-1',70,'2026-11-01','Obra',$4) returning id",[company,project,supplier,u1])).rows[0].id;
    await db.query("insert into procurement_purchase_order_items(company_id,project_id,order_id,request_id,request_item_id,input_code,input_name,ordered_quantity,sort_order) values($1,$2,$3,$4,$5,'MAT-1','Material 1',7,1)",[company,project,order,request,requestItem]);
    await assert.rejects(()=>db.query("select issue_procurement_purchase_order($1,$2,$3)",[company,project,order]),/ultrapassa o saldo solicitado/i);
  });

  await t.test("alçadas exigem aprovadores distintos e bloqueiam emissão antes da aprovação",async()=>{
    await db.query("select save_procurement_purchase_approval_settings($1,true,5000,40000,true,true)",[company]);
    const order=(await db.query("insert into procurement_purchase_orders(company_id,project_id,supplier_id,order_number,total_amount,expected_delivery_date,delivery_address,created_by) values($1,$2,$3,'PC-2',10000,'2026-11-01','Obra',$4) returning id",[company,project,supplier,u1])).rows[0].id;
    await db.query("insert into procurement_purchase_order_items(company_id,project_id,order_id,request_id,request_item_id,input_code,input_name,ordered_quantity,sort_order) values($1,$2,$3,$4,$5,'MAT-1','Material 1',1,1)",[company,project,order,request,requestItem]);
    await assert.rejects(()=>db.query("select issue_procurement_purchase_order($1,$2,$3)",[company,project,order]),/alçadas de aprovação/i);
    await db.query("select submit_procurement_purchase_order_for_approval($1,$2,$3)",[company,project,order]);
    let row=(await db.query("select approval_status,required_approval_level,current_approval_level from procurement_purchase_orders where id=$1",[order])).rows[0];
    assert.equal(row.approval_status,"pending");assert.equal(row.required_approval_level,2);
    await assert.rejects(()=>db.query("select approve_procurement_purchase_order_level($1,$2,$3,null)",[company,project,order]),/criador do pedido/i);
    await db.query("select set_config('test.uid',$1,false)",[u2]);
    await db.query("select approve_procurement_purchase_order_level($1,$2,$3,'1a alçada')",[company,project,order]);
    await assert.rejects(()=>db.query("select approve_procurement_purchase_order_level($1,$2,$3,'2a alçada')",[company,project,order]),/aprovadores diferentes/i);
    await db.query("select set_config('test.uid',$1,false)",[u3]);
    await db.query("select approve_procurement_purchase_order_level($1,$2,$3,'2a alçada')",[company,project,order]);
    row=(await db.query("select approval_status,current_approval_level from procurement_purchase_orders where id=$1",[order])).rows[0];
    assert.equal(row.approval_status,"approved");assert.equal(row.current_approval_level,2);
  });
 }finally{await db.close();}
});
