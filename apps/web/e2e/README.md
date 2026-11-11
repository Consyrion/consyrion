# Auth E2E tests and the post-deploy smoke check

## Auth regression (`auth.e2e.ts`, runs in CI as `e2e-auth`)

Real browser (Playwright, Chromium) against the production build with e-mail verification on. A local test mail
server (`smtp-sink.mjs`, 127.0.0.1 only) catches the verification and reset links. Covered:

- sign-up opens no session; an unverified sign-in sends a fresh link
- the verification link confirms the address and opens no session
- a verified e-mail sign-in lands on `/dashboard` and stays there (live bug 08.11.26)
- a wrong password, sign-out
- signing in as a second account in a browser that is still signed in as the first
- forgot password → link → new password; the old one stops working

Locally (needs an empty PostgreSQL database):

```
pnpm build
DATABASE_URL=postgres://…/consyrium_e2e pnpm db:migrate
pnpm --filter @consyrium/web exec playwright install chromium
E2E_DATABASE_URL=postgres://…/consyrium_e2e pnpm --filter @consyrium/web e2e
```

## Smoke check after every deploy (`smoke.e2e.ts`)

Signs in with a verified test account, expects `/dashboard`, signs out again. The credentials come only from the
environment – never from the repository:

```
SMOKE_BASE_URL=https://app.consyrium.com SMOKE_EMAIL=… SMOKE_PASSWORD=… pnpm --filter @consyrium/web e2e:smoke
```

Use a dedicated test account without API keys or data. Without `SMOKE_EMAIL`/`SMOKE_PASSWORD` the check is skipped.
