#!/usr/bin/env bash
# Tests the off-site part of backup.sh (#526) with stubs for docker, age, sftp and rsync (no network, no root):
#   bash deploy/hetzner/backup-offsite.test.sh      (also run in CI; needs GNU date/stat, i.e. Linux)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

mkdir -p "$T/bin" "$T/root/backups" "$T/root/secrets" "$T/box"
export BOX="$T/box"
cat >"$T/bin/docker" <<'S'
#!/usr/bin/env bash
echo "PGDMP fake dump"
S
cat >"$T/bin/age" <<'S'
#!/usr/bin/env bash
# age -r <recipient> -o <out> <in>  →  "AGE:" + content
out="" in=""; while [ $# -gt 0 ]; do case "$1" in -r) shift ;; -o) out="$2"; shift ;; *) in="$1" ;; esac; shift; done
{ echo "AGE:"; cat "$in"; } >"$out"
S
cat >"$T/bin/sftp" <<'S'
#!/usr/bin/env bash
# Batch from stdin: "ls -1 <dir>" lists the fake box, "rm <dir>/<name>" deletes there.
[ -n "${SFTP_DOWN:-}" ] && exit 1
while read -r cmd arg; do
  case "$cmd" in
    ls) echo "sftp> ls -1 $arg"; for f in "$BOX"/*; do [ -e "$f" ] && echo "$arg/$(basename "$f")"; done ;;
    rm) rm "$BOX/$(basename "$arg")" ;;
  esac
done
S
cat >"$T/bin/rsync" <<'S'
#!/usr/bin/env bash
# Last two args: source, "host:path" – copies into the fake box; --ignore-existing keeps what is there.
args=("$@"); src="${args[-2]}"; dst="${args[-1]}"; name="$(basename "${dst#*:}")"
[[ " $* " == *" --ignore-existing "* ]] && [ -e "$BOX/$name" ] && exit 0
cp "$src" "$BOX/$name"
S
cat >"$T/bin/logger" <<'S'
#!/usr/bin/env bash
:
S
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH" CONSYRION_ROOT="$T/root" DELETIONS_LOG="$T/deletions.log"
echo "2026-01-01T00:00:00.000Z project prj_x org_x" >"$DELETIONS_LOG"

old_day="$(date -u -d '-45 days' +%Y%m%d)"
recent_day="$(date -u -d '-3 days' +%Y%m%d)"
echo old >"$BOX/consyrion-${old_day}T031500Z-daily.dump.age"
echo recent >"$BOX/consyrion-${recent_day}T031500Z-daily.dump.age"
echo "kept" >"$BOX/deletions.log"
echo "other" >"$BOX/engine-notes.txt"
# A local dump the box does not have yet (catch-up after a failed night).
echo "PGDMP missed" >"$T/root/backups/consyrion-${recent_day}T120000Z-pre-abc.dump"

# 1) Encrypted upload, own prune, deletion list untouched.
printf 'BACKUP_REMOTE=u1-sub1@u1.your-storagebox.de:.\nBACKUP_AGE_RECIPIENT=age1testrecipient\n' >"$T/root/secrets/deploy.env"
bash "$HERE/backup.sh" test >/dev/null
grep -q 'remote=ok$' "$T/root/backup.state" || fail "state not ok: $(cat "$T/root/backup.state")"
[ ! -e "$BOX/consyrion-${old_day}T031500Z-daily.dump.age" ] || fail "box copy older than 30 days not pruned"
[ -e "$BOX/consyrion-${recent_day}T031500Z-daily.dump.age" ] || fail "recent box copy pruned"
[ -e "$BOX/engine-notes.txt" ] || fail "foreign file on the box touched"
grep -q "prj_x" "$BOX/deletions.log" || fail "deletion list not mirrored"
[ -e "$BOX/consyrion-${recent_day}T120000Z-pre-abc.dump.age" ] || fail "missed local dump not uploaded"
new="$(ls -1 "$T/root/backups" | grep -- '-test.dump$')"
head -n1 "$BOX/$new.age" | grep -q '^AGE:' || fail "upload not encrypted"
ls -a "$T/root/backups" | grep -q '^\.offsite-' && fail "temporary encrypted file left behind"

# 2) A dump deleted on the server stays on the box (no --delete).
rm "$T/root/backups/consyrion-${recent_day}T120000Z-pre-abc.dump"
bash "$HERE/backup.sh" test2 >/dev/null
[ -e "$BOX/consyrion-${recent_day}T120000Z-pre-abc.dump.age" ] || fail "local deletion reached the box"

# 3) No recipient: nothing unencrypted leaves the server, state says failed.
before="$(ls -1 "$BOX" | wc -l)"
printf 'BACKUP_REMOTE=u1-sub1@u1.your-storagebox.de:.\n' >"$T/root/secrets/deploy.env"
bash "$HERE/backup.sh" test3 >/dev/null
grep -q 'remote=failed:_BACKUP_AGE_RECIPIENT' "$T/root/backup.state" || fail "missing recipient not reported: $(cat "$T/root/backup.state")"
[ "$(ls -1 "$BOX" | wc -l)" = "$before" ] || fail "uploaded without a recipient"

# 4) Box unreachable: the local backup still succeeds, state says failed.
printf 'BACKUP_REMOTE=u1-sub1@u1.your-storagebox.de:.\nBACKUP_AGE_RECIPIENT=age1testrecipient\n' >"$T/root/secrets/deploy.env"
SFTP_DOWN=1 bash "$HERE/backup.sh" test4 >/dev/null
grep -q 'remote=failed:_storage_box_not_reachable' "$T/root/backup.state" || fail "unreachable box not reported"
ls "$T/root/backups" | grep -q -- '-test4.dump$' || fail "local backup missing when the box is down"

# 5) No BACKUP_REMOTE: local only, state off.
: >"$T/root/secrets/deploy.env"
bash "$HERE/backup.sh" test5 >/dev/null
grep -q 'remote=off$' "$T/root/backup.state" || fail "state not off"
echo "backup-offsite.test.sh: all checks passed"
