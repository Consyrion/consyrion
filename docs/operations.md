# Operations and incident response (#32)

## Signals

- **Health**: `GET /api/health` (database round trip, version, latency). 503 when the database is unavailable.
  Docker `HEALTHCHECK` uses it; add it to an uptime monitor.
- **Logs**: JSON lines (`level`, `time`, `message`, fields) from `apps/web/src/lib/server/logger.ts`; secret-like
  keys and API-key/token patterns are redacted. Ship stdout to your log service.
- **Business metrics** from the database: sessions by status, failed stages (`workflow_stage.status='failed'`),
  provider errors (`usage_record.outcome <> 'ok'`), queue depth (`job` with `status='queued'`), stuck jobs
  (`status='running' and locked_until < now()` → they are re-claimed automatically).

Useful queries:

```sql
select status, count(*) from job group by status;
select outcome, provider, count(*) from usage_record where created_at > now() - interval '1 hour' group by 1, 2;
select phase, error, count(*) from workflow_stage where status = 'failed' group by 1, 2 order by 3 desc;
```

## Backups and restore

- PostgreSQL: daily full backup + WAL/PITR (managed providers do this). Test a restore monthly.
- The credential master keys are as important as the database: without them stored API keys cannot be
  decrypted. Keep them in a secret manager with access logging; never in backups of the database.

## Runbooks

| Situation                                     | Action                                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider outage (many `unavailable` outcomes) | Sessions retry transient errors; persistent failures mark the participant failed. Tell users to retry later; nothing to fix server-side.                                                                                       |
| Queue not progressing                         | Check worker logs and `docker info` on the worker host; restart the worker – runs resume from checkpoints. The worker logs its capacity at start (`N parallel jobs, M per workspace, K builds`).                               |
| Councils wait long in `queued`                | All slots busy (`WORKER_CONCURRENCY`) or the workspace is at `WORKER_JOBS_PER_WORKSPACE`; the session page shows jobs ahead/running. Raise the concurrency, add a worker replica or rescale (see `docs/hetzner.md`, Capacity). |
| Suspected key leak                            | Rotate the affected provider key in _AI providers_; for the master key add `CREDENTIALS_MASTER_KEY_V2`, set it active, re-encrypt by rotating keys, then remove V1.                                                            |
| GitHub App compromise                         | Regenerate the private key and webhook secret in GitHub, update env, restart web + worker.                                                                                                                                     |
| Abuse / runaway costs                         | Lower plan limits in `/admin`; budgets are enforced per run; cancel sessions/runs from the UI.                                                                                                                                 |
| Data request (export/deletion)                | Owners use _Workspace → Download export / Delete workspace_; log the request.                                                                                                                                                  |
