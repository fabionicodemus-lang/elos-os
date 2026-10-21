#!/usr/bin/env bash
# Dump e manifesto no mesmo snapshot; somente criptografia em backup/.
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL não configurada}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE não configurada}"
exec python3 "$(dirname "$0")/database_backup.py" backup
