#!/usr/bin/env bash
# Tests for rollback-guard.sh (#181, stage 1): bash deploy/hetzner/rollback-guard.test.sh
set -euo pipefail
GUARD="$(cd "$(dirname "$0")" && pwd)/rollback-guard.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
failures=0

release() { # release <name> [release_level] [min_rollback_level]
  mkdir -p "$TMP/$1/deploy/hetzner"
  if [ $# -ge 2 ]; then printf '# comment\nrelease_level=%s\nmin_rollback_level=%s\n' "$2" "${3:-0}" >"$TMP/$1/deploy/hetzner/RELEASE_LEVEL"; fi
}
expect() { # expect <exit-code> <description> <running> <target> [env...]
  local want="$1" what="$2" running="$3" target="$4" got=0
  shift 4
  env "$@" bash "$GUARD" "$TMP/$running" "$TMP/$target" >/dev/null 2>&1 || got=$?
  if [ "$got" = "$want" ]; then echo "ok   - $what"; else echo "FAIL - $what (exit $got, expected $want)"; failures=$((failures + 1)); fi
}

release p             # production e33a3bb: no RELEASE_LEVEL file = level 0
release stage1 1 1    # stage 1 (42fb6d0)
release stage1b 2 1   # this release: sessions remember their gate version, builds re-check on every run
release s1 3 2        # later S1 gate
release broken x 1

expect 1 "stage 1 -> P is refused" stage1 p
expect 0 "stage 1 -> P is allowed only with the explicit override" stage1 p ALLOW_BELOW_MINIMUM=1
expect 0 "stage 1b -> stage 1 is allowed" stage1b stage1
expect 0 "S1 -> stage 1b is allowed" s1 stage1b
expect 1 "S1 -> stage 1 is refused (it would run queued S1 councils with the old gate)" s1 stage1
expect 1 "S1 -> P is refused" s1 p
expect 0 "stage 1 -> stage 1 (same level) is allowed" stage1 stage1
expect 0 "P -> P (no files, nothing to enforce) is allowed" p p
expect 2 "an invalid level is an error, not a silent 0" stage1 broken

[ "$failures" = 0 ] || { echo "$failures rollback guard test(s) failed" >&2; exit 1; }
echo "rollback guard: all tests passed"
