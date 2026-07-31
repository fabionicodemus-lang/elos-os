#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
MIGRATION="supabase/migrations/20260731_0062_bossa_homologation_project.sql"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  v_company_id uuid;
  v_user_id uuid;
  v_project_id uuid;
begin
  select id into v_company_id from public.companies where slug='bossa' and status='active' order by created_at asc limit 1;
  select id into v_user_id from auth.users where lower(email)=lower('fabio@bossaempreendimentos.com.br') and email_confirmed_at is not null limit 1;
  select id into v_project_id from public.projects
   where company_id=v_company_id
     and upper(coalesce(code,''))='HOM-001'
     and upper(name) like '%[HOMOLOGAÇÃO]%'
   limit 1;

  if v_company_id is null then raise exception 'Bossa não localizada'; end if;
  if v_user_id is null then raise exception 'Usuário de homologação não localizado'; end if;
  if v_project_id is null then raise exception 'Projeto HOM-001 não foi criado'; end if;
  if not exists(
    select 1 from public.project_memberships
    where project_id=v_project_id and user_id=v_user_id
  ) then
    raise exception 'Usuário de homologação não foi vinculado ao projeto HOM-001';
  end if;
end $$;
SQL

if [[ -n "${GH_TOKEN:-}" && -n "${PR_NUMBER:-}" ]]; then
  gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    -f body='✅ Migration 0062 aplicada e validada. A obra HOM-001 · [HOMOLOGAÇÃO] Residencial Aurora foi criada dentro da Bossa e o usuário técnico foi vinculado exclusivamente ao projeto de testes.' >/dev/null
fi
