#!/usr/bin/env bash
# Deploys the committed HEAD to the server: ./deploy/hetzner/deploy.sh <server-ip>
# Builds the images on the server, takes a pre-deploy database backup, runs migrations, switches the stack and
# waits for health. The previous version stays available for rollback.sh. See docs/hetzner.md.
set -euo pipefail

HOST="${1:?usage: deploy.sh <server-ip>}"
KEY="${SSH_KEY:-$HOME/.ssh/hetzner_consyrion}"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$HOST")
cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Uncommitted changes – commit first; only committed code is deployed." >&2
  exit 1
fi

[ -d node_modules ] || pnpm install --frozen-lockfile
pnpm --filter @consyrion/engine typecheck
pnpm --filter @consyrion/engine test

VERSION="$(git rev-parse --short HEAD)"
echo "== deploying $VERSION to $HOST"

git archive --format=tar HEAD | "${SSH[@]}" "rm -rf /opt/consyrion/build && mkdir -p /opt/consyrion/build && tar -x -C /opt/consyrion/build"

"${SSH[@]}" VERSION="$VERSION" bash -s <<'REMOTE'
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
cd /opt/consyrion/build
docker build -q -f Dockerfile.web -t "consyrion-web:$VERSION" .
docker build -q -f Dockerfile.worker -t "consyrion-worker:$VERSION" .

# Pre-deploy backup while the old version still runs (skipped on the very first deploy).
if [ -x /opt/consyrion/app/deploy/hetzner/backup.sh ] && docker compose -p consyrion ps --status running postgres | grep -q postgres; then
  /opt/consyrion/app/deploy/hetzner/backup.sh "pre-$VERSION"
fi

rm -rf /opt/consyrion/app.prev
# setup-server.sh creates an empty app directory; mv into an existing directory would nest the release.
if [ -d /opt/consyrion/app/deploy ]; then mv /opt/consyrion/app /opt/consyrion/app.prev; else rm -rf /opt/consyrion/app; fi
mv /opt/consyrion/build /opt/consyrion/app
cd /opt/consyrion/app
APP_VERSION="$VERSION" docker compose --env-file /opt/consyrion/secrets/deploy.env -f deploy/hetzner/compose.yml up -d --remove-orphans
wait_healthy
echo "$(date -u +%FT%TZ) $VERSION" >>/opt/consyrion/RELEASES
docker image prune -f >/dev/null
echo "== running: $VERSION"
REMOTE

DOMAIN="$("${SSH[@]}" "grep ^APP_DOMAIN= /opt/consyrion/secrets/deploy.env | cut -d= -f2")"
# The first deploy has to wait for Caddy to obtain the certificate.
HEALTH="$(curl -fsS --retry 12 --retry-delay 5 --retry-all-errors "https://$DOMAIN/api/health")"
echo "$HEALTH"
if ! grep -q '"engine":"production"' <<<"$HEALTH"; then
  echo "The release runs without the production engine – councils are refused. Roll back: deploy/hetzner/rollback.sh $HOST" >&2
  exit 1
fi

