#!/usr/bin/env bash
# Finishes a GitHub App created from a manifest (docs/github-app.md): exchanges the one-time code from the
# redirect URL, writes the GITHUB_APP_* values into /opt/consyrion/secrets/app.env on the server and recreates
# web and worker. Secrets go straight from GitHub to the server and are never printed.
# Usage: deploy/hetzner/github-app-finish.sh <code> [host]
set -euo pipefail
CODE="${1:?usage: github-app-finish.sh <code> [host]}"
HOST="${2:?server ip required}"
KEY="${SSH_KEY:-$HOME/.ssh/hetzner_consyrion}"
umask 077
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl -fsS -X POST -H "Accept: application/vnd.github+json" "https://api.github.com/app-manifests/$CODE/conversions" >"$TMP" ||
  { echo "GitHub refused the code (expired after one hour, or already used)." >&2; exit 1; }

jq -r '"GITHUB_APP_ID=\(.id)",
  "GITHUB_APP_SLUG=\(.slug)",
  "GITHUB_APP_CLIENT_ID=\(.client_id)",
  "GITHUB_APP_CLIENT_SECRET=\(.client_secret)",
  "GITHUB_APP_WEBHOOK_SECRET=\(.webhook_secret)",
  "GITHUB_APP_PRIVATE_KEY=\(.pem | gsub("\n"; "\\n"))"' "$TMP" |
  ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$HOST" bash -c "'
    set -euo pipefail
    f=/opt/consyrion/secrets/app.env
    cp \$f \$f.bak-\$(date +%s)
    grep -v ^GITHUB_APP_ \$f >\$f.new || true
    cat >>\$f.new
    chmod 600 \$f.new && mv \$f.new \$f
    cd /opt/consyrion/app
    APP_VERSION=\$(tail -1 /opt/consyrion/RELEASES | cut -d\" \" -f2) docker compose --env-file /opt/consyrion/secrets/deploy.env -f deploy/hetzner/compose.yml up -d --no-deps --force-recreate web worker
  '"

echo "== GitHub App configured on $HOST:"
jq '{id, slug, client_id, owner: .owner.login, html_url}' "$TMP"
