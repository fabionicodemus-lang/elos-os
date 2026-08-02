-- Elos OS — Orçamento base e exclusão segura V0.71.6
-- Define uma única revisão base por obra, protege centros de custo já utilizados
-- e centraliza a exclusão de orçamentos em uma função transacional.

begin;

alter table public.engineering_budgets
  add column if not exists is_base boolean not null default false,
  add column if not exists base_set_at timestamptz,
  add column if not exists base_set_by uuid references auth.users(id);

-- Preserva a operação atual: quando uma obra já possui revisões aprovadas, a
-- revisão aprovada mais recente passa a ser a base inicial somente se ainda
-- não houver uma base definida.
with projects_without_base as (
  select budget.company_id, budget.project_id
  from public.engineering_budgets budget
  group by budget.company_id, budget.project_id
  having bool_or(budget.is_base) = false
), ranked_approved as (
  select
    budget.id,
    row_number() over (
      partition by budget.company_id, budget.project_id
      order by budget.updated_at desc, budget.created_at desc, budget.id desc
    ) as position
  from public.engineering_budgets budget
  join projects_without_base missing
    on missing.company_id = budget.company_id
   and missing.project_id = budget.project_id
  where budget.status = 'approved'
)
update public.engineering_budgets budget
set is_base = true,
    base_set_at = coalesce(budget.updated_at, now()),
    base_set_by = budget.created_by
from ranked_approved ranked
where budget.id = ranked.id
  and ranked.position = 1;

create unique index if not exists engineering_budgets_one_base_per_project_uidx
  on public.engineering_budgets(company_id, project_id)
  where is_base;

create index if not exists engineering_budgets_project_base_idx
  on public.engineering_budgets(company_id, project_id, is_base, status, updated_at desc);

create or replace function public.engineering_budget_base_guard_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_base and new.status <> 'approved' then
    raise exception 'Somente um orçamento aprovado pode ser salvo como orçamento base.';
  end if;

  if tg_op = 'UPDATE'
     and old.is_base
     and new.status <> 'approved' then
    raise exception 'O orçamento base deve permanecer aprovado. Defina outra revisão como base antes de alterar ou arquivar esta revisão.';
  end if;

  if tg_op = 'UPDATE'
     and old.is_base
     and (
       old.company_id is distinct from new.company_id
       or old.project_id is distinct from new.project_id
     ) then
    raise exception 'A empresa e a obra do orçamento base não podem ser alteradas.';
  end if;

  return new;
end;
$$;

drop trigger if exists engineering_budget_base_guard on public.engineering_budgets;
create trigger engineering_budget_base_guard
before insert or update on public.engineering_budgets
for each row execute function public.engineering_budget_base_guard_trigger();

create or replace function public.set_engineering_budget_base(
  p_company_id uuid,
  p_project_id uuid,
  p_budget_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget public.engineering_budgets%rowtype;
begin
  if not public.has_company_permission(p_company_id, 'budgets.manage') then
    raise exception 'Você não possui permissão para definir o orçamento base.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_company_id::text || ':' || p_project_id::text || ':budget-base'));

  select * into v_budget
  from public.engineering_budgets budget
  where budget.id = p_budget_id
    and budget.company_id = p_company_id
    and budget.project_id = p_project_id
  for update;

  if not found then
    raise exception 'Orçamento não localizado para esta obra.';
  end if;

  if v_budget.status <> 'approved' then
    raise exception 'Aprove o orçamento antes de salvá-lo como orçamento base.';
  end if;

  update public.engineering_budgets
  set is_base = false,
      base_set_at = null,
      base_set_by = null,
      updated_at = case when is_base then now() else updated_at end
  where company_id = p_company_id
    and project_id = p_project_id
    and is_base
    and id <> p_budget_id;

  update public.engineering_budgets
  set is_base = true,
      base_set_at = now(),
      base_set_by = auth.uid(),
      updated_at = now()
  where id = p_budget_id
    and company_id = p_company_id
    and project_id = p_project_id;

  return p_budget_id;
end;
$$;

create or replace function public.delete_engineering_budget(
  p_company_id uuid,
  p_project_id uuid,
  p_budget_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget public.engineering_budgets%rowtype;
  v_material_requests integer := 0;
begin
  if not public.has_company_permission(p_company_id, 'budgets.manage') then
    raise exception 'Você não possui permissão para excluir orçamentos.';
  end if;

  select * into v_budget
  from public.engineering_budgets budget
  where budget.id = p_budget_id
    and budget.company_id = p_company_id
    and budget.project_id = p_project_id
  for update;

  if not found then
    raise exception 'Orçamento não localizado para esta obra.';
  end if;

  if to_regclass('public.execution_material_requests') is not null then
    select count(*) into v_material_requests
    from public.execution_material_requests request
    where request.company_id = p_company_id
      and request.project_id = p_project_id
      and request.budget_id = p_budget_id;
  end if;

  if v_material_requests > 0 then
    raise exception 'Este orçamento não pode ser excluído porque possui % solicitação(ões) lançada(s) nos centros de custo que ele gerou.', v_material_requests;
  end if;

  -- Grupos, itens e memórias internas possuem vínculo com a revisão e são
  -- removidos junto com ela. Registros operacionais são verificados acima.
  delete from public.engineering_budgets
  where id = p_budget_id
    and company_id = p_company_id
    and project_id = p_project_id;

  if not found then
    raise exception 'O orçamento não foi excluído.';
  end if;
end;
$$;

create or replace function public.execution_material_request_require_base_budget_trigger()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Uma solicitação histórica pode continuar sendo editada enquanto mantiver
  -- o mesmo orçamento. Novas solicitações ou trocas de revisão usam a base atual.
  if tg_op = 'UPDATE' and new.budget_id is not distinct from old.budget_id then
    return new;
  end if;

  if not exists (
    select 1
    from public.engineering_budgets budget
    where budget.id = new.budget_id
      and budget.company_id = new.company_id
      and budget.project_id = new.project_id
      and budget.status = 'approved'
      and budget.is_base
  ) then
    raise exception 'Selecione o orçamento aprovado e salvo como orçamento base para gerar centros de custo.';
  end if;

  return new;
end;
$$;

drop trigger if exists execution_material_request_require_base_budget on public.execution_material_requests;
create trigger execution_material_request_require_base_budget
before insert or update of budget_id on public.execution_material_requests
for each row execute function public.execution_material_request_require_base_budget_trigger();

grant execute on function public.set_engineering_budget_base(uuid, uuid, uuid) to authenticated;
grant execute on function public.delete_engineering_budget(uuid, uuid, uuid) to authenticated;

commit;
