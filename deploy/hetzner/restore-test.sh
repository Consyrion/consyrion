#!/usr/bin/env bash
# Proves that a backup restores: ./restore-test.sh [--alert] [dump-file | dump.age]  (on the server, as root)
# Restores into a throw-away Postgres container without network, runs the post-restore scrub (ADR 0206) and compares
# row counts with the live database. Touches nothing in the running stack. The result is appended to
# /opt/consyrion/restore-tests.log. With --alert (monthly cron, #525) the result is also e-mailed via alert.sh.
# An off-site copy (*.dump.age, #526) needs AGE_KEY_FILE=<private key file>; give the key only for the test and
# delete it afterwards – it never stays on the server.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ALERT=0
[ "${1:-}" = "--alert" ] && { ALERT=1; shift; }
DUMP="${1:-$(ls -1t /opt/consyrion/backups/consyrion-*.dump | head -n 1)}"
NAME="consyrion-restore-test-$$"
PLAIN=""
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; [ -n "$PLAIN" ] && rm -f "$PLAIN"; }
trap cleanup EXIT
report() {
  echo "$(date -u +%FT%TZ) restore-test $(basename "$DUMP"): $1" | tee -a /opt/consyrion/restore-tests.log
  [ "$ALERT" = 1 ] && { "$HERE/alert.sh" "CONSYRIUM restore test: $2" "$1 ($(basename "$DUMP"))" || true; }
}
trap 'report "FAILED (line $LINENO)" "FAILED"' ERR

if [ "${DUMP%.age}" != "$DUMP" ]; then
  : "${AGE_KEY_FILE:?an off-site copy (.age) needs AGE_KEY_FILE=<private key file>}"
  PLAIN="$(mktemp /opt/consyrion/backups/.restore-test-XXXXXX)"
  age -d -i "$AGE_KEY_FILE" -o "$PLAIN" "$DUMP"
  SOURCE="$PLAIN"
else
  SOURCE="$DUMP"
fi

docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=restore -e POSTGRES_USER=consyrion -e POSTGRES_DB=consyrion postgres:17-alpine >/dev/null
# The image first runs a temporary init server on the socket only; TCP answers once the real server is up.
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -h 127.0.0.1 -U consyrion -d consyrion >/dev/null 2>&1 && break; sleep 1; done
docker exec -i "$NAME" pg_restore -U consyrion -d consyrion --no-owner --exit-on-error <"$SOURCE"
# Deletion list (ADR 0206): nothing deleted after the dump may come back, also not in the test.
if [ -x "$HERE/post-restore-scrub.sh" ]; then
  DELETIONS_LOG="${DELETIONS_LOG:-/opt/consyrion/deletions/deletions.log}" "$HERE/post-restore-scrub.sh" "$NAME" >/dev/null
fi
QUERY="select (select count(*) from \"user\") || ' users, ' || (select count(*) from council_session) || ' sessions, ' || (select count(*) from ai_provider_credential) || ' keys, ' || (select count(*) from drizzle.__drizzle_migrations) || ' migrations'"
RESTORED="$(docker exec "$NAME" psql -U consyrion -d consyrion -tAc "$QUERY")"
LIVE="$(docker exec consyrion-postgres-1 psql -U consyrion -d consyrion -tAc "$QUERY")"
trap - ERR
# The live database may have grown since the dump; a restore with fewer than 90 % of the live users or sessions is suspicious.
ru=$(echo "$RESTORED" | awk '{print $1}') rs=$(echo "$RESTORED" | awk '{print $3}')
lu=$(echo "$LIVE" | awk '{print $1}') ls_=$(echo "$LIVE" | awk '{print $3}')
verdict="ok"
{ [ "$lu" -gt 0 ] && [ $((ru * 100 / lu)) -lt 90 ]; } && verdict="DEVIATION"
{ [ "$ls_" -gt 0 ] && [ $((rs * 100 / ls_)) -lt 90 ]; } && verdict="DEVIATION"
report "restored [$RESTORED] live [$LIVE] $verdict" "$verdict"
