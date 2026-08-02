create or replace function public.create_hr_payroll_run(
  p_company_id uuid,
  p_project_id uuid,
  p_competence date,
  p_salary_due_date date,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
begin
  if not public.has_company_permission(p_company_id, 'hr.payroll.manage') then
    raise exception 'Você não possui permissão para criar a folha.';
  end if;

  if extract(day from p_competence) <> 1 then
    raise exception 'A competência deve ser informada no primeiro dia do mês.';
  end if;

  if not exists (
    select 1 from public.projects
    where id = p_project_id and company_id = p_company_id
  ) then
    raise exception 'Empreendimento inválido para esta empresa.';
  end if;

  insert into public.hr_payroll_runs (
    company_id, project_id, competence, salary_due_date, notes, created_by
  ) values (
    p_company_id, p_project_id, p_competence, p_salary_due_date, nullif(btrim(p_notes), ''), auth.uid()
  )
  returning id into v_run_id;

  insert into public.hr_payroll_entries (
    company_id, project_id, payroll_run_id, employee_id,
    base_salary, earnings, deductions, due_date
  )
  select
    employee.company_id,
    p_project_id,
    v_run_id,
    employee.id,
    employee.base_salary,
    0,
    0,
    p_salary_due_date
  from public.hr_employees employee
  where employee.company_id = p_company_id
    and employee.default_project_id = p_project_id
    and employee.status = 'active'
    and (employee.admission_date is null or employee.admission_date <= (p_competence + interval '1 month - 1 day')::date)
    and (employee.termination_date is null or employee.termination_date >= p_competence);

  perform public.refresh_hr_payroll_run_totals(v_run_id);
  return v_run_id;
end;
$$;

create or replace function public.post_hr_payroll_run(
  p_company_id uuid,
  p_project_id uuid,
  p_run_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.hr_payroll_runs%rowtype;
  v_count integer := 0;
  v_rows integer := 0;
  v_competence_label text;
begin
  if not public.has_company_permission(p_company_id, 'hr.payroll.approve') then
    raise exception 'Você não possui permissão para aprovar e gerar a folha.';
  end if;

  select * into v_run
  from public.hr_payroll_runs
  where id = p_run_id
    and company_id = p_company_id
    and project_id = p_project_id
  for update;

  if not found then
    raise exception 'Folha não localizada.';
  end if;

  if v_run.status <> 'draft' then
    raise exception 'Apenas folhas em elaboração podem ser aprovadas.';
  end if;

  if not exists (
    select 1 from public.hr_payroll_entries
    where payroll_run_id = p_run_id and net_salary > 0
  ) then
    raise exception 'A folha não possui salários líquidos para gerar.';
  end if;

  perform public.refresh_hr_payroll_run_totals(p_run_id);
  v_competence_label := to_char(v_run.competence, 'MM/YYYY');

  insert into public.payables (
    company_id, project_id, supplier_id,
    beneficiary_name, beneficiary_tax_id,
    document, fiscal_class, payment_method,
    due_date, amount, status, installment_label, notes,
    origin, source_system, source_id, source_category, created_by
  )
  select
    entry.company_id,
    entry.project_id,
    null,
    employee.full_name,
    employee.tax_id,
    'FOLHA ' || v_competence_label,
    'Folha de pagamento',
    'Transferência',
    entry.due_date,
    entry.net_salary,
    'open',
    employee.full_name,
    concat_ws(' · ', employee.position_title, nullif(entry.notes, '')),
    'hr_payroll',
    'elos_hr',
    'payroll:' || p_run_id::text || ':employee:' || employee.id::text,
    'salary',
    auth.uid()
  from public.hr_payroll_entries entry
  join public.hr_employees employee on employee.id = entry.employee_id
  where entry.payroll_run_id = p_run_id
    and entry.net_salary > 0
  on conflict (company_id, source_system, source_id)
  do update set
    due_date = excluded.due_date,
    amount = excluded.amount,
    beneficiary_name = excluded.beneficiary_name,
    beneficiary_tax_id = excluded.beneficiary_tax_id,
    document = excluded.document,
    installment_label = excluded.installment_label,
    notes = excluded.notes,
    updated_at = now()
  where public.payables.status = 'open';

  get diagnostics v_count = row_count;

  insert into public.payables (
    company_id, project_id, supplier_id,
    beneficiary_name, beneficiary_tax_id,
    document, fiscal_class, payment_method,
    due_date, amount, status, installment_label, notes,
    origin, source_system, source_id, source_category, created_by
  )
  select
    obligation.company_id,
    obligation.project_id,
    null,
    obligation.beneficiary_name,
    obligation.beneficiary_tax_id,
    coalesce(nullif(obligation.obligation_code, ''), 'ENCARGO') || ' ' || v_competence_label,
    case obligation.obligation_type
      when 'benefit' then 'Benefício trabalhista'
      when 'withholding' then 'Retenção da folha'
      else 'Encargo trabalhista'
    end,
    'Boleto/Guia',
    obligation.due_date,
    obligation.amount,
    'open',
    obligation.description,
    obligation.notes,
    'hr_payroll',
    'elos_hr',
    'payroll:' || p_run_id::text || ':obligation:' || obligation.id::text,
    obligation.obligation_type,
    auth.uid()
  from public.hr_payroll_obligations obligation
  where obligation.payroll_run_id = p_run_id
  on conflict (company_id, source_system, source_id)
  do update set
    due_date = excluded.due_date,
    amount = excluded.amount,
    beneficiary_name = excluded.beneficiary_name,
    beneficiary_tax_id = excluded.beneficiary_tax_id,
    document = excluded.document,
    installment_label = excluded.installment_label,
    notes = excluded.notes,
    updated_at = now()
  where public.payables.status = 'open';

  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  update public.hr_payroll_runs
  set status = 'posted',
      posted_at = now(),
      posted_by = auth.uid(),
      updated_at = now()
  where id = p_run_id;

  return v_count;
end;
$$;

create or replace function public.cancel_hr_payroll_run(
  p_company_id uuid,
  p_project_id uuid,
  p_run_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not (
    public.has_company_permission(p_company_id, 'hr.payroll.manage')
    or public.has_company_permission(p_company_id, 'hr.payroll.approve')
  ) then
    raise exception 'Você não possui permissão para cancelar a folha.';
  end if;

  select status into v_status
  from public.hr_payroll_runs
  where id = p_run_id
    and company_id = p_company_id
    and project_id = p_project_id
  for update;

  if not found then
    raise exception 'Folha não localizada.';
  end if;

  if v_status = 'cancelled' then
    return;
  end if;

  if exists (
    select 1 from public.payables
    where company_id = p_company_id
      and project_id = p_project_id
      and source_system = 'elos_hr'
      and source_id like 'payroll:' || p_run_id::text || ':%'
      and status = 'paid'
  ) then
    raise exception 'Existem contas da folha já pagas. Estorne os pagamentos antes de cancelar.';
  end if;

  update public.hr_payroll_runs
  set status = 'cancelled', updated_at = now()
  where id = p_run_id;

  update public.payables
  set status = 'cancelled', updated_at = now()
  where company_id = p_company_id
    and project_id = p_project_id
    and source_system = 'elos_hr'
    and source_id like 'payroll:' || p_run_id::text || ':%'
    and status = 'open';
end;
$$;

create or replace function public.protect_hr_payable_status_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.source_system = 'elos_hr'
    and old.status = 'open'
    and new.status = 'cancelled'
    and not exists (
      select 1
      from public.hr_payroll_runs run
      where run.company_id = old.company_id
        and run.project_id = old.project_id
        and run.status = 'cancelled'
        and old.source_id like 'payroll:' || run.id::text || ':%'
    )
  then
    raise exception 'Contas geradas pelo RH não podem ser canceladas isoladamente. Cancele a folha no módulo RH.';
  end if;
  return new;
end;
$$;

drop trigger if exists payables_protect_hr_status on public.payables;
create trigger payables_protect_hr_status
before update of status on public.payables
for each row execute function public.protect_hr_payable_status_trigger();
