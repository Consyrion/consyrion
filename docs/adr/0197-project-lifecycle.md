# ADR 0197 – Archiving and deleting a project safely

- Status: **accepted** (owner approval 08.11.2026) – PR 1 (archive) and PR 2 (two-phase delete) implemented
- Date: 08.11.2026
- Issue: #197 (follow-ups: #198 single sessions, #201 plan usage ledger – merged first, #206 privacy data map)

## 1. Question

How can a person with `project:delete` **archive** a project (reversible) or **delete** it for good, so that
- no running council, job or build keeps calling models on the user's key, writes data or retries forever after the
  deletion,
- nothing is left half-deleted (referential consistency),
- the person is told truthfully what is deleted and what is not (external copies, backups)?

## 2. Current state (main, 08.11.2026)

- **Archive** (`archiveProject`) sets `status = archived`. New councils are refused (`latestBrief`), but builds,
  approvals and deliveries of existing sessions still work, the decisions list still shows its sessions, and there is
  no way back (no unarchive). The project page offers no archive button (test council 08.11.26).
- **Delete** (`deleteProjectPermanently`) checks role, workspace and the typed name, then runs
  `DELETE FROM project` and relies on `ON DELETE CASCADE`. It does not look at running councils, queued jobs or builds.
  Jobs reference sessions/plans only in their JSON payload (no FK), so they stay queued; a worker in the middle of a
  model call writes into rows that are gone, fails on a foreign key and is retried up to `maxAttempts`.
- **Quota:** since #201 monthly runs are counted from the content-free `plan_usage` ledger, so deleting no longer gives
  runs back. Project slots still count active (not archived, not deleted) projects – intended.
- **Not under our control:** draft pull requests on GitHub, reports already sent by e-mail/Telegram/Confluence, provider
  logs, and backups until their retention ends (`deploy/hetzner/backup.sh`: local 14 days; the optional remote copy has
  no purge of its own).

## 3. Options

| | A – two-phase delete (recommended) | B – one synchronous transaction | C – archive + delayed purge |
|---|---|---|---|
| How | `status = deleting` at once; jobs of the project's sessions/plans are cancelled; workers check the status before every model call and every write; a purge job deletes once nothing runs | stop everything, lock, cascade-delete in one transaction | archive now, delete after N days |
| Race with a running model call | closed: the call's result is discarded, no write, no retry | open: the call returns after the delete | open until the purge |
| Idempotent / repeatable | yes (status + purge job keyed by project) | partly | yes |
| GDPR "delete now" | yes (minutes) | yes | no (N days) |
| Complexity | medium (status checks in two workers) | low | low, but a second policy |

**Decision: A.** It is the only option without a write-after-delete race and still deletes within minutes.

## 4. Design

### 4.1 States

`draft | ready` → (archive) → `archived` → (restore) → previous state; `draft | ready | archived` → (delete) →
`deleting` → (purge) → row gone. `deleting` is final: no restore.

| Action \ project state | draft/ready | archived | deleting |
|---|---|---|---|
| Start council, confirm requirements, edit brief | yes | **no** | no |
| Approve, select alternative, mark favourite, prototype | yes | **no** | no |
| Start or resume a build, publish a PR | yes | **no** | no |
| Read sessions, reports, export | yes | yes (marked "archived") | no (404) |
| Archive / restore | archive | restore | no |
| Delete | yes | yes | idempotent (204) |

Running councils of a project that is archived keep running to their verdict (archiving is not cancelling); the UI says
so before archiving and offers "stop running councils" as a separate, explicit step.

### 4.2 Delete (variant A)

1. `requestProjectDeletion` (role `project:delete`, typed name, session login only): in one transaction with the
   project row locked `FOR UPDATE`: set `status = deleting`, set every queued/running session to `cancel_requested`
   and every active plan to `cancel_requested`, mark their queued jobs `failed` ("project deleted"), enqueue one purge
   job `project.purge:<id>` (dedupe key = idempotency). Audit `privacy.project_deletion_requested` with counts only.
2. Workers: the council and build workers already re-read session/plan state between steps; they additionally refuse
   to start a model call or write when the project is `deleting` (one indexed lookup), end the job without retry and
   release reservations. A model call already in flight finishes at the provider (may be billed on the user's key –
   said in the dialog) but its result is dropped.
3. Purge job: waits until no job of the project is running (lock expiry respected), then `DELETE FROM project`
   (cascade), removes leftover sandbox workspaces of its plans, writes a minimal tombstone audit
   (`privacy.project_deleted`, project id, counts, no names or content). Retries are safe: a missing row is success.
4. Every read path (`getProject`, session view, reports, exports, SSE, assistant tools, MCP) treats `deleting` like a
   missing project (404) – no information leaks while the purge runs.

### 4.3 Archive

`archiveProject` / new `restoreProject` (role `project:delete`), visible on the project page. Archived projects are
listed under "Archive" on the projects page; the decisions list hides their sessions by default with a filter
"show archived". All write paths above check the project state on the server (one shared `assertProjectWritable`).

### 4.4 Dialog (with #206)

Before deleting, the dialog shows real counts (sessions, decisions, builds, documents, running jobs, sent reports,
draft PRs), requires the typed name and embeds `DeletionNotice` (#206): already running model calls may still be
billed by the provider; GitHub PRs, sent reports and backups (until their retention ends) are not deleted by CONSYRION.

### 4.5 Data

Migration: enum value `project_status = 'deleting'`. No new table and no job column: the request cancels queued
sessions/plans and their jobs (matched by `payload->>'sessionId'` / `payload->>'planId'`) and asks running ones to stop
through the existing `cancel_requested` path; the purge job (`project.purge`) checks the same and re-schedules itself
every 30 seconds while something still runs, at most `PROJECT_PURGE_MAX_WAIT_MS` (30 minutes), then deletes anyway.

## 5. Test matrix

| # | Scenario | Expected |
|---|---|---|
| 1 | Full project: 2 brief versions, confirmed list, 2 sessions, revisions, objections, verdict with matrix, approval, measurement, plan, code artifacts, test runs, usage, delivery log → delete + purge | no rows of the project left in any table (FK audit query over all tables), ledger unchanged |
| 2 | Delete while a council is queued | job failed, no model call, session gone after purge |
| 3 | Delete while a council waits on a slow model call; lock expires; worker restarts | no further model call, no write, no retry; purge completes |
| 4 | Delete while a build is queued / awaiting plan approval / running a task / in sandbox test / resumed | no new write, no GitHub push or PR, sandbox dir removed |
| 5 | Wrong name, viewer, member without `project:delete`, foreign workspace, API token | refused, nothing read or changed |
| 6 | Two delete requests at once; delete again after purge | one purge job; 204 then 404 consistently |
| 7 | Archived project: start council, confirm list, approve, favourite, start/resume build, publish PR | all refused; reading and export still work |
| 8 | Restore an archived project | writes allowed again; project slot counted again (refused if the plan is full) |
| 9 | Reads while `deleting`: project, session view, report, export, assistant, MCP | 404, no data |
| 10 | Audit entries | counts and ids only, no brief, prompt, document or key text |

Restore drill for backups (a restored backup must not resurrect deleted projects) is handled with #206 (deletion list
outside the backups, clean-up after restore).

## 6. Delivery

- PR 1 – archive made consistent: `assertProjectWritable` on every write path, restore, archive list and filter,
  archive/restore buttons on the project page. Tests 7, 8 (+ parts of 5).
- PR 2 – two-phase delete: status `deleting`, job cancellation, worker checks, purge job, dialog with counts and
  `DeletionNotice`, FK audit. Tests 1–6, 9, 10.
- #198 (single session delete, owner decision 08.11.26): always the whole session with every verdict, approval,
  measurement, build and delivery log (cascade) – never a single verdict, no session archive. The report export is
  offered first. A running council must be stopped and an active build cancelled before (`deleteSession` refuses
  otherwise, checked under a lock on the session row), so no purge phase is needed; queued jobs of the session are
  failed. Project, briefs, requirement lists, other sessions and the plan usage ledger stay. Session login only.

Both PRs are merged only after the owner approved this ADR. Cost: none (offline tests).
