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
- Sessions: Better Auth cookies (HttpOnly). State-changing API routes accept JSON only.
- Unexpected errors return a generic 500 without internal messages.

## Generated code (Execution Council)
- Executed only in containers (`packages/build/src/sandbox.ts`); never on the host. Tests run without network.
- Model-chosen file paths are validated; `.git`/`.github` cannot be written.
- See docs/execution-council.md for limits (network during install).

## Not yet implemented (tracked)
- Email verification for password accounts (needs a mail provider). Until then an unverified password
  account and a later Google/GitHub sign-in with the same address must not be linked automatically –
  Better Auth default linking rules apply; review before public launch.
- PostgreSQL row-level security (tenant isolation is enforced in the repository layer), password reset,
  key re-encryption job, dedicated prompt-injection test suite for repository content (#11; untrusted-data
  wrapping and rules are in `packages/council/src/prompts.ts`), registry proxy / gVisor for the sandbox (#23).
- Done since: rate limiting (auth + API), CSP and security headers, container sandbox without network for tests.

## Sign-in methods and account linking
Users can sign in with email/password, Google or GitHub (each social provider is enabled only when its OAuth
credentials are set). Sign-in never merges accounts on its own: a login with an unknown e-mail address creates a
new account. A signed-in user can connect further methods under **Settings → Account** (Better Auth
`linkSocial`); different e-mail addresses are allowed only for this explicit linking. A login that already
belongs to another Consyrion account is refused, and the last remaining method cannot be removed.

