#!/usr/bin/env bash
# Tests post-restore-scrub.sh without a database (PRINT_SQL=1): which lines reach psql, missing list, usage.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

cat >"$T/list" <<'LIST'
2026-11-08T20:00:00.000Z workspace org_abc org_abc
2026-11-08T20:01:00.000Z project prj_1 org_b
2026-11-08T20:02:00.000Z session ses_1 org_b
2026-11-08T20:03:00.000Z project prj_x'; drop table "user";-- org_b
garbage line
2026-11-08T20:04:00.000Z secret prj_2 org_b
LIST
out="$(DELETIONS_LOG="$T/list" PRINT_SQL=1 "$HERE/post-restore-scrub.sh" consyrion-postgres-1 2>"$T/err")"
echo "$out" | grep -qx "2026-11-08T20:00:00.000Z workspace org_abc org_abc" || fail "valid workspace line missing"
echo "$out" | grep -qx "2026-11-08T20:02:00.000Z session ses_1 org_b" || fail "valid session line missing"
echo "$out" | grep -q "drop table" && fail "malformed id reached psql"
echo "$out" | grep -q "secret prj_2" && fail "unknown kind reached psql"
grep -q "ignored 3 malformed" "$T/err" || fail "malformed lines not reported: $(cat "$T/err")"
echo "$out" | head -1 | grep -qx "BEGIN;" || fail "no transaction"
echo "$out" | tail -1 | grep -qx "COMMIT;" || fail "no commit"
DELETIONS_LOG="$T/list" PRINT_SQL=1 "$HERE/post-restore-scrub.sh" --dry-run x 2>/dev/null | tail -1 | grep -qx "ROLLBACK;" || fail "dry run commits"

# A missing list stops the restore unless the operator says nothing was ever deleted.
set +e
DELETIONS_LOG="$T/none" PRINT_SQL=1 "$HERE/post-restore-scrub.sh" x >/dev/null 2>&1
[ $? -eq 3 ] || fail "missing list did not exit 3"
"$HERE/post-restore-scrub.sh" >/dev/null 2>&1
[ $? -ne 0 ] || fail "no target accepted"
set -e
DELETIONS_LOG="$T/none" ALLOW_MISSING_LIST=1 PRINT_SQL=1 "$HERE/post-restore-scrub.sh" x | grep -q "COMMIT;" || fail "ALLOW_MISSING_LIST"
echo "post-restore-scrub tests passed"
