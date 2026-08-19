-- Elos OS — Contas a pagar · apropriação por serviço/WBS
-- Permite que um único título financeiro seja apropriado a um ou vários centros de custo,
-- preservando a origem/evidência da apropriação (inclusive importações legadas do Koper).

begin;

create table if not exists public.payable_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  payable_id uuid not null references public.payables(id) on delete cascade,
  service_id uuid references public.engineering_services(id) on delete restrict,
  budget_item_id uuid references public.engineering_budget_items(id) on delete restrict,
  wbs_code_snapshot text,
  service_name_snapshot text,
  allocation_amount numeric(18,2) not null check (allocation_amount > 0),
  allocation_percent numeric(12,8) check (allocation_percent is null or (allocation_percent > 0 and allocation_percent <= 100)),
  resolution_method text not null default 'manual'
    check (resolution_method in (
      'manual',
      'koper_service_order',
      'koper_receipt_purchase',
      'koper_measurement_contract',
      'koper_invoice_purchase_order',
      'koper_monitoring_crosswalk',
      'import_other'
    )),
  source_system text,
  source_id text,
  evidence jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payable_cost_allocations_target_check check (
    service_id is not null or budget_item_id is not null or nullif(trim(coalesce(wbs_code_snapshot,'')),'') is not null
  ),
  constraint payable_cost_allocations_source_pair_check check (
    (source_system is null and source_id is null)
    or (nullif(trim(source_system),'') is not null and nullif(trim(source_id),'') is not null)
  )
);

create unique index if not exists payable_cost_allocations_source_unique_idx
  on public.payable_cost_allocations(company_id, source_system, source_id)
  where source_system is not null and source_id is not null;

create index if not exists payable_cost_allocations_payable_idx
  on public.payable_cost_allocations(payable_id);
create index if not exists payable_cost_allocations_service_idx
  on public.payable_cost_allocations(project_id, service_id)
  where service_id is not null;
create index if not exists payable_cost_allocations_budget_item_idx
  on public.payable_cost_allocations(project_id, budget_item_id)
  where budget_item_id is not null;

create or replace function public.validate_payable_cost_allocation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_payable public.payables%rowtype;
  v_service public.engineering_services%rowtype;
  v_budget_item public.engineering_budget_items%rowtype;
begin
  select * into v_payable from public.payables where id=new.payable_id;
  if v_payable.id is null then raise exception 'Título financeiro da apropriação não encontrado.'; end if;
  if v_payable.company_id<>new.company_id or v_payable.project_id<>new.project_id then
    raise exception 'A apropriação precisa pertencer à mesma empresa e obra do título.';
  end if;

  if new.service_id is not null then
    select * into v_service from public.engineering_services where id=new.service_id;
    if v_service.id is null or v_service.company_id<>new.company_id then
      raise exception 'Serviço da apropriação não pertence à empresa do título.';
    end if;
  end if;

  if new.budget_item_id is not null then
    select * into v_budget_item from public.engineering_budget_items where id=new.budget_item_id;
    if v_budget_item.id is null
       or v_budget_item.company_id<>new.company_id
       or v_budget_item.project_id<>new.project_id then
      raise exception 'Item WBS da apropriação não pertence à obra do título.';
    end if;
    if new.service_id is not null and v_budget_item.service_id is not null and v_budget_item.service_id<>new.service_id then
      raise exception 'Serviço e item WBS informados não correspondem entre si.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists payable_cost_allocations_validate_trigger on public.payable_cost_allocations;
create trigger payable_cost_allocations_validate_trigger
before insert or update on public.payable_cost_allocations
for each row execute function public.validate_payable_cost_allocation();

create or replace function public.validate_payable_cost_allocation_balance()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_payable_id uuid:=coalesce(new.payable_id,old.payable_id);
  v_amount numeric(18,2);
  v_sum numeric(18,2);
begin
  select amount into v_amount from public.payables where id=v_payable_id;
  if v_amount is null then return null; end if;
  select coalesce(round(sum(allocation_amount),2),0) into v_sum
  from public.payable_cost_allocations where payable_id=v_payable_id;
  if v_sum>round(v_amount,2) then
    raise exception 'O rateio do título (%) não pode ultrapassar o valor do título (%).',v_sum,v_amount;
  end if;
  return null;
end;
$$;

drop trigger if exists payable_cost_allocations_balance_trigger on public.payable_cost_allocations;
create constraint trigger payable_cost_allocations_balance_trigger
after insert or update or delete on public.payable_cost_allocations
deferrable initially deferred
for each row execute function public.validate_payable_cost_allocation_balance();

create or replace function public.payable_cost_allocation_status(p_payable_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  select jsonb_build_object(
    'payable_id',p.id,
    'amount',p.amount,
    'allocated_amount',coalesce(round(sum(a.allocation_amount),2),0),
    'remaining_amount',round(p.amount-coalesce(sum(a.allocation_amount),0),2),
    'allocation_count',count(a.id),
    'is_fully_allocated',round(coalesce(sum(a.allocation_amount),0),2)=round(p.amount,2)
  )
  from public.payables p
  left join public.payable_cost_allocations a on a.payable_id=p.id
  where p.id=p_payable_id
  group by p.id,p.amount;
$$;

alter table public.payable_cost_allocations enable row level security;

drop policy if exists payable_cost_allocations_select on public.payable_cost_allocations;
create policy payable_cost_allocations_select on public.payable_cost_allocations
for select to authenticated using (
  public.has_company_permission(company_id,'payables.view')
  or public.has_company_permission(company_id,'payables.manage')
);

drop policy if exists payable_cost_allocations_write on public.payable_cost_allocations;
create policy payable_cost_allocations_write on public.payable_cost_allocations
for all to authenticated using (
  public.has_company_permission(company_id,'payables.manage')
) with check (
  public.has_company_permission(company_id,'payables.manage')
);

grant select,insert,update,delete on public.payable_cost_allocations to authenticated;
grant execute on function public.payable_cost_allocation_status(uuid) to authenticated;

comment on table public.payable_cost_allocations is
  'Rateio estruturado de contas a pagar por serviço/centro de custo e item WBS do orçamento.';
comment on column public.payable_cost_allocations.evidence is
  'Trilha auditável usada para determinar o rateio (OS, recibo, compra, medição, NF-e, monitoramento etc.).';

commit;
