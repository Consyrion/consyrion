#!/usr/bin/env bash
# Database backup on the server (cron 03:15, and before every deploy): /opt/consyrion/app/deploy/hetzner/backup.sh [label]
# Custom-format pg_dump, 30 days kept locally (unencrypted, 0600, for a fast rollback on this server).
# Off-site (#526): with BACKUP_REMOTE and BACKUP_AGE_RECIPIENT in deploy.env every dump is encrypted with age (public
# key only – the private key is kept offline by the owner, never on this server) and uploaded WITHOUT --delete, so a
# deletion on this server never reaches the off-site copy. The Storage Box has its own 30-day prune of
# consyrion-*.dump.age (privacy policy, /datenschutz); deletions.log (ADR 0206) is never pruned.
# The dump contains provider keys only as ciphertext; the master key (app.env) is NOT in the backup – keep it in
# a password manager, a restore needs it (docs/hetzner.md).
# The result is written to /opt/consyrion/backup.state, which check.sh watches (#525).
set -euo pipefail
LABEL="${1:-daily}"
ROOT="${CONSYRION_ROOT:-/opt/consyrion}"  # overridable for backup-offsite.test.sh
DIR="$ROOT/backups"
STATE="$ROOT/backup.state"
HERE="$(cd "$(dirname "$0")" && pwd)"
KEEP_DAYS=30
FILE="$DIR/consyrion-$(date -u +%Y%m%dT%H%M%SZ)-$LABEL.dump"
umask 077
docker exec consyrion-postgres-1 pg_dump -U consyrion -d consyrion -Fc >"$FILE.part"
mv "$FILE.part" "$FILE"
find "$DIR" -name 'consyrion-*.dump' -mtime +$KEEP_DAYS -delete
# shellcheck disable=SC1091
. "$ROOT/secrets/deploy.env"

# Remote spec "user@host:dir" (dir may be empty or "." for the sub-account's home).
remote="off"
if [ -n "${BACKUP_REMOTE:-}" ]; then
  remote="ok"
  HOST="${BACKUP_REMOTE%%:*}"
  RDIR="${BACKUP_REMOTE#*:}"; [ "$RDIR" = "$BACKUP_REMOTE" ] && RDIR=""; RDIR="${RDIR:-.}"
  SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=20)
  sftp_batch() { sftp -q -P 23 "${SSH_OPTS[@]}" -b - "$HOST" 2>&1; }
  fail() { remote="failed: $1"; }

  if [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; then
    fail "BACKUP_AGE_RECIPIENT missing – no unencrypted off-site upload"
  elif ! command -v age >/dev/null; then
    fail "age not installed (apt-get install age)"
  elif ! listing="$(printf 'ls -1 %s\n' "$RDIR" | sftp_batch)"; then
    fail "storage box not reachable"
  else
    present="$(printf '%s\n' "$listing" | sed -n 's#.*/\{0,1\}\(consyrion-[0-9TZ]*-[^ /]*\.dump\.age\)$#\1#p')"
    # Upload every local dump the box does not have yet (catches up after a failed night).
    for f in "$DIR"/consyrion-*.dump; do
      name="$(basename "$f").age"
      printf '%s\n' "$present" | grep -qxF "$name" && continue
      tmp="$DIR/.offsite-$name"
      if age -r "$BACKUP_AGE_RECIPIENT" -o "$tmp" "$f" \
        && rsync -a --ignore-existing -e "ssh -p 23 ${SSH_OPTS[*]}" "$tmp" "$HOST:$RDIR/$name"; then
        :
      else
        fail "upload of $name failed"
      fi
      rm -f "$tmp"
    done
    # Own retention on the box, by the time stamp in the file name – independent of what happens here.
    cutoff="$(date -u -d "-$KEEP_DAYS days" +%Y%m%d)"
    prune=""
    for name in $present; do
      day="$(printf '%s' "$name" | sed -n 's/^consyrion-\([0-9]\{8\}\)T.*/\1/p')"
      [ -n "$day" ] && [ "$day" -lt "$cutoff" ] && prune+="rm $RDIR/$name"$'\n'
    done
    if [ -n "$prune" ] && ! printf '%s' "$prune" | sftp_batch >/dev/null; then fail "prune on the storage box failed"; fi
  fi
  # Deletion list (ADR 0206): mirrored without --delete, never pruned.
  [ -x "$HERE/deletions-sync.sh" ] && { BACKUP_REMOTE="$BACKUP_REMOTE" "$HERE/deletions-sync.sh" || fail "deletions.log sync failed"; }
fi

SIZE="$(stat -c %s "$FILE")"
printf '%s %s %s remote=%s\n' "$(date -u +%FT%TZ)" "$(basename "$FILE")" "$SIZE" "${remote// /_}" >"$STATE"
echo "$(date -u +%FT%TZ) backup ok $(basename "$FILE") $(du -h "$FILE" | cut -f1) remote: $remote"
if [ "${remote%%:*}" = "failed" ]; then
  "$HERE/alert.sh" "CONSYRIUM: off-site backup failed" "$(basename "$FILE") is saved locally, but $remote" || true
fi
