# Testing

| Package | Command | What is covered |
|---|---|---|
| `packages/core` | `pnpm --filter @consyrium/core test` | RBAC matrix, encryption (round trip, tamper, tenant binding, rotation), phase names, weights |
| `packages/db` | `pnpm --filter @consyrium/db test` | Real SQL on in-memory PGlite: migrations, org creation, tenant isolation, roles, brief versioning, credential storage |
| `packages/ai` | `pnpm --filter @consyrium/ai test` | Adapter contract tests with **mocked SDK clients**, retry policy, model discovery error isolation |
| `packages/council` | `pnpm --filter @consyrium/council test` | Full council runs on PGlite with **scripted test models** (test/scripted-adapter.ts): isolation of Independent Thinking, reveal, 11:1 security block, refuted/unresolved objections, failing model, budget stop, cancel, crash resume, mode differences, approval gate, more-debate cycle, tenant isolation, queue locking |
| `packages/build` | `pnpm --filter @consyrium/build test` | Execution Council with scripted engineers and a fake sandbox: approval and feasibility gates, DAG order, repair loop, reviews, resume of failed tasks, GitHub flow |
| `packages/github` | `pnpm --filter @consyrium/github test` | App JWT, webhook signatures, state, scoped tokens, snapshot and pull-request secret filters, draft PR without touching the base branch |
| `apps/web` | `pnpm --filter @consyrium/web test` | API error mapping, no leakage of internal errors, design-system components, execution status |
| `apps/web` (E2E) | `pnpm --filter @consyrium/web e2e` (CI job `e2e-auth`) | Auth flows in a real browser against the production build: sign-up, verification link, sign-in (verified/unverified/wrong password), sign-out, second account in the same browser, password reset ([apps/web/e2e/README.md](../apps/web/e2e/README.md)) |

## Real provider end-to-end tests
Run locally with the user's own keys on 26 Oct 2026 (BYOK; keys are entered by the user in the app, never in the
repository):
- **Full workflow:** decision → human approval → Execution Council → draft PR in a sandbox repository
  (tests reported "not run" – no Docker on that machine, shown as a warning by design).
- **Councils up to the Final Verdict:** Anthropic (Claude Haiku), DeepSeek, Z.ai GLM 4.7 and xAI Grok (grok-4.7,
  grok-4.20). Moonshot Kimi delivered proposals in a live council; OpenAI (gpt-4o-mini) was selected in a live test
  but a complete OpenAI council is not recorded here. Findings from these runs were fixed:
  GLM timeouts (#120, #123, #127), consensus summary vs. revisions (#105), honest failure status (#106), feasibility
  gate for contradictory requirements (#121), score rounding (#122), media models in discovery (#118).
- **Key check and model lists:** verified for all eight providers except Qwen. Google Gemini: key and live model list
  verified; one call to the retired `gemini-2.5-flash-lite` returned 404 (model choice, not an adapter fault).
- **Not yet run with a real key:** Qwen.

Add a key under *AI providers* and use **Check** and **Load models** (both are free – no tokens are generated). The *AI providers* page links to each provider's
key console (Anthropic, OpenAI, Google AI Studio, DeepSeek, Z.ai, Moonshot/Kimi, Alibaba Model Studio, xAI); API usage is prepaid and billed separately
from ChatGPT or Claude subscriptions.

## Manual verification (Milestone 1)
Screenshots of the running app are in `docs/screenshots/m1/`.

## Golden cases (evaluation harness, #33)
`packages/council/eval/` runs fixed decision scenarios through the real engine with deterministic models and
checks properties of the outcome (winner, tie, blocking objection, confidence, failed models). It runs in CI as
part of the council tests and prints a report with `pnpm --filter @consyrium/council eval`. Limits and how
to add cases: `packages/council/eval/README.md`.


## Reference set (#182)
Twelve synthetic briefs with human-reviewed gold labels measure whether real councils decide **correctly** (false
approvals and unnecessary blocks counted apart). Scoring is offline from exported Decision Report JSONs; live runs
need a budget approval. Study plan, hypotheses and protocol: `docs/reference-set.md`.

## Load and race tests (#510)
- Assistant: `apps/web/src/app/api/assistant/assistant-load.test.ts` – plan quota under parallel questions, council chat,
  token limit (measured, soft – #519), double click, abort, rate limit (details in `docs/assistant.md`).
- Council starts (scenario 6): `packages/council/test/council-start-load.test.ts` – six parallel starts on the last two
  free monthly slots: exactly two sessions start, every started session has exactly one booking in `plan_usage`
  (monthly run booked in the session's transaction under the workspace lock, #201). Local only, PGlite, test key.
