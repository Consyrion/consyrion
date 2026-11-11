#!/usr/bin/env bash
# Sends an operations alert (#525): ./alert.sh "<subject>" "<text>"   (on the server, as root)
# E-mail through the app's own SMTP (SMTP_URL and MAIL_FROM in app.env) to ALERT_EMAIL (deploy.env, comma-separated),
# plus ALERT_WEBHOOK_URL if set (e.g. a Telegram bot URL; the message goes in the "text" field). No extra service.
# Never prints the SMTP credentials. Exit 0 when at least one channel delivered or none is configured.
set -uo pipefail
SUBJECT="${1:?usage: alert.sh <subject> <text>}"
TEXT="${2:-}"
# shellcheck disable=SC1091
[ -f /opt/consyrion/secrets/deploy.env ] && . /opt/consyrion/secrets/deploy.env
APP_ENV=/opt/consyrion/secrets/app.env
value() { grep -m1 "^$1=" "$APP_ENV" 2>/dev/null | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
sent=0 tried=0

if [ -n "${ALERT_EMAIL:-}" ]; then
  tried=1
  SMTP_URL="$(value SMTP_URL)"
  FROM="$(value MAIL_FROM)"
  # MAIL_FROM may be "Name <addr>"; the envelope needs the bare address.
  FROM_ADDR="$(printf '%s' "$FROM" | sed -E 's/.*<([^>]+)>.*/\1/')"
  if [ -z "$SMTP_URL" ] || [ -z "$FROM_ADDR" ]; then
    logger -t consyrion-alert "alert e-mail not sent: SMTP_URL or MAIL_FROM missing in app.env"
  else
    rcpt=()
    IFS=',' read -ra list <<<"$ALERT_EMAIL"
    for r in "${list[@]}"; do r="$(echo "$r" | tr -d ' ')"; [ -n "$r" ] && rcpt+=(--mail-rcpt "$r"); done
    msg="$(mktemp)"
    {
      printf 'From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n' \
        "${FROM:-$FROM_ADDR}" "$ALERT_EMAIL" "$SUBJECT" "$(date -R)"
      printf '%s\r\n\r\n-- \r\nCONSYRIUM server check (%s)\r\n' "$TEXT" "$(hostname)"
    } >"$msg"
    # smtp:// upgrades with STARTTLS (--ssl-reqd), smtps:// is TLS from the start; credentials come from the URL.
    if curl -sS --max-time 30 --ssl-reqd --url "$SMTP_URL" --mail-from "$FROM_ADDR" "${rcpt[@]}" -T "$msg" >/dev/null 2>"$msg.err"; then
      sent=1
    else
      # curl's error text can contain the URL – log only the first word of the error class.
      logger -t consyrion-alert "alert e-mail failed: $(head -c 120 "$msg.err" | sed -E 's#[a-z]+://[^ ]*#<smtp>#g')"
    fi
    rm -f "$msg" "$msg.err"
  fi
fi

if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
  tried=1
  curl -fsS --max-time 10 --data-urlencode "text=$SUBJECT – $TEXT" "$ALERT_WEBHOOK_URL" >/dev/null && sent=1
fi

logger -t consyrion-alert "$SUBJECT – $TEXT"
[ "$tried" = 0 ] || [ "$sent" = 1 ]
