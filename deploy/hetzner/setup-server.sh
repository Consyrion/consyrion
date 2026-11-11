#!/usr/bin/env bash
# One-time setup of a fresh Hetzner Cloud server (Ubuntu 24.04, x86) for CONSYRIUM. Run as root ON THE SERVER:
#   APP_DOMAIN=app.consyrium.com ACME_EMAIL=you@example.com bash setup-server.sh
# Idempotent: existing secrets are never overwritten. See docs/hetzner.md.
set -euo pipefail

: "${APP_DOMAIN:?set APP_DOMAIN, e.g. app.consyrium.com}"
: "${ACME_EMAIL:?set ACME_EMAIL for Lets Encrypt notices}"
export DEBIAN_FRONTEND=noninteractive

echo "== packages and automatic security updates"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg ufw unattended-upgrades postgresql-client age
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== swap (4 GB): the image build on a 4 GB server (CX23) needs it briefly"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  sysctl -qw vm.swappiness=10
  echo 'vm.swappiness=10' >/etc/sysctl.d/90-consyrion-swap.conf
fi

echo "== Docker Engine (official apt repository)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

echo "== gVisor (runsc) for the code sandbox"
if ! command -v runsc >/dev/null; then
  curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" >/etc/apt/sources.list.d/gvisor.list
  apt-get update -q
  apt-get install -yq runsc
  runsc install
  systemctl restart docker
fi
docker info --format '{{json .Runtimes}}' | grep -q runsc || { echo "runsc is not registered with Docker" >&2; exit 1; }

echo "== sandbox images (pre-pulled)"
# Same digests as SANDBOX_IMAGES in packages/build/src/sandbox.ts (#399) – update both together.
docker pull -q node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
docker pull -q python:3.12-alpine@sha256:e064671ca452259bab50e8e2c7bd896e39e9a343bb06ca25234adf6fe18d0fc7

echo "== firewall: only SSH, HTTP, HTTPS"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "== SSH: keys only"
# A drop-in sorted first wins over cloud-init's 50-cloud-init.conf (sshd uses the first value it reads).
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' > /etc/ssh/sshd_config.d/00-consyrion.conf
sshd -t
# Ubuntu 24.04+ starts sshd per connection via ssh.socket (new config applies to the next login);
# only a running daemon needs a reload.
if systemctl is-active --quiet ssh; then systemctl reload ssh; elif systemctl is-active --quiet sshd; then systemctl reload sshd; fi

echo "== directories"
install -d -m 0755 /opt/consyrion /opt/consyrion/app
install -d -m 0700 /opt/consyrion/secrets /opt/consyrion/backups
# Workspaces of the Execution Council: written by the worker (uid 1000), mounted into sandbox containers.
install -d -m 0700 -o 1000 -g 1000 /srv/consyrion/workspaces

echo "== secrets (generated once, never printed)"
SECRETS=/opt/consyrion/secrets
umask 077
if [ ! -f "$SECRETS/postgres_password" ]; then
  openssl rand -hex 24 >"$SECRETS/postgres_password"
fi
if [ ! -f "$SECRETS/app.env" ]; then
  cat >"$SECRETS/app.env" <<ENV
NODE_ENV=production
DATABASE_URL=postgres://consyrion:$(cat "$SECRETS/postgres_password")@postgres:5432/consyrion
BETTER_AUTH_URL=https://${APP_DOMAIN}
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
CREDENTIALS_MASTER_KEY_V1=$(openssl rand -base64 32)
CREDENTIALS_ACTIVE_KEY_VERSION=1
PLATFORM_ADMIN_EMAILS=
LOG_LEVEL=info
ENV
  echo "   created $SECRETS/app.env – copy CREDENTIALS_MASTER_KEY_V1 and BETTER_AUTH_SECRET into your password manager now."
fi
cat >"$SECRETS/deploy.env" <<ENV
APP_DOMAIN=${APP_DOMAIN}
ACME_EMAIL=${ACME_EMAIL}
DOCKER_GID=$(getent group docker | cut -d: -f3)
SANDBOX_DOCKER_RUNTIME=runsc
ENV
# The Postgres container reads the password as its own user.
chmod 0644 "$SECRETS/postgres_password"

echo "== scheduled jobs (backup 03:15, checks every 5 minutes, restore test monthly) – deploy.sh installs deploy/hetzner/consyrion.cron"

echo "Done. Next: point DNS ${APP_DOMAIN} (A/AAAA) to this server, then run deploy.sh from your machine."
