-- Elos OS — Incorporação · Estudo de Viabilidade de Permuta
-- Viabilidade econômica anterior ao empreendimento, com baseline imutável na conversão.
begin;

create table if not exists public.commercial_feasibility_studies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  code text,
  city text,
  state text,
  status text not null default 'draft' check (status in ('draft','converted','rejected')),
  project_type text not null default 'residential' check (project_type in ('residential','commercial','mixed','land','industrial','other')),
  legal_entity_id uuid,

  garage_stairs_area_m2 numeric(16,4) not null default 0 check (garage_stairs_area_m2 >= 0),
  garage_stairs_cost_m2 numeric(16,4) not null default 0 check (garage_stairs_cost_m2 >= 0),
  lobby_area_m2 numeric(16,4) not null default 0 check (lobby_area_m2 >= 0),
  lobby_cost_m2 numeric(16,4) not null default 0 check (lobby_cost_m2 >= 0),
  decorated_common_area_m2 numeric(16,4) not null default 0 check (decorated_common_area_m2 >= 0),
  decorated_common_cost_m2 numeric(16,4) not null default 0 check (decorated_common_cost_m2 >= 0),
  apartment_cost_m2 numeric(16,4) not null default 0 check (apartment_cost_m2 >= 0),
  design_cost_m2 numeric(16,4) not null default 0 check (design_cost_m2 >= 0),

  land_cash_amount numeric(16,2) not null default 0 check (land_cash_amount >= 0),
  iptu_amount numeric(16,2) not null default 0 check (iptu_amount >= 0),
  onerous_grant_amount numeric(16,2) not null default 0 check (onerous_grant_amount >= 0),
  other_land_amount numeric(16,2) not null default 0 check (other_land_amount >= 0),

  commission_pct numeric(8,4) not null default 6 check (commission_pct between 0 and 100),
  tax_regime text not null default 'ret' check (tax_regime in ('ret','common')),
  tax_rate_pct numeric(8,4) not null default 4 check (tax_rate_pct between 0 and 100),
  marketing_amount numeric(16,2) not null default 0 check (marketing_amount >= 0),
  central_office_amount numeric(16,2) not null default 0 check (central_office_amount >= 0),
  financial_cost_amount numeric(16,2) not null default 0 check (financial_cost_amount >= 0),
  contingency_pct numeric(8,4) not null default 0 check (contingency_pct between 0 and 100),

  preconstruction_months integer not null default 6 check (preconstruction_months between 0 and 60),
  construction_duration_months integer not null default 36 check (construction_duration_months between 1 and 180),
  construction_start_date date,
  sales_start_offset_months integer not null default -3 check (sales_start_offset_months between -60 and 180),
  sales_velocity_units_month numeric(12,4) not null default 2 check (sales_velocity_units_month > 0),
  entry_pct numeric(8,4) not null default 10 check (entry_pct between 0 and 100),
  during_construction_pct numeric(8,4) not null default 40 check (during_construction_pct between 0 and 100),
  keys_pct numeric(8,4) not null default 20 check (keys_pct between 0 and 100),
  post_keys_pct numeric(8,4) not null default 30 check (post_keys_pct between 0 and 100),
  post_keys_months integer not null default 24 check (post_keys_months between 1 and 240),
  discount_rate_annual_pct numeric(8,4) not null default 15 check (discount_rate_annual_pct > -100 and discount_rate_annual_pct <= 500),

  approved_metrics jsonb,
  approved_cashflow jsonb,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  converted_project_id uuid references public.projects(id) on delete restrict,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  constraint commercial_feasibility_legal_entity_fk foreign key (company_id, legal_entity_id)
    references public.legal_entities(company_id, id) on delete restrict,
  constraint commercial_feasibility_payment_mix_check check (
    abs((entry_pct + during_construction_pct + keys_pct + post_keys_pct) - 100) < 0.0001
  ),
  constraint commercial_feasibility_state_check check (state is null or char_length(trim(state)) = 2)
);

create unique index if not exists commercial_feasibility_company_code_uq
  on public.commercial_feasibility_studies(company_id, upper(code))
  where code is not null and trim(code) <> '';
create index if not exists commercial_feasibility_company_status_idx
  on public.commercial_feasibility_studies(company_id, status, updated_at desc);

create table if not exists public.commercial_feasibility_unit_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  study_id uuid not null,
  name text not null,
  quantity integer not null check (quantity > 0),
  private_area_m2 numeric(14,4) not null check (private_area_m2 > 0),
  sale_price_m2 numeric(16,4) not null check (sale_price_m2 > 0),
  barter_units integer not null default 0 check (barter_units >= 0),
  sort_order integer not null default 0,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_feasibility_unit_study_fk foreign key (company_id, study_id)
    references public.commercial_feasibility_studies(company_id, id) on delete cascade,
  constraint commercial_feasibility_barter_units_check check (barter_units <= quantity)
);
create index if not exists commercial_feasibility_units_study_idx
  on public.commercial_feasibility_unit_types(company_id, study_id, sort_order, name);

create table if not exists public.commercial_development_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  baseline_study_id uuid not null references public.commercial_feasibility_studies(id) on delete restrict,
  baseline_metrics jsonb not null,
  baseline_cashflow jsonb not null,
  approved_at timestamptz not null,
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(project_id),
  unique(baseline_study_id)
);
create index if not exists commercial_development_profiles_company_idx
  on public.commercial_development_profiles(company_id, project_id);

alter table public.commercial_feasibility_studies enable row level security;
alter table public.commercial_feasibility_unit_types enable row level security;
alter table public.commercial_development_profiles enable row level security;

revoke all on public.commercial_feasibility_studies from anon, authenticated;
revoke all on public.commercial_feasibility_unit_types from anon, authenticated;
revoke all on public.commercial_development_profiles from anon, authenticated;
grant select, insert, update on public.commercial_feasibility_studies to authenticated;
grant select, insert, update, delete on public.commercial_feasibility_unit_types to authenticated;
grant select, insert on public.commercial_development_profiles to authenticated;

drop policy if exists feasibility_studies_select on public.commercial_feasibility_studies;
create policy feasibility_studies_select on public.commercial_feasibility_studies
for select to authenticated
using (
  public.has_company_permission(company_id, 'commercial.incorporation.view')
  or public.has_company_permission(company_id, 'commercial.incorporation.manage')
  or public.has_company_permission(company_id, 'commercial.incorporation.approve')
);

drop policy if exists feasibility_studies_insert on public.commercial_feasibility_studies;
create policy feasibility_studies_insert on public.commercial_feasibility_studies
for insert to authenticated
with check (public.has_company_permission(company_id, 'commercial.incorporation.manage'));

drop policy if exists feasibility_studies_update on public.commercial_feasibility_studies;
create policy feasibility_studies_update on public.commercial_feasibility_studies
for update to authenticated
using (
  public.has_company_permission(company_id, 'commercial.incorporation.manage')
  or public.has_company_permission(company_id, 'commercial.incorporation.approve')
)
with check (
  public.has_company_permission(company_id, 'commercial.incorporation.manage')
  or public.has_company_permission(company_id, 'commercial.incorporation.approve')
);

drop policy if exists feasibility_units_select on public.commercial_feasibility_unit_types;
create policy feasibility_units_select on public.commercial_feasibility_unit_types
for select to authenticated
using (
  public.has_company_permission(company_id, 'commercial.incorporation.view')
  or public.has_company_permission(company_id, 'commercial.incorporation.manage')
  or public.has_company_permission(company_id, 'commercial.incorporation.approve')
);

drop policy if exists feasibility_units_insert on public.commercial_feasibility_unit_types;
create policy feasibility_units_insert on public.commercial_feasibility_unit_types
for insert to authenticated
with check (public.has_company_permission(company_id, 'commercial.incorporation.manage'));

drop policy if exists feasibility_units_update on public.commercial_feasibility_unit_types;
create policy feasibility_units_update on public.commercial_feasibility_unit_types
for update to authenticated
using (public.has_company_permission(company_id, 'commercial.incorporation.manage'))
with check (public.has_company_permission(company_id, 'commercial.incorporation.manage'));

drop policy if exists feasibility_units_delete on public.commercial_feasibility_unit_types;
create policy feasibility_units_delete on public.commercial_feasibility_unit_types
for delete to authenticated
using (public.has_company_permission(company_id, 'commercial.incorporation.manage'));

drop policy if exists development_profiles_select on public.commercial_development_profiles;
create policy development_profiles_select on public.commercial_development_profiles
for select to authenticated
using (
  public.has_company_permission(company_id, 'commercial.incorporation.view')
  or public.has_company_permission(company_id, 'commercial.incorporation.manage')
  or public.has_company_permission(company_id, 'commercial.incorporation.approve')
);

drop policy if exists development_profiles_insert on public.commercial_development_profiles;
create policy development_profiles_insert on public.commercial_development_profiles
for insert to authenticated
with check (public.has_company_permission(company_id, 'commercial.incorporation.approve'));

create or replace function public.commercial_guard_feasibility_study()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    raise exception 'Estudo aprovado/convertido é imutável. Crie um novo estudo para alterar a viabilidade.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists commercial_guard_feasibility_study_trg on public.commercial_feasibility_studies;
create trigger commercial_guard_feasibility_study_trg
before update on public.commercial_feasibility_studies
for each row execute function public.commercial_guard_feasibility_study();

create or replace function public.commercial_guard_feasibility_unit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_study uuid := coalesce(new.study_id, old.study_id);
  target_company uuid := coalesce(new.company_id, old.company_id);
  target_status text;
begin
  select status into target_status
  from public.commercial_feasibility_studies
  where id = target_study and company_id = target_company;
  if target_status is distinct from 'draft' then
    raise exception 'Tipologias de um estudo aprovado/convertido são imutáveis.';
  end if;
  if tg_op <> 'DELETE' then new.updated_at := now(); end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists commercial_guard_feasibility_unit_trg on public.commercial_feasibility_unit_types;
create trigger commercial_guard_feasibility_unit_trg
before insert or update or delete on public.commercial_feasibility_unit_types
for each row execute function public.commercial_guard_feasibility_unit();

create or replace function public.commercial_convert_feasibility_study(p_study_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_study public.commercial_feasibility_studies;
  v_project_id uuid;
  v_user_id uuid := auth.uid();
  v_total_units integer;
  v_private_area numeric;
  v_built_area numeric;
  v_delivery date;
begin
  if v_user_id is null then raise exception 'Usuário não autenticado.'; end if;

  select * into v_study
  from public.commercial_feasibility_studies
  where id = p_study_id
  for update;

  if v_study.id is null then raise exception 'Estudo de viabilidade não encontrado.'; end if;
  if v_study.status <> 'draft' then raise exception 'Este estudo já foi concluído.'; end if;
  if not public.has_company_permission(v_study.company_id, 'commercial.incorporation.approve') then
    raise exception 'Sem permissão para aprovar estudo de viabilidade.';
  end if;
  if not public.has_company_permission(v_study.company_id, 'projects.manage') then
    raise exception 'Sem permissão para criar o empreendimento aprovado.';
  end if;
  if v_study.approved_metrics is null or v_study.approved_cashflow is null then
    raise exception 'Calcule e grave o snapshot econômico antes da aprovação.';
  end if;
  if not exists(select 1 from public.commercial_feasibility_unit_types where study_id = v_study.id) then
    raise exception 'Inclua ao menos uma tipologia de apartamento.';
  end if;

  v_total_units := coalesce((v_study.approved_metrics->>'total_units')::integer, 0);
  v_private_area := coalesce((v_study.approved_metrics->>'apartment_area_m2')::numeric, 0);
  v_built_area := coalesce((v_study.approved_metrics->>'built_area_m2')::numeric, 0);
  if v_total_units <= 0 or v_built_area <= 0 then raise exception 'A viabilidade precisa ter unidades e área construída válidas.'; end if;

  if v_study.construction_start_date is not null then
    v_delivery := (v_study.construction_start_date + make_interval(months => v_study.construction_duration_months))::date;
  end if;

  insert into public.projects(
    company_id, name, code, city, state, status, project_type, legal_entity_id,
    built_area_m2, private_area_m2, common_area_m2, total_units,
    construction_start_date, delivery_date, description, notes, created_by
  ) values (
    v_study.company_id, v_study.name, nullif(trim(v_study.code), ''), v_study.city, v_study.state,
    'planning', v_study.project_type, v_study.legal_entity_id,
    v_built_area, v_private_area, greatest(v_built_area - v_private_area, 0), v_total_units,
    v_study.construction_start_date, v_delivery,
    'Empreendimento criado a partir de estudo de viabilidade de permuta aprovado.',
    concat('Baseline econômico: estudo ', v_study.id::text), v_user_id
  ) returning id into v_project_id;

  insert into public.commercial_development_profiles(
    company_id, project_id, baseline_study_id, baseline_metrics, baseline_cashflow,
    approved_at, approved_by
  ) values (
    v_study.company_id, v_project_id, v_study.id, v_study.approved_metrics, v_study.approved_cashflow,
    now(), v_user_id
  );

  update public.commercial_feasibility_studies
  set status = 'converted', approved_at = now(), approved_by = v_user_id,
      converted_project_id = v_project_id, updated_at = now()
  where id = v_study.id;

  return jsonb_build_object('study_id', v_study.id, 'project_id', v_project_id, 'status', 'converted');
end;
$$;

revoke all on function public.commercial_convert_feasibility_study(uuid) from public, anon;
grant execute on function public.commercial_convert_feasibility_study(uuid) to authenticated;

commit;
