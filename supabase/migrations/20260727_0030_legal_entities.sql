-- Elos OS — Empreendimentos · Empresas e SPEs
-- Cadastro fiscal central separado da empresa de acesso/multiempresa.

begin;

create or replace function public.is_valid_cnpj(p_value text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  cnpj text := regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g');
  total integer := 0;
  remainder integer;
  digit_one integer;
  digit_two integer;
  position integer;
  weights_one integer[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  weights_two integer[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if length(cnpj) <> 14 or cnpj ~ '^([0-9])\1{13}$' then
    return false;
  end if;

  for position in 1..12 loop
    total := total + substring(cnpj from position for 1)::integer * weights_one[position];
  end loop;
  remainder := total % 11;
  digit_one := case when remainder < 2 then 0 else 11 - remainder end;

  total := 0;
  for position in 1..13 loop
    total := total + substring(cnpj from position for 1)::integer * weights_two[position];
  end loop;
  remainder := total % 11;
  digit_two := case when remainder < 2 then 0 else 11 - remainder end;

  return substring(cnpj from 13 for 1)::integer = digit_one
     and substring(cnpj from 14 for 1)::integer = digit_two;
end;
$$;

create table if not exists public.legal_entities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  parent_entity_id uuid,
  entity_type text not null default 'spe' check (entity_type in ('incorporator', 'spe', 'holding', 'other')),
  legal_name text not null,
  trade_name text,
  cnpj text,
  state_registration text,
  municipal_registration text,
  email text,
  phone text,
  postal_code text,
  street text,
  address_number text,
  complement text,
  district text,
  city text,
  state text,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  is_primary boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  constraint legal_entities_state_check check (state is null or char_length(trim(state)) = 2),
  constraint legal_entities_cnpj_check check (cnpj is null or public.is_valid_cnpj(cnpj)),
  constraint legal_entities_parent_fk foreign key (company_id, parent_entity_id)
    references public.legal_entities(company_id, id) on delete restrict
);

create unique index if not exists legal_entities_company_cnpj_unique_idx
  on public.legal_entities(company_id, regexp_replace(cnpj, '[^0-9]', '', 'g'))
  where cnpj is not null and trim(cnpj) <> '';

create unique index if not exists legal_entities_one_primary_idx
  on public.legal_entities(company_id)
  where is_primary = true;

create index if not exists legal_entities_company_status_idx
  on public.legal_entities(company_id, status, entity_type, legal_name);

alter table public.projects
  add column if not exists legal_entity_id uuid;

alter table public.projects
  drop constraint if exists projects_legal_entity_fk;

alter table public.projects
  add constraint projects_legal_entity_fk
  foreign key (company_id, legal_entity_id)
  references public.legal_entities(company_id, id)
  on delete restrict;

create index if not exists projects_legal_entity_idx
  on public.projects(company_id, legal_entity_id);

alter table public.legal_entities enable row level security;

drop policy if exists legal_entities_select on public.legal_entities;
create policy legal_entities_select on public.legal_entities
for select to authenticated
using (
  public.is_company_member(company_id)
  or public.has_company_permission(company_id, 'projects.view')
  or public.has_company_permission(company_id, 'projects.manage')
);

drop policy if exists legal_entities_insert on public.legal_entities;
create policy legal_entities_insert on public.legal_entities
for insert to authenticated
with check (
  public.has_company_permission(company_id, 'projects.manage')
  or public.has_company_permission(company_id, 'admin.company.manage')
);

drop policy if exists legal_entities_update on public.legal_entities;
create policy legal_entities_update on public.legal_entities
for update to authenticated
using (
  public.has_company_permission(company_id, 'projects.manage')
  or public.has_company_permission(company_id, 'admin.company.manage')
)
with check (
  public.has_company_permission(company_id, 'projects.manage')
  or public.has_company_permission(company_id, 'admin.company.manage')
);

-- Cria uma empresa fiscal inicial por ambiente já existente.
insert into public.legal_entities (
  company_id,
  entity_type,
  legal_name,
  trade_name,
  cnpj,
  status,
  is_primary,
  created_by
)
select
  company.id,
  'incorporator',
  company.name,
  company.name,
  case
    when public.is_valid_cnpj(company.document) then regexp_replace(company.document, '[^0-9]', '', 'g')
    else null
  end,
  'active',
  true,
  company.created_by
from public.companies company
where not exists (
  select 1 from public.legal_entities entity
  where entity.company_id = company.id
);

-- Vincula as obras atuais à empresa fiscal principal do ambiente.
update public.projects project
set legal_entity_id = entity.id,
    updated_at = now()
from public.legal_entities entity
where project.company_id = entity.company_id
  and entity.is_primary = true
  and project.legal_entity_id is null;

create or replace function public.validate_project_legal_entity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.legal_entity_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.legal_entities entity
    where entity.id = new.legal_entity_id
      and entity.company_id = new.company_id
      and entity.status = 'active'
      and public.is_valid_cnpj(entity.cnpj)
  ) then
    raise exception 'Selecione uma empresa/SPE ativa com CNPJ válido para o empreendimento.';
  end if;

  return new;
end;
$$;

drop trigger if exists projects_validate_legal_entity on public.projects;
create trigger projects_validate_legal_entity
before insert or update of legal_entity_id, company_id
on public.projects
for each row
execute function public.validate_project_legal_entity();

create or replace function public.protect_linked_legal_entity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'active' and new.status = 'inactive' and exists (
    select 1
    from public.projects project
    where project.legal_entity_id = old.id
      and project.status <> 'archived'
  ) then
    raise exception 'A empresa está vinculada a empreendimento não arquivado. Altere o vínculo antes de inativá-la.';
  end if;

  if new.parent_entity_id = new.id then
    raise exception 'A empresa não pode ser controladora de si mesma.';
  end if;

  new.cnpj := nullif(regexp_replace(coalesce(new.cnpj, ''), '[^0-9]', '', 'g'), '');
  new.state := nullif(upper(trim(coalesce(new.state, ''))), '');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists legal_entities_protect_linked on public.legal_entities;
create trigger legal_entities_protect_linked
before update on public.legal_entities
for each row
execute function public.protect_linked_legal_entity();

create or replace function public.normalize_new_legal_entity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.cnpj := nullif(regexp_replace(coalesce(new.cnpj, ''), '[^0-9]', '', 'g'), '');
  new.state := nullif(upper(trim(coalesce(new.state, ''))), '');
  return new;
end;
$$;

drop trigger if exists legal_entities_normalize_insert on public.legal_entities;
create trigger legal_entities_normalize_insert
before insert on public.legal_entities
for each row
execute function public.normalize_new_legal_entity();

grant select, insert, update on public.legal_entities to authenticated;
grant execute on function public.is_valid_cnpj(text) to authenticated;

commit;
