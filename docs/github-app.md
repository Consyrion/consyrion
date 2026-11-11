# GitHub App setup (Milestone 5)

Consyrium uses a **GitHub App** (not a personal token) so access is limited to repositories the user selects
and every token is short-lived and scoped to one repository.

## Create the app (once per deployment)
GitHub → Settings → Developer settings → GitHub Apps → *New GitHub App*:

| Setting | Value |
|---|---|
| Homepage URL | `https://consyrium.com` |
| Callback URL | `<BETTER_AUTH_URL>/api/github/setup` |
| Setup URL | `<BETTER_AUTH_URL>/api/github/setup` |
| Request user authorization (OAuth) during installation | **on** (proves the user can access the installation) |
| Webhook URL | `<BETTER_AUTH_URL>/api/github/webhook`, with a random webhook secret |
| Repository permissions | Contents: **Read & write**, Pull requests: **Read & write**, Checks: **Read**, Metadata: Read |
| Organization/account permissions | none |
| Subscribe to events | Installation (others not needed) |
| Where can it be installed | Any account (for the SaaS) or only this account (testing) |

Then generate a private key and set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_PRIVATE_KEY` on the web app **and** the
worker. Creating the app costs nothing.

### Faster: create it from a manifest (production, 30 Oct 2026)
Post the manifest below to `https://github.com/settings/apps/new` (a local HTML form with a hidden `manifest`
field), check the form and click *Create*. GitHub redirects to the `redirect_url` with `?code=…`. Within **one
hour**, the operator runs

```
deploy/hetzner/github-app-finish.sh <code>
```

It exchanges the code (`POST /app-manifests/{code}/conversions`), writes the six `GITHUB_APP_*` values into
`/opt/consyrion/secrets/app.env` (backup first), recreates `web` and `worker` and prints only id, slug, client id
and owner. Secrets go from GitHub to the server without being shown. The webhook secret is the one GitHub generates.

```json
{ "name": "CONSYRIUM AI", "url": "https://consyrium.com",
  "hook_attributes": { "url": "https://app.consyrium.com/api/github/webhook", "active": true },
  "redirect_url": "https://app.consyrium.com/settings/integrations",
  "callback_urls": ["https://app.consyrium.com/api/github/setup"], "setup_url": "https://app.consyrium.com/api/github/setup",
  "request_oauth_on_install": true, "public": true,
  "default_permissions": { "contents": "write", "pull_requests": "write", "checks": "read", "metadata": "read" },
  "default_events": [] }
```

Production app: `consyrium-ai` (https://github.com/apps/consyrium-ai, renamed 11 Nov 2026 together with the organisation), owned by the organisation
`Consyrium` (transferred 30 Oct 2026; id, key and server values unchanged). Customers never create an app – they click *Connect GitHub*.

## Flow
Redirects and links (setup, invites, billing) use the origin of `BETTER_AUTH_URL`, never the request URL – behind
Caddy that is the container address `0.0.0.0:3000` (bug seen on the first production install, 30 Oct 2026).

1. Owner → *Integrations* → **Connect GitHub** → GitHub installation page (choose repositories).
2. GitHub redirects to the setup URL with `installation_id`, an OAuth `code` and our signed `state`.
   The server checks the state (same user and workspace, 15 min expiry) and that this GitHub user **controls** the
   installation (#394) – merely seeing it is not enough, because GitHub lists an installation for everybody with read
   access to one of its repositories:
   - personal account: the GitHub user must be that account;
   - organization: the GitHub user must have admin rights on every repository the installation covers (organization
     owners always do). The check compares `GET /user/installations/{id}/repositories` (user token) with the app's own
     repository count, so the app needs no organization permission. Installations without repositories or with more
     than 1,000 repositories are refused with a hint.

   One installation belongs to one workspace: connecting it to a second workspace is refused until it is suspended or
   uninstalled there. Only then is it stored.
3. On a project, link one repository. The server verifies with GitHub that the installation covers it.
   A repository URL entered when the project is created is linked automatically when one of the workspace's
   installations covers it (best effort; otherwise link it on the project page).
   GitHub needs a plan with the `github` entitlement (Pro and above); Integrations and the project page say so
   before anything is installed.
4. The Execution Council imports a snapshot of the default branch (text files only; `node_modules`, build output,
   binaries, `.env`/key files and files containing credential-like values are skipped and listed).
5. After a completed run, an owner/admin clicks **Create draft pull request**: new branch `consyrium/<run id>`,
   one commit with the changed files via the Git Data API, a **draft** PR with plan, test status and review findings.
   The base branch is never written; Consyrium never merges.
6. CI checks of the PR commit are shown in *Review & Tests*.

Webhooks: `installation` `deleted`/`suspend` mark the connection unusable; `unsuspend` restores it. Deliveries
without a valid `X-Hub-Signature-256` are rejected.

## Sign in with GitHub (separate OAuth app)
"Continue with GitHub" uses a classic OAuth app (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`) with the callback
`<BETTER_AUTH_URL>/api/auth/callback/github`. It is independent of the GitHub App above.

## End-to-end check (26 Oct 2026, local)
App installed on a private sandbox repository only → project created with the repository URL → council
(Claude Haiku 5.5, gpt-5-mini, deepseek-flash) → human approval → Execution Council imported the default-branch
snapshot (5 files), changed 2 files → draft PR #1 opened by the app on `consyrium/<run id>`, base untouched.
Sandbox tests were `not_run` locally (no Docker) and the PR body says so; the PR branch passed `npm test` (7/7)
when run by hand.

## Tokens
- App JWT (RS256, 9 min) only to mint installation tokens.
- Installation tokens are requested per action and never stored. Listing, snapshots, existing pull requests and
  checks use read-only tokens (`contents:read, pull_requests:read, checks:read, metadata:read`); only the
  human-triggered draft PR asks for
  `contents:write, pull_requests:write` restricted to the one repository.

## Reading existing pull requests (#18)
`GET /api/github/pulls?integrationId=…&repository=owner/name[&state=open|closed|all]` lists the repository's pull
requests (most recently updated first); `&number=N` returns one with its changed files. Only repositories linked to
a project of the workspace can be read (#402) – the installation may grant more, but their code is not for every
member to browse. Listing the installation's repositories (`GET /api/github/repositories`) needs the right to link one
(owner, admin, member), not viewer. The installation token is read-only and scoped to that repository. Diffs pass the same filters as repository snapshots: secret-looking paths,
credential-like content, binaries and patches over 20,000 characters are listed without their diff (`withheld`
says why). Nothing is written, commented or merged. The app's existing "Pull requests: Read & write" permission
covers this; no new permission is requested.
