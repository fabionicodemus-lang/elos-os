import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migrationDir = new URL("../../supabase/migrations/", import.meta.url);
const migrationFile = readdirSync(migrationDir).find((name) => name.endsWith("_integration_eobra_import.sql"));
assert.ok(migrationFile, "eObra migration must exist");
const migration = readFileSync(new URL(migrationFile, migrationDir), "utf8");
export const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const PA = "11111111-1111-4111-8111-111111111111";
export const PA2 = "22222222-2222-4222-8222-222222222222";
export const PB = "33333333-3333-4333-8333-333333333333";
export const UA = "12345678-1234-4234-8234-123456789abc";
export const UB = "22345678-1234-4234-8234-123456789abc";
const CA = "44444444-4444-4444-8444-444444444444";
const CB = "55555555-5555-4555-8555-555555555555";
const UNIT = "66666666-6666-4666-8666-666666666666";
const SALE = "77777777-7777-4777-8777-777777777777";
const SB = "88888888-8888-4888-8888-888888888888";

export async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${UA}'),('${UB}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid',true),'')::uuid
    $$;
    create function public.is_company_member(target_company_id uuid) returns boolean language sql stable as $$
      select auth.uid() is not null and target_company_id = nullif(current_setting('test.company',true),'')::uuid
    $$;
    create function public.has_company_permission(target_company_id uuid,target_permission text) returns boolean language sql stable as $$
      select public.is_company_member(target_company_id)
        and coalesce(current_setting('test.denied',true),'')<>target_permission
    $$;
    create table public.companies(id uuid primary key,name text);
    create table public.projects(id uuid primary key,company_id uuid not null references public.companies(id),name text,code text);
    create table public.suppliers(
      id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
      person_type text not null check(person_type in ('company','individual','other')), legal_name text not null,
      tax_id text,email text,phone text,address text,city text,state text,notes text,status text not null,
      source_system text,source_id text,created_by uuid references auth.users(id),
      created_at timestamptz default now(),updated_at timestamptz default now(),
      unique(company_id,source_system,source_id)
    );
    create table public.clients(
      id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
      person_type text not null check(person_type in ('PF','PJ','OTHER')), name text not null,
      tax_id text,email text,phone text,address text,city text,state text,notes text,status text not null,
      source_system text,source_id text,created_by uuid references auth.users(id),
      created_at timestamptz default now(),updated_at timestamptz default now(),
      unique(company_id,source_system,source_id)
    );
    create table public.units(id uuid primary key, company_id uuid not null references public.companies(id),project_id uuid not null references public.projects(id));
    create table public.sales(id uuid primary key,company_id uuid not null references public.companies(id),project_id uuid not null references public.projects(id),client_id uuid not null references public.clients(id),unit_id uuid not null references public.units(id),status text not null default 'active');
    create table public.payables(
      id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid not null references public.projects(id),supplier_id uuid references public.suppliers(id),
      document text,due_date date not null,amount numeric(16,2) not null check(amount>=0),status text not null check(status in ('open','paid','cancelled')),installment_label text,notes text,paid_at date,paid_amount numeric(16,2),paid_account_name text,origin text not null,source_system text,source_id text,beneficiary_name text,beneficiary_tax_id text,created_by uuid references auth.users(id),
      created_at timestamptz default now(),updated_at timestamptz default now(),unique(company_id,source_system,source_id)
    );
    create table public.receivables(
      id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),project_id uuid not null references public.projects(id),sale_id uuid not null references public.sales(id),client_id uuid not null references public.clients(id),unit_id uuid not null references public.units(id),category text not null,description text not null,due_date date not null,
      amount numeric(16,2) not null check(amount>=0),adjusted_amount numeric(16,2) not null,status text not null check(status in ('open','paid','cancelled')),paid_at date,paid_amount numeric(16,2),paid_account_name text,correction_locked boolean not null,
      installment_interest_amount numeric(16,2),correction_amount numeric(16,2),late_fee_amount numeric(16,2),other_accrual_amount numeric(16,2),discount_amount numeric(16,2),source_system text,source_id text,created_by uuid references auth.users(id),created_at timestamptz default now(),updated_at timestamptz default now(),unique(company_id,source_system,source_id)
    );
    insert into public.companies values ('${A}','Empresa sintética A'),('${B}','Outra');
    insert into public.projects values ('${PA}','${A}','Obra sintética A','OBRA-A'),('${PA2}','${A}','Obra sintética B','OBRA-B'),('${PB}','${B}','Outro','OUT');
    insert into public.clients(id,company_id,person_type,name,tax_id,status) values ('${CA}','${A}','PJ','Cliente real','99000001000101','active'),('${CB}','${B}','PJ','Cliente externo','99000002000148','active');
    insert into public.units values ('${UNIT}','${A}','${PA}');
    insert into public.sales(id,company_id,project_id,client_id,unit_id) values ('${SALE}','${A}','${PA}','${CA}','${UNIT}');
    insert into public.suppliers(id,company_id,person_type,legal_name,tax_id,status) values ('${SB}','${B}','company','Fornecedor externo','99000002000148','active');
    grant usage on schema public,auth to authenticated;
    grant select on public.companies,public.projects,public.units,public.sales to authenticated;
    grant select,insert,update on public.suppliers,public.clients,public.payables,public.receivables to authenticated;
    do $$ declare t text; begin
      foreach t in array array['companies','projects','suppliers','clients','units','sales','payables','receivables'] loop
        execute format('alter table public.%I enable row level security',t);
        execute format('create policy tenant on public.%I for all to authenticated using (public.is_company_member(%I)) with check(public.is_company_member(%I))',t,case when t='companies' then 'id' else 'company_id' end,case when t='companies' then 'id' else 'company_id' end);
      end loop;
    end; $$;
  `);
  await db.exec(migration);
  await db.exec(`
    create policy project_scope on public.projects as restrictive for select to authenticated using (id::text is distinct from current_setting('test.hidden_project',true));
    create schema finance_private;
    alter table public.projects add column legal_entity_id uuid;
    alter table public.suppliers add column trade_name text;
    alter table public.units alter column id set default gen_random_uuid();
    alter table public.units add column code text, add column status text default 'available', add column tower text, add column floor integer, add column type text,
      add column private_area numeric(12,2), add column total_area numeric(12,2), add column common_area numeric(12,2), add column uncovered_private_area numeric(12,2),
      add column fractional_share numeric(14,10), add column bedrooms integer, add column suites integer, add column parking_spaces integer, add column parking_description text,
      add column list_price numeric(16,2), add column registry text, add column notes text, add column position text,
      add column source_system text, add column source_id text, add column created_by uuid, add column created_at timestamptz default now(),add column updated_at timestamptz default now();
    create unique index units_source_identity on public.units(company_id,source_system,source_id);
    create unique index units_project_code on public.units(project_id,code);
    alter table public.sales alter column id set default gen_random_uuid();
    alter table public.sales add column number text,add column sale_date date,add column total_amount numeric(16,2),add column contract_number text,
      add column commission_pct numeric(8,4) default 0,add column commission_amount numeric(16,2) default 0,add column broker_name text,
      add column payment_plan_available boolean default false,add column notes text,add column source_code text,
      add column source_system text,add column source_id text,add column created_by uuid,add column created_at timestamptz default now(),add column updated_at timestamptz default now();
    create unique index sales_source_identity on public.sales(company_id,source_system,source_id);
    create unique index sales_one_active_per_unit_idx on public.sales(unit_id) where status='active';
    alter table public.receivables add column sequence_number integer default 1,add column sequence_total integer default 1,add column notes text,
      add column adjustment_index text,add column interest_rate_monthly numeric,add column correction_base_month date,add column correction_base_value numeric,
      add column correction_reference_month date,add column correction_reference_value numeric,add column correction_index_id uuid,
      add column bank_account_id uuid,add column bank_transaction_id uuid;
    alter table public.payables add column fiscal_class text,add column payment_method text,add column source_category text,add column bank_account_id uuid,add column bank_transaction_id uuid;
    create table public.finance_bank_accounts(id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,legal_entity_id uuid,label text,status text,closed_through date,allow_negative boolean default true);
    create table public.finance_bank_transactions(id uuid primary key default gen_random_uuid(),company_id uuid,project_id uuid,legal_entity_id uuid,bank_account_id uuid,
      transaction_date date,competence_date date,direction text,transaction_type text,description text,document text,counterparty text,amount numeric(16,2),status text,
      receivable_id uuid,payable_id uuid,source_system text,source_id text,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now(),
      unique(company_id,source_system,source_id));
    create table public.commercial_sale_parties(id uuid primary key default gen_random_uuid(),company_id uuid not null,project_id uuid not null,sale_id uuid not null references public.sales(id),client_id uuid not null references public.clients(id),
      role text not null default 'buyer',ownership_percent numeric(8,4),is_primary boolean not null default false,status text not null default 'active',joined_at date,notes text,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
    create unique index commercial_sale_primary_party_idx on public.commercial_sale_parties(sale_id) where is_primary and status='active';
    grant select,insert,update on public.units,public.sales,public.finance_bank_accounts,public.finance_bank_transactions,public.commercial_sale_parties to authenticated;
    do $$ declare t text;begin
      foreach t in array array['finance_bank_accounts','finance_bank_transactions','commercial_sale_parties'] loop
        execute format('alter table public.%I enable row level security',t);
        execute format('create policy tenant on public.%I for all to authenticated using(public.is_company_member(company_id)) with check(public.is_company_member(company_id))',t);
      end loop;
    end; $$;
  `);
  await db.exec(readFileSync(new URL('20261126150339_eobra_snapshot_foundation.sql', migrationDir), 'utf8'));
  await setTenant(db,A,UA);
  return db;
}

export async function setTenant(db, company, user) {
  await db.exec("reset role");
  await db.query("select set_config('test.company',$1,false),set_config('test.uid',$2,false),set_config('test.denied','',false),set_config('test.hidden_project','',false)",[company,user]);
  await db.exec("set role authenticated");
}


export async function applyMigration(db,suffix) {
  await db.exec('reset role');
  const file = readdirSync(migrationDir).find(name=>name.endsWith(suffix));
  assert.ok(file, `Migration ${suffix} must exist`);
  await db.exec(readFileSync(new URL(file,migrationDir),'utf8'));
  await db.exec('set role authenticated');
}
