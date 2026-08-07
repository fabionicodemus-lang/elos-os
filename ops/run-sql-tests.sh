#!/usr/bin/env bash
# Roda os testes SQL de supabase/tests.
#
# Há dois tipos, e eles precisam de bancos diferentes:
#
#   - Testes que declaram `-- requires: shadow` rodam contra o shadow database,
#     ou seja, contra o schema real produzido por supabase/migrations. Semeiam
#     seus próprios dados e terminam em rollback, sem deixar resíduo.
#
#   - Os demais montam um schema mínimo próprio e exigem um banco vazio. Cada um
#     recebe o seu, descartado ao final.
#
# Uso: ops/run-sql-tests.sh [nome-do-shadow]

set -euo pipefail

DB_NAME="${1:-elos_shadow}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-shadow}"

passed=0
failed=0

scratch_db="elos_sql_test_scratch"

for test in $(ls "${ROOT}"/supabase/tests/*.sql | sort); do
  name="$(basename "${test}")"

  if grep -q -- "-- requires: shadow" "${test}"; then
    target="${DB_NAME}"
  else
    # Schema próprio: precisa de um banco vazio só para ele.
    psql -q -d postgres -v ON_ERROR_STOP=1 \
      -c "drop database if exists ${scratch_db};" \
      -c "create database ${scratch_db};"
    target="${scratch_db}"
  fi

  if output="$(psql -q -d "${target}" -v ON_ERROR_STOP=1 -f "${test}" 2>&1)"; then
    echo "  ok    ${name}"
    passed=$((passed + 1))
  else
    echo "  FALHA ${name}" >&2
    echo "${output}" | grep -E "ERROR|DETAIL" | head -3 >&2
    failed=$((failed + 1))
  fi
done

psql -q -d postgres -c "drop database if exists ${scratch_db};" > /dev/null 2>&1 || true

echo "==> ${passed} passaram, ${failed} falharam"
[ "${failed}" -eq 0 ]
