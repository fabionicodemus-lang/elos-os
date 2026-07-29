#!/usr/bin/env bash
set -euo pipefail

LOG_FILE=/tmp/migration-0053.log
SAFE_LOG=/tmp/migration-0053-safe.log
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
    echo '❌ A migration 0053 de Assistências Técnicas falhou.'
    echo
    echo '```text'
    tail -n 260 "$SAFE_LOG"
    echo '```'
  } >/tmp/migration-0053-comment.md
  gh pr comment "$PR_NUMBER" --body-file /tmp/migration-0053-comment.md || true
  exit "$exit_code"
}
trap report_failure ERR

gh pr comment "$PR_NUMBER" --body 'Iniciando a migration `0053`: chamados técnicos, garantia, visitas, evidências, custos e aceite.'

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
  --file=supabase/migrations/20260729_0053_postwork_assistance.sql \
  >"$LOG_FILE" 2>&1

psql "$EFFECTIVE_DB_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --command="do \$\$ begin
    if to_regclass('public.postwork_assistance_tickets') is null then raise exception 'Tabela de chamados não criada'; end if;
    if to_regclass('public.postwork_assistance_visits') is null then raise exception 'Tabela de visitas não criada'; end if;
    if to_regclass('public.postwork_assistance_documents') is null then raise exception 'Tabela de evidências não criada'; end if;
    if to_regclass('public.postwork_assistance_audit') is null then raise exception 'Tabela de histórico não criada'; end if;
    if to_regprocedure('public.postwork_next_assistance_number(uuid,uuid,date)') is null then raise exception 'Numeração automática ausente'; end if;
    if to_regprocedure('public.postwork_assistance_summary(uuid,uuid)') is null then raise exception 'Indicadores de assistência ausentes'; end if;
    if to_regprocedure('public.postwork_set_assistance_status(uuid,uuid,text,text,text,text,uuid)') is null then raise exception 'Fluxo de atendimento ausente'; end if;
    if not exists(select 1 from public.permissions where key='postwork.assistance.view') then raise exception 'Permissão de visualização ausente'; end if;
    if not exists(select 1 from public.permissions where key='postwork.assistance.close') then raise exception 'Permissão de encerramento ausente'; end if;
    if not exists(select 1 from storage.buckets where id='postwork-assistance' and public=false) then raise exception 'Bucket privado de evidências ausente'; end if;
    if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='postwork_assistance_storage_insert') then raise exception 'Política de upload ausente'; end if;
  end \$\$;" >>"$LOG_FILE" 2>&1

sanitize_log
cat "$SAFE_LOG"
gh pr comment "$PR_NUMBER" --body "✅ Migration 0053 aplicada e validada. Chamados, garantia, vistorias, execução, evidências, custos, aceite e histórico foram confirmados. Execução: https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
trap - ERR
