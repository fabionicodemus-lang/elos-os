-- Elos OS — Engenharia: plano de contratações
-- Pacotes vinculados à linha de base, serviço, fornecedor e datas-limite.

begin;

create table if not exists public.engineering_contract_packages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  baseline_id uuid not null references public.engineering_schedule_baselines(id) on delete cascade,
  service_id uuid not null references public.engineering_services(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete set null,
  code text not null,
  name text not null,
  planned_service_start date not null,
  quotation_lead_days integer not null default 30 check (quotation_lead_days >= 0),
  negotiation_lead_days integer not null default 15 check (negotiation_lead_days >= 0),
  contracting_lead_days integer not null default 10 check (contracting_lead_days >= 0),
  mobilization_lead_days integer not null default 15 check (mobilization_lead_days >= 0),
  quotation_start date not null,
  negotiation_start date not null,
  contract_deadline date not null,
  mobilization_start date not null,
  planned_value numeric(18,2) not null default 0 check (planned_value >= 0),
  status text not null default 'planned'
    check (status in ('planned', 'quotation', 'negotiation', 'approval', 'contracted', 'mobilization', 'completed', 'canceled')),
  responsible text,
  notes text,
  record_status text not null default 'active' check (record_status in ('active', 'inactive')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (baseline_id, service_id),
  unique (baseline_id, code)
);

create index if not exists engineering_contract_packages_project_idx
  on public.engineering_contract_packages(project_id, record_status, contract_deadline);
create index if not exists engineering_contract_packages_baseline_idx
  on public.engineering_contract_packages(baseline_id, status, planned_service_start);
create index if not exists engineering_contract_packages_supplier_idx
  on public.engineering_contract_packages(supplier_id)
  where supplier_id is not null;

alter table public.engineering_contract_packages enable row level security;

drop policy if exists engineering_contract_packages_select on public.engineering_contract_packages;
create policy engineering_contract_packages_select on public.engineering_contract_packages
for select using (
  public.has_company_permission(company_id, 'schedule.view')
  or public.has_company_permission(company_id, 'schedule.manage')
);

drop policy if exists engineering_contract_packages_insert on public.engineering_contract_packages;
create policy engineering_contract_packages_insert on public.engineering_contract_packages
for insert with check (public.has_company_permission(company_id, 'schedule.manage'));

drop policy if exists engineering_contract_packages_update on public.engineering_contract_packages;
create policy engineering_contract_packages_update on public.engineering_contract_packages
for update using (public.has_company_permission(company_id, 'schedule.manage'))
with check (public.has_company_permission(company_id, 'schedule.manage'));

grant select, insert, update on public.engineering_contract_packages to authenticated;

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'engineering_contract_packages';
