insert into public.permissions (key, module, action, description) values
  ('hr.employees.view', 'hr', 'view_employees', 'Visualizar colaboradores e dados cadastrais'),
  ('hr.employees.manage', 'hr', 'manage_employees', 'Criar e editar colaboradores'),
  ('hr.payroll.view', 'hr', 'view_payroll', 'Visualizar folhas, salários e encargos'),
  ('hr.payroll.manage', 'hr', 'manage_payroll', 'Criar e editar folhas, salários e encargos'),
  ('hr.payroll.approve', 'hr', 'approve_payroll', 'Aprovar folha e gerar contas a pagar')
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
      when role.key in ('owner', 'admin', 'director', 'hr') then
        array[
          'hr.employees.view', 'hr.employees.manage',
          'hr.payroll.view', 'hr.payroll.manage', 'hr.payroll.approve'
        ]::text[]
      when role.key = 'finance' then
        array['hr.payroll.view', 'hr.payroll.approve']::text[]
      else array[]::text[]
    end
  ) as permission_key
) permissions
on conflict (role_id, permission_key) do update set allowed = true;

alter table public.hr_employees enable row level security;
alter table public.hr_payroll_runs enable row level security;
alter table public.hr_payroll_entries enable row level security;
alter table public.hr_payroll_obligations enable row level security;

drop policy if exists hr_employees_select on public.hr_employees;
create policy hr_employees_select on public.hr_employees
for select using (
  public.has_company_permission(company_id, 'hr.employees.view')
  or public.has_company_permission(company_id, 'hr.employees.manage')
  or public.has_company_permission(company_id, 'hr.payroll.view')
  or public.has_company_permission(company_id, 'hr.payroll.manage')
);

drop policy if exists hr_employees_insert on public.hr_employees;
create policy hr_employees_insert on public.hr_employees
for insert with check (
  public.has_company_permission(company_id, 'hr.employees.manage')
  and public.is_company_member(company_id)
);

drop policy if exists hr_employees_update on public.hr_employees;
create policy hr_employees_update on public.hr_employees
for update using (
  public.has_company_permission(company_id, 'hr.employees.manage')
) with check (
  public.has_company_permission(company_id, 'hr.employees.manage')
);

drop policy if exists hr_payroll_runs_select on public.hr_payroll_runs;
create policy hr_payroll_runs_select on public.hr_payroll_runs
for select using (
  public.has_company_permission(company_id, 'hr.payroll.view')
  or public.has_company_permission(company_id, 'hr.payroll.manage')
  or public.has_company_permission(company_id, 'hr.payroll.approve')
);

drop policy if exists hr_payroll_runs_insert on public.hr_payroll_runs;
create policy hr_payroll_runs_insert on public.hr_payroll_runs
for insert with check (
  public.has_company_permission(company_id, 'hr.payroll.manage')
  and public.is_company_member(company_id)
);

drop policy if exists hr_payroll_runs_update on public.hr_payroll_runs;
create policy hr_payroll_runs_update on public.hr_payroll_runs
for update using (
  public.has_company_permission(company_id, 'hr.payroll.manage')
  or public.has_company_permission(company_id, 'hr.payroll.approve')
) with check (
  public.has_company_permission(company_id, 'hr.payroll.manage')
  or public.has_company_permission(company_id, 'hr.payroll.approve')
);

drop policy if exists hr_payroll_entries_select on public.hr_payroll_entries;
create policy hr_payroll_entries_select on public.hr_payroll_entries
for select using (
  public.has_company_permission(company_id, 'hr.payroll.view')
  or public.has_company_permission(company_id, 'hr.payroll.manage')
  or public.has_company_permission(company_id, 'hr.payroll.approve')
);

drop policy if exists hr_payroll_entries_insert on public.hr_payroll_entries;
create policy hr_payroll_entries_insert on public.hr_payroll_entries
for insert with check (
  public.has_company_permission(company_id, 'hr.payroll.manage')
);

drop policy if exists hr_payroll_entries_update on public.hr_payroll_entries;
create policy hr_payroll_entries_update on public.hr_payroll_entries
for update using (
  public.has_company_permission(company_id, 'hr.payroll.manage')
) with check (
  public.has_company_permission(company_id, 'hr.payroll.manage')
);

drop policy if exists hr_payroll_obligations_select on public.hr_payroll_obligations;
create policy hr_payroll_obligations_select on public.hr_payroll_obligations
for select using (
  public.has_company_permission(company_id, 'hr.payroll.view')
  or public.has_company_permission(company_id, 'hr.payroll.manage')
  or public.has_company_permission(company_id, 'hr.payroll.approve')
);

drop policy if exists hr_payroll_obligations_insert on public.hr_payroll_obligations;
create policy hr_payroll_obligations_insert on public.hr_payroll_obligations
for insert with check (
  public.has_company_permission(company_id, 'hr.payroll.manage')
);

drop policy if exists hr_payroll_obligations_update on public.hr_payroll_obligations;
create policy hr_payroll_obligations_update on public.hr_payroll_obligations
for update using (
  public.has_company_permission(company_id, 'hr.payroll.manage')
) with check (
  public.has_company_permission(company_id, 'hr.payroll.manage')
);

drop policy if exists hr_payroll_obligations_delete on public.hr_payroll_obligations;
create policy hr_payroll_obligations_delete on public.hr_payroll_obligations
for delete using (
  public.has_company_permission(company_id, 'hr.payroll.manage')
);

grant select, insert, update on public.hr_employees to authenticated;
grant select, insert, update on public.hr_payroll_runs to authenticated;
grant select, insert, update on public.hr_payroll_entries to authenticated;
grant select, insert, update, delete on public.hr_payroll_obligations to authenticated;

grant execute on function public.refresh_hr_payroll_run_totals(uuid) to authenticated;
grant execute on function public.create_hr_payroll_run(uuid, uuid, date, date, text) to authenticated;
grant execute on function public.post_hr_payroll_run(uuid, uuid, uuid) to authenticated;
grant execute on function public.cancel_hr_payroll_run(uuid, uuid, uuid) to authenticated;
