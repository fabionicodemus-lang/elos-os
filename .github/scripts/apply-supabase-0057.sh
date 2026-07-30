#!/usr/bin/env bash
set -euo pipefail

LOG_FILE=/tmp/migration-0057.log
SAFE_LOG=/tmp/migration-0057-safe.log
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
    echo '❌ A migration 0057 de Dados & Backup falhou.'
    echo
    echo '```text'
    tail -n 360 "$SAFE_LOG"
    echo '```'
  } >/tmp/migration-0057-comment.md
  gh pr comment "$PR_NUMBER" --body-file /tmp/migration-0057-comment.md || true
  exit "$exit_code"
}
trap report_failure ERR

gh pr comment "$PR_NUMBER" --body 'Iniciando a migration `0057`: inventário, exportações privadas, integridade, retenção, auditoria e solicitações de restauração.'

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
  --file=supabase/migrations/20260729_0057_system_data_backup.sql \
  >"$LOG_FILE" 2>&1

psql "$EFFECTIVE_DB_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --command="do \$\$ begin
    if to_regclass('public.system_data_exports') is null then raise exception 'Tabela de exportações ausente'; end if;
    if to_regclass('public.system_data_restore_requests') is null then raise exception 'Tabela de restaurações ausente'; end if;
    if to_regclass('public.system_data_audit') is null then raise exception 'Auditoria de dados ausente'; end if;
    if to_regprocedure('public.system_company_data_inventory(uuid,uuid)') is null then raise exception 'Inventário de dados ausente'; end if;
    if to_regprocedure('public.system_build_data_export(uuid,uuid,text[])') is null then raise exception 'Gerador lógico ausente'; end if;
    if to_regprocedure('public.system_create_data_export(uuid,uuid,text,text[],text,integer)') is null then raise exception 'Criação de exportação ausente'; end if;
    if to_regprocedure('public.system_request_data_restore(uuid,text)') is null then raise exception 'Solicitação de restauração ausente'; end if;
    if not exists(select 1 from public.permissions where key='admin.data.view') then raise exception 'Permissão de consulta ausente'; end if;
    if not exists(select 1 from public.permissions where key='admin.data.export') then raise exception 'Permissão de exportação ausente'; end if;
    if not exists(select 1 from public.permissions where key='admin.data.restore') then raise exception 'Permissão de restauração ausente'; end if;
    if not exists(select 1 from storage.buckets where id='system-backups' and public=false) then raise exception 'Bucket privado ausente'; end if;
    if has_table_privilege('authenticated','public.system_data_exports','INSERT') or has_table_privilege('authenticated','public.system_data_exports','UPDATE') or has_table_privilege('authenticated','public.system_data_exports','DELETE') then raise exception 'Alteração direta das exportações ainda permitida'; end if;
    if has_table_privilege('authenticated','public.system_data_restore_requests','INSERT') or has_table_privilege('authenticated','public.system_data_restore_requests','UPDATE') or has_table_privilege('authenticated','public.system_data_restore_requests','DELETE') then raise exception 'Alteração direta das restaurações ainda permitida'; end if;
    if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='system_backups_select') then raise exception 'Política de download privado ausente'; end if;
    if public.system_data_module_for_table('finance_taxes')<>'finance' then raise exception 'Classificação de módulos inválida'; end if;
  end \$\$;" >>"$LOG_FILE" 2>&1

sanitize_log
cat "$SAFE_LOG"
gh pr comment "$PR_NUMBER" --body "✅ Migration 0057 aplicada e validada. Inventário, exportação lógica, bucket privado, checksum, retenção, auditoria e fluxo seguro de restauração foram confirmados. Execução: https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
trap - ERR
