#!/usr/bin/env bash
# Restores a database backup into the running stack – the only supported restore (ADR 0206, #206):
#   ./restore.sh --yes <dump-file>      (on the server, as root)
# 1. backs up the current database (label pre-restore) and adds its deletion tombstones to the deletion list,
# 2. stops web and worker, restores the dump (pg_restore --clean),
# 3. runs post-restore-scrub.sh so nothing deleted after the dump comes back – if the scrub fails, the app stays stopped,
# 4. starts web and worker again.
set -euo pipefail
[ "${1:-}" = "--yes" ] || { echo "usage: restore.sh --yes <dump-file>   (replaces the live database)" >&2; exit 1; }
DUMP="${2:?usage: restore.sh --yes <dump-file>}"
[ -f "$DUMP" ] || { echo "restore: $DUMP not found" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
PG=consyrion-postgres-1
LOG="${DELETIONS_LOG:-/opt/consyrion/deletions/deletions.log}"

install -d -m 1777 "$(dirname "$LOG")"
touch "$LOG" && chmod 666 "$LOG"
if docker exec "$PG" pg_isready -U consyrion -d consyrion >/dev/null 2>&1; then
  "$HERE/backup.sh" pre-restore
  # The live database may know deletions the list missed (e.g. a failed write); merge them in, never drop lines.
  docker exec "$PG" psql -U consyrion -d consyrion -tA -F ' ' -c \
    "select to_char(deleted_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'), kind, entity_id, organization_id from deletion_tombstone" \
    2>/dev/null >>"$LOG" || echo "restore: no tombstones exported (table missing in the live database?)" >&2
  sort -u -o "$LOG" "$LOG"
fi

docker stop consyrion-web-1 consyrion-worker-1 >/dev/null 2>&1 || true
docker exec -i "$PG" pg_restore -U consyrion -d consyrion --clean --if-exists --no-owner --exit-on-error <"$DUMP"
if ! "$HERE/post-restore-scrub.sh" "$PG"; then
  echo "restore: the post-restore scrub failed – web and worker stay stopped. Fix the cause, run post-restore-scrub.sh $PG, then start them." >&2
  exit 1
fi
docker start consyrion-web-1 consyrion-worker-1 >/dev/null
echo "$(date -u +%FT%TZ) restore $(basename "$DUMP") done" | tee -a /opt/consyrion/restore-tests.log
