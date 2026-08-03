\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create table public.companies(id uuid primary key);
create table public.projects(id uuid primary key);
create table public.engineering_services(id uuid primary key,company_id uuid not null);
create table public.execution_service_contracts(id uuid primary key,company_id uuid not null,project_id uuid not null);
create table public.execution_service_contract_amendments(id uuid primary key,company_id uuid not null,project_id uuid not null,contract_id uuid not null);
create table public.execution_service_contract_items(id uuid primary key,company_id uuid not null,project_id uuid not null,contract_id uuid not null,service_id uuid not null);
create table auth.users(id uuid primary key);

create table public.execution_contract_measurements(
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft',
  constraint execution_contract_measurements_status_check
    check (status in ('draft','submitted','approved','rejected','invoiced','paid','cancelled'))
);

create table public.execution_contract_measurement_items(
  id uuid primary key default gen_random_uuid(),
  contracted_quantity numeric not null default 1,
  previous_approved_quantity numeric not null default 0,
  current_quantity numeric not null default 1,
  accumulated_quantity numeric not null default 1,
  unit_price numeric not null default 1,
  previous_approved_amount numeric not null default 0,
  current_amount numeric not null default 1,
  accumulated_amount numeric not null default 1,
  progress_percent numeric not null default 0,
  constraint execution_contract_measurement_item_values_check check (
    contracted_quantity > 0 and previous_approved_quantity >= 0 and current_quantity > 0 and accumulated_quantity >= 0 and
    unit_price >= 0 and previous_approved_amount >= 0 and current_amount >= 0 and accumulated_amount >= 0 and
    progress_percent between 0 and 100.0001 and accumulated_quantity <= contracted_quantity + 0.000001
  )
);

create table public.permissions(
  key text primary key,
  module text not null,
  action text not null,
  description text not null
);
create table public.roles(id uuid primary key default gen_random_uuid(),key text unique not null);
create table public.role_permissions(
  role_id uuid not null references public.roles(id),
  permission_key text not null,
  allowed boolean not null,
  primary key(role_id,permission_key)
);

create or replace function public.has_company_permission(target_company_id uuid,target_permission text)
returns boolean language sql stable as $$
  select current_setting('app.allowed_company_id',true) is not null
     and current_setting('app.allowed_company_id',true)::uuid=target_company_id;
$$;

insert into public.roles(key) values ('owner'),('admin'),('director');

\i supabase/migrations/20260803_0071_execution_contract_commitments.sql

insert into public.companies(id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');
insert into public.projects(id) values
  ('11111111-1111-1111-1111-111111111101'),
  ('22222222-2222-2222-2222-222222222202');
insert into public.engineering_services(id,company_id) values
  ('11111111-1111-1111-1111-111111111102','11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222203','22222222-2222-2222-2222-222222222222');
insert into public.execution_service_contracts(id,company_id,project_id) values
  ('11111111-1111-1111-1111-111111111103','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111101'),
  ('22222222-2222-2222-2222-222222222204','22222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222202');
insert into public.execution_service_contract_amendments(id,company_id,project_id,contract_id) values
  ('11111111-1111-1111-1111-111111111104','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111101','11111111-1111-1111-1111-111111111103'),
  ('22222222-2222-2222-2222-222222222205','22222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222202','22222222-2222-2222-2222-222222222204');
insert into public.execution_service_contract_items(id,company_id,project_id,contract_id,service_id) values
  ('11111111-1111-1111-1111-111111111105','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111101','11111111-1111-1111-1111-111111111103','11111111-1111-1111-1111-111111111102'),
  ('11111111-1111-1111-1111-111111111107','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111101','11111111-1111-1111-1111-111111111103','11111111-1111-1111-1111-111111111102'),
  ('22222222-2222-2222-2222-222222222206','22222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222202','22222222-2222-2222-2222-222222222204','22222222-2222-2222-2222-222222222203');
insert into auth.users(id) values ('11111111-1111-1111-1111-111111111106');

insert into public.execution_service_contract_amendment_items(
  company_id,project_id,contract_id,amendment_id,contract_item_id,service_id,value_change,created_by
) values
  ('11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111101','11111111-1111-1111-1111-111111111103','11111111-1111-1111-1111-111111111104','11111111-1111-1111-1111-111111111105','11111111-1111-1111-1111-111111111102',100,'11111111-1111-1111-1111-111111111106'),
  ('22222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222202','22222222-2222-2222-2222-222222222204','22222222-2222-2222-2222-222222222205','22222222-2222-2222-2222-222222222206','22222222-2222-2222-2222-222222222203',200,'11111111-1111-1111-1111-111111111106');

select set_config('app.allowed_company_id','11111111-1111-1111-1111-111111111111',false);
set role authenticated;

do $$
declare visible_count integer; begin
  select count(*) into visible_count from public.execution_service_contract_amendment_items;
  if visible_count<>1 then
    raise exception 'Falha RLS: Empresa A visualizou % registros; esperado 1.',visible_count;
  end if;

  insert into public.execution_service_contract_amendment_items(
    company_id,project_id,contract_id,amendment_id,contract_item_id,service_id,value_change,created_by
  ) values (
    '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111101','11111111-1111-1111-1111-111111111103',
    '11111111-1111-1111-1111-111111111104','11111111-1111-1111-1111-111111111107','11111111-1111-1111-1111-111111111102',50,
    '11111111-1111-1111-1111-111111111106'
  );

  begin
    insert into public.execution_service_contract_amendment_items(
      company_id,project_id,contract_id,amendment_id,contract_item_id,service_id,value_change,created_by
    ) values (
      '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111101','11111111-1111-1111-1111-111111111103',
      '11111111-1111-1111-1111-111111111104','22222222-2222-2222-2222-222222222206','11111111-1111-1111-1111-111111111102',50,
      '11111111-1111-1111-1111-111111111106'
    );
    raise exception 'Falha de integridade: referência cruzada à Empresa B foi permitida.';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.execution_service_contract_amendment_items(
      company_id,project_id,contract_id,amendment_id,contract_item_id,service_id,value_change,created_by
    ) values (
      '22222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222202','22222222-2222-2222-2222-222222222204',
      '22222222-2222-2222-2222-222222222205','22222222-2222-2222-2222-222222222206','22222222-2222-2222-2222-222222222203',50,
      '11111111-1111-1111-1111-111111111106'
    );
    raise exception 'Falha RLS: escrita na Empresa B foi permitida.';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
select 'RLS_MULTI_TENANT_OK' as result;
