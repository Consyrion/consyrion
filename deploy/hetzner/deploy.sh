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
# Disk hygiene before building (06.11.26: 82 old images filled the 38 GB disk – the migration then failed with
# ENOSPC). Unused images older than two days and the build cache go; running containers and recent images stay
# (rollback.sh needs the previous release).
docker image prune -a -f --filter "until=48h" >/dev/null || true
docker builder prune -f --filter "until=48h" >/dev/null || true
free_kb="$(df --output=avail -k / | tail -1 | tr -d ' ')"
if [ "${free_kb:-0}" -lt 4000000 ]; then
  df -h / >&2
  echo "less than 4 GB free on / – not building; free space first (docker system df)" >&2
  exit 1
fi
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
# Deletion list (ADR 0206): web (user app) and worker (user node) both append; ids and times only, kept forever.
install -d -m 1777 /opt/consyrion/deletions
touch /opt/consyrion/deletions/deletions.log && chmod 666 /opt/consyrion/deletions/deletions.log
COMPOSE=(docker compose --env-file /opt/consyrion/secrets/deploy.env -f deploy/hetzner/compose.yml)
# The Docker socket only when the sandbox is on (#398).
if grep -qE '^SANDBOX_DISABLED=(false|0|no)$' /opt/consyrion/secrets/deploy.env && [ -f deploy/hetzner/compose.sandbox.yml ]; then
  COMPOSE+=(-f deploy/hetzner/compose.sandbox.yml)
  # Egress network and firewall for dependency installs (#399), also after every reboot via systemd.
  if [ -x deploy/hetzner/sandbox-network.sh ]; then
    deploy/hetzner/sandbox-network.sh
    install -m 0644 deploy/hetzner/consyrion-sandbox-net.service /etc/systemd/system/consyrion-sandbox-net.service
    systemctl daemon-reload && systemctl enable --quiet consyrion-sandbox-net.service
  fi
fi
# Migrate first with the NEW image while the old web/worker keep serving (06.11.26: a failed migration inside
# `up -d` left the site at 502 for minutes). Up to three attempts; on failure the old release stays live untouched.
migrated=0
# Very first deploy: no database yet – `up -d` starts Postgres and runs the migration as before.
docker compose -p consyrion ps --status running postgres | grep -q postgres || migrated=1
for attempt in 1 2 3; do
  [ "$migrated" = 1 ] && break
  # -T and </dev/null: this script itself arrives on stdin over SSH – `compose run` would read (and swallow) the rest.
  if APP_VERSION="$VERSION" "${COMPOSE[@]}" run --rm --no-deps -T migrate </dev/null; then migrated=1; break; fi
  echo "migration attempt $attempt failed" >&2
  sleep 5
done
if [ "$migrated" != 1 ]; then
  cd /opt/consyrion
  rm -rf /opt/consyrion/app.failed && mv /opt/consyrion/app /opt/consyrion/app.failed
  [ -d /opt/consyrion/app.prev ] && mv /opt/consyrion/app.prev /opt/consyrion/app
  echo "migration failed – the previous release is still running; files of $VERSION in /opt/consyrion/app.failed" >&2
  docker image rm "consyrion-web:$VERSION" "consyrion-worker:$VERSION" >/dev/null 2>&1 || true
  exit 1
fi
APP_VERSION="$VERSION" "${COMPOSE[@]}" up -d --remove-orphans
# The Caddyfile is a bind mount from the release directory. The directory is replaced on every deploy, but compose sees
# no config change and keeps Caddy on the old file (08.11.26, #401 needed a manual --force-recreate). Recreate Caddy
# whenever the Caddyfile differs from the previous release.
if [ ! -f /opt/consyrion/app.prev/deploy/hetzner/Caddyfile ] || ! cmp -s deploy/hetzner/Caddyfile /opt/consyrion/app.prev/deploy/hetzner/Caddyfile; then
  echo "== Caddyfile changed – recreating caddy"
  APP_VERSION="$VERSION" "${COMPOSE[@]}" up -d --no-deps --force-recreate caddy
fi
wait_healthy
echo "$(date -u +%FT%TZ) $VERSION" >>/opt/consyrion/RELEASES
# Keep only the running release and the one before it (rollback.sh) – the 48 h filter above does not help on days with
# many deploys (07.11.26: 62 release images, disk at 90 %, the next deploy refused to build).
previous="$(tail -2 /opt/consyrion/RELEASES | head -1 | cut -d' ' -f2)"
for image in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^consyrion-(web|worker|migrate):' || true); do
  tag="${image#*:}"
  [ "$tag" = "$VERSION" ] || [ "$tag" = "$previous" ] || docker rmi "$image" >/dev/null 2>&1 || true
done
docker image prune -f >/dev/null
docker builder prune -f >/dev/null || true
df -h / | tail -1
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

