#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
MIGRATION="supabase/migrations/20260731_0061_platform_environment_administration.sql"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regclass('public.platform_admins') is null then
    raise exception 'platform_admins ausente';
  end if;
  if to_regclass('public.platform_environment_audit') is null then
    raise exception 'platform_environment_audit ausente';
  end if;
  if to_regprocedure('public.is_platform_admin()') is null then
    raise exception 'is_platform_admin ausente';
  end if;
  if to_regprocedure('public.platform_create_environment(text,text,text,text,text)') is null then
    raise exception 'platform_create_environment ausente';
  end if;
  if to_regprocedure('public.platform_list_environments()') is null then
    raise exception 'platform_list_environments ausente';
  end if;
  if not exists(select 1 from public.platform_admins where status='active') then
    raise exception 'nenhum administrador fundador da plataforma foi identificado';
  end if;
  if has_function_privilege('authenticated','public.bootstrap_company(text,text,text,text)','EXECUTE') then
    raise exception 'bootstrap_company continua liberada para authenticated';
  end if;
  if not has_function_privilege('authenticated','public.platform_create_environment(text,text,text,text,text)','EXECUTE') then
    raise exception 'platform_create_environment não foi liberada para authenticated';
  end if;
end $$;
SQL

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -f body='✅ Migration 0061 aplicada e validada. O auto-onboarding de empresas foi bloqueado, o administrador fundador da plataforma foi identificado e a criação de ambientes agora exige autorização global no servidor e no banco.' >/dev/null
fi
