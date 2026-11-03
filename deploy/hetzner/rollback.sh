#!/usr/bin/env bash
# Switches back to the previous release: ./deploy/hetzner/rollback.sh <server-ip> [--allow-below-minimum]
# Images of the previous version are kept on the server. Migrations only move forward: if the release being
# rolled back added a migration, restore the pre-deploy backup instead (docs/hetzner.md, "Rollback").
# Rollback guard (#181): the running release's deploy/hetzner/RELEASE_LEVEL names the lowest release level it may be
# rolled back to; an older target is refused unless --allow-below-minimum is given (docs/hetzner.md, "Rollback guard").
set -euo pipefail
HOST="${1:?usage: rollback.sh <server-ip> [--allow-below-minimum]}"
ALLOW_BELOW_MINIMUM=0
case "${2:-}" in
  "") ;;
  --allow-below-minimum)
    ALLOW_BELOW_MINIMUM=1
    echo "WARNING: --allow-below-minimum given – the rollback guard will only warn, not refuse." >&2
    ;;
  *) echo "usage: rollback.sh <server-ip> [--allow-below-minimum]" >&2; exit 1 ;;
esac
KEY="${SSH_KEY:-$HOME/.ssh/hetzner_consyrion}"
ssh -i "$KEY" "root@$HOST" ALLOW_BELOW_MINIMUM="$ALLOW_BELOW_MINIMUM" bash -s <<'REMOTE'
set -euo pipefail
wait_healthy() {
  for _ in $(seq 1 60); do
    web="$(docker inspect -f '{{.State.Health.Status}}' consyrion-web-1 2>/dev/null || true)"
    worker="$(docker inspect -f '{{.State.Status}}' consyrion-worker-1 2>/dev/null || true)"
    migrate="$(docker inspect -f '{{.State.ExitCode}}' consyrion-migrate-1 2>/dev/null || true)"
    [ "$migrate" != "" ] && [ "$migrate" != "0" ] && { docker logs --tail 50 consyrion-migrate-1; echo "migration failed" >&2; return 1; }
    [ "$web" = healthy ] && [ "$worker" = running ] && return 0
    sleep 5
  done
  docker compose -p consyrion ps; echo "not healthy after 5 minutes" >&2; return 1
}
PREVIOUS="$(tail -n 2 /opt/consyrion/RELEASES | head -n 1 | cut -d' ' -f2)"
[ -d /opt/consyrion/app.prev ] || { echo "No previous release directory" >&2; exit 1; }
docker image inspect "consyrion-web:$PREVIOUS" >/dev/null
# The guard ships with the running release; releases before it (no guard file) have nothing to enforce.
if [ -f /opt/consyrion/app/deploy/hetzner/rollback-guard.sh ]; then
  ALLOW_BELOW_MINIMUM="$ALLOW_BELOW_MINIMUM" bash /opt/consyrion/app/deploy/hetzner/rollback-guard.sh /opt/consyrion/app /opt/consyrion/app.prev
fi
rm -rf /opt/consyrion/app.failed && mv /opt/consyrion/app /opt/consyrion/app.failed && mv /opt/consyrion/app.prev /opt/consyrion/app
cd /opt/consyrion/app
APP_VERSION="$PREVIOUS" docker compose --env-file /opt/consyrion/secrets/deploy.env -f deploy/hetzner/compose.yml up -d --remove-orphans
wait_healthy
echo "$(date -u +%FT%TZ) $PREVIOUS (rollback)" >>/opt/consyrion/RELEASES
echo "== rolled back to $PREVIOUS"
REMOTE
