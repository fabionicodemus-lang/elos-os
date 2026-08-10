#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

MIGRATION="supabase/migrations/20260810_0081_owner_admin_full_access.sql"

echo "Aplicando Supabase 0081: owner e admin com acesso total."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION"

echo "Validando regra central e matriz protegida..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if to_regprocedure('public.has_company_permission(uuid,text)') is null then
    raise exception '0081: função has_company_permission ausente';
  end if;

  if position('role.key in (''owner'', ''admin'')' in pg_get_functiondef('public.has_company_permission(uuid,text)'::regprocedure)) = 0 then
    raise exception '0081: bypass de owner/admin não encontrado';
  end if;

  if exists (
    select 1
    from public.roles role
    cross join public.permissions permission
    left join public.role_permissions mapping
      on mapping.role_id = role.id
     and mapping.permission_key = permission.key
     and mapping.allowed = true
    where role.key in ('owner', 'admin')
      and role.status = 'active'
      and mapping.role_id is null
  ) then
    raise exception '0081: há owner/admin ativo sem alguma permissão cadastrada';
  end if;
end $$;
SQL

message="✅ Supabase 0081 aplicado e validado. Proprietários e Administradores ativos possuem acesso total, inclusive às permissões futuras."
echo "$message"

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" -f body="$message" >/dev/null
fi
