#!/usr/bin/env bash
set -euo pipefail

LOG_FILE=/tmp/migration-0050.log
SAFE_LOG=/tmp/migration-0050-safe.log
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
    echo '❌ A migration 0050 de Impostos falhou.'
    echo
    echo '```text'
    tail -n 180 "$SAFE_LOG"
    echo '```'
  } >/tmp/migration-0050-comment.md
  gh pr comment "$PR_NUMBER" --body-file /tmp/migration-0050-comment.md || true
  exit "$exit_code"
}
trap report_failure ERR

gh pr comment "$PR_NUMBER" --body 'Iniciando a migration `0050`: cadastro de tributos, agenda fiscal e integração com Contas a Pagar.'

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
  --file=supabase/migrations/20260729_0050_finance_taxes.sql \
  >"$LOG_FILE" 2>&1

psql "$EFFECTIVE_DB_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --command="do \$\$ begin
    if to_regclass('public.finance_tax_types') is null then raise exception 'Tabela de tributos não criada'; end if;
    if to_regclass('public.finance_tax_obligations') is null then raise exception 'Tabela de obrigações não criada'; end if;
    if to_regprocedure('public.finance_generate_tax_payable(uuid)') is null then raise exception 'Função de geração da conta não criada'; end if;
    if to_regprocedure('public.finance_sync_tax_obligation_from_payable()') is null then raise exception 'Função de sincronização não criada'; end if;
    if not exists(select 1 from pg_trigger where tgname='finance_payables_tax_obligation_sync' and not tgisinternal) then raise exception 'Trigger de sincronização não criado'; end if;
    if not exists(select 1 from public.permissions where key='finance.taxes.view') then raise exception 'Permissão de visualização ausente'; end if;
    if not exists(select 1 from public.permissions where key='finance.taxes.manage') then raise exception 'Permissão de gestão ausente'; end if;
  end \$\$;" >>"$LOG_FILE" 2>&1

sanitize_log
cat "$SAFE_LOG"
gh pr comment "$PR_NUMBER" --body "✅ Migration 0050 aplicada e validada. Tributos, agenda fiscal, geração de Contas a Pagar e sincronização após a baixa bancária foram confirmados. Execução: https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
trap - ERR
