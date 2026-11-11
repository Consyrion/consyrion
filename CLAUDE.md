# CLAUDE.md – Consyrium

Guidance for Claude Code (and humans) working in this repository. Keep it short and current.

## Product
**CONSYRIUM AI** is an open-source (AGPL-3.0), self-hosted, bring-your-own-key multi-model decision and development platform: several AI
models think independently, challenge each other, protect minority views, reach a documented verdict and –
only after human approval – implement it as a reviewed pull request.

- Name: company and product are both **CONSYRIUM AI** – use exactly this in visible UI text, titles and assets
  (code identifiers, package names and file names stay `Consyrium*`). No other company name.
- Canonical brief: issue #58 (supersedes older naming in #1–#48: the domain is **consyrium.com** since the rename on 10 Nov 2026).
- Product areas: Consyrium Decision, Consyrium Build, Consyrium Workspace.
- The seven phases, exact names everywhere (code: `COUNCIL_PHASES` in `packages/core/src/phases.ts`):
  Independent Thinking, Open Council, 12 Minds Council, Minority Review, Consensus Round, Final Verdict, Execution Council.
- Modes: Independent Expert, Adversarial Review, Consensus. Modes must change orchestration, not just labels.

## Repository layout (pnpm workspace)
| Path | Purpose |
|---|---|
| `apps/web` | Next.js 16 App Router UI + API routes, Better Auth, Tailwind 4 design tokens |
| `packages/core` | Pure domain logic: phases/modes, RBAC, credential encryption, domain errors |
| `packages/db` | Drizzle schema, migrations (`drizzle/`), tenant-scoped repositories |
| `packages/ai` | Provider adapters (Anthropic, OpenAI, Gemini), model discovery, retry/timeout |
| `packages/council` | Decision engine: seven phases, job queue, session service, decision report |
| `packages/build` | Execution Council: plan, coding tasks, sandbox, repair loop, reviews, patch export |
| `packages/github` | GitHub App auth, repository snapshot, draft pull requests, checks |
| `packages/engine` | Engine contract (`contract.ts`) and implementation (`src/`): verdict, requirement gate, prompts |
| `packages/billing` | Stripe checkout/portal/webhooks for the platform subscription |
| `apps/vscode` | VS Code extension (API token, decisions, approvals, diffs) |
| `apps/obsidian` | Obsidian plugin (selected note text → council → report as a new note; integration token) |
| `apps/worker` | Council worker process for PostgreSQL deployments |
| `docs/` | Architecture, security, testing, data model, concept, screenshots |

## Commands
```
pnpm install
pnpm dev            # http://localhost:3000, embedded PGlite in .data/pglite
pnpm test           # all unit/integration tests
pnpm lint && pnpm typecheck
pnpm format <changed files>   # Prettier, 160 columns; never reformat untouched files
pnpm db:generate    # after changing packages/db/src/schema.ts – commit the migration
pnpm build
```

## Rules
- Every tenant-scoped query goes through a repository that takes an `ActorContext` (from `resolveActor`)
  and checks a permission with `assertCan`. Never query tenant tables by id alone.
- Provider API keys: only via `createCredential`/`decryptCredentialForUse`. Plaintext keys never reach the
  client, logs, audit metadata or error messages.
- No invented data: model lists come from provider APIs; never hardcode model names, prices, scores,
  progress or test results as if real. Mocks live in `packages/ai/src/testing` and are labelled.
- Features of later milestones appear in the UI only as clearly marked "planned" items.
- Generated code runs only in the container sandbox – never add a host execution fallback.
- BYOK only (issue #30): never add AI credits, token resale or an operator-owned fallback key.
- No automatic merge to main, no production deploy and no paid resources without explicit user approval.
- Work on feature branches, open PRs that link issues, close issues only when acceptance criteria are met.
- Code comments in English. Document every feature in README/docs in the same PR.

## Status
Milestones 1–7 implemented (Execution Council: `docs/execution-council.md`) (engine: `docs/council-engine.md`) – see `docs/roadmap.md` for what is done and what is next.
