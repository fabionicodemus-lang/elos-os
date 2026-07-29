\set ON_ERROR_STOP on

begin;

-- A limpeza é intencionalmente limitada à empresa com este nome exato.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.companies
  where lower(trim(name)) = lower('Bossa Empreendimentos');

  if v_count <> 1 then
    raise exception 'Limpeza cancelada: esperada exatamente 1 empresa chamada Bossa Empreendimentos, encontradas %.', v_count;
  end if;
end $$;

create temp table catalog_cleanup_context on commit drop as
select
  gen_random_uuid() as run_id,
  id as company_id,
  name as company_name,
  now() as started_at
from public.companies
where lower(trim(name)) = lower('Bossa Empreendimentos');

-- Backup interno persistente para permitir auditoria ou restauração manual.
create table if not exists public.engineering_catalog_cleanup_backups (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  company_name text not null,
  table_name text not null,
  relation_column text,
  row_key text,
  row_data jsonb not null,
  backed_up_at timestamptz not null default now()
);

create index if not exists engineering_catalog_cleanup_backups_run_idx
  on public.engineering_catalog_cleanup_backups(run_id, table_name);

create table if not exists public.engineering_catalog_cleanup_runs (
  run_id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  company_name text not null,
  services_deleted integer not null,
  inputs_deleted integer not null,
  dependent_rows_deleted jsonb not null default '{}'::jsonb,
  started_at timestamptz not null,
  completed_at timestamptz not null default now()
);

-- Registros principais e dependências que seriam removidas por cascata.
insert into public.engineering_catalog_cleanup_backups(
  run_id, company_id, company_name, table_name, relation_column, row_key, row_data
)
select context.run_id, context.company_id, context.company_name,
       'engineering_services', 'company_id', service.id::text, to_jsonb(service)
from catalog_cleanup_context context
join public.engineering_services service on service.company_id = context.company_id;

insert into public.engineering_catalog_cleanup_backups(
  run_id, company_id, company_name, table_name, relation_column, row_key, row_data
)
select context.run_id, context.company_id, context.company_name,
       'engineering_inputs', 'company_id', input.id::text, to_jsonb(input)
from catalog_cleanup_context context
join public.engineering_inputs input on input.company_id = context.company_id;

insert into public.engineering_catalog_cleanup_backups(
  run_id, company_id, company_name, table_name, relation_column, row_key, row_data
)
select context.run_id, context.company_id, context.company_name,
       'engineering_service_compositions', 'company_id', composition.id::text, to_jsonb(composition)
from catalog_cleanup_context context
join public.engineering_service_compositions composition on composition.company_id = context.company_id;

insert into public.engineering_catalog_cleanup_backups(
  run_id, company_id, company_name, table_name, relation_column, row_key, row_data
)
select context.run_id, context.company_id, context.company_name,
       'engineering_service_composition_items', 'company_id', item.id::text, to_jsonb(item)
from catalog_cleanup_context context
join public.engineering_service_composition_items item on item.company_id = context.company_id;

insert into public.engineering_catalog_cleanup_backups(
  run_id, company_id, company_name, table_name, relation_column, row_key, row_data
)
select context.run_id, context.company_id, context.company_name,
       'engineering_input_prices', 'company_id', price.id::text, to_jsonb(price)
from catalog_cleanup_context context
join public.engineering_input_prices price on price.company_id = context.company_id;

-- Descobre todas as chaves estrangeiras diretas para Serviços e Insumos.
-- Relações RESTRICT/NO ACTION são removidas antes dos catálogos; CASCADE/SET NULL
-- permanecem sob responsabilidade da própria restrição do banco.
do $$
declare
  v_run_id uuid;
  v_company_id uuid;
  v_company_name text;
  v_deleted_by_table jsonb := '{}'::jsonb;
  v_services_before integer;
  v_inputs_before integer;
  v_rows integer;
  v_total integer;
  fk record;
  v_target_table text;
  v_target_source text;
begin
  select run_id, company_id, company_name
    into v_run_id, v_company_id, v_company_name
  from catalog_cleanup_context;

  select count(*) into v_services_before
  from public.engineering_services
  where company_id = v_company_id;

  select count(*) into v_inputs_before
  from public.engineering_inputs
  where company_id = v_company_id;

  if exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.contype = 'f'
      and constraint_record.confrelid in (
        'public.engineering_services'::regclass,
        'public.engineering_inputs'::regclass
      )
      and (
        array_length(constraint_record.conkey, 1) <> 1
        or array_length(constraint_record.confkey, 1) <> 1
      )
  ) then
    raise exception 'Limpeza cancelada: existe chave estrangeira composta apontando para Serviços ou Insumos.';
  end if;

  for fk in
    select
      namespace_record.nspname as schema_name,
      table_record.relname as table_name,
      attribute_record.attname as column_name,
      constraint_record.confrelid,
      constraint_record.confdeltype
    from pg_constraint constraint_record
    join pg_class table_record
      on table_record.oid = constraint_record.conrelid
    join pg_namespace namespace_record
      on namespace_record.oid = table_record.relnamespace
    join pg_attribute attribute_record
      on attribute_record.attrelid = constraint_record.conrelid
     and attribute_record.attnum = constraint_record.conkey[1]
    where constraint_record.contype = 'f'
      and constraint_record.confrelid in (
        'public.engineering_services'::regclass,
        'public.engineering_inputs'::regclass
      )
      and namespace_record.nspname = 'public'
    order by table_record.relname, attribute_record.attname
  loop
    if fk.confrelid = 'public.engineering_services'::regclass then
      v_target_table := 'engineering_services';
      v_target_source := 'public.engineering_services';
    else
      v_target_table := 'engineering_inputs';
      v_target_source := 'public.engineering_inputs';
    end if;

    -- Backup das linhas diretamente relacionadas, inclusive as que serão SET NULL ou CASCADE.
    execute format(
      'insert into public.engineering_catalog_cleanup_backups(
         run_id, company_id, company_name, table_name, relation_column, row_key, row_data
       )
       select $1, $2, $3, %L, %L,
              coalesce(to_jsonb(linked_row)->>''id'', md5(to_jsonb(linked_row)::text)),
              to_jsonb(linked_row)
       from %I.%I linked_row
       where linked_row.%I in (
         select id from %s where company_id = $2
       )',
      fk.table_name,
      fk.column_name,
      fk.schema_name,
      fk.table_name,
      fk.column_name,
      v_target_source
    ) using v_run_id, v_company_id, v_company_name;

    -- confdeltype: a = NO ACTION, r = RESTRICT, c = CASCADE, n = SET NULL, d = SET DEFAULT.
    if fk.confdeltype in ('a', 'r') then
      execute format(
        'delete from %I.%I linked_row
         where linked_row.%I in (
           select id from %s where company_id = $1
         )',
        fk.schema_name,
        fk.table_name,
        fk.column_name,
        v_target_source
      ) using v_company_id;

      get diagnostics v_rows = row_count;
      v_total := coalesce((v_deleted_by_table ->> fk.table_name)::integer, 0) + v_rows;
      v_deleted_by_table := jsonb_set(v_deleted_by_table, array[fk.table_name], to_jsonb(v_total), true);
      raise notice 'Dependência removida: %.% por % (% linha(s)).', fk.schema_name, fk.table_name, fk.column_name, v_rows;
    end if;
  end loop;

  -- Serviços primeiro: suas composições são apagadas por cascata e referências SET NULL são preservadas.
  delete from public.engineering_services
  where company_id = v_company_id;

  get diagnostics v_rows = row_count;
  if v_rows <> v_services_before then
    raise exception 'Quantidade inesperada ao apagar serviços: previstos %, apagados %.', v_services_before, v_rows;
  end if;

  -- Depois dos vínculos e composições, os insumos e respectivos preços podem ser removidos.
  delete from public.engineering_inputs
  where company_id = v_company_id;

  get diagnostics v_rows = row_count;
  if v_rows <> v_inputs_before then
    raise exception 'Quantidade inesperada ao apagar insumos: previstos %, apagados %.', v_inputs_before, v_rows;
  end if;

  if exists (select 1 from public.engineering_services where company_id = v_company_id)
     or exists (select 1 from public.engineering_inputs where company_id = v_company_id) then
    raise exception 'Validação final falhou: ainda existem serviços ou insumos da empresa.';
  end if;

  insert into public.engineering_catalog_cleanup_runs(
    run_id,
    company_id,
    company_name,
    services_deleted,
    inputs_deleted,
    dependent_rows_deleted,
    started_at,
    completed_at
  )
  select
    v_run_id,
    v_company_id,
    v_company_name,
    v_services_before,
    v_inputs_before,
    v_deleted_by_table,
    started_at,
    now()
  from catalog_cleanup_context;

  raise notice 'CLEANUP_RUN_ID=%', v_run_id;
  raise notice 'SERVICES_DELETED=%', v_services_before;
  raise notice 'INPUTS_DELETED=%', v_inputs_before;
  raise notice 'DEPENDENT_ROWS_DELETED=%', v_deleted_by_table;
end $$;

commit;

select
  run_id,
  company_name,
  services_deleted,
  inputs_deleted,
  dependent_rows_deleted,
  completed_at
from public.engineering_catalog_cleanup_runs
where run_id = (
  select run_id
  from public.engineering_catalog_cleanup_runs
  where lower(trim(company_name)) = lower('Bossa Empreendimentos')
  order by completed_at desc
  limit 1
);
