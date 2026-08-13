-- Elos OS — Bossa CRM: captação de leads (integração Meta Lead Ads)
-- Cria a tabela `crm_leads` e as colunas usadas pelo webhook do Meta Lead Ads.
-- Não existia tabela de leads/pipeline no schema; ela é criada aqui seguindo
-- as convenções de multiempresa (company_id, created_by, timestamps, RLS).
-- Execute após 20260806_0080_owner_full_access.sql.

begin;

create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  nome text,
  email text,
  telefone text,
  status text not null default 'novo'
    check (status in ('novo','em_atendimento','qualificado','desqualificado','convertido','perdido')),
  origem text not null default 'manual',
  projeto text,
  mensagem_recebida text,
  respostas jsonb not null default '{}'::jsonb,
  meta_leadgen_id text,
  meta_form_id text,
  meta_ad_id text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Colunas adicionadas de forma idempotente, caso a tabela já exista em algum ambiente.
alter table public.crm_leads add column if not exists meta_leadgen_id text;
alter table public.crm_leads add column if not exists meta_form_id text;
alter table public.crm_leads add column if not exists meta_ad_id text;
alter table public.crm_leads add column if not exists origem text not null default 'manual';
alter table public.crm_leads add column if not exists projeto text;
alter table public.crm_leads add column if not exists mensagem_recebida text;
alter table public.crm_leads add column if not exists respostas jsonb not null default '{}'::jsonb;

-- Índice único que garante a idempotência do webhook (dedupe por lead da Meta).
create unique index if not exists crm_leads_meta_leadgen_id_uq
  on public.crm_leads(meta_leadgen_id)
  where meta_leadgen_id is not null;

create index if not exists crm_leads_company_status_idx
  on public.crm_leads(company_id, status, created_at desc);
create index if not exists crm_leads_company_project_idx
  on public.crm_leads(company_id, project_id, created_at desc);
create index if not exists crm_leads_telefone_idx
  on public.crm_leads(company_id, telefone);

-- updated_at automático.
create or replace function public.crm_leads_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists crm_leads_set_updated_at on public.crm_leads;
create trigger crm_leads_set_updated_at
before update on public.crm_leads
for each row
execute function public.crm_leads_set_updated_at();

-- Permissões do módulo de CRM.
insert into public.permissions (key, module, action, description) values
  ('crm.leads.view', 'crm_leads', 'view', 'Visualizar leads do CRM'),
  ('crm.leads.manage', 'crm_leads', 'manage', 'Criar, editar e atribuir leads do CRM')
on conflict (key) do update set
  module = excluded.module,
  action = excluded.action,
  description = excluded.description;

insert into public.role_permissions (role_id, permission_key)
select role.id, permission_key
from public.roles role
cross join lateral (
  select unnest(
    case
      when role.key in ('owner','admin','director','commercial') then
        array['crm.leads.view','crm.leads.manage']::text[]
      when role.key in ('finance','viewer') then
        array['crm.leads.view']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

-- RLS obrigatório para dados de empresa.
-- O webhook grava via service_role, que ignora RLS por padrão.
alter table public.crm_leads enable row level security;

drop policy if exists crm_leads_select on public.crm_leads;
create policy crm_leads_select on public.crm_leads
for select using (
  public.has_company_permission(company_id, 'crm.leads.view')
  or public.has_company_permission(company_id, 'crm.leads.manage')
);

drop policy if exists crm_leads_insert on public.crm_leads;
create policy crm_leads_insert on public.crm_leads
for insert with check (
  public.has_company_permission(company_id, 'crm.leads.manage')
);

drop policy if exists crm_leads_update on public.crm_leads;
create policy crm_leads_update on public.crm_leads
for update using (
  public.has_company_permission(company_id, 'crm.leads.manage')
) with check (
  public.has_company_permission(company_id, 'crm.leads.manage')
);

drop policy if exists crm_leads_delete on public.crm_leads;
create policy crm_leads_delete on public.crm_leads
for delete using (
  public.has_company_permission(company_id, 'crm.leads.manage')
);

commit;
