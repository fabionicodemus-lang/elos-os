-- Elos OS — Mapa de Integrações genérico
-- Fundação para de-para entre sistemas externos e entidades nativas do Elos.
-- Mantém compatibilidade com engineering_cost_center_mappings (Koper -> serviço).

begin;

create or replace function public.integration_normalize_key(p_value text)
returns text
language sql
immutable
as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p_value, '')), '[[:space:]]+', ' ', 'g')), '');
$$;

create or replace function public.integration_name_unit_key(p_name text, p_unit text)
returns text
language sql
immutable
as $$
  select case
    when public.integration_normalize_key(p_name) is null then null
    else public.integration_normalize_key(p_name) || '|' || coalesce(public.integration_normalize_key(p_unit), '')
  end;
$$;

create table if not exists public.integration_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,

  source_system text not null
    check (source_system <> '' and source_system = public.integration_normalize_key(source_system)),
  source_entity_type text not null
    check (source_entity_type <> '' and source_entity_type = public.integration_normalize_key(source_entity_type)),

  scope text not null default 'company'
    check (scope in ('company', 'project')),
  scope_id uuid not null,

  key_kind text not null
    check (key_kind in ('id', 'code', 'name_unit', 'custom')),
  external_key text not null
    check (external_key <> '' and external_key = public.integration_normalize_key(external_key)),
  external_id text,
  external_code text,
  external_name text,
  external_unit text,

  target_entity_type text not null
    check (target_entity_type <> '' and target_entity_type = public.integration_normalize_key(target_entity_type)),
  target_entity_id uuid not null,

  status text not null default 'confirmed'
    check (status in ('confirmed', 'suggested', 'rejected', 'inactive')),
  confidence numeric(5,2)
    check (confidence is null or (confidence >= 0 and confidence <= 100)),
  match_method text not null default 'manual'
    check (btrim(match_method) <> ''),

  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint integration_mappings_scope_consistency check (
    (scope = 'company' and project_id is null and scope_id = company_id)
    or
    (scope = 'project' and project_id is not null and scope_id = project_id)
  )
);

create unique index if not exists integration_mappings_source_key_uq
  on public.integration_mappings(
    company_id,
    source_system,
    source_entity_type,
    scope,
    scope_id,
    key_kind,
    external_key
  );

create index if not exists integration_mappings_target_idx
  on public.integration_mappings(company_id, target_entity_type, target_entity_id);

create index if not exists integration_mappings_lookup_idx
  on public.integration_mappings(
    company_id,
    source_system,
    source_entity_type,
    key_kind,
    external_key,
    status
  );

comment on table public.integration_mappings is
  'Mapa genérico de integrações. Traduz IDs/códigos/aliases externos para entidades canônicas do Elos, sem usar a estrutura do ERP como identidade interna.';
comment on column public.integration_mappings.external_key is
  'Chave normalizada usada no matching persistente. O dado original permanece nos campos external_*.';
comment on column public.integration_mappings.target_entity_id is
  'ID da entidade canônica no Elos. O tipo está em target_entity_type; a validação específica é feita pelo fluxo que cria o vínculo.';

alter table public.integration_mappings enable row level security;

drop policy if exists integration_mappings_select on public.integration_mappings;
create policy integration_mappings_select
  on public.integration_mappings for select to authenticated
  using (public.is_company_member(company_id));

revoke all on public.integration_mappings from anon, authenticated;
grant select on public.integration_mappings to authenticated;

create table if not exists public.integration_mapping_audit (
  id bigint generated always as identity primary key,
  mapping_id uuid references public.integration_mappings(id) on delete set null,
  company_id uuid not null references public.companies(id) on delete cascade,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists integration_mapping_audit_mapping_idx
  on public.integration_mapping_audit(mapping_id, created_at desc);
create index if not exists integration_mapping_audit_company_idx
  on public.integration_mapping_audit(company_id, created_at desc);

alter table public.integration_mapping_audit enable row level security;

drop policy if exists integration_mapping_audit_select on public.integration_mapping_audit;
create policy integration_mapping_audit_select
  on public.integration_mapping_audit for select to authenticated
  using (public.is_company_member(company_id));

revoke all on public.integration_mapping_audit from anon, authenticated;
grant select on public.integration_mapping_audit to authenticated;

create or replace function public.integration_mapping_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.integration_mapping_audit (
      mapping_id, company_id, action, old_data, new_data, changed_by
    ) values (
      new.id, new.company_id, 'insert', null, to_jsonb(new), coalesce(auth.uid(), new.confirmed_by, new.created_by)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.integration_mapping_audit (
      mapping_id, company_id, action, old_data, new_data, changed_by
    ) values (
      new.id, new.company_id, 'update', to_jsonb(old), to_jsonb(new), coalesce(auth.uid(), new.confirmed_by, new.created_by)
    );
    return new;
  else
    insert into public.integration_mapping_audit (
      mapping_id, company_id, action, old_data, new_data, changed_by
    ) values (
      old.id, old.company_id, 'delete', to_jsonb(old), null, auth.uid()
    );
    return old;
  end if;
end;
$$;

revoke all on function public.integration_mapping_audit_trigger() from public, anon, authenticated;

drop trigger if exists integration_mappings_audit on public.integration_mappings;
create trigger integration_mappings_audit
after insert or update or delete on public.integration_mappings
for each row execute function public.integration_mapping_audit_trigger();

create or replace function public.resolve_integration_mapping(
  p_company_id uuid,
  p_project_id uuid,
  p_source_system text,
  p_source_entity_type text,
  p_external_id text default null,
  p_external_code text default null,
  p_external_name text default null,
  p_external_unit text default null,
  p_target_entity_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_system text := public.integration_normalize_key(p_source_system);
  v_source_entity_type text := public.integration_normalize_key(p_source_entity_type);
  v_target_entity_type text := public.integration_normalize_key(p_target_entity_type);
  v_target_id uuid;
begin
  if p_company_id is null or v_source_system is null or v_source_entity_type is null then
    return null;
  end if;

  if auth.uid() is not null and not public.is_company_member(p_company_id) then
    return null;
  end if;

  with candidates(priority, key_kind, external_key) as (
    values
      (1, 'id'::text, public.integration_normalize_key(p_external_id)),
      (2, 'code'::text, public.integration_normalize_key(p_external_code)),
      (3, 'name_unit'::text, public.integration_name_unit_key(p_external_name, p_external_unit))
  )
  select mapping.target_entity_id
    into v_target_id
  from public.integration_mappings mapping
  join candidates candidate
    on candidate.key_kind = mapping.key_kind
   and candidate.external_key = mapping.external_key
  where candidate.external_key is not null
    and mapping.company_id = p_company_id
    and mapping.source_system = v_source_system
    and mapping.source_entity_type = v_source_entity_type
    and mapping.status = 'confirmed'
    and (v_target_entity_type is null or mapping.target_entity_type = v_target_entity_type)
    and (
      (p_project_id is not null and mapping.scope = 'project' and mapping.scope_id = p_project_id)
      or
      (mapping.scope = 'company' and mapping.scope_id = p_company_id)
    )
  order by
    case when p_project_id is not null and mapping.scope = 'project' then 0 else 1 end,
    candidate.priority,
    mapping.updated_at desc
  limit 1;

  return v_target_id;
end;
$$;

create or replace function public.upsert_integration_mapping(
  p_company_id uuid,
  p_source_system text,
  p_source_entity_type text,
  p_target_entity_type text,
  p_target_entity_id uuid,
  p_project_id uuid default null,
  p_external_id text default null,
  p_external_code text default null,
  p_external_name text default null,
  p_external_unit text default null,
  p_status text default 'confirmed',
  p_confidence numeric default 100,
  p_match_method text default 'manual',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_system text := public.integration_normalize_key(p_source_system);
  v_source_entity_type text := public.integration_normalize_key(p_source_entity_type);
  v_target_entity_type text := public.integration_normalize_key(p_target_entity_type);
  v_scope text := case when p_project_id is null then 'company' else 'project' end;
  v_scope_id uuid := coalesce(p_project_id, p_company_id);
  v_status text := lower(btrim(coalesce(p_status, 'confirmed')));
  v_match_method text := btrim(coalesce(p_match_method, 'manual'));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_key_kind text;
  v_external_key text;
  v_mapping_id uuid;
  v_ids uuid[] := '{}'::uuid[];
begin
  if p_company_id is null or p_target_entity_id is null then
    raise exception 'Empresa e entidade alvo são obrigatórias.';
  end if;
  if v_source_system is null or v_source_entity_type is null or v_target_entity_type is null then
    raise exception 'Sistema, entidade de origem e entidade alvo são obrigatórios.';
  end if;
  if v_status not in ('confirmed', 'suggested', 'rejected', 'inactive') then
    raise exception 'Status de mapeamento inválido: %', v_status;
  end if;
  if p_confidence is not null and (p_confidence < 0 or p_confidence > 100) then
    raise exception 'Confiança deve estar entre 0 e 100.';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'metadata deve ser um objeto JSON.';
  end if;

  if p_project_id is not null and not exists (
    select 1 from public.projects project
    where project.id = p_project_id and project.company_id = p_company_id
  ) then
    raise exception 'Empreendimento não pertence à empresa informada.';
  end if;

  if auth.uid() is not null
     and not (
       public.has_company_permission(p_company_id, 'projects.manage')
       or public.has_company_permission(p_company_id, 'admin.company.manage')
     ) then
    raise exception 'Sem permissão para gerenciar o Mapa de Integrações.';
  end if;

  -- Validação forte para o primeiro alvo usado pelo mapa. Outros tipos podem
  -- adicionar validação equivalente quando forem conectados ao importador.
  if v_target_entity_type = 'engineering_service' and not exists (
    select 1 from public.engineering_services service
    where service.id = p_target_entity_id and service.company_id = p_company_id
  ) then
    raise exception 'Serviço alvo não pertence à empresa informada.';
  end if;

  if public.integration_normalize_key(p_external_id) is null
     and public.integration_normalize_key(p_external_code) is null
     and public.integration_name_unit_key(p_external_name, p_external_unit) is null then
    raise exception 'Informe external_id, external_code ou external_name para criar o mapeamento.';
  end if;

  for v_key_kind, v_external_key in
    select key_kind, external_key
    from (
      values
        ('id'::text, public.integration_normalize_key(p_external_id)),
        ('code'::text, public.integration_normalize_key(p_external_code)),
        ('name_unit'::text, public.integration_name_unit_key(p_external_name, p_external_unit))
    ) as keys(key_kind, external_key)
    where external_key is not null
  loop
    insert into public.integration_mappings (
      company_id,
      project_id,
      source_system,
      source_entity_type,
      scope,
      scope_id,
      key_kind,
      external_key,
      external_id,
      external_code,
      external_name,
      external_unit,
      target_entity_type,
      target_entity_id,
      status,
      confidence,
      match_method,
      confirmed_by,
      confirmed_at,
      metadata,
      created_by,
      updated_at
    ) values (
      p_company_id,
      p_project_id,
      v_source_system,
      v_source_entity_type,
      v_scope,
      v_scope_id,
      v_key_kind,
      v_external_key,
      nullif(btrim(p_external_id), ''),
      nullif(btrim(p_external_code), ''),
      nullif(btrim(p_external_name), ''),
      nullif(btrim(p_external_unit), ''),
      v_target_entity_type,
      p_target_entity_id,
      v_status,
      p_confidence,
      v_match_method,
      case when v_status = 'confirmed' then auth.uid() else null end,
      case when v_status = 'confirmed' then now() else null end,
      v_metadata,
      auth.uid(),
      now()
    )
    on conflict (
      company_id,
      source_system,
      source_entity_type,
      scope,
      scope_id,
      key_kind,
      external_key
    )
    do update set
      project_id = excluded.project_id,
      external_id = coalesce(excluded.external_id, integration_mappings.external_id),
      external_code = coalesce(excluded.external_code, integration_mappings.external_code),
      external_name = coalesce(excluded.external_name, integration_mappings.external_name),
      external_unit = coalesce(excluded.external_unit, integration_mappings.external_unit),
      target_entity_type = excluded.target_entity_type,
      target_entity_id = excluded.target_entity_id,
      status = excluded.status,
      confidence = excluded.confidence,
      match_method = excluded.match_method,
      confirmed_by = case when excluded.status = 'confirmed' then coalesce(excluded.confirmed_by, integration_mappings.confirmed_by) else null end,
      confirmed_at = case when excluded.status = 'confirmed' then coalesce(integration_mappings.confirmed_at, now()) else null end,
      metadata = integration_mappings.metadata || excluded.metadata,
      updated_at = now()
    returning id into v_mapping_id;

    v_ids := array_append(v_ids, v_mapping_id);
  end loop;

  return v_ids;
end;
$$;

create or replace function public.set_integration_mapping_status(
  p_mapping_id uuid,
  p_status text,
  p_reason text default null
)
returns public.integration_mappings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mapping public.integration_mappings%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
begin
  select * into v_mapping
  from public.integration_mappings
  where id = p_mapping_id;

  if not found then
    raise exception 'Mapeamento não encontrado.';
  end if;
  if v_status not in ('confirmed', 'suggested', 'rejected', 'inactive') then
    raise exception 'Status de mapeamento inválido: %', v_status;
  end if;
  if auth.uid() is not null
     and not (
       public.has_company_permission(v_mapping.company_id, 'projects.manage')
       or public.has_company_permission(v_mapping.company_id, 'admin.company.manage')
     ) then
    raise exception 'Sem permissão para gerenciar o Mapa de Integrações.';
  end if;

  update public.integration_mappings
  set status = v_status,
      confirmed_by = case when v_status = 'confirmed' then auth.uid() else null end,
      confirmed_at = case when v_status = 'confirmed' then now() else null end,
      metadata = case
        when nullif(btrim(p_reason), '') is null then metadata
        else metadata || jsonb_build_object('status_reason', btrim(p_reason))
      end,
      updated_at = now()
  where id = p_mapping_id
  returning * into v_mapping;

  return v_mapping;
end;
$$;

revoke all on function public.resolve_integration_mapping(uuid, uuid, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.upsert_integration_mapping(uuid, text, text, text, uuid, uuid, text, text, text, text, text, numeric, text, jsonb) from public, anon;
revoke all on function public.set_integration_mapping_status(uuid, text, text) from public, anon;
grant execute on function public.resolve_integration_mapping(uuid, uuid, text, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.upsert_integration_mapping(uuid, text, text, text, uuid, uuid, text, text, text, text, text, numeric, text, jsonb) to authenticated, service_role;
grant execute on function public.set_integration_mapping_status(uuid, text, text) to authenticated, service_role;

-- Backfill 1: de-para Koper já aprendido no módulo de engenharia.
insert into public.integration_mappings (
  company_id,
  project_id,
  source_system,
  source_entity_type,
  scope,
  scope_id,
  key_kind,
  external_key,
  external_code,
  external_name,
  target_entity_type,
  target_entity_id,
  status,
  confidence,
  match_method,
  confirmed_at,
  metadata,
  created_at,
  updated_at
)
select
  mapping.company_id,
  mapping.project_id,
  public.integration_normalize_key(mapping.source_system),
  'cost_center',
  'project',
  mapping.project_id,
  'code',
  public.integration_normalize_key(mapping.source_code),
  mapping.source_code,
  mapping.source_name,
  'engineering_service',
  mapping.service_id,
  'confirmed',
  100,
  'legacy_backfill',
  coalesce(mapping.updated_at, mapping.created_at, now()),
  jsonb_build_object('legacy_table', 'engineering_cost_center_mappings'),
  coalesce(mapping.created_at, now()),
  coalesce(mapping.updated_at, mapping.created_at, now())
from public.engineering_cost_center_mappings mapping
where public.integration_normalize_key(mapping.source_system) is not null
  and public.integration_normalize_key(mapping.source_code) is not null
on conflict (
  company_id,
  source_system,
  source_entity_type,
  scope,
  scope_id,
  key_kind,
  external_key
)
do update set
  external_name = coalesce(excluded.external_name, integration_mappings.external_name),
  target_entity_type = excluded.target_entity_type,
  target_entity_id = excluded.target_entity_id,
  status = 'confirmed',
  confidence = 100,
  match_method = 'legacy_backfill',
  confirmed_at = coalesce(integration_mappings.confirmed_at, excluded.confirmed_at),
  metadata = integration_mappings.metadata || excluded.metadata,
  updated_at = now();

-- Backfill 2: IDs de origem já conhecidos no catálogo técnico passam a ser aliases globais da empresa.
insert into public.integration_mappings (
  company_id,
  project_id,
  source_system,
  source_entity_type,
  scope,
  scope_id,
  key_kind,
  external_key,
  external_id,
  external_name,
  target_entity_type,
  target_entity_id,
  status,
  confidence,
  match_method,
  confirmed_at,
  metadata
)
select
  service.company_id,
  null,
  public.integration_normalize_key(service.source_system),
  'service',
  'company',
  service.company_id,
  'id',
  public.integration_normalize_key(service.source_id),
  service.source_id,
  service.description,
  'engineering_service',
  service.id,
  'confirmed',
  100,
  'legacy_backfill',
  now(),
  jsonb_build_object('legacy_source', 'engineering_services.source_id')
from public.engineering_services service
where public.integration_normalize_key(service.source_system) is not null
  and public.integration_normalize_key(service.source_id) is not null
on conflict (
  company_id,
  source_system,
  source_entity_type,
  scope,
  scope_id,
  key_kind,
  external_key
)
do update set
  external_name = coalesce(excluded.external_name, integration_mappings.external_name),
  target_entity_type = excluded.target_entity_type,
  target_entity_id = excluded.target_entity_id,
  status = 'confirmed',
  confidence = 100,
  match_method = 'legacy_backfill',
  metadata = integration_mappings.metadata || excluded.metadata,
  updated_at = now();

-- Compatibilidade: o resolvedor atual de centro de custo passa a consultar primeiro
-- o mapa genérico. O fallback legado permanece enquanto os importadores antigos existirem.
create or replace function public.resolve_engineering_cost_center_service(
  p_company_id uuid,
  p_project_id uuid,
  p_source_system text,
  p_source_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_system text := coalesce(public.integration_normalize_key(p_source_system), 'koper');
  v_source_code text := public.integration_normalize_key(p_source_code);
  v_service_id uuid;
begin
  if p_company_id is null or p_project_id is null or v_source_code is null then
    return null;
  end if;

  v_service_id := public.resolve_integration_mapping(
    p_company_id,
    p_project_id,
    v_source_system,
    'cost_center',
    null,
    v_source_code,
    null,
    null,
    'engineering_service'
  );

  if v_service_id is not null then
    return v_service_id;
  end if;

  select mapping.service_id
    into v_service_id
  from public.engineering_cost_center_mappings mapping
  join public.engineering_services service
    on service.id = mapping.service_id
   and service.company_id = p_company_id
  where mapping.company_id = p_company_id
    and mapping.project_id = p_project_id
    and mapping.source_system = v_source_system
    and mapping.source_code = v_source_code
  limit 1;

  if v_service_id is not null then
    return v_service_id;
  end if;

  select mapping.service_id
    into v_service_id
  from public.engineering_cost_center_mappings mapping
  join public.engineering_services service
    on service.id = mapping.service_id
   and service.company_id = p_company_id
  where mapping.company_id = p_company_id
    and mapping.project_id = p_project_id
    and mapping.source_code = v_source_code
  order by case when mapping.source_system = 'koper' then 0 else 1 end,
           mapping.updated_at desc
  limit 1;

  if v_service_id is not null then
    return v_service_id;
  end if;

  select service.id
    into v_service_id
  from public.engineering_services service
  where service.company_id = p_company_id
    and (
      public.integration_normalize_key(service.code) = v_source_code
      or public.integration_normalize_key(service.source_id) = v_source_code
    )
  order by case when public.integration_normalize_key(service.source_system) = 'koper' then 0 else 1 end,
           service.updated_at desc nulls last,
           service.id
  limit 1;

  return v_service_id;
end;
$$;

create or replace function public.remember_engineering_cost_center_mapping(
  p_company_id uuid,
  p_project_id uuid,
  p_source_system text,
  p_source_code text,
  p_source_name text,
  p_service_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_system text := coalesce(public.integration_normalize_key(p_source_system), 'koper');
  v_source_code text := public.integration_normalize_key(p_source_code);
begin
  if p_company_id is null
     or p_project_id is null
     or p_service_id is null
     or v_source_code is null then
    return;
  end if;

  if not exists (
    select 1
    from public.engineering_services service
    where service.id = p_service_id
      and service.company_id = p_company_id
  ) then
    raise exception 'Serviço do de-para não pertence à empresa informada.';
  end if;

  insert into public.engineering_cost_center_mappings (
    company_id,
    project_id,
    source_system,
    source_code,
    source_name,
    service_id
  ) values (
    p_company_id,
    p_project_id,
    v_source_system,
    v_source_code,
    nullif(btrim(p_source_name), ''),
    p_service_id
  )
  on conflict (company_id, project_id, source_system, source_code)
  do update set
    source_name = coalesce(excluded.source_name, engineering_cost_center_mappings.source_name),
    service_id = excluded.service_id,
    updated_at = now();

  perform public.upsert_integration_mapping(
    p_company_id,
    v_source_system,
    'cost_center',
    'engineering_service',
    p_service_id,
    p_project_id,
    null,
    v_source_code,
    p_source_name,
    null,
    'confirmed',
    100,
    'rule',
    jsonb_build_object('bridge', 'engineering_cost_center_mappings')
  );
end;
$$;

revoke all on function public.resolve_engineering_cost_center_service(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.remember_engineering_cost_center_mapping(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;

commit;
