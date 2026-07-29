#!/usr/bin/env bash
set -euo pipefail

LOG_FILE=/tmp/migration-0049.log
SAFE_LOG=/tmp/migration-0049-safe.log
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
    echo '❌ A migration 0049 falhou.'
    echo
    echo '```text'
    tail -n 160 "$SAFE_LOG"
    echo '```'
  } >/tmp/migration-0049-comment.md
  gh pr comment "$PR_NUMBER" --body-file /tmp/migration-0049-comment.md || true
  exit "$exit_code"
}
trap report_failure ERR

gh pr comment "$PR_NUMBER" --body 'Iniciando a migration `0049`: Serviços integrados, limpeza de mão de obra direta e inclusão das empreitadas.'

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
    raise SystemExit('Use a URI Session Pooler.')
print(f'::add-mask::{normalized}')
Path('/tmp/effective-db-url').write_text(normalized)
PY

export EFFECTIVE_DB_URL
EFFECTIVE_DB_URL="$(cat /tmp/effective-db-url)"

psql "$EFFECTIVE_DB_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --file=supabase/migrations/20260729_0049_engineering_services_compositions_merge.sql \
  >"$LOG_FILE" 2>&1

psql "$EFFECTIVE_DB_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --command="do \$\$ declare v_count integer; begin
    if to_regprocedure('public.engineering_sync_service_outsourced_labor(uuid)') is null then raise exception 'Função de sincronização não criada'; end if;
    if not exists(select 1 from pg_trigger where tgname='engineering_services_outsourced_labor_sync' and not tgisinternal) then raise exception 'Trigger dos serviços não criado'; end if;

    select count(*) into v_count
    from public.engineering_service_composition_items item
    join public.engineering_inputs input on input.id=item.input_id
    where item.status='active' and input.category='labor'
      and coalesce(input.family_code,'')<>'MO-EMP'
      and public.engineering_normalize_text(input.description) not like '%mao de obra empreitada%';
    if v_count<>0 then raise exception 'Ainda existem % vínculos ativos de mão de obra direta',v_count; end if;

    select count(*) into v_count
    from public.engineering_inputs input
    where input.status='active' and input.category='labor'
      and coalesce(input.family_code,'')<>'MO-EMP'
      and public.engineering_normalize_text(input.description) not like '%mao de obra empreitada%';
    if v_count<>0 then raise exception 'Ainda existem % insumos ativos de mão de obra direta',v_count; end if;

    select count(*) into v_count
    from public.engineering_services service
    where service.status='active'
      and not public.engineering_service_excludes_outsourced_labor(service.description,service.group_code)
      and not exists(
        select 1
        from public.engineering_service_compositions composition
        join public.engineering_service_composition_items item on item.composition_id=composition.id and item.status='active'
        join public.engineering_inputs input on input.id=item.input_id
        where composition.service_id=service.id
          and composition.company_id=service.company_id
          and input.family_code='MO-EMP'
      );
    if v_count<>0 then raise exception 'Existem % serviços elegíveis sem mão de obra empreitada',v_count; end if;
  end \$\$;" >>"$LOG_FILE" 2>&1

sanitize_log
cat "$SAFE_LOG"
gh pr comment "$PR_NUMBER" --body "✅ Migration 0049 aplicada e validada. Serviços e composições foram unificados; mão de obra direta foi retirada; empreitadas foram vinculadas somente aos serviços elegíveis. Execução: https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
trap - ERR
