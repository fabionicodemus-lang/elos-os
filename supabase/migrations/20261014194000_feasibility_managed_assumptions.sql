-- Elos OS — Viabilidade: áreas de construção e velocidades de venda gerenciáveis
-- Mantém os campos legados no estudo como fallback e adiciona coleções editáveis.
begin;

create table if not exists public.commercial_feasibility_construction_areas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  study_id uuid not null,
  name text not null,
  area_m2 numeric(16,4) not null check (area_m2 >= 0),
  cost_m2 numeric(16,4) not null check (cost_m2 >= 0),
  source_key text,
  sort_order integer not null default 0,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feasibility_construction_area_study_fk foreign key (company_id, study_id)
    references public.commercial_feasibility_studies(company_id, id) on delete cascade
);

create index if not exists feasibility_construction_areas_study_idx
  on public.commercial_feasibility_construction_areas(company_id, study_id, sort_order, name);
create unique index if not exists feasibility_construction_areas_source_uq
  on public.commercial_feasibility_construction_areas(study_id, source_key)
  where source_key is not null;

create table if not exists public.commercial_feasibility_sales_velocities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  study_id uuid not null,
  name text not null,
  start_offset_months integer not null check (start_offset_months between -60 and 240),
  units_per_month numeric(12,4) not null check (units_per_month > 0),
  sort_order integer not null default 0,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feasibility_sales_velocity_study_fk foreign key (company_id, study_id)
    references public.commercial_feasibility_studies(company_id, id) on delete cascade,
  constraint feasibility_sales_velocity_start_uq unique (study_id, start_offset_months)
);

create index if not exists feasibility_sales_velocities_study_idx
  on public.commercial_feasibility_sales_velocities(company_id, study_id, start_offset_months, sort_order);

-- Converte as áreas legadas existentes em linhas gerenciáveis sem duplicar custo.
insert into public.commercial_feasibility_construction_areas(
  company_id, study_id, name, area_m2, cost_m2, source_key, sort_order, created_by
)
select company_id, id, 'Garagem + escadas', garage_stairs_area_m2, garage_stairs_cost_m2, 'garage_stairs', 10, created_by
from public.commercial_feasibility_studies s
where (garage_stairs_area_m2 > 0 or garage_stairs_cost_m2 > 0)
  and not exists (
    select 1 from public.commercial_feasibility_construction_areas a
    where a.study_id = s.id and a.source_key = 'garage_stairs'
  );

insert into public.commercial_feasibility_construction_areas(
  company_id, study_id, name, area_m2, cost_m2, source_key, sort_order, created_by
)
select company_id, id, 'Hall de entrada', lobby_area_m2, lobby_cost_m2, 'lobby', 20, created_by
from public.commercial_feasibility_studies s
where (lobby_area_m2 > 0 or lobby_cost_m2 > 0)
  and not exists (
    select 1 from public.commercial_feasibility_construction_areas a
    where a.study_id = s.id and a.source_key = 'lobby'
  );

insert into public.commercial_feasibility_construction_areas(
  company_id, study_id, name, area_m2, cost_m2, source_key, sort_order, created_by
)
select company_id, id, 'Áreas comuns decoradas', decorated_common_area_m2, decorated_common_cost_m2, 'decorated_common', 30, created_by
from public.commercial_feasibility_studies s
where (decorated_common_area_m2 > 0 or decorated_common_cost_m2 > 0)
  and not exists (
    select 1 from public.commercial_feasibility_construction_areas a
    where a.study_id = s.id and a.source_key = 'decorated_common'
  );

-- Cada estudo atual recebe uma fase inicial equivalente à premissa legada.
insert into public.commercial_feasibility_sales_velocities(
  company_id, study_id, name, start_offset_months, units_per_month, sort_order, created_by
)
select company_id, id, 'Velocidade padrão', sales_start_offset_months, sales_velocity_units_month, 10, created_by
from public.commercial_feasibility_studies s
where not exists (
  select 1 from public.commercial_feasibility_sales_velocities v where v.study_id = s.id
);

alter table public.commercial_feasibility_construction_areas enable row level security;
alter table public.commercial_feasibility_sales_velocities enable row level security;

revoke all on public.commercial_feasibility_construction_areas from anon, authenticated;
revoke all on public.commercial_feasibility_sales_velocities from anon, authenticated;
grant select, insert, update, delete on public.commercial_feasibility_construction_areas to authenticated;
grant select, insert, update, delete on public.commercial_feasibility_sales_velocities to authenticated;

drop policy if exists feasibility_construction_areas_select on public.commercial_feasibility_construction_areas;
create policy feasibility_construction_areas_select on public.commercial_feasibility_construction_areas
for select to authenticated
using (
  public.has_company_permission(company_id, 'commercial.incorporation.view')
  or public.has_company_permission(company_id, 'commercial.incorporation.manage')
  or public.has_company_permission(company_id, 'commercial.incorporation.approve')
);

drop policy if exists feasibility_construction_areas_insert on public.commercial_feasibility_construction_areas;
create policy feasibility_construction_areas_insert on public.commercial_feasibility_construction_areas
for insert to authenticated
with check (public.has_company_permission(company_id, 'commercial.incorporation.manage'));

drop policy if exists feasibility_construction_areas_update on public.commercial_feasibility_construction_areas;
create policy feasibility_construction_areas_update on public.commercial_feasibility_construction_areas
for update to authenticated
using (public.has_company_permission(company_id, 'commercial.incorporation.manage'))
with check (public.has_company_permission(company_id, 'commercial.incorporation.manage'));

drop policy if exists feasibility_construction_areas_delete on public.commercial_feasibility_construction_areas;
create policy feasibility_construction_areas_delete on public.commercial_feasibility_construction_areas
for delete to authenticated
using (public.has_company_permission(company_id, 'commercial.incorporation.manage'));

drop policy if exists feasibility_sales_velocities_select on public.commercial_feasibility_sales_velocities;
create policy feasibility_sales_velocities_select on public.commercial_feasibility_sales_velocities
for select to authenticated
using (
  public.has_company_permission(company_id, 'commercial.incorporation.view')
  or public.has_company_permission(company_id, 'commercial.incorporation.manage')
  or public.has_company_permission(company_id, 'commercial.incorporation.approve')
);

drop policy if exists feasibility_sales_velocities_insert on public.commercial_feasibility_sales_velocities;
create policy feasibility_sales_velocities_insert on public.commercial_feasibility_sales_velocities
for insert to authenticated
with check (public.has_company_permission(company_id, 'commercial.incorporation.manage'));

drop policy if exists feasibility_sales_velocities_update on public.commercial_feasibility_sales_velocities;
create policy feasibility_sales_velocities_update on public.commercial_feasibility_sales_velocities
for update to authenticated
using (public.has_company_permission(company_id, 'commercial.incorporation.manage'))
with check (public.has_company_permission(company_id, 'commercial.incorporation.manage'));

drop policy if exists feasibility_sales_velocities_delete on public.commercial_feasibility_sales_velocities;
create policy feasibility_sales_velocities_delete on public.commercial_feasibility_sales_velocities
for delete to authenticated
using (public.has_company_permission(company_id, 'commercial.incorporation.manage'));

create or replace function public.commercial_guard_feasibility_child()
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
    raise exception 'Premissas de um estudo aprovado/convertido são imutáveis.';
  end if;

  if tg_op <> 'DELETE' then new.updated_at := now(); end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists commercial_guard_feasibility_construction_area_trg on public.commercial_feasibility_construction_areas;
create trigger commercial_guard_feasibility_construction_area_trg
before insert or update or delete on public.commercial_feasibility_construction_areas
for each row execute function public.commercial_guard_feasibility_child();

drop trigger if exists commercial_guard_feasibility_sales_velocity_trg on public.commercial_feasibility_sales_velocities;
create trigger commercial_guard_feasibility_sales_velocity_trg
before insert or update or delete on public.commercial_feasibility_sales_velocities
for each row execute function public.commercial_guard_feasibility_child();

commit;
