-- Elos OS — Pacote de segurança: trilha de auditoria geral
-- Registra quem criou, alterou ou excluiu registros sensíveis (financeiro,
-- folha, contratos, orçamentos, acessos). A trilha é somente-adição: ninguém
-- pelo aplicativo consegue editar ou apagar um registro dela.
-- LGPD: em alterações, guarda apenas os campos que mudaram (minimização).

begin;

insert into public.permissions(key,module,action,description) values
  ('security.audit.view','security','view_audit','Visualizar a trilha de auditoria da empresa')
on conflict(key) do update set module=excluded.module, action=excluded.action, description=excluded.description;

insert into public.role_permissions(role_id,permission_key,allowed)
select r.id,'security.audit.view',true from public.roles r where r.key in ('owner','admin')
on conflict(role_id,permission_key) do update set allowed=true;

create table if not exists public.security_audit_log (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies(id) on delete cascade,
  table_name text not null,
  record_id text,
  action text not null check (action in ('insert','update','delete')),
  changed_fields jsonb,
  old_values jsonb,
  new_values jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists security_audit_log_company_created_idx
  on public.security_audit_log(company_id, created_at desc);
create index if not exists security_audit_log_record_idx
  on public.security_audit_log(table_name, record_id);

alter table public.security_audit_log enable row level security;

drop policy if exists security_audit_log_select on public.security_audit_log;
create policy security_audit_log_select on public.security_audit_log
for select to authenticated using (
  company_id is not null and public.has_company_permission(company_id,'security.audit.view')
);

-- Somente leitura pelo app: gravação apenas pelo gatilho abaixo.
revoke all on public.security_audit_log from anon, authenticated;
grant select on public.security_audit_log to authenticated;

create or replace function public.security_audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_j jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  new_j jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  diff_old jsonb;
  diff_new jsonb;
  keys jsonb;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, o.value), '{}'::jsonb),
           coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb),
           coalesce(jsonb_agg(n.key), '[]'::jsonb)
      into diff_old, diff_new, keys
      from jsonb_each(new_j) n
      left join jsonb_each(old_j) o on o.key = n.key
     where o.value is distinct from n.value and n.key <> 'updated_at';
    if keys = '[]'::jsonb then return new; end if;
  end if;

  insert into public.security_audit_log(company_id, table_name, record_id, action, changed_fields, old_values, new_values)
  values (
    nullif(coalesce(new_j->>'company_id', old_j->>'company_id'), '')::uuid,
    tg_table_name,
    coalesce(new_j->>'id', old_j->>'id'),
    lower(tg_op),
    keys,
    case when tg_op = 'UPDATE' then diff_old else old_j end,
    case when tg_op = 'UPDATE' then diff_new else new_j end
  );
  return coalesce(new, old);
end $$;

revoke all on function public.security_audit_row_change() from public, anon, authenticated;

do $$
declare
  t text;
  audited text[] := array[
    'company_memberships','project_memberships',
    'payables','receivables',
    'finance_bank_accounts','finance_bank_transactions','finance_bank_transfers',
    'hr_payroll_runs','hr_payroll_entries','hr_payroll_obligations',
    'engineering_budgets','execution_service_contracts','execution_contract_measurements'
  ];
begin
  foreach t in array audited loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists zz_security_audit on public.%I', t);
      execute format('create trigger zz_security_audit after insert or update or delete on public.%I
                      for each row execute function public.security_audit_row_change()', t);
    end if;
  end loop;
end $$;

commit;
