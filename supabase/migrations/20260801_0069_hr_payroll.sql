-- Elos OS — RH e Folha de Pagamento V0.71.0
-- Colaboradores, fechamento mensal, encargos/benefícios e geração de contas a pagar.

alter table public.payables alter column supplier_id drop not null;
alter table public.payables add column if not exists beneficiary_name text;
alter table public.payables add column if not exists beneficiary_tax_id text;
alter table public.payables add column if not exists source_category text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payables_supplier_or_beneficiary_check'
      and conrelid = 'public.payables'::regclass
  ) then
    alter table public.payables
      add constraint payables_supplier_or_beneficiary_check
      check (supplier_id is not null or nullif(btrim(beneficiary_name), '') is not null)
      not valid;
  end if;
end $$;

alter table public.payables validate constraint payables_supplier_or_beneficiary_check;

create table if not exists public.hr_employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  default_project_id uuid references public.projects(id) on delete set null,
  employee_code text not null,
  full_name text not null,
  tax_id text,
  position_title text,
  employment_type text not null default 'clt'
    check (employment_type in ('clt', 'pj', 'intern', 'apprentice', 'partner', 'other')),
  admission_date date,
  termination_date date,
  base_salary numeric(16,2) not null default 0 check (base_salary >= 0),
  salary_due_day smallint not null default 5 check (salary_due_day between 1 and 31),
  bank_name text,
  bank_branch text,
  bank_account text,
  pix_key text,
  cost_center text,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'terminated')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, employee_code)
);

create unique index if not exists hr_employees_company_tax_id_uidx
  on public.hr_employees(company_id, tax_id)
  where nullif(btrim(tax_id), '') is not null;

create index if not exists hr_employees_company_status_idx
  on public.hr_employees(company_id, status, full_name);
create index if not exists hr_employees_project_idx
  on public.hr_employees(company_id, default_project_id, status);

create table if not exists public.hr_payroll_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  competence date not null check (extract(day from competence) = 1),
  salary_due_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'posted', 'cancelled')),
  notes text,
  gross_amount numeric(16,2) not null default 0,
  deduction_amount numeric(16,2) not null default 0,
  net_amount numeric(16,2) not null default 0,
  obligations_amount numeric(16,2) not null default 0,
  total_company_cost numeric(16,2) not null default 0,
  posted_at timestamptz,
  posted_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hr_payroll_runs_active_competence_uidx
  on public.hr_payroll_runs(company_id, project_id, competence)
  where status <> 'cancelled';

create index if not exists hr_payroll_runs_company_project_idx
  on public.hr_payroll_runs(company_id, project_id, competence desc);

create table if not exists public.hr_payroll_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  payroll_run_id uuid not null references public.hr_payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id),
  base_salary numeric(16,2) not null default 0 check (base_salary >= 0),
  earnings numeric(16,2) not null default 0 check (earnings >= 0),
  deductions numeric(16,2) not null default 0 check (deductions >= 0),
  gross_salary numeric(16,2) generated always as (base_salary + earnings) stored,
  net_salary numeric(16,2) generated always as (base_salary + earnings - deductions) stored,
  due_date date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_run_id, employee_id),
  check (deductions <= base_salary + earnings)
);

create index if not exists hr_payroll_entries_run_idx
  on public.hr_payroll_entries(payroll_run_id, employee_id);

create table if not exists public.hr_payroll_obligations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  payroll_run_id uuid not null references public.hr_payroll_runs(id) on delete cascade,
  obligation_code text,
  description text not null,
  obligation_type text not null default 'employer_charge'
    check (obligation_type in ('employer_charge', 'withholding', 'benefit', 'other')),
  beneficiary_name text not null,
  beneficiary_tax_id text,
  due_date date not null,
  amount numeric(16,2) not null check (amount > 0),
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_payroll_obligations_run_idx
  on public.hr_payroll_obligations(payroll_run_id, sort_order, due_date);
