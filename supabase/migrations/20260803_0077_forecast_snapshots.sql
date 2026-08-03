-- Elos OS — Fase 5 · Memória imutável da previsão financeira

begin;

create table if not exists public.forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  baseline_id uuid references public.engineering_schedule_baselines(id) on delete restrict,
  budget_id uuid references public.engineering_budgets(id) on delete restrict,
  reference_month date not null,
  forecast_as_of_date date not null,
  captured_at timestamptz not null default now(),
  source text not null default 'manual',
  created_by uuid references auth.users(id) on delete set null,
  budget_total numeric(18,2) not null,
  actual_total numeric(18,2) not null,
  committed_total numeric(18,2) not null,
  to_commit_total numeric(18,2) not null,
  projected_cost_total numeric(18,2) not null,
  deviation_total numeric(18,2) not null,
  default_payment_days integer not null,
  engine_version text not null,
  baseline_label text,
  budget_label text,
  warnings jsonb not null default '[]'::jsonb,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  constraint forecast_snapshots_reference_month_check
    check (reference_month = date_trunc('month', reference_month::timestamp)::date),
  constraint forecast_snapshots_source_check check (source in ('manual','automatic')),
  constraint forecast_snapshots_manual_user_check check (source = 'automatic' or created_by is not null),
  constraint forecast_snapshots_totals_check check (
    budget_total >= 0 and actual_total >= 0 and committed_total >= 0 and to_commit_total >= 0 and projected_cost_total >= 0 and
    abs(projected_cost_total - (actual_total + committed_total + to_commit_total)) <= 0.02 and
    abs(deviation_total - (projected_cost_total - budget_total)) <= 0.02
  ),
  constraint forecast_snapshots_payment_days_check check (default_payment_days between 0 and 365),
  constraint forecast_snapshots_engine_version_check check (nullif(trim(engine_version),'') is not null),
  constraint forecast_snapshots_warnings_check check (jsonb_typeof(warnings) = 'array'),
  constraint forecast_snapshots_archive_check check (
    (archived_at is null and archived_by is null) or (archived_at is not null and archived_by is not null)
  )
);

create table if not exists public.forecast_snapshot_rows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  snapshot_id uuid not null references public.forecast_snapshots(id) on delete cascade,
  service_id uuid references public.engineering_services(id) on delete restrict,
  service_key text not null,
  service_code text,
  service_name text not null,
  service_budget_amount numeric(18,2) not null,
  month date not null,
  layer text not null,
  amount numeric(18,2) not null,
  created_at timestamptz not null default now(),
  constraint forecast_snapshot_rows_service_key_check check (nullif(trim(service_key),'') is not null),
  constraint forecast_snapshot_rows_service_name_check check (nullif(trim(service_name),'') is not null),
  constraint forecast_snapshot_rows_month_check check (month = date_trunc('month', month::timestamp)::date),
  constraint forecast_snapshot_rows_layer_check check (layer in ('actual','committed','to_commit')),
  constraint forecast_snapshot_rows_values_check check (service_budget_amount >= 0 and amount >= 0),
  unique (snapshot_id, service_key, month, layer)
);

create index if not exists forecast_snapshots_project_captured_idx
  on public.forecast_snapshots(company_id, project_id, captured_at desc);
create index if not exists forecast_snapshots_reference_month_idx
  on public.forecast_snapshots(company_id, project_id, reference_month desc);
create index if not exists forecast_snapshot_rows_snapshot_idx
  on public.forecast_snapshot_rows(snapshot_id, service_key, month);
create index if not exists forecast_snapshot_rows_project_month_idx
  on public.forecast_snapshot_rows(company_id, project_id, month);

create or replace function public.validate_forecast_snapshot_tenant()
returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if not exists (
    select 1 from public.projects p
    where p.id = new.project_id and p.company_id = new.company_id
  ) then
    raise exception 'A obra não pertence à empresa informada.' using errcode='23514';
  end if;

  if new.baseline_id is not null and not exists (
    select 1 from public.engineering_schedule_baselines b
    where b.id = new.baseline_id and b.company_id = new.company_id and b.project_id = new.project_id
      and (new.budget_id is null or b.budget_id = new.budget_id)
  ) then
    raise exception 'A linha de base não pertence à empresa, obra e orçamento informados.' using errcode='23514';
  end if;

  if new.budget_id is not null and not exists (
    select 1 from public.engineering_budgets b
    where b.id = new.budget_id and b.company_id = new.company_id and b.project_id = new.project_id
  ) then
    raise exception 'O orçamento não pertence à empresa e obra informadas.' using errcode='23514';
  end if;

  return new;
end; $$;

create or replace function public.validate_forecast_snapshot_row_tenant()
returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if not exists (
    select 1 from public.forecast_snapshots s
    where s.id = new.snapshot_id and s.company_id = new.company_id and s.project_id = new.project_id
  ) then
    raise exception 'A linha não pertence ao snapshot, empresa e obra informados.' using errcode='23514';
  end if;

  if new.service_id is not null and not exists (
    select 1 from public.engineering_services s
    where s.id = new.service_id and s.company_id = new.company_id
  ) then
    raise exception 'O serviço não pertence à empresa informada.' using errcode='23514';
  end if;

  return new;
end; $$;

create or replace function public.protect_forecast_snapshot_immutability()
returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Snapshots de previsão são imutáveis e não podem ser excluídos.' using errcode='55000';
  end if;

  if (to_jsonb(new) - 'archived_at' - 'archived_by') is distinct from
     (to_jsonb(old) - 'archived_at' - 'archived_by') then
    raise exception 'Snapshots de previsão são imutáveis; somente o arquivamento é permitido.' using errcode='55000';
  end if;

  if old.archived_at is not null or old.archived_by is not null then
    raise exception 'Um snapshot arquivado não pode ser alterado ou restaurado.' using errcode='55000';
  end if;

  if new.archived_at is null or new.archived_by is null then
    raise exception 'O arquivamento exige data e usuário.' using errcode='23514';
  end if;

  return new;
end; $$;

create or replace function public.protect_forecast_snapshot_row_immutability()
returns trigger
language plpgsql set search_path=public as $$
begin
  raise exception 'Linhas de snapshot são imutáveis e não podem ser alteradas ou excluídas.' using errcode='55000';
end; $$;

drop trigger if exists forecast_snapshots_validate_tenant on public.forecast_snapshots;
create trigger forecast_snapshots_validate_tenant
before insert or update of company_id,project_id,baseline_id,budget_id
on public.forecast_snapshots
for each row execute function public.validate_forecast_snapshot_tenant();

drop trigger if exists forecast_snapshots_protect_immutability on public.forecast_snapshots;
create trigger forecast_snapshots_protect_immutability
before update or delete on public.forecast_snapshots
for each row execute function public.protect_forecast_snapshot_immutability();

drop trigger if exists forecast_snapshot_rows_validate_tenant on public.forecast_snapshot_rows;
create trigger forecast_snapshot_rows_validate_tenant
before insert or update of company_id,project_id,snapshot_id,service_id
on public.forecast_snapshot_rows
for each row execute function public.validate_forecast_snapshot_row_tenant();

drop trigger if exists forecast_snapshot_rows_protect_immutability on public.forecast_snapshot_rows;
create trigger forecast_snapshot_rows_protect_immutability
before update or delete on public.forecast_snapshot_rows
for each row execute function public.protect_forecast_snapshot_row_immutability();

alter table public.forecast_snapshots enable row level security;
alter table public.forecast_snapshot_rows enable row level security;

drop policy if exists forecast_snapshots_select on public.forecast_snapshots;
create policy forecast_snapshots_select
on public.forecast_snapshots
for select to authenticated
using (
  public.has_company_permission(company_id,'schedule.view')
  or public.has_company_permission(company_id,'schedule.manage')
);

drop policy if exists forecast_snapshot_rows_select on public.forecast_snapshot_rows;
create policy forecast_snapshot_rows_select
on public.forecast_snapshot_rows
for select to authenticated
using (
  public.has_company_permission(company_id,'schedule.view')
  or public.has_company_permission(company_id,'schedule.manage')
);

create or replace function public.create_forecast_snapshot(
  p_company_id uuid,
  p_project_id uuid,
  p_baseline_id uuid,
  p_budget_id uuid,
  p_reference_month date,
  p_forecast_as_of_date date,
  p_source text,
  p_budget_total numeric,
  p_actual_total numeric,
  p_committed_total numeric,
  p_to_commit_total numeric,
  p_projected_cost_total numeric,
  p_deviation_total numeric,
  p_default_payment_days integer,
  p_engine_version text,
  p_baseline_label text,
  p_budget_label text,
  p_warnings jsonb,
  p_rows jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public as $$
declare
  v_snapshot_id uuid;
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_actual numeric;
  v_committed numeric;
  v_to_commit numeric;
begin
  if v_user_id is null then
    raise exception 'Usuário não autenticado.' using errcode='42501';
  end if;

  if not public.has_company_permission(p_company_id,'schedule.manage') then
    raise exception 'Sem permissão para congelar previsões.' using errcode='42501';
  end if;

  if p_source not in ('manual','automatic') then
    raise exception 'Origem de snapshot inválida.' using errcode='23514';
  end if;

  if p_source = 'manual' and (
    p_reference_month <> date_trunc('month', v_today::timestamp)::date
    or p_forecast_as_of_date <> v_today
  ) then
    raise exception 'Snapshots manuais devem usar a competência e a data de corte atuais.' using errcode='23514';
  end if;

  if jsonb_typeof(coalesce(p_rows,'null'::jsonb)) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'O snapshot precisa conter linhas mensais.' using errcode='23514';
  end if;

  insert into public.forecast_snapshots (
    company_id,project_id,baseline_id,budget_id,reference_month,forecast_as_of_date,source,created_by,
    budget_total,actual_total,committed_total,to_commit_total,projected_cost_total,deviation_total,
    default_payment_days,engine_version,baseline_label,budget_label,warnings
  ) values (
    p_company_id,p_project_id,p_baseline_id,p_budget_id,p_reference_month,p_forecast_as_of_date,p_source,v_user_id,
    p_budget_total,p_actual_total,p_committed_total,p_to_commit_total,p_projected_cost_total,p_deviation_total,
    p_default_payment_days,p_engine_version,p_baseline_label,p_budget_label,coalesce(p_warnings,'[]'::jsonb)
  ) returning id into v_snapshot_id;

  insert into public.forecast_snapshot_rows (
    company_id,project_id,snapshot_id,service_id,service_key,service_code,service_name,
    service_budget_amount,month,layer,amount
  )
  select
    p_company_id,p_project_id,v_snapshot_id,x.service_id,x.service_key,x.service_code,x.service_name,
    x.service_budget_amount,x.month,x.layer,x.amount
  from jsonb_to_recordset(p_rows) as x(
    service_id uuid,
    service_key text,
    service_code text,
    service_name text,
    service_budget_amount numeric,
    month date,
    layer text,
    amount numeric
  );

  select
    coalesce(sum(amount) filter (where layer='actual'),0),
    coalesce(sum(amount) filter (where layer='committed'),0),
    coalesce(sum(amount) filter (where layer='to_commit'),0)
  into v_actual,v_committed,v_to_commit
  from public.forecast_snapshot_rows
  where snapshot_id=v_snapshot_id;

  if abs(v_actual-p_actual_total)>0.02 or abs(v_committed-p_committed_total)>0.02 or abs(v_to_commit-p_to_commit_total)>0.02 then
    raise exception 'As linhas do snapshot não coincidem com os totais congelados.' using errcode='23514';
  end if;

  return v_snapshot_id;
end; $$;

create or replace function public.archive_forecast_snapshot(p_snapshot_id uuid)
returns void
language plpgsql
security definer
set search_path=public as $$
declare
  v_company_id uuid;
  v_archived_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado.' using errcode='42501';
  end if;

  select company_id,archived_at into v_company_id,v_archived_at
  from public.forecast_snapshots
  where id=p_snapshot_id;

  if v_company_id is null then
    raise exception 'Snapshot não encontrado.' using errcode='P0002';
  end if;

  if not public.has_company_permission(v_company_id,'schedule.manage') then
    raise exception 'Sem permissão para arquivar previsões.' using errcode='42501';
  end if;

  if v_archived_at is not null then
    return;
  end if;

  update public.forecast_snapshots
  set archived_at=now(),archived_by=auth.uid()
  where id=p_snapshot_id;
end; $$;

revoke all on public.forecast_snapshots from public,anon,authenticated;
revoke all on public.forecast_snapshot_rows from public,anon,authenticated;
grant select on public.forecast_snapshots to authenticated;
grant select on public.forecast_snapshot_rows to authenticated;

revoke all on function public.create_forecast_snapshot(
  uuid,uuid,uuid,uuid,date,date,text,numeric,numeric,numeric,numeric,numeric,numeric,integer,text,text,text,jsonb,jsonb
) from public;
grant execute on function public.create_forecast_snapshot(
  uuid,uuid,uuid,uuid,date,date,text,numeric,numeric,numeric,numeric,numeric,numeric,integer,text,text,text,jsonb,jsonb
) to authenticated;

revoke all on function public.archive_forecast_snapshot(uuid) from public;
grant execute on function public.archive_forecast_snapshot(uuid) to authenticated;

comment on table public.forecast_snapshots is 'Cabeçalho imutável da previsão financeira congelada por obra.';
comment on table public.forecast_snapshot_rows is 'Valores mensais e por serviço das três camadas congeladas no snapshot.';
comment on column public.forecast_snapshots.engine_version is 'Versão do motor compartilhado que produziu o snapshot.';

commit;
