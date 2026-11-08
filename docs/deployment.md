# Deployment

Nothing in this repository deploys automatically. Production deployment needs your approval and accounts.

## Components
| Component | Runs | Notes |
|---|---|---|
| Web app (`Dockerfile.web`, Next.js standalone) | Vercel **or** any container host | `COUNCIL_WORKER=external` |
| Worker (`Dockerfile.worker`) | A long-running host with a container runtime | Runs council + Execution Council jobs; starts sandbox containers |
| PostgreSQL 15+ | Managed (Neon, Supabase, RDS…) or `docker-compose.prod.yml` | Daily backups, point-in-time recovery recommended |

**Chosen setup (26 Oct 2026): everything on one dedicated Hetzner Cloud server – see [docs/hetzner.md](hetzner.md)**
(Caddy HTTPS, web, worker, PostgreSQL, gVisor sandbox, backups, monitoring, deploy/rollback scripts in
`deploy/hetzner/`). The web app on Vercel cannot run the worker (long jobs, Docker); the options below remain for
other environments.

## Environment
See `apps/web/.env.example`. Required in production: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`CREDENTIALS_MASTER_KEY_V1` (+ `CREDENTIALS_ACTIVE_KEY_VERSION`). Optional: Google/GitHub OAuth, GitHub App,
Stripe, `PLATFORM_ADMIN_EMAILS`, `LOG_LEVEL`, `APP_VERSION`. Web and worker need the same database URL and
credential master keys; the worker also needs the GitHub App variables if repositories are used.

## Steps
1. Create the database; run migrations: `docker run --rm -e DATABASE_URL=… consyrion-worker migrate`
2. Deploy the web app (Vercel project root `apps/web`, or the web image behind a TLS proxy).
3. Start one or more workers (`docker compose -f docker-compose.prod.yml up -d worker`).
4. Check `GET /api/health` → `{"status":"ok"}`.
5. Configure OAuth callback URLs, the GitHub App (docs/github-app.md) and Stripe webhooks (docs/saas.md).
6. Point `consyrion.com` to the web app only after the release checklist (docs/release-checklist.md) is complete.
   Today the domain serves the coming-soon page from `~/consyrion-site`.

## Sandbox host hardening
- Rootless Docker (or gVisor `runsc`) for the worker host; the worker itself only runs Consyrion code.
- Keep the images `node:22-alpine` / `python:3.12-alpine` pre-pulled by the digests in `packages/build/src/sandbox.ts` (#399).
- With the sandbox on, run `deploy/hetzner/sandbox-network.sh` as root on the Docker host (and at every boot): installs only run on its egress network, which cannot reach the host, private ranges or 169.254.169.254. Set `SANDBOX_EGRESS_MARKER` if your workspace directory is not `/srv/consyrion/workspaces` (docs/hetzner.md, #399).
- Firewall: the worker needs outbound HTTPS (AI providers, GitHub, package registries during install).

### Disk hygiene (07.11.26)

After a healthy deploy, `deploy.sh` removes every `consyrion-web/worker/migrate` image except the running release and
the previous one (for `rollback.sh`), then prunes dangling images and the build cache and prints the free space. Before
building it still refuses to start with less than 4 GB free.
