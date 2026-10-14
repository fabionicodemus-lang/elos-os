#!/usr/bin/env bash
# Backup lógico do banco do Elos OS, criptografado com AES-256 (gpg).
# Gera: backup/elos-os-<data>.dump.gpg e backup/manifest.txt (contagem de linhas).
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE não configurada}"
export PGSSLMODE="${PGSSLMODE:-require}"
STAMP="$(date -u +%Y-%m-%dT%H%MZ)"
mkdir -p backup
PG="docker run --rm -e PGSSLMODE -v $PWD/backup:/backup postgres:17"

$PG pg_dump "$SUPABASE_DB_URL" -Fc --no-owner --no-privileges \
  --schema=public --schema=auth --schema=storage -f "/backup/elos-os.dump"

# Manifesto: linhas por tabela, para conferir a restauração.
$PG psql "$SUPABASE_DB_URL" -X -At -c "
  select format('%s|%s', c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', c.relname), false, true, '')))[1]::text)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' order by 1" > backup/manifest.txt

gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" \
  --symmetric --cipher-algo AES256 -o "backup/elos-os-$STAMP.dump.gpg" backup/elos-os.dump
sha256sum "backup/elos-os-$STAMP.dump.gpg" > backup/checksum.txt
rm -f backup/elos-os.dump
echo "Backup gerado: elos-os-$STAMP.dump.gpg ($(du -h backup/elos-os-$STAMP.dump.gpg | cut -f1)), $(wc -l < backup/manifest.txt) tabelas."
