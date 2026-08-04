\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;

create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select '00000000-0000-0000-0000-000000000001'::uuid
$$;

create table public.companies (id uuid primary key);
create table public.projects (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade
);
create table public.permissions (key text primary key);
create or replace function public.has_company_permission(uuid, text)
returns boolean language sql stable as $$ select true $$;

create table public.engineering_budgets (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'draft',
  is_base boolean not null default false,
  base_set_at timestamptz,
  base_set_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index engineering_budgets_one_base_per_project_uidx
  on public.engineering_budgets(company_id, project_id) where is_base;

create table public.engineering_schedule_baselines (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_id uuid not null references public.engineering_budgets(id) on delete restrict
);
create table public.engineering_schedule_activities (
  id uuid primary key,
  baseline_id uuid not null references public.engineering_schedule_baselines(id) on delete cascade
);
create table public.engineering_schedule_progress_measurements (
  id uuid primary key,
  company_id uuid not null,
  project_id uuid not null,
  baseline_id uuid not null references public.engineering_schedule_baselines(id) on delete cascade
);
create table public.forecast_snapshots (
  id uuid primary key,
  company_id uuid not null,
  project_id uuid not null,
  baseline_id uuid references public.engineering_schedule_baselines(id) on delete restrict,
  budget_id uuid references public.engineering_budgets(id) on delete restrict
);
create table public.execution_material_requests (
  id uuid primary key,
  budget_id uuid references public.engineering_budgets(id) on delete restrict
);
create table public.execution_service_contracts (
  id uuid primary key,
  budget_id uuid references public.engineering_budgets(id) on delete restrict
);

insert into auth.users values ('00000000-0000-0000-0000-000000000001');
insert into public.companies values ('10000000-0000-0000-0000-000000000001');
insert into public.projects values (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001'
);

\i supabase/migrations/20260804_0078_budget_delete_dependencies.sql

-- Caso 1: baseline sem execução é planejamento interno e deve acompanhar o orçamento.
insert into public.engineering_budgets (id, company_id, project_id, status, is_base)
values (
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'approved', true
), (
  '30000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'approved', false
);
insert into public.engineering_schedule_baselines values (
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001'
);
insert into public.engineering_schedule_activities values (
  '50000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001'
);

select public.delete_engineering_budget(
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001'
);

do $$
begin
  if exists(select 1 from public.engineering_budgets where id='30000000-0000-0000-0000-000000000001') then
    raise exception 'O orçamento com baseline vazia não foi excluído';
  end if;
  if exists(select 1 from public.engineering_schedule_baselines where id='40000000-0000-0000-0000-000000000001') then
    raise exception 'A baseline interna não foi excluída';
  end if;
  if exists(select 1 from public.engineering_schedule_activities where id='50000000-0000-0000-0000-000000000001') then
    raise exception 'A atividade interna não acompanhou a baseline';
  end if;
  if not exists(
    select 1 from public.engineering_budgets
    where id='30000000-0000-0000-0000-000000000002' and is_base
  ) then
    raise exception 'A revisão aprovada remanescente não foi promovida a base';
  end if;
end $$;

-- Caso 2: medição física bloqueia e preserva tudo.
insert into public.engineering_budgets (id, company_id, project_id, status)
values (
  '30000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'approved'
);
insert into public.engineering_schedule_baselines values (
  '40000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000003'
);
insert into public.engineering_schedule_progress_measurements values (
  '60000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000003'
);

do $$
begin
  begin
    perform public.delete_engineering_budget(
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000003'
    );
    raise exception 'A exclusão com medição deveria ter sido bloqueada';
  exception when others then
    if position('medição' in sqlerrm) = 0 then raise; end if;
  end;
  if not exists(select 1 from public.engineering_budgets where id='30000000-0000-0000-0000-000000000003') then
    raise exception 'O orçamento bloqueado foi removido';
  end if;
end $$;

-- Caso 3: contrato e snapshot são reconhecidos como bloqueadores amigáveis.
insert into public.engineering_budgets (id, company_id, project_id, status)
values (
  '30000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'approved'
);
insert into public.execution_service_contracts values (
  '70000000-0000-0000-0000-000000000004',
  '30000000-0000-0000-0000-000000000004'
);
insert into public.forecast_snapshots values (
  '80000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  null,
  '30000000-0000-0000-0000-000000000004'
);

do $$
begin
  begin
    perform public.delete_engineering_budget(
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000004'
    );
    raise exception 'A exclusão com histórico deveria ter sido bloqueada';
  exception when others then
    if position('snapshot' in sqlerrm) = 0 or position('contrato' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

select 'budget-delete-0078-ok' as result;
