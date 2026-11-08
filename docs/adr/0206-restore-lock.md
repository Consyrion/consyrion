# ADR 0206 – Deleted data stays deleted after a backup restore

Status: **implemented** (deletion list, tombstones, scrub, restore.sh); was **accepted** (08.11.2026, coordinator; #206 part 3). Built after the production check; the call in
the delete functions only after the #197 ADR is approved. Agreed with the deployment owner (#525/#526: backup alarm, restore
test, encrypted offsite copies) and the #197 owner (#197: two-step project deletion, ADR 0197).

## Problem

Backups are kept for 30 days. Restoring a dump that is older than a deletion brings the deleted workspace or project
back, with its proposals, code, delivery connections and queued jobs. A queued job or a delivery could even run again.

A deletion list **inside** the database does not help: the older dump does not contain the newer entries.

## Decision

1. **Deletion list outside the dumps.** When a workspace or a project is permanently deleted, the app appends one line to
   `/opt/consyrion/deletions/deletions.log` (new volume, mounted into web and worker):
   `<ISO time> <kind: organization|project> <id>` – ids only, no names, no content, no user.
   Append-only, never rotated: one line per deletion is data-minimal and needed for as long as a backup could exist.
   The deletion also writes the same line to a `deletion_tombstone` table, so a restore can be checked both ways.
2. **Offsite copy.** The file is mirrored to the Storage Box by its own `rsync` line **without** `--delete` (as agreed
   with 1a: not part of `backup.sh`). The file is tiny.
3. **Post-restore scrub** – new `deploy/hetzner/post-restore-scrub.sh <target>`:
   - `<target>` is a container name (`consyrion-postgres-1`, or the throwaway container of `restore-test.sh`) **or** a
     PostgreSQL URL. Exit code 0 = clean, ≠ 0 = scrub failed (the caller must not start the app).
   - Reads `deletions.log` (local copy; falls back to the Storage Box copy when the local one is missing).
   - In one transaction: for every listed id that exists in the restored database, delete it (the existing FK cascades
     do the rest), delete queued `job` rows of those workspaces/projects first, insert the missing tombstones, write
     one audit entry `privacy.restore_scrubbed` (counts only).
   - Prints counts (`scrubbed organizations=1 projects=3`), never names.
4. **Callers.** A new `deploy/hetzner/restore.sh <dump>` (today a restore is a manual `pg_restore` from the runbook):
   stop web + worker → `pg_restore` → `post-restore-scrub.sh consyrion-postgres-1` → start. `restore-test.sh` (1a, #525)
   calls the scrub against its throwaway container before counting rows. `docs/hetzner.md` names `restore.sh` as the
   only supported restore; a manual `pg_restore` must be followed by the scrub.
5. **No resurrection side effects.** The scrub runs before web and worker start, so no job, delivery or council of a
   deleted workspace can run. #197's `deleting` status is covered: a project in `deleting` in the dump is deleted too.

## Files

`deploy/hetzner/post-restore-scrub.sh` + SQL, `deploy/hetzner/restore.sh` (new), `compose.yml` (volume), a small
`recordDeletion` in `packages/db` called from the delete/purge functions (coordinated with 83: only one call added),
`docs/hetzner.md`, `docs/privacy-data-map.md`. Not touched: `backup.sh`, `check.sh`, `restore-test.sh` (1a).

## Tests

- PGlite: delete a workspace and a project → line in the log and tombstone; restore an older snapshot (dump taken before
  the deletion) → scrub removes both, removes their queued jobs, leaves other workspaces untouched, is idempotent.
- Shell test like `rollback-guard.test.sh`: argument handling (container vs URL), missing log → clear error, exit codes.
- `restore-test.sh` on the server (1a) proves it end to end.

## Rollback and risks

- The scrub only deletes ids that were deleted by a user before; a wrong line could delete data → ids are random and
  written only by the delete functions; the scrub prints what it removed before committing in `--dry-run`.
- Losing `deletions.log` and its offsite copy → restored data may come back; the tombstone table in newer dumps is the
  second source. Documented as residual risk.
- Without the volume (self-hosted without the Hetzner compose) the app logs a warning once and only writes the table.

## Not decided here

Encryption and pruning of the offsite backups (#526, 1a). Legal retention questions stay with the operator.
