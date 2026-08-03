\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;

create table public.companies(id uuid primary key);
create table public.projects(id uuid primary key,company_id uuid not null);
create table public.engineering_budgets(id uuid primary key,company_id uuid not null,project_id uuid not null,code text,name text,version text);
create table public.engineering_schedule_baselines(id uuid primary key,company_id uuid not null,project_id uuid not null,budget_id uuid not null,code text,name text,version text);
create table public.engineering_services(id uuid primary key,company_id uuid not null);
create table auth.users(id uuid primary key);

create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id',true),'')::uuid;
$$;

create or replace function public.has_company_permission(target_company_id uuid,target_permission text)
returns boolean language sql stable as $$
  select current_setting('app.allowed_company_id',true) is not null
     and current_setting('app.allowed_company_id',true)::uuid=target_company_id
     and target_permission in ('schedule.view','schedule.manage');
$$;

\i supabase/migrations/20260803_0077_forecast_snapshots.sql

insert into public.companies(id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');
insert into public.projects(id,company_id) values
  ('11111111-1111-1111-1111-111111111101','11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222202','22222222-2222-2222-2222-222222222222');
insert into public.engineering_budgets(id,company_id,project_id,code,name,version) values
  ('11111111-1111-1111-1111-111111111102','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111101','ORC-A','Orçamento A','R1'),
  ('22222222-2222-2222-2222-222222222203','22222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222202','ORC-B','Orçamento B','R1');
insert into public.engineering_schedule_baselines(id,company_id,project_id,budget_id,code,name,version) values
  ('11111111-1111-1111-1111-111111111103','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111101','11111111-1111-1111-1111-111111111102','LB-A','Base A','V1'),
  ('22222222-2222-2222-2222-222222222204','22222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222202','22222222-2222-2222-2222-222222222203','LB-B','Base B','V1');
insert into public.engineering_services(id,company_id) values
  ('11111111-1111-1111-1111-111111111104','11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222205','22222222-2222-2222-2222-222222222222');
insert into auth.users(id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select set_config('app.user_id','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',false);
select set_config('app.allowed_company_id','11111111-1111-1111-1111-111111111111',false);

select public.create_forecast_snapshot(
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111101',
  '11111111-1111-1111-1111-111111111103',
  '11111111-1111-1111-1111-111111111102',
  date_trunc('month',(now() at time zone 'America/Sao_Paulo'))::date,
  (now() at time zone 'America/Sao_Paulo')::date,
  'manual',1000,100,300,600,1000,0,30,'forecast-engine-v1','LB-A · V1 · Base A','ORC-A · R1 · Orçamento A','[]'::jsonb,
  jsonb_build_array(
    jsonb_build_object('service_id','11111111-1111-1111-1111-111111111104','service_key','11111111-1111-1111-1111-111111111104','service_code','01','service_name','Estrutura','service_budget_amount',1000,'month',date_trunc('month',(now() at time zone 'America/Sao_Paulo'))::date,'layer','actual','amount',100),
    jsonb_build_object('service_id','11111111-1111-1111-1111-111111111104','service_key','11111111-1111-1111-1111-111111111104','service_code','01','service_name','Estrutura','service_budget_amount',1000,'month',date_trunc('month',(now() at time zone 'America/Sao_Paulo'))::date,'layer','committed','amount',300),
    jsonb_build_object('service_id','11111111-1111-1111-1111-111111111104','service_key','11111111-1111-1111-1111-111111111104','service_code','01','service_name','Estrutura','service_budget_amount',1000,'month',date_trunc('month',(now() at time zone 'America/Sao_Paulo'))::date,'layer','to_commit','amount',600)
  )
) as snapshot_a \gset
select set_config('app.snapshot_a', :'snapshot_a', false);

select set_config('app.allowed_company_id','22222222-2222-2222-2222-222222222222',false);
select public.create_forecast_snapshot(
  '22222222-2222-2222-2222-222222222222',
  '22222222-2222-2222-2222-222222222202',
  '22222222-2222-2222-2222-222222222204',
  '22222222-2222-2222-2222-222222222203',
  date_trunc('month',(now() at time zone 'America/Sao_Paulo'))::date,
  (now() at time zone 'America/Sao_Paulo')::date,
  'manual',2000,200,500,1300,2000,0,30,'forecast-engine-v1','LB-B · V1 · Base B','ORC-B · R1 · Orçamento B','[]'::jsonb,
  jsonb_build_array(
    jsonb_build_object('service_id','22222222-2222-2222-2222-222222222205','service_key','22222222-2222-2222-2222-222222222205','service_code','02','service_name','Acabamentos','service_budget_amount',2000,'month',date_trunc('month',(now() at time zone 'America/Sao_Paulo'))::date,'layer','actual','amount',200),
    jsonb_build_object('service_id','22222222-2222-2222-2222-222222222205','service_key','22222222-2222-2222-2222-222222222205','service_code','02','service_name','Acabamentos','service_budget_amount',2000,'month',date_trunc('month',(now() at time zone 'America/Sao_Paulo'))::date,'layer','committed','amount',500),
    jsonb_build_object('service_id','22222222-2222-2222-2222-222222222205','service_key','22222222-2222-2222-2222-222222222205','service_code','02','service_name','Acabamentos','service_budget_amount',2000,'month',date_trunc('month',(now() at time zone 'America/Sao_Paulo'))::date,'layer','to_commit','amount',1300)
  )
) as snapshot_b \gset
select set_config('app.snapshot_b', :'snapshot_b', false);

select set_config('app.allowed_company_id','11111111-1111-1111-1111-111111111111',false);
set role authenticated;

do $$
declare
  visible_headers integer;
  visible_rows integer;
  snapshot_b uuid := current_setting('app.snapshot_b')::uuid;
begin
  select count(*) into visible_headers from public.forecast_snapshots;
  select count(*) into visible_rows from public.forecast_snapshot_rows;
  if visible_headers <> 1 or visible_rows <> 3 then
    raise exception 'Falha RLS: Empresa A visualizou % cabeçalhos e % linhas.',visible_headers,visible_rows;
  end if;

  begin
    insert into public.forecast_snapshot_rows(company_id,project_id,snapshot_id,service_key,service_name,service_budget_amount,month,layer,amount)
    values ('22222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222202',snapshot_b,'x','Inválido',1,date_trunc('month',now())::date,'actual',1);
    raise exception 'Falha: escrita direta em snapshot da Empresa B foi permitida.';
  exception when insufficient_privilege then
    null;
  end;
end $$;

select public.archive_forecast_snapshot(:'snapshot_a');
reset role;

do $$
declare
  snapshot_a uuid := current_setting('app.snapshot_a')::uuid;
  snapshot_b uuid := current_setting('app.snapshot_b')::uuid;
  frozen_total numeric;
  row_total numeric;
begin
  update public.projects set company_id=company_id where id='11111111-1111-1111-1111-111111111101';
  select projected_cost_total into frozen_total from public.forecast_snapshots where id=snapshot_a;
  select sum(amount) into row_total from public.forecast_snapshot_rows where snapshot_id=snapshot_a;
  if frozen_total <> 1000 or row_total <> 1000 then
    raise exception 'Snapshot mudou após alteração posterior ou suas linhas não fecham com o total.';
  end if;

  if not exists(select 1 from public.forecast_snapshots where id=snapshot_a and archived_at is not null and archived_by is not null) then
    raise exception 'Arquivamento não foi registrado.';
  end if;

  begin
    update public.forecast_snapshots set projected_cost_total=999 where id=snapshot_a;
    raise exception 'Falha: alteração de total do snapshot foi permitida.';
  exception when object_not_in_prerequisite_state then
    null;
  end;

  begin
    update public.forecast_snapshots set archived_at=null,archived_by=null where id=snapshot_a;
    raise exception 'Falha: restauração de snapshot arquivado foi permitida.';
  exception when object_not_in_prerequisite_state then
    null;
  end;

  begin
    delete from public.forecast_snapshots where id=snapshot_a;
    raise exception 'Falha: exclusão de snapshot foi permitida.';
  exception when object_not_in_prerequisite_state then
    null;
  end;

  begin
    update public.forecast_snapshot_rows set amount=999 where snapshot_id=snapshot_a;
    raise exception 'Falha: alteração de linha congelada foi permitida.';
  exception when object_not_in_prerequisite_state then
    null;
  end;

  begin
    insert into public.forecast_snapshot_rows(company_id,project_id,snapshot_id,service_id,service_key,service_name,service_budget_amount,month,layer,amount)
    values ('11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111101',snapshot_b,'11111111-1111-1111-1111-111111111104','cross','Cruzado',1,date_trunc('month',now())::date,'actual',1);
    raise exception 'Falha: relação cruzada entre empresas foi permitida.';
  exception when check_violation then
    null;
  end;
end $$;

select 'FORECAST_SNAPSHOT_RLS_IMMUTABILITY_OK' as result;
