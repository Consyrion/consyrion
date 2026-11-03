# Self-hosting

CONSYRION AI runs entirely on your own hardware. You bring your own AI provider keys (BYOK); the providers bill
you directly. There is no hosted service and nothing is sent anywhere except to the AI providers and services you
configure yourself.

## Requirements

- Docker with Compose v2 and `openssl`
- 2 CPU cores and 4 GB RAM are enough for decision councils; the Execution Council (code sandbox) needs more
- At least one API key from a supported provider: Anthropic, OpenAI, Google Gemini, DeepSeek, Z.ai (GLM),
  Moonshot (Kimi), Alibaba (Qwen) or xAI (Grok). A council needs at least two models.

## Install

```bash
deploy/selfhost/init.sh [public-url]      # default http://localhost:3000; writes deploy/selfhost/.env
docker compose -f deploy/selfhost/compose.yml up -d --build
docker compose -f deploy/selfhost/compose.yml ps   # web becomes "healthy" after ~30 s
```

Open the URL, create an account and add your keys under **AI providers**. Keys are stored encrypted
(AES-256-GCM) with `CREDENTIALS_MASTER_KEY_V1` from `deploy/selfhost/.env`.

**Back up `deploy/selfhost/.env`.** Without the master key, stored provider keys cannot be decrypted.

## Configuration

`deploy/selfhost/.env` holds the required values. Optional settings (add them to the same file, then
`docker compose … up -d`) are documented in `apps/web/.env.example`:

| Setting                                              | Purpose                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` | Social sign-in (email + password always works)                                     |
| `GITHUB_APP_*`                                       | Connect repositories and open draft pull requests ([github-app.md](github-app.md)) |
| `SMTP_URL`, `MAIL_FROM`                              | E-mail delivery of decisions                                                       |
| `ARTIFICIAL_ANALYSIS_API_KEY`                        | Model strength ranking (free key, attribution required)                            |
| `PLATFORM_ADMIN_EMAILS`                              | Accounts with access to `/admin`                                                   |

`SELF_HOSTED=true` (set by `init.sh`) removes all plan limits. Stripe and plans are only for running CONSYRION AI
as a hosted service ([saas.md](saas.md)).

## Running on a server

Put a TLS reverse proxy (Caddy, nginx, Traefik) in front of port 3000 and pass the public HTTPS URL to `init.sh`
(or set `BETTER_AUTH_URL`). The compose file binds the web app to `127.0.0.1` only. A complete single-server
setup with Caddy, gVisor sandbox, backups and monitoring is described in [hetzner.md](hetzner.md).

## Execution Council (optional)

The worker starts generated code in sandbox containers through the host's Docker socket. Only enable this on a
machine you trust with it; prefer rootless Docker or gVisor (`SANDBOX_DOCKER_RUNTIME=runsc`), see
[deployment.md](deployment.md). Without Docker access, decision councils work and sandbox tests show "not run".

## Update

```bash
git pull
docker compose -f deploy/selfhost/compose.yml up -d --build   # migrations run automatically
```

## Backup and restore

```bash
docker compose -f deploy/selfhost/compose.yml exec postgres pg_dump -U consyrion -Fc consyrion > consyrion.dump
docker compose -f deploy/selfhost/compose.yml exec -T postgres pg_restore -U consyrion -d consyrion --clean < consyrion.dump
```
