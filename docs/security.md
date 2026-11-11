# Security: tenancy and credentials

## Tenancy and roles

- Membership is re-checked on every request (`resolveActor`); the active-organization cookie is only a preference.
- Permissions per role are defined in `packages/core/src/rbac.ts` and unit-tested.
  Members may run decisions but not approve them or manage keys; viewers are read-only.
- Cross-tenant access returns `NOT_FOUND` (tested in `packages/db/src/repositories/repositories.test.ts`).

## Provider API keys (BYOK)

- Encrypted with AES-256-GCM before storage. Envelope: `v<keyVersion>.<iv>.<tag>.<ciphertext>`.
- Associated data binds each ciphertext to `organizationId` and `credentialId`; a ciphertext copied into
  another tenant's row cannot be decrypted.
- Master keys: `CREDENTIALS_MASTER_KEY_V<n>` (32 bytes, base64), active version in
  `CREDENTIALS_ACTIVE_KEY_VERSION`. Without a key the app refuses to store credentials.
- Rotation: add `CREDENTIALS_MASTER_KEY_V2`, set the active version to 2; old envelopes stay readable.
  A re-encryption job is planned (`envelopeKeyVersion` identifies old rows).
- The API returns only a hint (`••••1234`). Decryption happens server-side immediately before a provider call.
- Audit metadata drops keys that look like secrets (`sanitizeAuditMetadata`).
- Provider errors are normalized to kind + status; provider response bodies are not passed to clients.

## Web

- Security headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- Sessions: Better Auth cookies (HttpOnly, `SameSite=Lax`).
- CSRF (#396): every API route wrapped in `handle()` refuses cookie-authenticated POST/PUT/PATCH/DELETE requests whose
  `Sec-Fetch-Site` is `cross-site` or `same-site` (a sibling subdomain counts as foreign) or whose `Origin` is not the
  app's own origin (`BETTER_AUTH_URL`). Bearer-token requests are exempt (no ambient credential); webhooks verify
  signatures instead. `readJson` additionally requires `Content-Type: application/json` from browsers, so a
  cross-site HTML form (`text/plain`) cannot smuggle a JSON body. Better Auth checks the origin of `/api/auth/*`.
- Unexpected errors return a generic 500 without internal messages.

## Generated code (Execution Council)

- Executed only in containers (`packages/build/src/sandbox.ts`); never on the host. Tests run without network.
- Model-chosen file paths are validated; `.git`/`.github` cannot be written.
- See docs/execution-council.md for limits (network during install).

## Email verification for password accounts

On whenever the server can send e-mail (`SMTP_URL`); `REQUIRE_EMAIL_VERIFICATION=false` switches it off explicitly.

- Sign-up sends a link (valid 24 hours) and creates no session; the account cannot sign in until the link is opened.
  Every sign-in attempt of an unverified account sends a fresh link. The link only verifies the address and leads to
  `/verify-email` ("address confirmed – sign in"); it never opens a session, so a leaked e-mail alone gives no access. A visitor who already has a session (the e-mail sign-in
  follows the same callback URL after success) is sent on to the dashboard.
  An invalid or expired link explains how to get a new one.
- Platform admins (`PLATFORM_ADMIN_EMAILS`) always need a **verified** address (#404), so registering an unclaimed
  admin address grants nothing (`isPlatformAdmin`, `resolvePlatformAdmin(…, { requireVerifiedEmail })`). Google/GitHub
  sign-ins count as verified.
- Invitations are accepted only from a verified address while verification is on (#404); the link alone is not enough.
- Accounts created before verification was switched on are unverified: they keep a running session, but the next
  password sign-in asks them to open the link first. Google/GitHub sign-ins are verified by the provider.
- Without SMTP verification stays off (nobody could receive the link). A password account then stays unverified and
  is **no** platform admin – sign in to the admin address with Google/GitHub, or opt out explicitly with
  `PLATFORM_ADMIN_ALLOW_UNVERIFIED=true` (then the e-mail list alone decides; register the admin addresses yourself
  right after installing). The opt-out is ignored while verification is on.
- Team: the last-owner check locks the workspace's owner memberships in the same transaction (#404), so two owners
  demoting each other at once cannot leave a workspace without owner. Feedback state changes, replies and deletions,
  the model-strength refresh and revoked invitations are audited.

## Password reset (#395)

On whenever SMTP is configured. **Sign in → Forgot password?** sends a link that is valid once for 60 minutes; the
answer is the same whether an account exists or not. Setting the new password ends every other session
(`revokeSessionsOnPasswordReset`) and marks the address as verified, because the link reached it – so the real owner
of an address somebody else pre-registered can take it back. Without SMTP there is no reset.

## Smaller hardening (#408)

- Privacy export: team skills and the exporting user's own, never colleagues' private skills.
- Stopping a council: the person who started it, or an owner/admin (`decision:approve`); members cannot stop others'.
- Telegram questions: only the person who connected the chat can switch them on (they run as that person).
- Repository snapshots additionally skip Terraform variables/state, `.netrc`, `.git-credentials`, `.htpasswd`,
  kubeconfig, Docker auth and service-account key files, and content with Stripe live keys, Slack webhooks, JWTs or
  Google service-account private keys.

## Not yet implemented (tracked)

- PostgreSQL row-level security (tenant isolation is enforced in the repository layer),
  key re-encryption job, dedicated prompt-injection test suite for repository content (#11; untrusted-data
  wrapping and rules are in `packages/council/src/prompts.ts`), registry proxy / gVisor for the sandbox (#23).
  Since #406 untrusted text cannot close its frame: `neutralizeWrapperTags` (`packages/core/src/untrusted.ts`) turns
  wrapper tags inside briefs, documents, skill texts, proposals, critiques, objections, files, tasks and test output
  into `‹/document` etc. before they are embedded – other markup (HTML, JSX, XML) is left as it is.
- Done since: rate limiting (auth + API), CSP and security headers, container sandbox without network for tests,
  email verification for password accounts (see above).

## Sign-in methods and account linking

Users can sign in with email/password, Google or GitHub (each social provider is enabled only when its OAuth
credentials are set). Sign-in never merges accounts on its own (`accountLinking.disableImplicitLinking`, #395): a
login with an unknown e-mail address creates a new account, and a Google/GitHub login whose address already belongs
to an account is refused with a hint ("sign in with your password, then connect it under Settings → Account").
Before #395 Better Auth linked such logins automatically when both sides were verified, so somebody who
pre-registered a victim's address could receive the victim's later Google login. A signed-in user can connect further methods under **Settings → Account** (Better Auth
`linkSocial`); different e-mail addresses are allowed only for this explicit linking. A login that already
belongs to another Consyrium account is refused, and the last remaining method cannot be removed.

## Dependency overrides (Dependabot, 08.11.26)

`pnpm.overrides` in the root `package.json` lifts transitive development dependencies that have known advisories and no
patched version in their parent's range: `@azure/identity` ≥ 4.14.1 (pulls `@azure/msal-node` ≥ 7.1.0, via `@vscode/vsce`),
`minimatch` ≥ 11.0.1 (via ESLint) and `esbuild` ≥ 0.25 (via `drizzle-kit` → `@esbuild-kit`). None of them is in the app
image. Remove an override once the parent package requires the patched version itself.
