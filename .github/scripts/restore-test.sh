#!/usr/bin/env bash
# Teste de restauração: restaura o backup num banco descartável e compara
# a contagem de linhas com o manifesto gerado no momento do backup.
set -euo pipefail
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE não configurada}"
FILE="$(ls backup/*.dump.gpg | head -1)"
sha256sum -c backup/checksum.txt
gpg --batch --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" -d -o backup/restore.dump "$FILE"
export PGPASSWORD=postgres
DB="postgresql://postgres@localhost:5432/postgres"
psql "$DB" -X -q -c "create role anon nologin; create role authenticated nologin; create role service_role nologin; create role supabase_admin nologin; create role supabase_auth_admin nologin; create role supabase_storage_admin nologin; create schema if not exists extensions;"
pg_restore -d "$DB" --no-owner --no-privileges backup/restore.dump > restore.log 2>&1 || true
echo "Avisos da restauração: $(grep -c 'error' restore.log || true)"
fail=0; checked=0
while IFS='|' read -r table expected; do
  got="$(psql "$DB" -X -At -c "select count(*) from public.\"$table\"" 2>/dev/null || echo missing)"
  checked=$((checked+1))
  if [ "$got" != "$expected" ]; then echo "DIVERGENTE: $table esperado=$expected restaurado=$got"; fail=$((fail+1)); fi
done < backup/manifest.txt
echo "Tabelas conferidas: $checked · divergentes: $fail"
rm -f backup/restore.dump
[ "$fail" -eq 0 ]
