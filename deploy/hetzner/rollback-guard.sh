#!/usr/bin/env bash
# Refuses a rollback to a release below the running release's minimum (#181, stage 1):
#   rollback-guard.sh <running-release-dir> <target-release-dir>
# Each release declares release_level and min_rollback_level in deploy/hetzner/RELEASE_LEVEL; a release without the
# file has level 0. Exit 0 = allowed, 1 = refused. ALLOW_BELOW_MINIMUM=1 overrides the refusal with a warning – only
# for an emergency where the database was restored to a matching pre-deploy backup and new councils/approvals are paused.
set -euo pipefail
RUNNING="${1:?usage: rollback-guard.sh <running-release-dir> <target-release-dir>}"
TARGET="${2:?usage: rollback-guard.sh <running-release-dir> <target-release-dir>}"

# Reads an integer key from a RELEASE_LEVEL file; missing file or key = 0. Anything else than digits is an error.
read_level() {
  local file="$1/deploy/hetzner/RELEASE_LEVEL" key="$2" value
  [ -f "$file" ] || { echo 0; return; }
  value="$(grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2 | tr -d '[:space:]' || true)"
  [ -z "$value" ] && { echo 0; return; }
  [[ "$value" =~ ^[0-9]+$ ]] || { echo "invalid $key in $file: $value" >&2; exit 2; }
  echo "$value"
}

MIN="$(read_level "$RUNNING" min_rollback_level)"
LEVEL="$(read_level "$TARGET" release_level)"
if [ "$LEVEL" -ge "$MIN" ]; then
  echo "rollback guard: target release level $LEVEL >= minimum $MIN – allowed"
  exit 0
fi
if [ "${ALLOW_BELOW_MINIMUM:-}" = "1" ]; then
  echo "WARNING: rollback below the minimum release level ($LEVEL < $MIN), forced with --allow-below-minimum." >&2
  echo "WARNING: the target release cannot read newer decision formats and may approve or build them. Restore the" >&2
  echo "WARNING: matching pre-deploy backup and pause new councils and approvals first (docs/hetzner.md)." >&2
  exit 0
fi
echo "rollback guard: refused – target release level $LEVEL is below the minimum $MIN of the running release." >&2
echo "Fix forward instead, or see docs/hetzner.md \"Rollback guard\" for the forced path (--allow-below-minimum)." >&2
exit 1
