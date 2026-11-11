#!/usr/bin/env bash
# Health check (cron, every 5 minutes): app health, worker running, queue not stuck, backups fresh (#525).
# Logs every problem; alerts once per state change through alert.sh (e-mail to ALERT_EMAIL via the app's SMTP,
# and ALERT_WEBHOOK_URL if set).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
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

# Backups (#525): newest dump at most 26 hours old, not much smaller than the one before, off-site upload ok.
BACKUPS=/opt/consyrion/backups
mapfile -t dumps < <(ls -1t "$BACKUPS"/consyrion-*.dump 2>/dev/null | head -n 2)
if [ ${#dumps[@]} -eq 0 ]; then
  problems+=("no database backup found")
else
  age_h=$((($(date +%s) - $(stat -c %Y "${dumps[0]}")) / 3600))
  [ "$age_h" -ge 26 ] && problems+=("newest backup is ${age_h} h old – daily backup not running?")
  if [ ${#dumps[@]} -eq 2 ]; then
    new=$(stat -c %s "${dumps[0]}") old=$(stat -c %s "${dumps[1]}")
    [ "$old" -gt 0 ] && [ $((new * 100 / old)) -lt 50 ] && problems+=("newest backup is less than half the size of the previous one ($new vs $old bytes)")
  fi
fi
remote_state="$(sed -n 's/.* remote=\([^ ]*\)$/\1/p' /opt/consyrion/backup.state 2>/dev/null)"
case "$remote_state" in failed*) problems+=("off-site backup ${remote_state//_/ }") ;; esac

STATE=/opt/consyrion/check.state
now="ok"
[ ${#problems[@]} -gt 0 ] && now="$(printf '%s; ' "${problems[@]}")"
before="$(cat "$STATE" 2>/dev/null || echo ok)"
[ "$now" != "ok" ] && echo "$(date -u +%FT%TZ) PROBLEM: $now"
if [ "$now" != "$before" ]; then
  echo "$now" >"$STATE"
  if [ "$now" = ok ]; then
    "$HERE/alert.sh" "CONSYRIUM ${APP_DOMAIN}: recovered" "All checks ok again." || true
  else
    "$HERE/alert.sh" "CONSYRIUM ${APP_DOMAIN}: PROBLEM" "$now" || true
  fi
fi
