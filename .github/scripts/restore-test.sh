#!/usr/bin/env bash
# Restaura somente em banco local novo elos_restore_*; falhas bloqueiam o aceite.
set -euo pipefail
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE não configurada}"
exec python3 "$(dirname "$0")/database_backup.py" restore
