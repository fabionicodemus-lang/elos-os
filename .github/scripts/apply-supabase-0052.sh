#!/usr/bin/env bash
set -euo pipefail

LOG_FILE=/tmp/migration-0052.log
SAFE_LOG=/tmp/migration-0052-safe.log
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
    echo '❌ As migrations 0052 de Corretores e Comissões falharam.'
    echo
    echo '```text'
    tail -n 240 "$SAFE_LOG"
    echo '```'
  } >/tmp/migration-0052-comment.md
  gh pr comment "$PR_NUMBER" --body-file /tmp/migration-0052-comment.md || true
  exit "$exit_code"
}
trap report_failure ERR

gh pr comment "$PR_NUMBER" --body 'Iniciando as migrations `0052`, `0052a` e `0052b`: corretores, comissões, Contas a Pagar e sincronização bancária.'

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
  --file=supabase/migrations/20260729_0052_commercial_brokers.sql \
  >"$LOG_FILE" 2>&1

psql "$EFFECTIVE_DB_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --file=supabase/migrations/20260729_0052a_commercial_brokers_backfill.sql \
  >>"$LOG_FILE" 2>&1

psql "$EFFECTIVE_DB_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --file=supabase/migrations/20260729_0052b_commercial_brokers_runtime_fix.sql \
  >>"$LOG_FILE" 2>&1

psql "$EFFECTIVE_DB_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --command="do \$\$ begin
    if to_regclass('public.commercial_brokers') is null then raise exception 'Tabela de corretores não criada'; end if;
    if to_regclass('public.commercial_sale_commissions') is null then raise exception 'Tabela de comissões não criada'; end if;
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='commercial_proposals' and column_name='broker_id') then raise exception 'Vínculo de corretor nas propostas ausente'; end if;
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='sales' and column_name='broker_id') then raise exception 'Vínculo de corretor nas vendas ausente'; end if;
    if to_regprocedure('public.commercial_brokers_summary(uuid,uuid)') is null then raise exception 'Resumo de corretores ausente'; end if;
    if to_regprocedure('public.commercial_set_commission_status(uuid,uuid,text,date,uuid)') is null then raise exception 'Aprovação de comissão ausente'; end if;
    if to_regprocedure('public.commercial_generate_commission_payable(uuid)') is null then raise exception 'Geração financeira da comissão ausente'; end if;
    if to_regprocedure('public.commercial_resolve_broker_reference()') is null then raise exception 'Resolução de vínculo do corretor ausente'; end if;
    if not exists(select 1 from pg_trigger where tgname='sales_sync_commission' and not tgisinternal) then raise exception 'Trigger automático de comissão ausente'; end if;
    if not exists(select 1 from pg_trigger where tgname='finance_payables_broker_commission_sync' and not tgisinternal) then raise exception 'Trigger financeiro da comissão ausente'; end if;
    if not exists(select 1 from public.permissions where key='commercial.brokers.view') then raise exception 'Permissão de visualização ausente'; end if;
    if not exists(select 1 from public.permissions where key='commercial.brokers.finance') then raise exception 'Permissão financeira ausente'; end if;
    if position('v_name_changed' in pg_get_functiondef('public.commercial_resolve_broker_reference()'::regprocedure)) = 0 then raise exception 'Correção da troca de corretor ausente'; end if;
  end \$\$;" >>"$LOG_FILE" 2>&1

sanitize_log
cat "$SAFE_LOG"
gh pr comment "$PR_NUMBER" --body "✅ Migrations 0052, 0052a e 0052b aplicadas e validadas. Corretores, troca de vínculo, comissões automáticas, Contas a Pagar e sincronização após a baixa bancária foram confirmados. Execução: https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
trap - ERR
