#!/usr/bin/env bash
set -euo pipefail

LOG_FILE=/tmp/migration-0054.log
SAFE_LOG=/tmp/migration-0054-safe.log
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
    echo '❌ A migration 0054 de Vistorias e Chamados falhou.'
    echo
    echo '```text'
    tail -n 280 "$SAFE_LOG"
    echo '```'
  } >/tmp/migration-0054-comment.md
  gh pr comment "$PR_NUMBER" --body-file /tmp/migration-0054-comment.md || true
  exit "$exit_code"
}
trap report_failure ERR

gh pr comment "$PR_NUMBER" --body 'Iniciando a migration `0054`: modelos, checklists, pendências, reinspeções, Assistência Técnica e termo de entrega.'

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
  --file=supabase/migrations/20260729_0054_postwork_inspections.sql \
  >"$LOG_FILE" 2>&1

psql "$EFFECTIVE_DB_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --command="do \$\$ begin
    if to_regclass('public.postwork_inspection_templates') is null then raise exception 'Tabela de modelos não criada'; end if;
    if to_regclass('public.postwork_inspection_template_items') is null then raise exception 'Itens dos modelos não criados'; end if;
    if to_regclass('public.postwork_unit_inspections') is null then raise exception 'Tabela de vistorias não criada'; end if;
    if to_regclass('public.postwork_unit_inspection_items') is null then raise exception 'Checklist das vistorias não criado'; end if;
    if to_regclass('public.postwork_inspection_documents') is null then raise exception 'Tabela de evidências não criada'; end if;
    if to_regprocedure('public.save_postwork_inspection_template(uuid,uuid,uuid,text,text,text,jsonb)') is null then raise exception 'Função de modelos ausente'; end if;
    if to_regprocedure('public.create_postwork_unit_inspection(uuid,uuid,uuid,uuid,uuid,text,timestamp with time zone,text,text,text,text,text)') is null then raise exception 'Criação de vistoria ausente'; end if;
    if to_regprocedure('public.complete_postwork_unit_inspection(uuid,uuid,uuid,jsonb,text)') is null then raise exception 'Conclusão do checklist ausente'; end if;
    if to_regprocedure('public.transfer_postwork_inspection_item_to_assistance(uuid,uuid,uuid,uuid,text,timestamp with time zone)') is null then raise exception 'Integração com Assistência Técnica ausente'; end if;
    if to_regprocedure('public.deliver_postwork_unit_inspection(uuid,uuid,uuid,text,text,text,integer,integer,text,text,text,integer)') is null then raise exception 'Termo de entrega ausente'; end if;
    if not exists(select 1 from public.permissions where key='postwork.inspections.view') then raise exception 'Permissão de visualização ausente'; end if;
    if not exists(select 1 from public.permissions where key='postwork.inspections.deliver') then raise exception 'Permissão de entrega ausente'; end if;
    if not exists(select 1 from storage.buckets where id='postwork-inspections' and public=false) then raise exception 'Bucket privado ausente'; end if;
    if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='postwork_inspections_storage_insert') then raise exception 'Política de upload ausente'; end if;
  end \$\$;" >>"$LOG_FILE" 2>&1

sanitize_log
cat "$SAFE_LOG"
gh pr comment "$PR_NUMBER" --body "✅ Migration 0054 aplicada e validada. Modelos, vistorias, pendências, reinspeções, transferência para Assistência Técnica, evidências e termo de entrega foram confirmados. Execução: https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
trap - ERR
