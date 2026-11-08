#!/usr/bin/env bash
# Mirrors the deletion list (ADR 0206) to the backup storage – WITHOUT --delete: the list only grows and holds ids and
# times, no names or content, so it is kept as long as any backup could be restored. Called after the backup run.
set -euo pipefail
LOG="${DELETIONS_LOG:-/opt/consyrion/deletions/deletions.log}"
[ -f /opt/consyrion/secrets/deploy.env ] && . /opt/consyrion/secrets/deploy.env
[ -n "${BACKUP_REMOTE:-}" ] && [ -f "$LOG" ] || exit 0
rsync -a -e "ssh -p 23 -o StrictHostKeyChecking=accept-new" "$LOG" "$BACKUP_REMOTE/deletions.log"
