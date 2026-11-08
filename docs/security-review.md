# Security review (Milestone 7)

Reviewed 25.10.2026 against the brief's security requirements. Status: ✅ implemented and tested ·
⚠️ implemented with known limits · ⏳ open.

| Area | Status | Evidence |
|---|---|---|
| Tenant isolation | ✅ | Repository layer filters by organization; cross-tenant ids return 404 (db, council, build tests) |
| RBAC | ✅ | `packages/core/src/rbac.ts` matrix tests; approvals and Execution Council owner/admin only |
| Encrypted provider keys | ✅ | AES-256-GCM, AAD bound to tenant+record, rotation; never returned, logged or exported |
| No operator AI key / credits | ✅ | BYOK only; no fallback code path (#30) |
| Prompt injection | ⚠️ | All user/model/repository content wrapped as untrusted data; models can still be influenced – human approval and reviews are the backstop |
| Human gates | ✅ | Verdict approval, Execution Council start and PR creation are separate human actions; no merge/deploy |
| Code sandbox | ⚠️ | Docker: no network for tests, caps dropped, limits, no host fallback (CI integration test). Install step has egress |
| Repository secrets | ✅ | Snapshot skips secret files and credential-like content; listed in UI |
| GitHub | ✅ | Repo-scoped short-lived tokens, verified installation ownership, signed state, webhook signatures |
| Stripe | ✅ | Signed webhooks with replay window; no AI billing |
| Auth | ⚠️ | Better Auth sessions, OAuth, rate limit in production, 12+ char passwords. ⏳ e-mail verification, 2FA |
| API tokens | ✅ | Hashed, expiring, revocable, one workspace, membership re-checked; a token cannot mint tokens or manage the team (#403) |
| Web hardening | ✅ | CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer/Permissions policy, no `x-powered-by` |
| Logging | ✅ | Redaction of secret keys and token patterns incl. `cns_`/`cni_`/`cnr_`, shared by web, worker and packages (`redactSecrets`, #403) |
| Rate limiting | ⚠️ | Auth (Better Auth) and key/model endpoints (in-memory per instance). ⏳ shared store for many instances |
| Data protection | ⚠️ | Export, deletion. ⏳ retention periods, DPA, legal review (Swiss nDSG / GDPR) |
| Dependencies | ✅ | `pnpm audit --prod --audit-level high` fails CI; Dependabot (npm + GitHub Actions, weekly, grouped); actions pinned by commit SHA (#397) |

Recommended before public launch: external penetration test, lawyer review
of privacy policy/terms and the trademark question (CONSYRION_BRAND_CHECK.md).
