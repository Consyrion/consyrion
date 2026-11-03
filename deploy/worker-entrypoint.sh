#!/bin/sh
# Entry point of the worker image: `start` runs the council worker, `migrate` applies database migrations.
set -eu
case "${1:-start}" in
  start) cd /app/apps/worker && exec ./node_modules/.bin/tsx src/main.ts ;;
  migrate) cd /app/packages/db && exec ./node_modules/.bin/tsx src/migrate-cli.ts ;;
  *) echo "usage: consyrion-worker start|migrate" >&2; exit 64 ;;
esac
