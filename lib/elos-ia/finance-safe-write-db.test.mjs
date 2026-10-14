import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migrations=[
  "../../supabase/migrations/20261014100000_elos_ia_safe_write.sql",
  "../../supabase/migrations/20261014100100_elos_ia_safe_write_attachment_link.sql",
  "../../supabase/migrations/20261014100200_elos_ia_safe_write_execute.sql",
  "../../supabase/migrations/20261014110000_elos_ia_financeiro.sql",
].map((path)=>readFileSync(new URL(path,import.meta.url),"utf8"));

async function setup(){
  const db=new PGlite();
  const uid="11111111-1111-4111-8111-111111111111",company="22222222-2222-4222-8222-222222222222",project="33333333-3333-4333-8333-333333333333",supplier="44444444-4444-4444-8444-444444444444";
  await db.exec(`
    create role anon; create role authenticated; create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create table companies(id uuid primary key);
    create table projects(id uuid primary key,company_id uuid not null references companies(id));
    create table suppliers(id uuid primary key,company_id uuid not null,status text not null default 'active');
    create table payables(id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,supplier_id uuid,document text,fiscal_class text,payment_method text,due_date date,amount numeric,status text,installment_label text,notes text,origin text,source_system text,source_id text unique,created_by uuid,updated_at timestamptz default now());
    create table finance_tax_obligations(id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,tax_type_id uuid,competence_date date,reference text,due_date date,principal_amount numeric,interest_amount numeric,penalty_amount numeric,other_amount numeric,discount_amount numeric,document_number text,payment_code text,barcode text,notes text,status text,payable_id uuid,created_by uuid,updated_at timestamptz);
    create table correction_index_values(id uuid primary key default gen_random_uuid(),company_id uuid,correction_index_id uuid,reference_month date,value numeric,notes text,created_by uuid,updated_at timestamptz,unique(company_id,correction_index_id,reference_month));
    create function has_company_permission(target_company_id uuid,target_permission text) returns boolean language sql stable as $$select target_company_id=nullif(current_setting('test.company',true),'')::uuid and coalesce(nullif(current_setting('test.allowed',true),''),'true')='true'$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
    grant usage on schema public,auth,storage to authenticated;
    insert into auth.users values('${uid}'); insert into companies values('${company}'); insert into projects values('${project}','${company}'); insert into suppliers values('${supplier}','${company}','active');
    create function save_procurement_material_supplier_offer(uuid,uuid,uuid,uuid,text,date,date,text,integer,text,text,text,jsonb) returns uuid language sql as $$select gen_random_uuid()$$;
    create function save_execution_contract_measurement(uuid,uuid,uuid,uuid,date,date,numeric,numeric,numeric,text,text,jsonb,boolean) returns uuid language sql as $$select gen_random_uuid()$$;
    create function pay_finance_payable(uuid,uuid,uuid,uuid,date,numeric) returns uuid language sql as $$select gen_random_uuid()$$;
    create function receive_finance_receivable(uuid,uuid,uuid,uuid,date,numeric) returns uuid language sql as $$select gen_random_uuid()$$;
    create function save_and_post_finance_manual_invoice(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,date,date,text,jsonb,jsonb,jsonb) returns uuid language sql as $$select gen_random_uuid()$$;
    create function finance_generate_tax_payable(uuid) returns uuid language sql as $$select gen_random_uuid()$$;
    create function post_finance_bank_transaction(uuid,uuid,uuid,date,date,text,text,text,text,text,numeric,text) returns uuid language sql as $$select gen_random_uuid()$$;
    create function transfer_finance_bank_accounts(uuid,uuid,uuid,uuid,date,numeric,text) returns uuid language sql as $$select gen_random_uuid()$$;
    create function reconcile_finance_bank_transaction(uuid,uuid,date,text) returns void language sql as $$select$$;
  `);
  for(const migration of migrations) await db.exec(migration);
  await db.exec(`select set_config('test.uid','${uid}',false),set_config('test.company','${company}',false),set_config('test.allowed','true',false); set role authenticated;`);
  return {db,uid,company,project,supplier};
}

test("Financeiro deriva permissão pelo tipo e cria conta a pagar uma única vez",async()=>{
  const {db,uid,company,project,supplier}=await setup();
  try{
    const payload={supplierId:supplier,document:"NF 123",fiscalClass:null,notes:"teste",installments:[{due_date:"2026-10-30",amount:1500,payment_method:"Boleto",label:"1 / 1"}]};
    const proposal=(await db.query(`insert into ai_action_proposals(company_id,project_id,turn_id,persona,action_type,required_permission,title,payload,preview,created_by) values($1,$2,gen_random_uuid(),'financeiro','finance_payable_create','spoof','Conta',$3::jsonb,'{"blocked":false}'::jsonb,$4) returning id,required_permission`,[company,project,JSON.stringify(payload),uid])).rows[0];
    assert.equal(proposal.required_permission,"payables.manage");
    await db.query(`select ai_execute_action_proposal($1)`,[proposal.id]);
    await db.query(`select ai_execute_action_proposal($1)`,[proposal.id]);
    const rows=(await db.query(`select document,amount,status,source_system from payables`)).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].document,"NF 123");assert.equal(Number(rows[0].amount),1500);assert.equal(rows[0].status,"open");assert.equal(rows[0].source_system,"elos_ia");
  }finally{await db.close();}
});

test("Financeiro mapeia permissões sensíveis no banco",async()=>{
  const {db}=await setup();
  try{
    const rows=(await db.query(`select ai_action_required_permission(x) permission from unnest(array['finance_payable_payment','finance_receivable_receipt','finance_manual_invoice','finance_tax_obligation','finance_bank_transfer','finance_bank_reconciliation','finance_correction_index']) x`)).rows.map(r=>r.permission);
    assert.deepEqual(rows,['payables.manage','receivables.manage','finance.manual_invoices.manage','finance.taxes.manage','finance.bank_accounts.transfer','finance.bank_accounts.reconcile','indices.manage']);
  }finally{await db.close();}
});
