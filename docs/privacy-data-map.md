# Data map: where data lives, how long, and what deleting does (#206)

What CONSYRIUM AI stores, where, for how long, what the workspace export contains and what a deletion removes. It describes
the code on `main`, not legal advice; legal requirements (GDPR, Swiss nDSG) are for the operator to confirm. Two-step
deletion (archive → delete permanently, stopping running councils and jobs) is #197 ([ADR 0197](adr/0197-project-lifecycle.md)): deleting starts at once, the project is hidden and locked, running councils, jobs and builds are stopped and a clean-up job removes the data, usually within seconds to minutes.

## Places

| Place                                    | What                                               | How long                                                | Deleted by CONSYRIUM AI? |
| ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- | ------------------------ |
| PostgreSQL (active database)             | accounts, workspaces and everything they produce   | until the user deletes it (project, workspace, account) | yes, see below           |
| Backups on the server                    | daily `pg_dump` and one before every deploy        | 30 days (`deploy/hetzner/backup.sh`)                    | yes, automatically       |
| Backup storage (Hetzner Storage Box, FI Helsinki, EU) | age-encrypted copies of the server backups, uploaded without `--delete` (#526) | 30 days – own prune on the box by the date in the file name | yes, automatically       |
| Sandbox containers                       | a copy of the repository while a build task runs   | removed when the task ends                              | yes                      |
| Model providers (BYOK)                   | prompts and answers of council calls               | the provider's API terms, under the user's own key      | no – provider account    |
| GitHub                                   | draft pull requests and branches the build created | until closed/deleted in the repository                  | **no**                   |
| E-mail, Telegram, Confluence             | reports sent by "Send decision"                    | with the recipients                                     | **no**                   |
| Downloads                                | JSON export, PDF/DOCX reports                      | wherever the user stored them                           | **no**                   |

The backup contains provider keys only encrypted; the master key is not in the backup. The dumps themselves are not yet
encrypted on the backup storage – planned in #526.

## Deleting a project (`deleteProjectPermanently`)

Removed by database cascade: the project, briefs, documents, requirement lists, all council sessions with participants,
role assignments, phase stages, proposals and revisions, debate messages, minority objections and reviews, consensus
results, votes, evaluation rounds and requirement checks, final decisions, approvals, measurement results, development
plans and tasks, agent runs, code artifacts, test runs, code reviews, usage records and delivery logs of those sessions.

Stays: the workspace's audit log (short entries – action, actor, time, ids; no proposal content) and one
`privacy.project_deleted` entry; assistant chats of the workspace (they belong to the workspace, not to a project);
the plan usage ledger (#201: kind, amount and run id only, so deleting does not give back a month's runs);
everything outside the database (table above).

## Deleting a workspace (`deleteOrganization`)

Removed by cascade: every table with an `organization_id` – projects and all of the above, provider keys (encrypted),
GitHub integration, delivery connections and Telegram requests, invitations, API tokens (also those of connected apps), OAuth authorization codes, idempotency keys, jobs,
subscriptions, model price hints, skills and role profiles of the workspace, assistant chats/usage/preferences, and the
workspace's audit log. Memberships end; user accounts stay.

Stays: one audit entry `privacy.organization_deleted` without workspace (who, when, which id – no content); the users'
own feedback reports, including reported assistant excerpts (personal data of the account, the workspace link is cleared); backups for up to 30 days; external
copies.

## Export (`exportOrganization`, Settings → Workspace)

Owner only, one workspace only, format version `exportFormat` (2 since #206). It contains the whole workspace record –
projects, councils with phases, votes, reviews, evaluation rounds and checks, builds, integrations, delivery connections
and logs, usage, skills, role profiles, audit log – and the exporting user's own assistant chats and feedback. Left out on
purpose: secrets (encrypted keys and delivery secrets, invitation and API token hashes, auth data), the internal job
queue and platform tables. `EXPORT_COVERAGE` in `packages/db/src/repositories/privacy.ts` lists every table as exported
or excluded with the reason; a test fails when a new table is missing there.

## Restoring an old backup (ADR 0206)

A restore from a backup older than a deletion would bring the deleted workspace back. The fix
([ADR 0206](adr/0206-restore-lock.md)): every permanent deletion appends a line to a deletion list outside the database
backups, and a clean-up step removes the listed data again after every restore, before the app starts (`deploy/hetzner/restore.sh`, `post-restore-scrub.sh`). The list holds
**only ids and the time – no names, no content, no user**. It is therefore kept without a deletion period, also on the
backup storage: it contains no personal content, and it is needed for as long as any backup could be restored.

## In the app

The delete sections of a project and of a workspace show this in short (`components/deletion-notice.tsx`); the privacy
policy (`/datenschutz`) names the backup period and external copies.

- `human_intervention` / `human_intervention_answer` (#15/#41): a person's questions to the council after the verdict and the models' answers; part of the session, deleted with it, in the workspace export.
