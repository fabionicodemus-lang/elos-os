create or replace function public.refresh_hr_payroll_run_totals(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gross numeric(16,2) := 0;
  v_deductions numeric(16,2) := 0;
  v_net numeric(16,2) := 0;
  v_obligations numeric(16,2) := 0;
  v_additional_cost numeric(16,2) := 0;
begin
  select
    coalesce(sum(gross_salary), 0)::numeric(16,2),
    coalesce(sum(deductions), 0)::numeric(16,2),
    coalesce(sum(net_salary), 0)::numeric(16,2)
  into v_gross, v_deductions, v_net
  from public.hr_payroll_entries
  where payroll_run_id = p_run_id;

  select
    coalesce(sum(amount), 0)::numeric(16,2),
    coalesce(sum(amount) filter (where obligation_type <> 'withholding'), 0)::numeric(16,2)
  into v_obligations, v_additional_cost
  from public.hr_payroll_obligations
  where payroll_run_id = p_run_id;

  update public.hr_payroll_runs
  set gross_amount = v_gross,
      deduction_amount = v_deductions,
      net_amount = v_net,
      obligations_amount = v_obligations,
      total_company_cost = v_gross + v_additional_cost,
      updated_at = now()
  where id = p_run_id;
end;
$$;

create or replace function public.hr_payroll_require_draft_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_company_id uuid;
  v_project_id uuid;
  v_status text;
begin
  if tg_op = 'UPDATE' and (
    old.payroll_run_id is distinct from new.payroll_run_id
    or old.company_id is distinct from new.company_id
    or old.project_id is distinct from new.project_id
  ) then
    raise exception 'A vinculação do lançamento à folha não pode ser alterada.';
  end if;

  if tg_op = 'DELETE' then
    v_run_id := old.payroll_run_id;
    v_company_id := old.company_id;
    v_project_id := old.project_id;
  else
    v_run_id := new.payroll_run_id;
    v_company_id := new.company_id;
    v_project_id := new.project_id;
  end if;

  select status into v_status
  from public.hr_payroll_runs
  where id = v_run_id
    and company_id = v_company_id
    and project_id = v_project_id;

  if not found then
    raise exception 'A folha vinculada ao lançamento não foi localizada.';
  end if;

  if v_status <> 'draft' then
    raise exception 'A folha já foi aprovada ou cancelada e não pode ser alterada.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists hr_payroll_entries_require_draft on public.hr_payroll_entries;
create trigger hr_payroll_entries_require_draft
before insert or update or delete on public.hr_payroll_entries
for each row execute function public.hr_payroll_require_draft_trigger();

drop trigger if exists hr_payroll_obligations_require_draft on public.hr_payroll_obligations;
create trigger hr_payroll_obligations_require_draft
before insert or update or delete on public.hr_payroll_obligations
for each row execute function public.hr_payroll_require_draft_trigger();

create or replace function public.hr_payroll_recalculate_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
begin
  v_run_id := case when tg_op = 'DELETE' then old.payroll_run_id else new.payroll_run_id end;
  perform public.refresh_hr_payroll_run_totals(v_run_id);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists hr_payroll_entries_refresh_totals on public.hr_payroll_entries;
create trigger hr_payroll_entries_refresh_totals
after insert or update or delete on public.hr_payroll_entries
for each row execute function public.hr_payroll_recalculate_trigger();

drop trigger if exists hr_payroll_obligations_refresh_totals on public.hr_payroll_obligations;
create trigger hr_payroll_obligations_refresh_totals
after insert or update or delete on public.hr_payroll_obligations
for each row execute function public.hr_payroll_recalculate_trigger();
