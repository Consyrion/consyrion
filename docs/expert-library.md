# Expert Library – role profiles (#270)

Stage 1 of the Expert Library. A **role profile** is a workspace's own, versioned addition to one of the twelve existing
12 Minds roles. It sharpens what that role looks at – it never adds a model, a vote or a reviewer.

## Content (`packages/core/src/role-profiles.ts`)

| Field            | Meaning                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `role`           | one of the 12 Minds roles (`COUNCIL_ROLES`); new roles are stage 2 (#446)                           |
| `name`           | name of the profile (no real persons)                                                               |
| `coreQuestion`   | the one guiding question                                                                            |
| `lenses`         | 3–8 concrete review lenses                                                                          |
| `notSuitableFor` | when this perspective is not the right one                                                          |
| `sources`        | up to 10: title, https link, status `verified` / `unconfirmed` / `outdated` / `own_statement`, date |

Rules checked on every save (`validateRoleProfileContent`): a `verified` source needs an https link and the date it was
checked; an `own_statement` has no link; unknown fields are reported, never stored; every text is scanned like skill
text (no keys or tokens, no e-mail addresses, no text that tries to change the council's rules).

## Visibility and versions (`packages/db/src/repositories/role-profiles.ts`)

- New profiles are **private** to their author. Sharing with the team needs an admin or owner. Another workspace never
  sees a profile ("not found").
- Versions are immutable; identical content creates no version. Deactivating hides a profile from new councils; the
  versions stay readable for councils that used them.
- Five **curated** profiles (`curated:<slug>`: security review, architecture fit, product value, cost control,
  verification) are read-only. They are the CONSYRION team's own assessment: no persons, no quotes, no links.
- `snapshotRoleProfiles` freezes the chosen profiles (at most one per role) for a council: id, version, content hash
  and content (`council_session.role_profiles`, migration 0044).
- Role profiles are part of the workspace data export (only what the exporting user may see).

## API

| Route                                  | Purpose                                                   |
| -------------------------------------- | --------------------------------------------------------- |
| `GET /api/role-profiles`               | curated, own private and team profiles                    |
| `POST /api/role-profiles`              | create `{ content, visibility? }` (private by default)    |
| `GET /api/role-profiles/:id[?version]` | snapshot of a version (also `curated:<slug>`)             |
| `PUT /api/role-profiles/:id`           | save `{ content }` as a new version (author)              |
| `PATCH /api/role-profiles/:id`         | `{ visibility }` – team sharing only by an admin or owner |
| `DELETE /api/role-profiles/:id`        | deactivate (author); councils keep the version they used  |

## In a council (part 3)

- Council setup: under the perspectives, "Role profiles (optional)" offers one profile per **active** role that has
  one (own, team or curated). Sent as `roleProfiles: [id, …]` with the session.
- `createSession` freezes the chosen profiles with `snapshotRoleProfiles` in `council_session.role_profiles` (version,
  hash, content). Refused: a profile for a role that is not active, two profiles for one role, a deactivated, foreign
  or unknown profile. A later edit or deactivation never changes a running or past council.
- The profile reaches **only its role's** 12 Minds review (and the security review of a hybrid proposal for a
  security profile) as an untrusted `<role_profile>` block after the role instruction (`roleProfileBlock`,
  `packages/council/src/prompts.ts`). `role_profile` is an untrusted wrapper tag (`packages/core/src/untrusted.ts`,
  #406): every profile text goes through `neutralizeWrapperTags`, so `</role_profile>` inside a profile cannot close
  the frame. Sources appear as title and status only; links are never fetched. Prompt version `2026-11-09.4`.
- Test: `packages/council/test/role-profiles.test.ts`.

## Suggested with the perspectives (#269)

The project suggestion in the council setup also suggests a profile per suggested role (only own/team profile, else the
curated one; none when several exist) and applies it only where no profile is chosen yet. See "Suggested perspectives"
in `docs/council-engine.md`.

## What a profile never changes

Number of independent models, votes and vote weights, the minimum of two foreign evaluators (#249), the requirement
gate, thresholds and the human approval. Three roles on one model stay one model.

## Status

- Part 1 (this): validation, tables, repository, curated profiles, export.
- Part 2: settings page **Settings → Role profiles** (`/settings/role-profiles`, en/de/fr/es/zh) and the API below. The
  page always states that a perspective is not an independent model; sources are shown as text with their status,
  never opened or fetched automatically.
- Part 3: the choice in the council setup together with the prompt (see below).
- Measurement with the golden set (with vs. without profile) runs live only with the owner's cost approval.
