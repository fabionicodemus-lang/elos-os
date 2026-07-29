#!/usr/bin/env bash
set -euo pipefail

LOG_FILE=/tmp/bossa-catalog-cleanup.log
SAFE_LOG=/tmp/bossa-catalog-cleanup-safe.log
PR_NUMBER="${PR_NUMBER:?PR_NUMBER ausente}"
CONFIRMATION="${CONFIRMATION:-}"

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
    echo '❌ A limpeza do catálogo técnico da Bossa foi cancelada ou falhou.'
    echo
    echo 'Nenhuma exclusão parcial é mantida, porque todo o processo roda dentro de uma única transação.'
    echo
    echo '```text'
    tail -n 180 "$SAFE_LOG"
    echo '```'
  } >/tmp/bossa-catalog-cleanup-comment.md
  gh pr comment "$PR_NUMBER" --body-file /tmp/bossa-catalog-cleanup-comment.md || true
  exit "$exit_code"
}
trap report_failure ERR

if [ "$CONFIRMATION" != "DELETE_BOSSA_ENGINEERING_CATALOG_20260729" ]; then
  echo 'Token de confirmação destrutiva inválido.' >"$LOG_FILE"
  false
fi

gh pr comment "$PR_NUMBER" --body '⚠️ Iniciando a limpeza confirmada do catálogo técnico da **Bossa Empreendimentos**. O processo fará backup interno, removerá dependências técnicas vinculadas e apagará todos os serviços e insumos da empresa em uma única transação.'

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
    raise SystemExit('Use uma URI Session Pooler do Supabase.')
print(f'::add-mask::{normalized}')
Path('/tmp/effective-db-url').write_text(normalized)
PY

export EFFECTIVE_DB_URL
EFFECTIVE_DB_URL="$(cat /tmp/effective-db-url)"

psql "$EFFECTIVE_DB_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --file=.github/scripts/cleanup-bossa-engineering-catalog.sql \
  >"$LOG_FILE" 2>&1

sanitize_log
cat "$SAFE_LOG"

SUMMARY="$(tail -n 40 "$SAFE_LOG")"
{
  echo '✅ Limpeza concluída com sucesso.'
  echo
  echo '- Empresa: **Bossa Empreendimentos**'
  echo '- Todos os serviços e insumos foram removidos.'
  echo '- Preços, composições e dependências técnicas vinculadas foram tratados dentro da mesma transação.'
  echo '- Uma cópia interna foi gravada nas tabelas de backup para auditoria ou restauração manual.'
  echo
  echo '<details><summary>Resumo técnico</summary>'
  echo
  echo '```text'
  printf '%s\n' "$SUMMARY"
  echo '```'
  echo '</details>'
} >/tmp/bossa-catalog-cleanup-success.md

gh pr comment "$PR_NUMBER" --body-file /tmp/bossa-catalog-cleanup-success.md
trap - ERR
