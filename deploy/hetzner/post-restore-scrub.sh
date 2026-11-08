#!/usr/bin/env bash
# ADR 0206 (#206): after a backup restore, removes again what users deleted after that backup was taken – before web and
# worker start. Usage (on the server, as root):
#   post-restore-scrub.sh [--dry-run] <postgres-container | postgres://url>
# Reads the deletion list outside the backups (DELETIONS_LOG, default /opt/consyrion/deletions/deletions.log; lines
# "<ISO time> <workspace|project|session> <id> <organization id>") and runs post-restore-scrub.sql in one transaction.
# Exit 0 = clean; anything else = the scrub did not run, do NOT start the app. --dry-run prints the counts and rolls back.
# PRINT_SQL=1 prints the psql input instead of running it (tests).
set -euo pipefail
DRY=0
if [ "${1:-}" = "--dry-run" ]; then DRY=1; shift; fi
TARGET="${1:?usage: post-restore-scrub.sh [--dry-run] <postgres-container|postgres://url>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="${DELETIONS_LOG:-/opt/consyrion/deletions/deletions.log}"
SQL="$HERE/post-restore-scrub.sql"
[ -f "$SQL" ] || { echo "post-restore-scrub: $SQL missing" >&2; exit 2; }
if [ ! -f "$LOG" ]; then
  # No list means either nothing was ever deleted or it was lost – the operator decides, the script does not guess.
  if [ "${ALLOW_MISSING_LIST:-0}" = "1" ]; then LOG=/dev/null; else
    echo "post-restore-scrub: deletion list $LOG not found (fetch the offsite copy, or set ALLOW_MISSING_LIST=1 if nothing was ever deleted)" >&2
    exit 3
  fi
fi

# Only well-formed lines are used; ids are app-generated (letters, digits, _ and -), so nothing else reaches SQL.
rows="$(grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z (workspace|project|session) [A-Za-z0-9_-]{1,128} [A-Za-z0-9_-]{1,128}$' "$LOG" || true)"
bad="$(grep -cvE '^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z (workspace|project|session) [A-Za-z0-9_-]{1,128} [A-Za-z0-9_-]{1,128})?$' "$LOG" || true)"
[ "${bad:-0}" = "0" ] || echo "post-restore-scrub: ignored $bad malformed line(s) in $LOG" >&2

input() {
  echo "BEGIN;"
  echo "CREATE TEMP TABLE scrub_list (deleted_at timestamptz NOT NULL, kind text NOT NULL, entity_id text NOT NULL, organization_id text NOT NULL) ON COMMIT DROP;"
  echo "COPY scrub_list (deleted_at, kind, entity_id, organization_id) FROM STDIN WITH (FORMAT text, DELIMITER ' ');"
  [ -n "$rows" ] && printf '%s\n' "$rows"
  echo '\.'
  cat "$SQL"
  if [ "$DRY" = "1" ]; then echo "ROLLBACK;"; else echo "COMMIT;"; fi
}

if [ "${PRINT_SQL:-0}" = "1" ]; then input; exit 0; fi
case "$TARGET" in
  postgres://* | postgresql://*) input | psql "$TARGET" -v ON_ERROR_STOP=1 -q -tA ;;
  *) input | docker exec -i "$TARGET" psql -U "${PGUSER:-consyrion}" -d "${PGDATABASE:-consyrion}" -v ON_ERROR_STOP=1 -q -tA ;;
esac
[ "$DRY" = "1" ] && echo "post-restore-scrub: dry run – nothing changed"
exit 0
