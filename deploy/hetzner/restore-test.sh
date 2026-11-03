#!/usr/bin/env bash
# Proves that the newest backup restores: ./restore-test.sh [dump-file]  (on the server, as root)
# Restores into a throw-away Postgres container without network and compares row counts with the live database.
# Touches nothing in the running stack. The result is appended to /opt/consyrion/restore-tests.log.
set -euo pipefail
DUMP="${1:-$(ls -1t /opt/consyrion/backups/consyrion-*.dump | head -n 1)}"
NAME="consyrion-restore-test-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=restore -e POSTGRES_USER=consyrion -e POSTGRES_DB=consyrion postgres:17-alpine >/dev/null
# The image first runs a temporary init server on the socket only; TCP answers once the real server is up.
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -h 127.0.0.1 -U consyrion -d consyrion >/dev/null 2>&1 && break; sleep 1; done
docker exec -i "$NAME" pg_restore -U consyrion -d consyrion --no-owner --exit-on-error <"$DUMP"
QUERY="select (select count(*) from \"user\") || ' users, ' || (select count(*) from council_session) || ' sessions, ' || (select count(*) from ai_provider_credential) || ' keys, ' || (select count(*) from drizzle.__drizzle_migrations) || ' migrations'"
RESTORED="$(docker exec "$NAME" psql -U consyrion -d consyrion -tAc "$QUERY")"
LIVE="$(docker exec consyrion-postgres-1 psql -U consyrion -d consyrion -tAc "$QUERY")"
echo "$(date -u +%FT%TZ) restore-test $(basename "$DUMP"): restored [$RESTORED] live [$LIVE]" | tee -a /opt/consyrion/restore-tests.log
