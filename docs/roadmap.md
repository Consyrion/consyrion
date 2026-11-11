# Roadmap and status

| Milestone | Scope | Status |
|---|---|---|
| M1 Foundation | Monorepo, PostgreSQL schema, auth, RBAC, encrypted BYOK, provider adapters, design system, APIs, CI | Merged (PR #59) |
| M2 Decision Engine | Seven phases as workflow modules, three modes, budgets, reports, human approval | Merged (PR #60) – see docs/council-engine.md |
| M3 Ten UI screens | Issues #37–#46 connected to the backend | Merged (PR #61) |
| M4 Execution Council | Task planner, sandboxed coding agents, tests, reviews | Merged (PR #62) – see docs/execution-council.md |
| M5 GitHub workflow | GitHub App, branches, draft PRs, approvals | Merged (PR #63) – see docs/github-app.md |
| M6 Commercial SaaS | Plans, entitlements, usage, Stripe, team, privacy, admin (BYOK, no credits) | Merged (PR #64) – see docs/saas.md |
| M7 VS Code & production | Extension, API tokens, health, logging, CSP, rate limits, Docker, docs | Merged (PR #65) |

**Status 26 Oct 2026:** all milestones are on `main`. Live runs with real keys: a full decision → approval → build →
draft PR run, and councils with Anthropic, DeepSeek, GLM and xAI Grok up to the verdict (`docs/testing.md`). Fixes from
those runs and from external QA: #105–#107, #118, #120–#122, #30. An audit of the open issues against the code
(26 Oct) found #1, #7, #20, #23, #27, #35 and #55 complete; the "Remaining" columns below list what is still open.
Then still open: hosting (#100), API v1 (#101), Obsidian (#103), Stripe products (#29), trademark/launch (#48),
benchmarks with real keys (#33).

**Status 8 Nov 2026:** open source (AGPL-3.0, self-hosted, BYOK) since 3 Nov; the engine is public in
`packages/engine/src` (#188 superseded). Done since 26 Oct: hosting on Hetzner (#100, `docs/hetzner.md`, live at
app.consyrium.com since 10 Nov, renamed CONSYRIUM AI in #595), API v1 (#101, `docs/api.md`), Obsidian plugin (#103), Stripe plans (#29, `docs/saas.md`),
project archive and two-phase delete (#197, ADR 0197), plan usage ledger (#201), privacy data map, complete export and
restore lock (#206, `docs/privacy-data-map.md`, ADR 0206), follow-up round (#228/#229), measured requirements (#226).
Overall test #275 (ChatGPT + Claude) ran on 8 Nov: findings #477 (header vs. verdict card, fixed in #481/#508) and #478
(qualified proposal under "needs verification", answered by gate 2 – favourite/prototype – in #502); the next overall
test is planned in #479 (bypass, tenant isolation, limits). Still open: trademark/launch (#48), benchmarks with real keys
(#33, #182).

## Milestone 1 – issue coverage
| Issue | Covered | Remaining |
|---|---|---|
| #2 Monorepo scaffold | pnpm workspace, lint, typecheck, tests, env example, Docker Compose, CI, Prettier (#129) | – |
| #3 PostgreSQL schema | Foundation tables + migration | M2+ entities (see data-model.md) |
| #4 Auth, orgs, RBAC | Email/password + optional GitHub OAuth, personal workspace, roles | Invitations, org switcher UI, email verification |
| #5 Provider adapters | Anthropic, OpenAI, Gemini and OpenAI-compatible adapters (DeepSeek, GLM, Kimi, Qwen, xAI), live model discovery with media-model filter, deadline vs. cancel classification, streaming (assistant, #309) | Model cache table usage, real-key run with Qwen |
| #6 BYOK | Encrypted storage, check, delete, masked display | Re-encryption job, per-key usage limits |
| #13 Design system | Tokens (dark/light), shell, form controls, states | Component docs, icons, remaining screens |
| #36 Claude handoff docs | CLAUDE.md, architecture, security, testing, roadmap | – |

## Issue hygiene found during M1
- #19 duplicates #21 and #20 duplicates #22 (identical titles) – recommend closing #19 and #20.
- #1–#48 still name the domain `consyrion.ai`; #58 and the user's current brief use `consyrion.com`.

## Milestone 2 – issue coverage
| Issue | Covered | Remaining |
|---|---|---|
| #7 Workflow engine | Persistent stages, legal transitions, checkpoints, resume, cancel, durable queue | Pause/resume button (cancel exists) |
| #50 Independent Thinking | Parallel isolated calls, barrier, atomic reveal, failures recorded | – |
| #51 Open Council | Neutral comparison, questions/answers, no winner, server-side reveal check | – |
| #52 12 Minds Council | 1–12 configurable roles, structured critiques, preferences, rebuttals, bounded rounds | Moderator summary per round |
| #53 Minority Review | Objection entity, author response, independent adjudication, blocking gate, re-evaluation flag | User-submitted objections |
| #54 Consensus Round | Immutable revisions with motivation, hybrid with own review, consensus result | Visual diff (M3 UI) |
| #55 Final Verdict | Deterministic rubric, gates, ties, separate majority vote, report export, human actions | PDF export |
| #57 Modes & policy | Three modes with different orchestration, validated overrides, snapshot, preview | – |
| #12 Real-time events | SSE stream of real session state | – |
| #10/#8/#9 | Covered by the phases above | – |

Real-model end-to-end runs: done on 26 Oct 2026 – see `docs/testing.md`.

## Milestone 3 – issue coverage
| Issue | Screen | Covered | Remaining |
|---|---|---|---|
| #37 | `/projects/new` | Sources (idea, GitHub URL, example), validation, character counter, project type and goal, browser autosave, server draft, text document upload on the project page | GitHub App repository picker (M5), PDF/Word extraction |
| #38 | `/projects/[id]/council/new` | Live model registry per key, 2–6 models, mode cards, 1–12 roles with model assignment, rounds, hybrid, weights (validated to 100), token budget, session rules, call/token preview | Price-based cost estimate (needs user-entered prices) |
| #39 | Session → Independent Thinking | Real per-model status from usage records, tokens, blind-phase notice, stop button | – |
| #40 | Session → Open Council | Neutral cards, compare table, detail view, comparisons, Q&A; authors hidden until verdict | Architecture diagrams |
| #41 | Session → 12 Minds Council | Roles with models and progress, threaded critiques/rebuttals, categories, severity, round/proposal filters, preferences, transcript export | Upvotes, human questions/comments in the debate |
| #42 | Session → Minority Review & Consensus Round | Separate sections backed by separate stages and tables; objection statuses and blocking; revisions with change reasons and field diff; consensus result | – |
| #43 | Session → Evaluation | Matrix from stored scores with weights, spread, gates, evaluator count, vote points, per-score rationale drill-down | – |
| #44 | Session → Final Verdict | Outcome, recommendation, minority report, alternatives, risks, export, approval actions with reasons, history | PDF export |
| #45 | Session → Execution Council | M4: plan, task DAG with agents and status, files with code view, activity log, budget, stop, patch download | Live log streaming of container output |
| #46 | Session → Review & Tests | M4: readiness, every sandbox run with status/exit code/duration/output, AI code and security reviews | Coverage (only if measured), linting/dependency scan steps, PR link (M5) |

## Milestone 4 – issue coverage
| Issue | Covered | Remaining |
|---|---|---|
| #56 Execution Council | Approval gate, plan, DAG, agents, sandboxed tests, repair loop, reviews, patch | Draft PR (M5) |
| #20/#22 Task planner and DAG | Validated plan, dependency-ordered execution | Manual task editing |
| #23 Sandboxed runtime | Docker isolation (no network for tests, caps dropped, limits), no host fallback | Registry proxy for installs, gVisor |
| #24 Parallel agents | Concurrency for independent tasks, assignment over models, optimistic same-file conflict check (tested) | Separate worktree per task |
| #25 Independent review | Code-quality and security reviews by non-planner models, blocking on critical findings (`readiness.ts`) | Static security / dependency scanners |
| #26 Tests and repair loop | Install/test in sandbox, bounded repairs, honest "not run" | Lint, dependency scanning, coverage |

## Milestone 5 – issue coverage
| Issue | Covered | Remaining |
|---|---|---|
| #18 GitHub App | Installation with verified OAuth code + signed state, repo-scoped short-lived tokens, webhook signatures, reading existing pull requests with filtered diffs (#130) | App creation by the operator (manual, documented) |
| #21 Repository ingestion | Default-branch snapshot with dependency/binary/secret filtering and listing of skipped files | Code search/index, path+commit citations in proposals |
| #27 Pull requests and gates | Branch + single commit via Git Data API, draft PR, idempotent, owner/admin only, CI checks displayed | Issue linking in PR body, re-run on PR feedback |

## Milestone 6 – issue coverage
| Issue | Covered | Remaining |
|---|---|---|
| #29 Plans and billing | Editable catalog, server-side gates, Stripe checkout/portal/webhooks, manual assignment | Real Stripe products (needs your Stripe account), invoices page |
| #30 BYOK usage transparency | Per-model calls/tokens/failures, optional own prices for estimates, rotation/revocation, hard budgets (M2/M4), key deleted during a run handled and tested (#131); **no credits by design** | Per-member limits |
| #31 Privacy | Export without secrets, project/workspace deletion with confirmation, audit | Automatic retention periods, DPA templates, legal review |
| #4 (rest) | Invitations, roles, workspace switcher | Email delivery, email verification |

## Milestone 7 – issue coverage
| Issue | Covered | Remaining |
|---|---|---|
| #28 VS Code extension | Tree of projects/sessions, decision webview with approvals, report, diff of generated files, VSIX in CI | Marketplace publishing, test inside VS Code |
| #32 Observability | Health endpoint, redacted JSON logs, runbooks, SQL signals, backup guidance | Metrics exporter, alerting setup |
| #33 Evaluation harness | – | Council vs. single model benchmark (needs real keys) |
| #34 Release | Deployment guide, Docker images (built in CI), release checklist | Real end-to-end demo with keys, production rollout |
