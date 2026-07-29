#!/usr/bin/env bash
set -euo pipefail

LOG_FILE=/tmp/migration-0051.log
SAFE_LOG=/tmp/migration-0051-safe.log
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
    echo '❌ As migrations 0051 de Propostas Comerciais falharam.'
    echo
    echo '```text'
    tail -n 220 "$SAFE_LOG"
    echo '```'
  } >/tmp/migration-0051-comment.md
  gh pr comment "$PR_NUMBER" --body-file /tmp/migration-0051-comment.md || true
  exit "$exit_code"
}
trap report_failure ERR

gh pr comment "$PR_NUMBER" --body 'Iniciando as migrations `0051` e `0051a`: propostas, versões, condições financeiras, reservas e conversão em vendas.'

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
  --file=supabase/migrations/20260729_0051_commercial_proposals.sql \
  >"$LOG_FILE" 2>&1

psql "$EFFECTIVE_DB_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --file=supabase/migrations/20260729_0051a_commercial_proposals_runtime_fix.sql \
  >>"$LOG_FILE" 2>&1

psql "$EFFECTIVE_DB_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --command="do \$\$ begin
    if to_regclass('public.commercial_proposals') is null then raise exception 'Tabela de propostas não criada'; end if;
    if to_regclass('public.commercial_proposal_payment_items') is null then raise exception 'Tabela de condições não criada'; end if;
    if to_regclass('public.commercial_proposal_counters') is null then raise exception 'Tabela de numeração não criada'; end if;
    if to_regprocedure('public.commercial_proposal_next_number(uuid,uuid,date)') is null then raise exception 'Função de numeração não criada'; end if;
    if to_regprocedure('public.commercial_set_proposal_status(uuid,uuid,text,date,uuid)') is null then raise exception 'Função de situação não criada'; end if;
    if to_regprocedure('public.commercial_create_proposal_revision(uuid,uuid,date,uuid)') is null then raise exception 'Função de versão não criada'; end if;
    if to_regprocedure('public.commercial_convert_proposal(uuid,uuid,date,text,uuid)') is null then raise exception 'Função de conversão não criada'; end if;
    if not exists(select 1 from public.permissions where key='commercial.proposals.view') then raise exception 'Permissão de visualização ausente'; end if;
    if not exists(select 1 from public.permissions where key='commercial.proposals.convert') then raise exception 'Permissão de conversão ausente'; end if;
    if position('plano financeiro' in lower(pg_get_functiondef('public.commercial_set_proposal_status(uuid,uuid,text,date,uuid)'::regprocedure))) = 0 then raise exception 'Validação do plano financeiro ausente'; end if;
  end \$\$;" >>"$LOG_FILE" 2>&1

sanitize_log
cat "$SAFE_LOG"
gh pr comment "$PR_NUMBER" --body "✅ Migrations 0051 e 0051a aplicadas e validadas. Propostas, versões, plano financeiro, reservas e conversão em vendas foram confirmados. Execução: https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
trap - ERR
