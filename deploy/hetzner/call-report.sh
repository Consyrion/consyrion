#!/usr/bin/env bash
# Read-only baseline for #243: how many model calls ended cut off (max_tokens/runaway) or with an invalid answer,
# per day and per provider/model/phase. Only counts and token sizes are read – no prompts, answers or workspace data.
# Usage: deploy/hetzner/call-report.sh [host] [days]
set -euo pipefail
HOST="${1:?usage: $0 <server-ip>}"
DAYS="${2:-14}"
[[ "$DAYS" =~ ^[0-9]+$ ]] || { echo "days must be a number" >&2; exit 1; }
KEY="${SSH_KEY:-$HOME/.ssh/hetzner_consyrion}"

ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "root@$HOST" \
  "docker exec -i consyrion-postgres-1 psql -U consyrion -d consyrion -P pager=off -v ON_ERROR_STOP=1" <<SQL
\echo '== Calls per day (cut = max_tokens or runaway, invalid = schema or mismatch)'
select date(created_at) as day, count(*) as calls,
  count(*) filter (where error_kind in ('max_tokens', 'runaway')) as cut,
  count(*) filter (where error_kind in ('schema', 'mismatch')) as invalid,
  round(100.0 * count(*) filter (where error_kind in ('max_tokens', 'runaway', 'schema', 'mismatch')) / count(*), 1) as pct
from usage_record where created_at > now() - interval '$DAYS days' and session_id is not null
group by 1 order by 1 desc;

\echo '== Cut off or invalid calls by provider, model and phase'
select provider, model_id, phase, error_kind, count(*) as calls,
  max(input_tokens) as max_input, min(output_tokens) as min_output, max(output_tokens) as max_output
from usage_record
where created_at > now() - interval '$DAYS days' and error_kind in ('max_tokens', 'runaway', 'schema', 'mismatch')
group by 1, 2, 3, 4 order by calls desc;

\echo '== Largest inputs per provider and model (context headroom)'
select provider, model_id, count(*) as calls, max(input_tokens) as max_input,
  percentile_disc(0.9) within group (order by input_tokens) as p90_input
from usage_record where created_at > now() - interval '$DAYS days' and session_id is not null
group by 1, 2 order by max_input desc;
SQL
