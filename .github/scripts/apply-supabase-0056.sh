#!/usr/bin/env bash
set -euo pipefail

LOG_FILE=/tmp/migration-0056.log
SAFE_LOG=/tmp/migration-0056-safe.log
PR_NUMBER="${PR_NUMBER:?PR_NUMBER ausente}"

sanitize_log() {
  python - "$LOG_FILE" "$SAFE_LOG" <<'PY'
import os,re,sys
from pathlib import Path
source=Path(sys.argv[1])
text=source.read_text(errors='replace') if source.exists() else ''
for name in ('SUPABASE_DB_URL','EFFECTIVE_DB_URL'):
    value=os.environ.get(name)
    if value:
        text=text.replace(value,'[REDACTED]')
text=re.sub(r'postgres(?:ql)?://[^\s]+','postgresql://[REDACTED]',text)
Path(sys.argv[2]).write_text(text)
PY
}

report_failure() {
  local exit_code=$?
  sanitize_log
  {
    echo '❌ A migration 0056 de Papéis e Permissões falhou.'
    echo
    echo '```text'
    tail -n 320 "$SAFE_LOG"
    echo '```'
  } >/tmp/migration-0056-comment.md
  gh pr comment "$PR_NUMBER" --body-file /tmp/migration-0056-comment.md || true
  exit "$exit_code"
}
trap report_failure ERR

gh pr comment "$PR_NUMBER" --body 'Iniciando a migration `0056`: papéis personalizados, matriz de permissões, proteções administrativas e auditoria.'

python - <<'PY'
import os
from pathlib import Path
from urllib.parse import quote, unquote, urlparse
raw=os.environ.get('SUPABASE_DB_URL','').strip()
if not raw:
    raise SystemExit('Secret SUPABASE_DB_URL não configurado.')
if any(x in raw.lower() for x in ('[your-password]','your-password','[password]')):
    raise SystemExit('URI contém senha-placeholder.')
normalized=raw
try:
    scheme,remainder=raw.split('://',1)
    credentials,server=remainder.rsplit('@',1)
    username,password=credentials.split(':',1)
    normalized=f"{scheme}://{quote(unquote(username),safe='')}:{quote(unquote(password),safe='')}@{server}"
except Exception:
    pass
host=(urlparse(normalized).hostname or '').lower()
if '.pooler.supabase.com' not in host:
    raise SystemExit('Use uma URI Session Pooler.')
print(f'::add-mask::{normalized}')
Path('/tmp/effective-db-url').write_text(normalized)
PY

export EFFECTIVE_DB_URL
EFFECTIVE_DB_URL="$(cat /tmp/effective-db-url)"

psql "$EFFECTIVE_DB_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --file=supabase/migrations/20260729_0056_system_permissions.sql \
  >"$LOG_FILE" 2>&1

psql "$EFFECTIVE_DB_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --command="do \$\$ begin
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='roles' and column_name='status') then raise exception 'Situação dos papéis ausente'; end if;
    if to_regclass('public.system_role_permission_audit') is null then raise exception 'Histórico de permissões não criado'; end if;
    if to_regprocedure('public.save_company_role(uuid,uuid,text,text,text)') is null then raise exception 'Cadastro de papéis ausente'; end if;
    if to_regprocedure('public.clone_company_role(uuid,uuid,text,text)') is null then raise exception 'Duplicação de papéis ausente'; end if;
    if to_regprocedure('public.set_company_role_permissions(uuid,uuid,text[])') is null then raise exception 'Matriz de permissões ausente'; end if;
    if position('role.key in (''owner'',''admin'')' in pg_get_functiondef('public.has_company_permission(uuid,text)'::regprocedure))=0 then raise exception 'Proteção de acesso total do proprietário e administrador ausente'; end if;
    if position('v_current_role.key=''owner''' in pg_get_functiondef('public.set_company_member_role(uuid,text)'::regprocedure))=0 then raise exception 'Proteção do proprietário ausente'; end if;
    if not exists(select 1 from public.permissions where key='admin.roles.view') then raise exception 'Permissão de visualização ausente'; end if;
    if not exists(select 1 from public.permissions where key='admin.roles.manage') then raise exception 'Permissão de gestão ausente'; end if;
    if exists(
      select 1 from public.roles r cross join public.permissions p
      left join public.role_permissions rp on rp.role_id=r.id and rp.permission_key=p.key and rp.allowed=true
      where r.key in ('owner','admin') and rp.role_id is null
    ) then raise exception 'Proprietário ou administrador sem acesso total'; end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename='system_role_permission_audit' and policyname='system_role_permission_audit_select') then raise exception 'Política de leitura do histórico ausente'; end if;
  end \$\$;" >>"$LOG_FILE" 2>&1

sanitize_log
cat "$SAFE_LOG"
gh pr comment "$PR_NUMBER" --body "✅ Migration 0056 aplicada e validada. Papéis personalizados, matriz de acessos, proteção do proprietário/administrador, papéis ativos e auditoria foram confirmados. Execução: https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
trap - ERR
