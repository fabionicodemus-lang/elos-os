#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

MIGRATION="supabase/migrations/20260812_0083_elos_platform_admin_tenant_split.sql"

echo "Aplicando Supabase 0083: separar administração global, Elos Engenharia e Bossa."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION"

echo "Validando separação dos ambientes sem exibir dados pessoais..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  v_platform_user_id uuid;
  v_bossa_user_id uuid;
  v_bossa_company_id uuid;
  v_elos_company_id uuid;
begin
  select id into v_platform_user_id from auth.users
  where md5(lower(coalesce(email,'')))='c055d77c475516b18ca9f396b630978b' limit 1;
  select id into v_bossa_user_id from auth.users
  where md5(lower(coalesce(email,'')))='d5dd8a3bee2e6ccae6954d8b066d2c61' limit 1;
  select id into v_bossa_company_id from public.companies where slug='bossa' limit 1;
  select id into v_elos_company_id from public.companies
  where slug='elos-engenharia' or lower(trim(name))='elos engenharia'
  order by case when slug='elos-engenharia' then 0 else 1 end limit 1;

  if v_platform_user_id is null or v_bossa_user_id is null then
    raise exception '0083: usuários-alvo não encontrados após aplicação.';
  end if;
  if v_bossa_company_id is null or v_elos_company_id is null then
    raise exception '0083: ambientes Bossa/Elos não encontrados após aplicação.';
  end if;
  if not exists(select 1 from public.platform_admins where user_id=v_platform_user_id and status='active') then
    raise exception '0083: administrador global esperado não está ativo.';
  end if;
  if exists(select 1 from public.platform_admins where user_id=v_bossa_user_id and status='active') then
    raise exception '0083: usuário da Bossa ainda possui administração global.';
  end if;
  if not exists(
    select 1 from public.company_memberships m
    join public.roles r on r.id=m.role_id
    where m.company_id=v_bossa_company_id and m.user_id=v_bossa_user_id
      and m.status='active' and r.key='owner' and r.company_id=v_bossa_company_id
  ) then
    raise exception '0083: owner da Bossa não configurado corretamente.';
  end if;
  if exists(
    select 1 from public.company_memberships m
    where m.company_id=v_bossa_company_id and m.user_id=v_platform_user_id and m.status='active'
  ) then
    raise exception '0083: administrador global ainda possui vínculo operacional ativo na Bossa.';
  end if;
  if not exists(
    select 1 from public.company_memberships m
    join public.roles r on r.id=m.role_id
    where m.company_id=v_elos_company_id and m.user_id=v_platform_user_id
      and m.status='active' and r.key='owner' and r.company_id=v_elos_company_id
  ) then
    raise exception '0083: owner da Elos não configurado corretamente.';
  end if;
  if exists(
    select 1 from public.company_memberships m
    where m.company_id=v_elos_company_id and m.user_id=v_bossa_user_id and m.status='active'
  ) then
    raise exception '0083: usuário da Bossa ainda possui vínculo operacional ativo na Elos.';
  end if;
  if exists(
    select 1
    from public.roles r
    cross join public.permissions p
    left join public.role_permissions rp
      on rp.role_id=r.id and rp.permission_key=p.key and rp.allowed=true
    where r.company_id=v_elos_company_id and r.key in ('owner','admin') and r.status='active'
      and rp.role_id is null
  ) then
    raise exception '0083: owner/admin da Elos sem acesso total.';
  end if;
end $$;

select
  exists(select 1 from public.companies where slug='elos-engenharia' and status='active') as elos_ativa,
  exists(
    select 1 from public.platform_admins pa
    join auth.users u on u.id=pa.user_id
    where md5(lower(coalesce(u.email,'')))='c055d77c475516b18ca9f396b630978b' and pa.status='active'
  ) as admin_global_ok;
SQL

echo "Supabase 0083 aplicado e validado: Elos e Bossa separados com sucesso."
