# Data model

Implemented tables (Milestone 1, `packages/db/src/schema.ts`, migration `drizzle/0000_*`):

| Entity (brief #58) | Table | Notes |
|---|---|---|
| User | `user` (+ `session`, `account`, `verification`) | Shape required by Better Auth |
| Organization | `organization` | Tenant root; slug unique |
| Membership | `membership` | Role enum owner/admin/member/viewer, unique per org+user |
| Project | `project` | Type and status enums, tenant-scoped |
| ProjectBrief | `project_brief` | Append-only versions, unique (project, version) |
| AIModel | `ai_model` | Cache of models discovered from provider APIs (filled from M2) |
| AIProviderCredential | `ai_provider_credential` | Encrypted secret, key version, hint, last check |
| AuditEvent | `audit_event` | Tenant-scoped, metadata sanitized of secret-like keys |

`AIProvider` is the enum `ai_provider_id` (anthropic, openai, google) because providers are code-level
adapters, not user data.

Milestone 2 adds (migration `drizzle/0001_*`): `council_session` (WorkflowRun + policy snapshot + budget),
`council_participant`, `council_role_assignment` (CouncilRole), `workflow_stage`, `proposal`,
`proposal_revision`, `debate_message`, `minority_objection`, `minority_review`, `consensus_result`,
`evaluation_score`, `vote`, `final_decision` (superseded versions kept), `human_approval`, `usage_record`,
`job` (durable queue). WorkflowDefinition is code (`MODE_POLICIES`, versioned by `POLICY_VERSION`); each
session also stores the `prompt_version` of the templates it ran with.

Requirement intake (#190, migration `drizzle/0022_requirement_lists`): `requirement_list` stores each confirmed
version of a project's hard requirements (items R1…Rn with source, excluded statements with reason, the brief id and
the source state with document hashes). `council_session`, `final_decision` and `human_approval` reference the list
version they belong to (`requirement_list_id`, null for older runs). See `docs/requirements-intake.md`.

## Execution, GitHub and SaaS (M4–M6, implemented)

| Milestone | Tables |
|---|---|
| M4 Build | `development_plan`, `development_task`, `agent_execution`, `code_artifact`, `test_run`, `code_review` |
| M5 GitHub | `github_integration` (plus repository columns on `project` and `development_plan`) |
| M6 SaaS | `plan_definition`, `subscription`, `invitation`, `api_token`, `model_price_hint` – no AI credits (BYOK only, #30) |

Design rules for all tables:
- Every row that belongs to a tenant carries `organization_id`.
- Results of model calls (proposals, revisions, messages, scores) are immutable; changes create new rows
  with a version number so reports can cite exactly what a model saw and said.
- Status fields are enums with explicit allowed transitions enforced in `packages/core`.
