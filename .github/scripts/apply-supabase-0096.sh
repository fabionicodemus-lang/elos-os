#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

MIGRATIONS=(
  "supabase/migrations/20261015111500_integration_mapping_foundation.sql"
  "supabase/migrations/20261015112000_integration_mapping_legacy_bridge.sql"
)
VALIDATION=".github/tests/integration-mappings-0096.sql"

echo "Aplicando Mapa de Integrações genérico..."
for migration in "${MIGRATIONS[@]}"; do
  echo "  - $migration"
  psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
done

echo "Validando Mapa de Integrações..."
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f "$VALIDATION"

echo "Supabase 0096 aplicado e validado: mapa genérico ativo e compatível com o de-para Koper existente."
