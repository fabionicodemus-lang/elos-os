#!/usr/bin/env bash
# Materializa o schema do Elos OS em um Postgres descartável, aplicando o shim do
# Supabase e todas as migrations em ordem.
#
# Serve a dois propósitos:
#   1. gerar types/database.ts a partir do schema real;
#   2. provar que supabase/migrations ainda aplica do zero — foi assim que se
#      descobriu que a 0048 não rodava como estava no repositório.
#
# Uso: ops/build-shadow-db.sh [nome-do-banco]
#
# Conexão pelas variáveis padrão do PostgreSQL, com defaults que servem tanto ao
# container de serviço do CI quanto a um cluster local:
#   PGHOST (127.0.0.1) PGPORT (5432) PGUSER (postgres) PGPASSWORD (shadow)

set -euo pipefail

DB_NAME="${1:-elos_shadow}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-shadow}"

# Provisionamento de dados, não de schema: cria a obra de homologação dentro de
# uma empresa Bossa que só existe no ambiente real. Não cabe no shadow.
SKIP_SUFFIX="_0062_bossa_homologation_project.sql"

echo "==> Recriando o banco ${DB_NAME} em ${PGHOST}:${PGPORT}"
psql -q -d postgres -v ON_ERROR_STOP=1 \
  -c "drop database if exists ${DB_NAME};" \
  -c "create database ${DB_NAME};"

echo "==> Aplicando o shim do Supabase"
psql -q -d "${DB_NAME}" -v ON_ERROR_STOP=1 -f "${ROOT}/supabase/shadow/00-supabase-shim.sql"

echo "==> Aplicando migrations"
applied=0
skipped=0
for migration in $(ls "${ROOT}"/supabase/migrations/*.sql | sort); do
  name="$(basename "${migration}")"
  case "${name}" in
    *${SKIP_SUFFIX})
      skipped=$((skipped + 1))
      echo "    pulada  ${name} (provisionamento de dados)"
      continue
      ;;
  esac

  if ! psql -q -d "${DB_NAME}" -v ON_ERROR_STOP=1 -f "${migration}" > /tmp/shadow-migration.log 2>&1; then
    echo "!!! Falhou: ${name}" >&2
    grep -E "ERROR|FATAL" /tmp/shadow-migration.log | head -5 >&2
    exit 1
  fi
  applied=$((applied + 1))
done

echo "==> ${applied} migrations aplicadas, ${skipped} pulada(s)"
echo "==> Pronto: postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB_NAME}"
