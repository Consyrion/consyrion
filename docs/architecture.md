# Architecture

Status: Milestone 1. Decisions are recorded as short ADRs below; change them only with a new ADR.

## Overview

```
Browser ──► apps/web (Next.js App Router)
              ├─ server components / API routes ── requireActor() ──► packages/db repositories ──► PostgreSQL
              ├─ Better Auth (sessions, email/password, GitHub OAuth)
              └─ packages/ai adapters ──► Anthropic / OpenAI / Gemini APIs (BYOK)
packages/core: pure domain rules (phases, modes, RBAC, encryption) shared by all of the above
```

A **modular monolith**: one deployable web app with internal packages. Workers for long-running council
and coding jobs will be added as a separate process in Milestone 2 using the same packages.

## ADRs

**ADR-001 Modular monolith in a pnpm workspace.** Fast iteration, one deploy, clear package boundaries.
Microservices are not needed for the expected load; the boundaries allow extracting workers later.

**ADR-002 PostgreSQL + Drizzle ORM, PGlite for development.** Drizzle gives typed SQL and generated
migrations that are reviewed in PRs. PGlite (PostgreSQL compiled to WebAssembly) runs the same SQL without
Docker, also in tests, so integration tests hit a real database instead of mocks. Production requires
`DATABASE_URL`.

**ADR-003 Better Auth for authentication; own tables for tenancy.** Better Auth handles sessions,
password hashing and OAuth on our own database. Organizations, memberships and roles are our own tables
because authorization rules (who may approve a decision, who may manage keys) are core domain logic.

**ADR-004 Tenant isolation in the repository layer.** Every repository function takes an `ActorContext`
resolved from a membership row and filters by `organization_id`. Foreign IDs return `NOT_FOUND`, not
`FORBIDDEN`, to avoid tenant enumeration. Row-level security in PostgreSQL is a planned second layer.

**ADR-005 Envelope-style encryption for BYOK keys.** AES-256-GCM with a versioned master key from the
environment and associated data bound to organization and record. See [security.md](security.md).

**ADR-006 Official provider SDKs behind one adapter interface.** `ProviderAdapter` exposes
`listModels` and `generate` with structured JSON output, normalized usage and stop reasons. Model lists
come only from provider APIs. SDK-level retries are disabled; the orchestrator owns retries, timeouts and
budgets. Refusals are reported, never silently answered by a fallback model, because council answers must
be attributable to the selected model.

**ADR-007 Seven phases as data, not as UI headings.** Phase and mode identifiers live in
`packages/core` and will drive the workflow engine (Milestone 2, issues #7, #49–#57).

## Open architecture work (next milestones)
- Durable job queue and workflow runner for council sessions (#7, #12): candidates are a
  PostgreSQL-backed queue (pg-boss style) to avoid new infrastructure.
- Server-sent events for live progress (#12).
  The stream retries a failed read up to five times instead of ending; the session page loads the stored state and
  opens a new stream when the browser gives up on it, and reloads the state after 30 s without news (QA 07.11.26: the
  page showed "running" after the verdict was stored).
- Sandboxed execution for coding agents (#23) – requires an isolation decision before Milestone 4.
