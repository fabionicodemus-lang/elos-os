#!/usr/bin/env bash
# Diagnóstico de segurança SOMENTE LEITURA (transação read only).
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
begin transaction read only;
\echo '== 1. Tabelas public SEM RLS'
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity order by 1;
\echo '== 2. Tabelas com RLS mas sem nenhuma política'
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relrowsecurity
   and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname) order by 1;
\echo '== 3. Políticas permissivas demais (true / anon / public)'
select tablename, policyname, cmd, roles, qual, with_check from pg_policies
 where schemaname='public' and (qual='true' or with_check='true' or 'anon'=any(roles) or 'public'=any(roles)) order by 1;
\echo '== 4. Tabelas de negócio sem company_id'
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r'
   and not exists (select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='company_id' and not a.attisdropped) order by 1;
\echo '== 5. Funções SECURITY DEFINER sem search_path fixo'
select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%') order by 1;
\echo '== 6. Funções SECURITY DEFINER executáveis por anon'
select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') order by 1;
\echo '== 7. Tabelas com privilégio para anon'
select table_name, string_agg(privilege_type, ',') from information_schema.role_table_grants
 where table_schema='public' and grantee='anon' group by 1 order by 1;
\echo '== 8. Views sem security_invoker'
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='v'
   and not coalesce((select bool_or(o like 'security_invoker=%true' or o like 'security_invoker=on') from unnest(c.reloptions) o), false) order by 1;
\echo '== 9. Buckets de storage'
select id, public, file_size_limit, allowed_mime_types from storage.buckets order by 1;
\echo '== 10. Auditoria existente'
select count(*) as audit_logs_rows, min(created_at), max(created_at) from public.audit_logs;
select column_name, data_type from information_schema.columns where table_schema='public' and table_name='audit_logs' order by ordinal_position;
\echo '== 11. Tabelas com triggers de auditoria'
select event_object_table, string_agg(distinct trigger_name, ',') from information_schema.triggers
 where trigger_schema='public' and trigger_name ilike '%audit%' group by 1 order by 1;
\echo '== 12. Tamanho do banco e maiores tabelas'
select pg_size_pretty(pg_database_size(current_database()));
select relname, pg_size_pretty(pg_total_relation_size(c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and relkind='r' order by pg_total_relation_size(c.oid) desc limit 10;
\echo '== 13. Usuários e MFA'
select count(*) users, count(*) filter (where last_sign_in_at > now()-interval '30 days') ativos30d from auth.users;
select count(distinct user_id) users_com_mfa from auth.mfa_factors where status='verified';
\echo '== 14. Extensões'
select extname, extversion from pg_extension order by 1;
\echo '== 15. Contagem de tabelas public'
select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r';
rollback;
SQL
