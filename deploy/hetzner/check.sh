#!/usr/bin/env bash
# Health check (cron, every 5 minutes): app health, worker running, queue not stuck.
# Logs every problem; posts once per state change to ALERT_WEBHOOK_URL (deploy.env) if set, e.g. a Telegram
# bot URL https://api.telegram.org/bot<token>/sendMessage?chat_id=<id> (the message goes in the "text" field).
set -uo pipefail
# shellcheck disable=SC1091
. /opt/consyrion/secrets/deploy.env
problems=()
curl -fsS --max-time 10 "https://${APP_DOMAIN}/api/health" >/dev/null || problems+=("app health check failed")
[ "$(docker inspect -f '{{.State.Status}}' consyrion-worker-1 2>/dev/null)" = running ] || problems+=("worker is not running")
QUEUE="select count(*) filter (where status = 'queued' and run_at < now() - interval '10 minutes') || ' ' || count(*) filter (where status = 'running' and locked_until < now() - interval '5 minutes') from job"
read -r waiting stale <<<"$(docker exec consyrion-postgres-1 psql -U consyrion -d consyrion -tAc "$QUEUE" 2>/dev/null || echo "? ?")"
[ "$waiting" = "?" ] && problems+=("database not reachable")
[ "${waiting:-0}" != "?" ] && [ "${waiting:-0}" -gt 0 ] && problems+=("$waiting job(s) waiting longer than 10 minutes – queue stuck?")
[ "${stale:-0}" != "?" ] && [ "${stale:-0}" -gt 0 ] && problems+=("$stale running job(s) without lock heartbeat – worker crashed?")

STATE=/opt/consyrion/check.state
now="ok"
[ ${#problems[@]} -gt 0 ] && now="$(printf '%s; ' "${problems[@]}")"
before="$(cat "$STATE" 2>/dev/null || echo ok)"
[ "$now" != "ok" ] && echo "$(date -u +%FT%TZ) PROBLEM: $now"
if [ "$now" != "$before" ]; then
  echo "$now" >"$STATE"
  message="CONSYRION ${APP_DOMAIN}: ${now/#ok/recovered – all checks ok}"
  [ -n "${ALERT_WEBHOOK_URL:-}" ] && curl -fsS --max-time 10 --data-urlencode "text=$message" "$ALERT_WEBHOOK_URL" >/dev/null
  logger -t consyrion-check "$message"
fi
