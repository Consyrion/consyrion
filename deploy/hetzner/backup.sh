#!/usr/bin/env bash
# Database backup on the server (cron 03:15, and before every deploy): /opt/consyrion/app/deploy/hetzner/backup.sh [label]
# Custom-format pg_dump, 30 days kept locally; the Storage Box (BACKUP_REMOTE in deploy.env) mirrors the same dumps,
# so remote copies are deleted after 30 days as well (privacy policy, /datenschutz).
# The dump contains provider keys only as ciphertext; the master key (app.env) is NOT in the backup – keep it in
# a password manager, a restore needs it (docs/hetzner.md).
set -euo pipefail
LABEL="${1:-daily}"
DIR=/opt/consyrion/backups
FILE="$DIR/consyrion-$(date -u +%Y%m%dT%H%M%SZ)-$LABEL.dump"
umask 077
docker exec consyrion-postgres-1 pg_dump -U consyrion -d consyrion -Fc >"$FILE.part"
mv "$FILE.part" "$FILE"
find "$DIR" -name 'consyrion-*.dump' -mtime +30 -delete
# shellcheck disable=SC1091
. /opt/consyrion/secrets/deploy.env
if [ -n "${BACKUP_REMOTE:-}" ]; then
  # e.g. BACKUP_REMOTE=u123456@u123456.your-storagebox.de:consyrion (SSH key in /root/.ssh, port 23)
  # Mirror only the dump files: dumps deleted locally are deleted remotely; anything else there stays untouched.
  rsync -a --delete --include='consyrion-*.dump' --exclude='*' -e "ssh -p 23 -o StrictHostKeyChecking=accept-new" "$DIR/" "$BACKUP_REMOTE/"
fi
echo "$(date -u +%FT%TZ) backup ok $(basename "$FILE") $(du -h "$FILE" | cut -f1)"
