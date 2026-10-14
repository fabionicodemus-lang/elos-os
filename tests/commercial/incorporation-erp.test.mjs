import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../../supabase/migrations/20261014043000_commercial_incorporation_erp.sql", import.meta.url), "utf8");
const integrity = readFileSync(new URL("../../supabase/migrations/20261014044000_commercial_incorporation_integrity.sql", import.meta.url), "utf8");
const uid="11111111-1111-4111-8111-111111111111";
const company="22222222-2222-4222-8222-222222222222";
const project="33333333-3333-4333-8333-333333333333";
const client="44444444-4444-4444-8444-444444444444";
const secondClient="44444444-4444-4444-8444-555555555555";
const unit="55555555-5555-4555-8555-555555555555";
const sale="66666666-6666-4666-8666-666666666666";

async function bootstrap(db){
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create table public.companies(id uuid primary key);
    create table public.projects(id uuid primary key,company_id uuid not null,status text default 'active');
    create table public.permissions(key text primary key,module text,action text,description text);
    create table public.roles(id uuid primary key default gen_random_uuid(),key text unique);
    create table public.role_permissions(role_id uuid,permission_key text,allowed boolean default true,primary key(role_id,permission_key));
    create table public.correction_indices(id uuid primary key default gen_random_uuid(),company_id uuid,code text,name text,status text default 'active');
    create table public.clients(id uuid primary key,company_id uuid not null,name text,tax_id text,status text default 'active');
    create table public.units(id uuid primary key,company_id uuid not null,project_id uuid not null,code text,list_price numeric,status text default 'available',updated_at timestamptz default now());
    create table public.sales(id uuid primary key,company_id uuid not null,project_id uuid not null,unit_id uuid not null,client_id uuid not null,number text,contract_number text,sale_date date,total_amount numeric,status text default 'active',created_by uuid,updated_at timestamptz default now());
    create table public.receivables(id uuid primary key default gen_random_uuid(),company_id uuid not null,project_id uuid not null,sale_id uuid not null,client_id uuid,unit_id uuid,description text,due_date date,amount numeric,adjusted_amount numeric,paid_amount numeric,status text default 'open',notes text,updated_at timestamptz default now());
    create table public.payables(id uuid primary key default gen_random_uuid(),company_id uuid not null,project_id uuid not null,supplier_id uuid,beneficiary_name text,beneficiary_tax_id text,document text,fiscal_class text,payment_method text,due_date date not null,amount numeric,status text default 'open',installment_label text,notes text,origin text default 'manual',source_category text,source_system text,source_id text,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now(),unique(company_id,source_system,source_id));
    create table public.commercial_sale_commissions(id uuid primary key default gen_random_uuid(),company_id uuid not null,project_id uuid not null,sale_id uuid not null,status text,notes text,updated_at timestamptz default now());
    create function public.has_company_permission(target_company_id uuid,target_permission text) returns boolean language sql stable as $$select auth.uid() is not null and target_company_id=nullif(current_setting('test.company',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated;

    insert into auth.users values('${uid}');
    insert into companies values('${company}');
    insert into projects values('${project}','${company}','active');
    insert into clients values
      ('${client}','${company}','Cliente Teste','12345678901','active'),
      ('${secondClient}','${company}','Segundo Cliente','98765432100','active');
    insert into units values('${unit}','${company}','${project}','101',900000,'available',now());
    insert into sales values('${sale}','${company}','${project}','${unit}','${client}','V-001','CT-001','2026-01-10',1000000,'active','${uid}',now());
    insert into receivables(company_id,project_id,sale_id,client_id,unit_id,description,due_date,amount,adjusted_amount,paid_amount,status) values
      ('${company}','${project}','${sale}','${client}','${unit}','Entrada','2026-01-15',100,100,40,'open'),
      ('${company}','${project}','${sale}','${client}','${unit}','Mensal','2026-12-15',200,200,0,'open');
  `);
  await db.exec(migration);
  await db.exec(integrity);
  await db.exec(`
    select set_config('test.uid','${uid}',false),set_config('test.company','${company}',false);
    set role authenticated;
  `);
}

test("ERP de incorporadora: tabela, carteira e distrato preservam invariantes", async(t)=>{
  const db=new PGlite();
  try{
    await bootstrap(db);
    await t.test("venda histórica recebe comprador principal",async()=>{
      const row=(await db.query("select client_id,is_primary,ownership_percent from commercial_sale_parties where sale_id=$1",[sale])).rows[0];
      assert.equal(row.client_id,client); assert.equal(row.is_primary,true); assert.equal(Number(row.ownership_percent),100);
    });
    await t.test("troca de comprador principal atualiza partes e venda na mesma RPC",async()=>{
      await db.query("select commercial_save_sale_party($1,$2,$3,'buyer',100,true,'2026-10-14','Cessão aprovada',$4)",[company,sale,secondClient,uid]);
      const primaries=(await db.query("select client_id from commercial_sale_parties where sale_id=$1 and is_primary and status='active'",[sale])).rows;
      assert.equal(primaries.length,1); assert.equal(primaries[0].client_id,secondClient);
      assert.equal((await db.query("select client_id from sales where id=$1",[sale])).rows[0].client_id,secondClient);
    });
    await t.test("ativar tabela atualiza preço da unidade",async()=>{
      const table=(await db.query("insert into commercial_price_tables(company_id,project_id,name,version_no,valid_from,status,created_by) values($1,$2,'Tabela 1',1,'2026-10-01','draft',$3) returning id",[company,project,uid])).rows[0].id;
      await db.query("insert into commercial_price_table_items(company_id,project_id,price_table_id,unit_id,list_price,created_by) values($1,$2,$3,$4,950000,$5)",[company,project,table,unit,uid]);
      await db.query("select commercial_activate_price_table($1,$2,$3)",[company,table,uid]);
      assert.equal(Number((await db.query("select list_price from units where id=$1",[unit])).rows[0].list_price),950000);
      assert.equal((await db.query("select status from commercial_price_tables where id=$1",[table])).rows[0].status,"active");
    });
    await t.test("resumo separa recebido, aberto e vencido",async()=>{
      const s=(await db.query("select commercial_incorporation_summary($1,$2) s",[company,project])).rows[0].s;
      assert.equal(Number(s.active_sales),1); assert.equal(Number(s.received_amount),40); assert.equal(Number(s.open_amount),260); assert.equal(Number(s.overdue_amount),60); assert.equal(Number(s.overdue_installments),1);
    });
    await t.test("distrato calcula retenção, cancela carteira, libera unidade e gera devolução",async()=>{
      const tid=(await db.query("select commercial_prepare_termination($1,$2,10,'2026-11-10','Desistência contratual',$3) id",[company,sale,uid])).rows[0].id;
      let tr=(await db.query("select paid_amount_snapshot,retention_amount,refund_amount,status from commercial_sale_terminations where id=$1",[tid])).rows[0];
      assert.equal(Number(tr.paid_amount_snapshot),40); assert.equal(Number(tr.retention_amount),4); assert.equal(Number(tr.refund_amount),36); assert.equal(tr.status,"draft");
      const payable=(await db.query("select commercial_execute_termination($1,$2,$3) id",[company,tid,uid])).rows[0].id;
      assert.ok(payable);
      assert.equal((await db.query("select status from sales where id=$1",[sale])).rows[0].status,"cancelled");
      assert.equal((await db.query("select status from units where id=$1",[unit])).rows[0].status,"available");
      assert.equal((await db.query("select count(*)::int n from receivables where sale_id=$1 and status='open'",[sale])).rows[0].n,0);
      const p=(await db.query("select amount,beneficiary_name,status from payables where id=$1",[payable])).rows[0];
      assert.equal(Number(p.amount),36); assert.equal(p.beneficiary_name,"Segundo Cliente"); assert.equal(p.status,"open");
      const again=(await db.query("select commercial_execute_termination($1,$2,$3) id",[company,tid,uid])).rows[0].id;
      assert.equal(again,payable);
    });
  }finally{await db.close();}
});
