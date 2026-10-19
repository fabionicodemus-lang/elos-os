-- Elos OS — Fundação da importação limpa de sistemas legados
--
-- Princípios (ver docs/integracoes/importacao-limpa.md):
--   * nenhum nome do sistema de origem é gravado em campo visível ao usuário;
--   * o vínculo com a origem vive somente em integration_mappings e em source_system/source_id;
--   * toda gravação é idempotente (rodar de novo atualiza, nunca duplica);
--   * o que não tem par seguro vira pendência em elos_import.issues, nunca um "balde genérico".
--
-- O esquema elos_import é técnico: não é exposto à API pública nem aos usuários autenticados.

begin;

create schema if not exists elos_import;
revoke all on schema elos_import from public, anon, authenticated;

-- Rodadas de importação (uma por onda/execução)
create table if not exists elos_import.runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  wave text not null check (btrim(wave) <> ''),
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Pendências que precisam de decisão humana
create table if not exists elos_import.issues (
  id bigint generated always as identity primary key,
  run_id uuid references elos_import.runs(id) on delete set null,
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  entity text not null,
  source_key text not null,
  problem text not null,
  detail jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, project_id, entity, source_key, problem)
);

-- Cópia de segurança de toda linha apagada pela importação
create table if not exists elos_import.backup_rows (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id uuid,
  row_data jsonb not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists backup_rows_table_idx on elos_import.backup_rows(table_name, row_id);

-- Apaga linhas guardando cópia antes. Uso: select elos_import.backup_and_delete('public.payables', array[...]);
create or replace function elos_import.backup_and_delete(p_table regclass, p_ids uuid[], p_reason text)
returns integer
language plpgsql
security definer
set search_path = public, elos_import
as $$
declare
  v_count integer;
begin
  execute format(
    'insert into elos_import.backup_rows(table_name, row_id, row_data, reason)
       select %L, t.id, to_jsonb(t), $2 from %s t where t.id = any($1)', p_table::text, p_table)
    using p_ids, p_reason;
  execute format('delete from %s where id = any($1)', p_table) using p_ids;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Leitura do de-para: devolve o id da entidade do Elos para uma chave de origem
create or replace function elos_import.map_get(
  p_company_id uuid, p_project_id uuid, p_source_entity text, p_external_key text)
returns uuid
language sql
stable
set search_path = public
as $$
  select m.target_entity_id
  from public.integration_mappings m
  where m.company_id = p_company_id
    and m.source_system = 'koper'
    and m.source_entity_type = public.integration_normalize_key(p_source_entity)
    and m.key_kind = 'id'
    and m.external_key = public.integration_normalize_key(p_external_key)
    and m.status = 'confirmed'
    and ((p_project_id is null and m.scope = 'company') or (m.scope = 'project' and m.scope_id = p_project_id))
  limit 1;
$$;

-- Gravação do de-para (idempotente)
create or replace function elos_import.map_put(
  p_company_id uuid, p_project_id uuid, p_source_entity text, p_external_key text,
  p_target_entity text, p_target_id uuid, p_match_method text,
  p_external_name text default null, p_external_code text default null, p_metadata jsonb default '{}'::jsonb)
returns void
language sql
set search_path = public
as $$
  insert into public.integration_mappings(
    company_id, project_id, source_system, source_entity_type, scope, scope_id, key_kind,
    external_key, external_id, external_code, external_name,
    target_entity_type, target_entity_id, status, match_method, confirmed_at, metadata)
  values (
    p_company_id, p_project_id, 'koper', public.integration_normalize_key(p_source_entity),
    case when p_project_id is null then 'company' else 'project' end,
    coalesce(p_project_id, p_company_id), 'id',
    public.integration_normalize_key(p_external_key), p_external_key, p_external_code, p_external_name,
    public.integration_normalize_key(p_target_entity), p_target_id, 'confirmed', p_match_method, now(), coalesce(p_metadata, '{}'::jsonb))
  on conflict (company_id, source_system, source_entity_type, scope, scope_id, key_kind, external_key)
  do update set target_entity_type = excluded.target_entity_type,
                target_entity_id = excluded.target_entity_id,
                external_name = excluded.external_name,
                external_code = excluded.external_code,
                match_method = excluded.match_method,
                metadata = excluded.metadata,
                status = 'confirmed',
                updated_at = now();
$$;

-- Registro de pendência (idempotente)
create or replace function elos_import.issue(
  p_run_id uuid, p_company_id uuid, p_project_id uuid, p_entity text, p_source_key text, p_problem text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
set search_path = public
as $$
  insert into elos_import.issues(run_id, company_id, project_id, entity, source_key, problem, detail)
  values (p_run_id, p_company_id, p_project_id, p_entity, p_source_key, p_problem, coalesce(p_detail, '{}'::jsonb))
  on conflict (company_id, project_id, entity, source_key, problem)
  do update set detail = excluded.detail, run_id = excluded.run_id, resolved = false;
$$;

revoke all on all tables in schema elos_import from public, anon, authenticated;
revoke all on all functions in schema elos_import from public, anon, authenticated;

-- Método de rateio: nomes neutros, sem o nome do sistema de origem
alter table public.payable_cost_allocations
  drop constraint if exists payable_cost_allocations_resolution_method_check;
alter table public.payable_cost_allocations
  add constraint payable_cost_allocations_resolution_method_check check (resolution_method = any (array[
    'manual',
    'koper_service_order', 'koper_receipt_purchase', 'koper_measurement_contract',
    'koper_invoice_purchase_order', 'koper_monitoring_crosswalk', 'import_other',
    'origin_material_request', 'origin_purchase_order', 'origin_service_contract',
    'origin_measurement', 'origin_title_allocation'
  ]));

commit;
