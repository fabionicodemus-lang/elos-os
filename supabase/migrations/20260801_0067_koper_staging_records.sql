-- Elos OS — staging canônica do conector Koper (somente leitura no app)

begin;

create table if not exists public.koper_staging_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source text not null default 'koper' check (source = 'koper'),
  entity text not null check (trim(entity) <> ''),
  koper_id text not null check (trim(koper_id) <> ''),
  koper_parent_id text,
  payload jsonb not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  koper_created_at timestamptz,
  koper_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processed', 'error')),
  processing_error text,
  mapping_version integer not null check (mapping_version > 0),
  sync_state text not null default 'present'
    check (sync_state in ('present', 'missing_at_source')),
  elos_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source, entity, koper_id)
);

create index if not exists koper_staging_records_entity_seen_idx
  on public.koper_staging_records(company_id, entity, last_seen_at desc);
create index if not exists koper_staging_records_processing_idx
  on public.koper_staging_records(company_id, processing_status, entity);

alter table public.koper_staging_records enable row level security;

drop policy if exists koper_staging_records_select on public.koper_staging_records;
create policy koper_staging_records_select
  on public.koper_staging_records for select to authenticated
  using (public.is_company_member(company_id));

revoke all on public.koper_staging_records from anon, authenticated;
grant select on public.koper_staging_records to authenticated;

commit;
