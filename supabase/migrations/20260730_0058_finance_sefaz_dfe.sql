begin;

create table if not exists public.finance_sefaz_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  environment text not null default 'production' check (environment in ('production','homologation')),
  state_code text not null,
  tax_id text not null,
  certificate_storage_path text not null,
  certificate_file_name text not null,
  certificate_password_encrypted text not null,
  certificate_expires_at timestamptz,
  last_nsu text not null default '000000000000000',
  max_nsu text not null default '000000000000000',
  last_sync_at timestamptz,
  last_status_code text,
  last_status_message text,
  status text not null default 'active' check (status in ('active','inactive','error')),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, legal_entity_id, environment)
);

create table if not exists public.finance_sefaz_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  connection_id uuid not null references public.finance_sefaz_connections(id) on delete cascade,
  nsu text not null,
  schema_name text not null,
  access_key text,
  issuer_tax_id text,
  issuer_name text,
  issue_datetime timestamptz,
  total_amount numeric(18,2),
  sefaz_document_status text,
  document_kind text not null default 'summary' check (document_kind in ('summary','full_xml','event')),
  processing_status text not null default 'available' check (processing_status in ('available','imported','ignored','error')),
  xml_storage_path text,
  imported_invoice_id uuid references public.finance_electronic_invoices(id) on delete set null,
  raw_summary jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, nsu, schema_name)
);

create unique index if not exists finance_sefaz_documents_access_key_full_uk
  on public.finance_sefaz_documents(company_id, legal_entity_id, access_key)
  where access_key is not null and document_kind = 'full_xml';

create table if not exists public.finance_sefaz_sync_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  legal_entity_id uuid not null references public.legal_entities(id) on delete cascade,
  connection_id uuid not null references public.finance_sefaz_connections(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  start_nsu text not null,
  final_nsu text,
  max_nsu text,
  status_code text,
  status_message text,
  documents_received integer not null default 0,
  full_xml_received integer not null default 0,
  status text not null default 'running' check (status in ('running','success','error')),
  error_message text,
  created_by uuid references auth.users(id)
);

create index if not exists finance_sefaz_documents_company_idx on public.finance_sefaz_documents(company_id, legal_entity_id, processing_status, issue_datetime desc);
create index if not exists finance_sefaz_sync_logs_connection_idx on public.finance_sefaz_sync_logs(connection_id, started_at desc);

alter table public.finance_sefaz_connections enable row level security;
alter table public.finance_sefaz_documents enable row level security;
alter table public.finance_sefaz_sync_logs enable row level security;

drop policy if exists finance_sefaz_connections_select on public.finance_sefaz_connections;
create policy finance_sefaz_connections_select on public.finance_sefaz_connections for select to authenticated
using (public.has_company_permission(company_id, 'finance.invoices.view'));
drop policy if exists finance_sefaz_connections_manage on public.finance_sefaz_connections;
create policy finance_sefaz_connections_manage on public.finance_sefaz_connections for all to authenticated
using (public.has_company_permission(company_id, 'finance.invoices.manage'))
with check (public.has_company_permission(company_id, 'finance.invoices.manage'));

drop policy if exists finance_sefaz_documents_select on public.finance_sefaz_documents;
create policy finance_sefaz_documents_select on public.finance_sefaz_documents for select to authenticated
using (public.has_company_permission(company_id, 'finance.invoices.view'));
drop policy if exists finance_sefaz_documents_manage on public.finance_sefaz_documents;
create policy finance_sefaz_documents_manage on public.finance_sefaz_documents for all to authenticated
using (public.has_company_permission(company_id, 'finance.invoices.manage'))
with check (public.has_company_permission(company_id, 'finance.invoices.manage'));

drop policy if exists finance_sefaz_sync_logs_select on public.finance_sefaz_sync_logs;
create policy finance_sefaz_sync_logs_select on public.finance_sefaz_sync_logs for select to authenticated
using (public.has_company_permission(company_id, 'finance.invoices.view'));
drop policy if exists finance_sefaz_sync_logs_manage on public.finance_sefaz_sync_logs;
create policy finance_sefaz_sync_logs_manage on public.finance_sefaz_sync_logs for all to authenticated
using (public.has_company_permission(company_id, 'finance.invoices.manage'))
with check (public.has_company_permission(company_id, 'finance.invoices.manage'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sefaz-certificates', 'sefaz-certificates', false, 10485760, array['application/x-pkcs12','application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sefaz-dfe', 'sefaz-dfe', false, 10485760, array['application/xml','text/xml','application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists sefaz_certificates_authenticated on storage.objects;
create policy sefaz_certificates_authenticated on storage.objects for all to authenticated
using (bucket_id = 'sefaz-certificates' and public.has_company_permission((storage.foldername(name))[1]::uuid, 'finance.invoices.manage'))
with check (bucket_id = 'sefaz-certificates' and public.has_company_permission((storage.foldername(name))[1]::uuid, 'finance.invoices.manage'));

drop policy if exists sefaz_dfe_authenticated on storage.objects;
create policy sefaz_dfe_authenticated on storage.objects for all to authenticated
using (bucket_id = 'sefaz-dfe' and public.has_company_permission((storage.foldername(name))[1]::uuid, 'finance.invoices.view'))
with check (bucket_id = 'sefaz-dfe' and public.has_company_permission((storage.foldername(name))[1]::uuid, 'finance.invoices.manage'));

commit;
