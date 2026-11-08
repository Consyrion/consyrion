# Hosting on Hetzner (#100)

Decision of 26 Oct 2026: CONSYRION runs on its **own Hetzner Cloud server** (not shared with other projects:
the Execution Council executes AI-generated code) under **`app.consyrion.com`**. `consyrion.com` stays the
public landing page. Nothing here orders, pays for or publishes anything – the server order, DNS and the
first deployment are done by the owner.

Hetzner hosts CONSYRION (app, database, backups). Content a user sends to a council or build still goes to the
AI providers whose keys the user connected (BYOK) – Hetzner does not change that.

## Architecture (one server)

| Service                                 | Image                                                              | Network                            | Public            |
| --------------------------------------- | ------------------------------------------------------------------ | ---------------------------------- | ----------------- |
| Caddy (HTTPS, Let's Encrypt, HSTS)      | `caddy:2.10-alpine`                                                | `edge`                             | **80/443 only**   |
| Web app + API (Next.js)                 | `consyrion-web:<version>` (`Dockerfile.web`)                       | `edge`, `db`                       | no (behind Caddy) |
| Worker (councils + Execution Council)   | `consyrion-worker:<version>` (`Dockerfile.worker`)                 | `db`, `egress`                     | no                |
| PostgreSQL 17                           | `postgres:17-alpine`                                               | `db` (internal, no internet)       | no                |
| Migrations (one-shot before web/worker) | worker image, `migrate`                                            | `db`                               | no                |
| Code sandbox                            | `node:22-alpine` / `python:3.12-alpine` (pinned by digest) under **gVisor (`runsc`)** | none for tests, own egress network for install (#399) | no                |

Files: `deploy/hetzner/compose.yml`, `Caddyfile`, `setup-server.sh`, `deploy.sh`, `rollback.sh`, `backup.sh`,
`restore-test.sh`, `check.sh`. No Kubernetes; the job queue is the PostgreSQL `job` table (SKIP LOCKED + lock
heartbeat), so a worker restart resumes interrupted councils from their last checkpoint without running finished
calls again (engine test "resumes after a crash without repeating finished work").

**Capacity (#149).** One worker runs `WORKER_CONCURRENCY` jobs side by side (default 4; councils mostly wait for
providers). Among due jobs the workspace with the fewest running jobs goes first, and one workspace runs at most
`WORKER_JOBS_PER_WORKSPACE` (default 3, like the three councils a workspace may start). Sandboxed builds are capped
by `WORKER_MAX_BUILDS` (compose default 1 on the CX23, code default 2). To scale: raise `WORKER_CONCURRENCY` (watch the worker's memory with `docker stats`), rescale the server, or run more worker replicas – `claimNext` uses
SKIP LOCKED, so replicas share the queue safely. A queued session shows how many jobs are ahead and how many run.

**Sandbox isolation.** Generated code never sees the Docker socket, app secrets or other tenants' data: each
run is a fresh container with uid 1000, all capabilities dropped, `no-new-privileges`, 1 CPU / 1 GB / 256 pids,
no network for tests, and gVisor as a user-space kernel between the code and the host
(`SANDBOX_DOCKER_RUNTIME=runsc`). The worker itself (trusted CONSYRION code, no inbound port) starts these containers
through the host's Docker socket – but only when the sandbox is on (#398): the socket is root-equivalent, so it is
mounted from `deploy/hetzner/compose.sandbox.yml`, which `deploy.sh` and `rollback.sh` add only when `deploy.env`
contains `SANDBOX_DISABLED=false`. The hosted default (`SANDBOX_DISABLED=true`) runs the worker without socket and
without the docker group. To switch the sandbox on, set `SANDBOX_DISABLED=false` in
`/opt/consyrion/secrets/deploy.env` (not only in `app.env`: the compose file reads it from `deploy.env`, and only
there does it also add the socket) and deploy again; its workspaces live in `/srv/consyrion/workspaces` at the same path on host and
in the container, owned by uid 1000 like the sandbox user. Without a container runtime tests are reported as
"not run", never as passed.

**Sandbox hardening (#399).** Only relevant with `SANDBOX_DISABLED=false` – the hosted default is unchanged.
- Installs run on the network `consyrion-sandbox-egress` (subnet `172.31.250.0/24`), never on Docker's default bridge.
  `deploy/hetzner/sandbox-network.sh` creates it and adds iptables rules: `DOCKER-USER` drops 10/8, 172.16/12,
  192.168/16, 169.254/16 (metadata), 100.64/10, loopback and multicast for that subnet, and `INPUT` drops everything
  from its bridge (`cnr-sbx0`) to the host. Public registries stay reachable. IPv6 is off on that network.
- The script writes the boot id to `/srv/consyrion/workspaces/.sandbox-egress-firewall`. The worker refuses an install
  (status error, nothing runs) while the network is missing or the marker is from an earlier boot – iptables rules do
  not survive a reboot. `deploy.sh` runs the script and installs `consyrion-sandbox-net.service`, which re-runs it
  after every boot.
- Containers run with `--read-only`, `--tmpfs /tmp` (256 MB) and `--ulimit nofile=1024:2048`, besides the existing
  limits. The workspace bind mount has no quota: the worker refuses to start with less than `SANDBOX_MIN_FREE_MB`
  (2048) free and stops a container whose workspace grows beyond `SANDBOX_WORKSPACE_MAX_MB` (2048, measured with
  `du` every 5 s). A hard quota needs XFS project quotas on `/srv/consyrion/workspaces` (not set up).
- Images are pinned by digest (`SANDBOX_IMAGES` in `packages/build/src/sandbox.ts`, pre-pulled by `setup-server.sh`);
  update both together.
- Switching the sandbox on (server, as root, only after asking the owner): set `SANDBOX_DISABLED=false` in
  `deploy.env`, then deploy – `deploy.sh` sets up network, firewall and the boot unit. Check:
  `iptables -S DOCKER-USER | grep 172.31.250` and `cat /srv/consyrion/workspaces/.sandbox-egress-firewall`.

## Costs (Hetzner list prices, checked 26 Oct 2026, EUR excl. VAT, incl. IPv4)

| Item                                                           | Recommendation                                                                                | Price                                   |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------- |
| Server (start / test phase)                                    | **CX23** – 2 vCPU, 4 GB RAM, 40 GB NVMe, 20 TB traffic, plus 4 GB swap from `setup-server.sh` | 5.99 / month                            |
| Server backups (optional, 7 daily snapshots of the whole disk) | on                                                                                            | 20 % of the server price ≈ 1.20 / month |
| Off-site database copies (optional)                            | Hetzner Storage Box                                                                           | see Hetzner console                     |

Chosen for the start (26 Oct 2026): **CX23** in Falkenstein (`consyrion-01`, ordered 27 Oct 2026; Helsinki and Nürnberg had no CX23 capacity). It runs web, worker, database and one sandbox at a time; the image
build during a deploy uses the swap and takes longer. When several builds run at once or users arrive, rescale in
the Hetzner console to CX33 (4 vCPU, 8 GB, 8.99 / month) or CX43 (8 vCPU, 16 GB, 16.49 / month) – choose
"CPU and RAM only" to keep the option of scaling back down. Not recommended: the ARM plan CAX11 (6.49), since the
images and gVisor setup are prepared and tested for x86. Hetzner showed the
cost-optimised plans as "currently unavailable" on its website when checked; the console shows real availability.
AI usage is **not** part of these costs – customers pay their providers directly (BYOK).

## First setup (owner)

1. **SSH key** on your machine: `ssh-keygen -t ed25519 -f ~/.ssh/hetzner_consyrion` (add the `.pub` in the
   Hetzner console when ordering).
2. **Order** the server in the Hetzner console: CX23 (x86), Ubuntu 26.04 (24.04 works too), your SSH key, backups on. Note the IPv4/IPv6.
3. **Cloud Firewall** (recommended, in addition to `ufw`): inbound TCP 22 (ideally only from your IP), 80, 443;
   attach it to the server. Docker publishes only Caddy's 80/443, the database has no published port.
4. **DNS** at your registrar: `A app.consyrion.com → <IPv4>` and `AAAA app.consyrion.com → <IPv6>`.
5. **Server setup** (copies the script, runs it once):
   ```bash
   scp -i ~/.ssh/hetzner_consyrion deploy/hetzner/setup-server.sh root@<IP>:/root/
   ssh -i ~/.ssh/hetzner_consyrion root@<IP> 'APP_DOMAIN=app.consyrion.com ACME_EMAIL=<your mail> bash /root/setup-server.sh'
   ```
   It installs updates, Docker, gVisor, the firewall, key-only SSH, cron jobs, and generates
   `/opt/consyrion/secrets/{app.env,postgres_password,deploy.env}` (mode 600, never printed).
   **Copy `CREDENTIALS_MASTER_KEY_V1` and `BETTER_AUTH_SECRET` from `app.env` into your password manager** –
   without the master key, stored provider keys cannot be decrypted after a restore.
6. Optional values in `/opt/consyrion/secrets/app.env`: `PLATFORM_ADMIN_EMAILS`, `ADMIN_EMAILS` (feedback e-mails, docs/feedback.md), Google/GitHub OAuth, GitHub App
   (callback URLs `https://app.consyrion.com/api/auth/callback/google` and `…/github`, see docs/github-app.md; the
   sign-in and sign-up pages render per request, so the buttons appear after a web restart, no rebuild needed), `ARTIFICIAL_ANALYSIS_API_KEY` for the
   model ranking (docs/model-weighting.md). Stripe stays off (postponed).
   In `deploy.env`: `ALERT_WEBHOOK_URL` (e.g. your Telegram bot) and `BACKUP_REMOTE` (Storage Box).
7. **Deploy** from your machine (committed `HEAD` only): `./deploy/hetzner/deploy.sh <IP>`

## Operations

| Task                              | Command                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Deploy a new version              | `./deploy/hetzner/deploy.sh <IP>` – builds on the server, pre-deploy backup, migrations, health wait |
| Smoke check after a deploy        | `SMOKE_BASE_URL=https://app.consyrion.com SMOKE_EMAIL=… SMOKE_PASSWORD=… pnpm --filter @consyrion/web e2e:smoke` – e-mail sign-in with a test account must land on `/dashboard` |
| Roll back to the previous version | `./deploy/hetzner/rollback.sh <IP>` – refused below the running release's minimum (rollback guard)   |
| Status / logs                     | `ssh … 'cd /opt/consyrion/app && docker compose -p consyrion ps'` · `docker logs consyrion-worker-1` |
| Restart the worker                | `docker restart consyrion-worker-1` (running councils resume from their checkpoint)                  |
| Backup now                        | `/opt/consyrion/app/deploy/hetzner/backup.sh manual` (daily 03:15 by cron, 30 days kept, Storage Box mirrored)             |
| Prove a restore                   | `/opt/consyrion/app/deploy/hetzner/restore-test.sh` → `/opt/consyrion/restore-tests.log`             |
| Releases                          | `/opt/consyrion/RELEASES` (time + git version)                                                       |

**Rollback.** Migrations only move forward. If the release you roll back added a migration, restore the
pre-deploy backup (`consyrion-…-pre-<version>.dump`) into the database first, then run `rollback.sh`.

**Restore (ADR 0206).** Restore a backup only with `/opt/consyrion/app/deploy/hetzner/restore.sh --yes <dump>`: it backs up
the current database, stops web and worker, restores, then runs `post-restore-scrub.sh` so workspaces, projects and
sessions deleted after the dump was taken are removed again (with their queued jobs) before the app starts; if the scrub
fails, the app stays stopped. The scrub reads the deletion list `/opt/consyrion/deletions/deletions.log` (ids and times
only, never rotated; mirrored to the Storage Box by `deletions-sync.sh` without `--delete`). If the server is lost, fetch
`deletions.log` from the Storage Box first. After a manual `pg_restore`, always run
`post-restore-scrub.sh consyrion-postgres-1` (`--dry-run` shows the counts first).

**Rollback guard (#181).** Every release declares two numbers in `deploy/hetzner/RELEASE_LEVEL`: `release_level`
(what it can safely handle) and `min_rollback_level` (the lowest level it may be rolled back to). Before switching,
`rollback.sh` runs the running release's `rollback-guard.sh` against `/opt/consyrion/app` (running) and
`/opt/consyrion/app.prev` (target). A target without the file has level 0. Current values:

| Release                                            | release_level | min_rollback_level | Why                                                                                                                                                                                                         |
| -------------------------------------------------- | ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| e33a3bb and older (no file)                        | 0             | –                  | Does not know decision format versions; would approve or re-evaluate decisions it cannot read                                                                                                               |
| Stage 1 of #181 (tolerant readers, gate version 1) | 1             | 1                  | Reads `final_decision.gate_version`, refuses unknown versions and outcomes                                                                                                                                  |
| Stage 1b of #181                                   | 2             | 1                  | Also reads `council_session.gate_version` (set at start) and re-checks a build's approval on every run and resume                                                                                           |
| S1 gate (later, writes gate version 2)             | 3             | 2                  | Rolling back to 1b is safe: 1b neither runs a version-2 council (even without a verdict) nor continues its build. Stage 1 sees a version-2 council only once it has a verdict, so it is refused as a target |

So from stage 1 on, a rollback to e33a3bb is refused, and from the S1 gate on a rollback to stage 1 (`42fb6d0`). `rollback.sh <IP> --allow-below-minimum` overrides the refusal
with a warning – only in an emergency, after restoring the matching pre-deploy backup and pausing new councils and
approvals. Tests: `bash deploy/hetzner/rollback-guard.test.sh` (also run in CI). Raise `min_rollback_level` only in
a release that must never be rolled back past.

**Monitoring.** `check.sh` runs every 5 minutes: `/api/health` over HTTPS, worker container running, jobs waiting
longer than 10 minutes (queue stuck) and running jobs without a lock heartbeat for 5 minutes (worker crashed).
Problems go to `/var/log/consyrion-check.log`, syslog and – once per state change – `ALERT_WEBHOOK_URL`.

**Secrets.** Only in `/opt/consyrion/secrets` (root, mode 600) and your password manager; never in images
(`.dockerignore` excludes `.env*`), the repository, logs or backups. Logs are redacted (docs/operations.md).

## Reference installation

The reference installation ran on one Hetzner CX23 server. Alerts: set `ALERT_WEBHOOK_URL` in `deploy.env`.

## Acceptance (#100) – status

| Criterion                                                                       | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reproducible start in an isolated environment, services healthy                 | **Done on consyrion-01 (27 Oct 2026)**: `deploy.sh` built, migrated (15 migrations) and started web, worker, Postgres and Caddy; Let's Encrypt certificate issued, HTTP redirects to HTTPS, HSTS set. The first deploy found three script bugs (fixed in #137, #138, #142)                                                                                                                                                                                                                                                            |
| Unauthenticated API access and public DB/queue connections fail                 | App: every API route checks the session or API token (`requireActor` / `requireUser`); public by design are only `/api/health` (no details), `/api/auth/*` (sign-in) and the GitHub and Stripe webhooks (signature-verified) – checked by listing all routes on 26 Oct. DB/queue: no published port, `internal` network, ufw + Cloud Firewall; **verified from outside on 27 Oct 2026**: `nc -vz <server-ip> 5432` and `… 3000` time out, nothing listens on the host for 5432/3000, `GET /api/projects` without a session returns 401 |
| Running council traceable after worker restart, no double billable execution    | Queue + checkpoints + engine resume test; worker restart on the server tested (clean stop, restart in 2 s); **still to repeat with a running council** once an account with keys exists                                                                                                                                                                                                                                                                                                                                               |
| Migration, backup restore and rollback practically tested, with log             | Migrations ran on the first deploy; backup + restore test passed on 27 Oct 2026 (restored and live row counts equal, logged in `restore-tests.log`; the test now waits for the real server, not the image's init server); rollback b691a49 → 8c9e8b3 → b691a49 tested on 27 Oct 2026, health reported the right version each time (`/opt/consyrion/RELEASES`)                                                                                                                                                                         |
| Sandbox test really executes; missing runtime shows "not run"                   | gVisor installed; a container under `--runtime=runsc` starts the gVisor kernel on consyrion-01 and the worker runs with `SANDBOX_DOCKER_RUNTIME=runsc`; "not run" path tested (`packages/build/test/units.test.ts`); a real Execution Council build on the server is still open                                                                                                                                                                                                                                                       |
| No secrets in logs/artifacts; monitoring reports worker failure and queue stall | Redacted logs, secret filters; `check.sh` covers worker and queue                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Runbook names remaining manual steps and approvals                              | This document: order, firewall, DNS, setup, secrets backup, first deploy                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Public release considers #93, #94, #96                                          | All three are closed (fixed and tested)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Remaining before a public launch: docs/release-checklist.md (legal pages, trademark, Stripe later).

## Migrations before the switch (06.11.26)
`deploy.sh` runs the migration with the new image (`docker compose run --rm --no-deps migrate`, up to three
attempts) while the previous release keeps serving. Only after it succeeds does `up -d` replace web and worker. If it
fails, the previous release stays live and untouched, the new files move to `/opt/consyrion/app.failed`, and the script
exits with an error. (A migration that failed inside `up -d` once left the site at 502 for about two minutes.)

## Disk hygiene (06.11.26)
Each deploy builds two images; failed deploys used to leave them behind, and 82 images filled the 38 GB disk (the
migration then failed with `ENOSPC`). `deploy.sh` now prunes unused images and build cache older than 48 h before
building, refuses to build with less than 4 GB free, and removes the images of a release whose migration failed.
Check by hand: `docker system df`, `df -h /`.
