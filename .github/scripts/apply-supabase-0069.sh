#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"

for migration in \
  supabase/migrations/20260801_0069_hr_payroll.sql \
  supabase/migrations/20260801_0069a_hr_payroll_triggers.sql \
  supabase/migrations/20260801_0069b_hr_payroll_functions.sql \
  supabase/migrations/20260801_0069c_hr_payroll_security.sql
do
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$migration"
done

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regclass('public.hr_employees') is null then raise exception 'Cadastro de colaboradores não criado'; end if;
  if to_regclass('public.hr_payroll_runs') is null then raise exception 'Folhas mensais não criadas'; end if;
  if to_regclass('public.hr_payroll_entries') is null then raise exception 'Lançamentos salariais não criados'; end if;
  if to_regclass('public.hr_payroll_obligations') is null then raise exception 'Encargos e benefícios não criados'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='payables' and column_name='beneficiary_name'
  ) then raise exception 'Favorecido livre não instalado em contas a pagar'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='payables' and column_name='source_category'
  ) then raise exception 'Categoria de origem não instalada em contas a pagar'; end if;

  if to_regprocedure('public.create_hr_payroll_run(uuid,uuid,date,date,text)') is null then
    raise exception 'RPC de criação da folha ausente';
  end if;
  if to_regprocedure('public.post_hr_payroll_run(uuid,uuid,uuid)') is null then
    raise exception 'RPC de aprovação e financeiro ausente';
  end if;
  if to_regprocedure('public.cancel_hr_payroll_run(uuid,uuid,uuid)') is null then
    raise exception 'RPC de cancelamento da folha ausente';
  end if;

  if not exists(select 1 from pg_trigger where tgname='hr_payroll_entries_require_draft' and not tgisinternal) then
    raise exception 'Bloqueio de edição após aprovação ausente nos salários';
  end if;
  if not exists(select 1 from pg_trigger where tgname='hr_payroll_obligations_require_draft' and not tgisinternal) then
    raise exception 'Bloqueio de edição após aprovação ausente nos encargos';
  end if;
  if not exists(select 1 from pg_trigger where tgname='payables_protect_hr_status' and not tgisinternal) then
    raise exception 'Proteção contra cancelamento isolado das contas do RH ausente';
  end if;

  if not exists(select 1 from public.permissions where key='hr.employees.view') then
    raise exception 'Permissão de colaboradores ausente';
  end if;
  if not exists(select 1 from public.permissions where key='hr.payroll.approve') then
    raise exception 'Permissão de aprovação da folha ausente';
  end if;

  if exists (
    select 1
    from public.hr_payroll_entries
    where net_salary < 0 or deductions > gross_salary
  ) then raise exception 'Existe lançamento salarial com líquido inválido'; end if;

  if exists (
    select 1
    from public.hr_payroll_runs run
    where run.status='posted'
      and not exists (
        select 1 from public.payables payable
        where payable.company_id=run.company_id
          and payable.project_id=run.project_id
          and payable.source_system='elos_hr'
          and payable.source_id like 'payroll:' || run.id::text || ':%'
      )
  ) then raise exception 'Existe folha lançada sem contas a pagar'; end if;
end $$;
SQL

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -f body='✅ Supabase 0069 aplicado e validado. Colaboradores, folha mensal, salários, descontos, encargos/benefícios e geração de contas a pagar estão ativos.' >/dev/null
fi
