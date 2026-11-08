# HTTP API

All endpoints are under `/api`. Authentication: browser session cookie **or** `Authorization: Bearer cns_…`
(personal API token, one workspace). Errors: `{ "error": { "code", "message", "details?" } }` with 401/403/404/
409/422/429/502/503.

| Method & path | Purpose | Permission |
|---|---|---|
| GET `/health` | Liveness/readiness | public |
| GET/POST `/projects`, GET/PATCH/DELETE `/projects/:id`, POST `/projects/:id/delete` | Projects, brief versions, archive, permanent delete | project:read/write/delete |
| GET/POST `/projects/:id/documents`, DELETE `/projects/:id/documents/:docId` | Documents (multipart `file`): text up to 200 kB; PDF, DOCX, PPTX up to 8 MB, stored as extracted text; images up to 3.5 MB, described first – POST `.../documents/:docId/describe`, PUT `.../documents/:docId/description` (`docs/documents.md`) | project:read/write |
| GET/POST `/projects/:id/requirements` | Proposed hard requirements, confirmed list versions; confirm a new version (#190, `docs/requirements-intake.md`) | project:read / project:write |
| POST/DELETE `/projects/:id/repository` | Link GitHub repository | project:write + plan |
| GET/POST `/projects/:id/sessions`, POST `/projects/:id/sessions/preview` | Councils, cost preview; a start needs a requirement list confirmed for the current brief and documents (409 otherwise) | decision:run |
| GET `/sessions`, GET `/sessions/:id`, GET `/sessions/:id/events` (SSE), GET `/sessions/:id/report?format=json` | Session view and report | project:read |
| POST `/sessions/:id/cancel` | Stop a session | decision:run |
| POST `/sessions/:id/approval` | approve, select_alternative, reject, request_changes, request_more_debate | decision:approve |
| GET/POST `/sessions/:id/executions` | Execution Council runs | read / decision:approve |
| GET `/executions/:id`, POST `/executions/:id/cancel`, GET `/executions/:id/patch` | Run view, stop, patch | read / approve |
| POST `/executions/:id/pull-request`, GET `/executions/:id/checks` | Draft PR, CI status | decision:approve / read |
| GET/POST `/credentials`, DELETE `/credentials/:id`, POST `/credentials/:id/validate`, POST `/credentials/:id/rotate`, GET `/models` | BYOK keys and live models | credential:read/write |
| GET/POST `/team/members`, PATCH/DELETE `/team/members/:id`, DELETE `/team/invitations/:id`, POST `/invitations/accept` | Team | member:manage |
| GET/POST `/tokens`, DELETE `/tokens/:id` | Personal API tokens | own; POST/DELETE only in the web app, not with a token (#403) |
| POST `/orgs/active`, GET `/orgs` | Workspaces | member |
| GET `/privacy/export`, DELETE `/privacy/organization` | Export, delete workspace | owner |
| GET/POST `/pricing`, DELETE `/pricing/:id` | Own model prices for estimates | credential:write |
| POST `/billing/checkout`, POST `/billing/portal`, POST `/billing/webhook` | Stripe | billing:manage / signed |
| GET `/github/install`, GET `/github/setup`, POST `/github/webhook`, GET `/github/repositories` | GitHub App | owner / signed; repositories: member+ (#402) |
| PUT `/admin/plans/:key`, PUT `/admin/organizations/:id/plan` | Platform admin | PLATFORM_ADMIN_EMAILS |
| POST `/feedback`, GET `/feedback/mine` | Send feedback (also visitors, 10/day, optional screenshot ≤ 3 MB as base64), own reports with replies | anyone / own |
| GET `/admin/feedback`, GET/PATCH/DELETE `/admin/feedback/:id`, POST `/admin/feedback/:id/reply` (`{ text, email? }`: also e-mail the author) | Feedback inbox | PLATFORM_ADMIN_EMAILS |

## API v1 for integrations (#101)

`/api/v1/...` serves the same handlers as `/api/...` and is the stable path for integrations. The description is at
`GET /api/v1/openapi.json` (OpenAPI 3.1, public, no data).

**Token scopes.** Create tokens under *Settings → API tokens*:

| Scope | Prefix | May use |
|---|---|---|
| Integration (default) | `cni_` | projects (list, create, read, new brief version), documents (incl. image description), requirements (read, confirm), credentials and models (read, never secrets), cost preview, council start, session list/view/events/report, cancel |
| Full access | `cns_` | everything the user's role allows, including approvals, builds, pull requests and keys (VS Code extension) – except creating/revoking tokens and managing the team, which need the web app (#403) |

Every handler that accepts an integration token opts in with `requireActor({ integration: true })`; all others refuse
it with 403 (fail closed). `apps/web/src/lib/server/actor.test.ts` pins the list, so widening it is a visible change.
Prefix and stored scope must agree. Releases before #101 accept only `cns_`, so a rollback refuses integration tokens
instead of giving them full access. Tokens created before #101 are full-access tokens.

**Starting a council.** `POST /api/v1/projects/:id/sessions` queues the council and returns `201 { session: { id } }`
at once; the run is asynchronous and survives worker restarts. Poll `GET /api/v1/sessions/:id` (or the SSE stream) until
`awaiting_approval`, `failed` or `cancelled`, then fetch `GET /api/v1/sessions/:id/report?format=json|md|pdf|docx`.
Send an `Idempotency-Key` header: the same key and body within 24 hours return the first session
(`200 { replayed: true }`), the same key with another body is `409`, a key whose first request is still running is
`409` (retry). A failed start releases the key. At most 10 starts per user and minute (`429`). Cancel stops new model
calls; calls already running finish and are billed by the provider.

**What goes to the AI providers.** Exactly what the council needs: the brief, the attached documents as text and the
confirmed requirements, sent with your own keys to the providers of the models you selected; nothing else of the
workspace. Provider-side retention follows the provider's API terms; CONSYRION AI stores the council (proposals,
evaluations, report) in the workspace until the project or workspace is deleted.

```bash
TOKEN=cni_...   # Settings → API tokens, "Councils only"
API=https://app.consyrion.com/api/v1
PROJECT=$(curl -s -X POST $API/projects -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Clinic SaaS","type":"architecture","brief":{"idea":"Scheduling SaaS for 120 clinics in Germany.","requirements":"Health data must stay in Germany."}}' | jq -r .project.id)
REQ=$(curl -s $API/projects/$PROJECT/requirements -H "Authorization: Bearer $TOKEN")
curl -s -X POST $API/projects/$PROJECT/requirements -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "$(echo "$REQ" | jq '{sourceHash: .proposal.source.hash, items: [.proposal.items[] | {text, candidateKey}]}')"
curl -s $API/credentials -H "Authorization: Bearer $TOKEN"     # credential ids
curl -s -X POST $API/projects/$PROJECT/sessions -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: clinic-saas-run-1' \
  -d '{"mode":"independent_expert","participants":[{"credentialId":"cred_…","modelId":"…"},{"credentialId":"cred_…","modelId":"…"}],"tokenBudget":400000}'
curl -s $API/sessions/ses_… -H "Authorization: Bearer $TOKEN" | jq .session.status
curl -s "$API/sessions/ses_…/report?format=md" -H "Authorization: Bearer $TOKEN"
```

Approving, choosing an alternative and building stay in the web app (human gate, #58).
