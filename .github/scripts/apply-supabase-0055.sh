#!/usr/bin/env bash
set -euo pipefail

LOG_FILE=/tmp/migration-0055.log
SAFE_LOG=/tmp/migration-0055-safe.log
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
    echo '❌ A migration 0055 de Garantias falhou.'
    echo
    echo '```text'
    tail -n 320 "$SAFE_LOG"
    echo '```'
  } >/tmp/migration-0055-comment.md
  gh pr comment "$PR_NUMBER" --body-file /tmp/migration-0055-comment.md || true
  exit "$exit_code"
}
trap report_failure ERR

gh pr comment "$PR_NUMBER" --body 'Iniciando a migration `0055`: regras de garantia, itens cobertos, manutenções, documentos e análise dos chamados.'

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
  --file=supabase/migrations/20260729_0055_postwork_warranties.sql \
  >"$LOG_FILE" 2>&1

psql "$EFFECTIVE_DB_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --command="do \$\$ begin
    if to_regclass('public.postwork_warranty_policies') is null then raise exception 'Tabela de regras não criada'; end if;
    if to_regclass('public.postwork_warranty_assets') is null then raise exception 'Tabela de itens garantidos não criada'; end if;
    if to_regclass('public.postwork_warranty_maintenance') is null then raise exception 'Tabela de manutenção não criada'; end if;
    if to_regclass('public.postwork_warranty_documents') is null then raise exception 'Tabela de documentos não criada'; end if;
    if to_regclass('public.postwork_warranty_audit') is null then raise exception 'Histórico de garantias não criado'; end if;
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='postwork_assistance_tickets' and column_name='warranty_asset_id') then raise exception 'Vínculo do chamado com o item garantido ausente'; end if;
    if to_regprocedure('public.save_postwork_warranty_policy(uuid,uuid,uuid,text,text,text,text,text,integer,integer,uuid,text,text,text,text,text)') is null then raise exception 'Função de regras ausente'; end if;
    if to_regprocedure('public.create_postwork_warranty_asset(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,date,date,date,text)') is null then raise exception 'Função de itens garantidos ausente'; end if;
    if to_regprocedure('public.schedule_postwork_warranty_maintenance(uuid,uuid,uuid,uuid,text,date)') is null then raise exception 'Agenda de manutenção ausente'; end if;
    if to_regprocedure('public.analyze_postwork_assistance_warranty(uuid,uuid,uuid,uuid,uuid,text,text)') is null then raise exception 'Análise de chamados ausente'; end if;
    if to_regprocedure('public.postwork_warranties_summary(uuid,uuid)') is null then raise exception 'Indicadores de garantias ausentes'; end if;
    if not exists(select 1 from public.permissions where key='postwork.warranties.view') then raise exception 'Permissão de visualização ausente'; end if;
    if not exists(select 1 from public.permissions where key='postwork.warranties.analyze') then raise exception 'Permissão de análise ausente'; end if;
    if not exists(select 1 from storage.buckets where id='postwork-warranties' and public=false) then raise exception 'Bucket privado de garantias ausente'; end if;
    if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='postwork_warranties_storage_insert') then raise exception 'Política de upload ausente'; end if;
  end \$\$;" >>"$LOG_FILE" 2>&1

sanitize_log
cat "$SAFE_LOG"
gh pr comment "$PR_NUMBER" --body "✅ Migration 0055 aplicada e validada. Regras, vigências, itens garantidos, manutenção, documentos privados e análise dos chamados foram confirmados. Execução: https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
trap - ERR
