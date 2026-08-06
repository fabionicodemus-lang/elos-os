#!/usr/bin/env bash
# Falha se types/database.ts não corresponder ao schema produzido por
# supabase/migrations. Roda no CI para impedir que uma migration entre sem que
# os tipos sejam regenerados — que é o caso em que o build fica verde e o erro
# só aparece em produção.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="elos_shadow_check"

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-shadow}"

GENERATED="$(mktemp)"
trap 'rm -f "${GENERATED}"' EXIT

"${ROOT}/ops/build-shadow-db.sh" "${DB_NAME}" > /dev/null

node "${ROOT}/ops/generate-database-types.mjs" \
  "postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${DB_NAME}" \
  "${GENERATED}" > /dev/null

if diff -u "${ROOT}/types/database.ts" "${GENERATED}" > /tmp/database-types.diff; then
  echo "types/database.ts está sincronizado com supabase/migrations."
  exit 0
fi

echo "types/database.ts está desatualizado em relação a supabase/migrations." >&2
echo "Regenere com: npm run db:shadow && npm run db:types" >&2
echo >&2
head -60 /tmp/database-types.diff >&2
exit 1
