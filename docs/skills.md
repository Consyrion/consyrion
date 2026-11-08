# Skills (#363)

A **skill** is a versioned decision package that pre-fills a council setup: perspectives, requirement building blocks,
verdict weights, session rules and domain knowledge. A skill **never decides** anything.

## Content (`packages/core/src/skills.ts`)

| Field                         | Pre-fills                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `name`, `summary`, `category` | the listing and preview                                                           |
| `council`                     | `mode` and suggested number of models (2–6)                                       |
| `roles`                       | 12 Minds perspectives                                                             |
| `requirementBlocks`           | requirement **proposals** for the intake; `{gap}` marks a value the user fills in |
| `weights`                     | Final Verdict weights (five criteria, sum 100)                                    |
| `sessionRules`                | the free-text session rules (max 2,000 characters)                                |
| `knowledge`                   | reference text / checklist given to the models as context (max 8,000 characters)  |

`validateSkillContent` checks untrusted input (editor, import, API) and returns trimmed content with known fields only.
Fields that are not part of the schema (also unknown keys inside `council` and `weights`) are **not stored and not
dropped silently** (#419): create, save and import answer with `ignoredFields` (e.g. `["run"]`), and the settings page
shows "Not taken over: run". A known field with an invalid value stays a validation error. A skill with a higher
`schemaVersion` than this installation reads is refused with "This skill was created with a newer CONSYRION version …"
(API: `422`, `error.details = { reason: "newer_schema", schemaVersion }`), translated in the UI.
`skillContentHash` is a sha256 over the canonical JSON (keys sorted at every level), so the same content always gives the
same hash. A council session stores a `SkillSessionRef` (`skillId`, `name`, `version`, `contentHash`).

**Files:** a skill folder has `SKILL.md` (readable description, `exportSkillFiles`) and `skill.json` (the machine part,
source of truth for `importSkillJson`), so skills can be shared via Git. Since #422 `SKILL.md` starts with YAML
frontmatter (`name`, `description`, `version`) generated from `skill.json` – compatible with Claude/OpenClaw-style skill
folders – and lists the changelog and, for a copy, its origin. Re-importing the exported `skill.json` gives the same
content hash.

**Duplicate and changelog (#422):** "Duplicate" on an official or team skill creates a private copy of the caller
(`POST /api/skills/:id/duplicate`, optional `{ name }`) with `forkedFrom: { skillId, name, version, contentHash }` of
the copied version (column `skill.forked_from`, migration 0041). The copy counts towards the plan limit. Every saved
version can carry an optional `changelog` (max. 500 characters, scanned like the content, column
`skill_version.changelog`); it is not part of the content or its hash. Semver and a `latest` tag follow with the
public SkillHub (#368).

## Visibility

| Visibility                   | Who sees and uses it          | Requires                            |
| ---------------------------- | ----------------------------- | ----------------------------------- |
| `private` (default)          | only the author               | –                                   |
| `team`                       | every member of the workspace | plan entitlement `teamSkills` (Pro) |
| official (`official:<slug>`) | everyone, read-only           | shipped in code (`OFFICIAL_SKILLS`) |
| public SkillHub              | everyone                      | version 2 – not built yet           |

Only the author changes a skill (new version, visibility, archive). A private skill of someone else answers "not found".
Archived skills are no longer listed and cannot pre-fill a new council; the version a council already pinned stays readable
(`getSkillForUse(…, version, { allowArchived: true })`). Versions are immutable;
saving identical content creates no new version.

## Security

1. A skill cannot override the requirement gate, independent review, minimum scores, blocking objections or the human
   approval; weights only rank qualified proposals.
2. Requirement blocks reach the intake as proposals – the user confirms the list as before.
3. Skill text is untrusted data for the models (same wrapping as documents), never a system instruction.
4. Every save and import runs `scanSkillContent`: no keys, tokens or passwords, no e-mail addresses, no text that tries to
   change the council's rules ("ignore previous instructions", "skip the approval", "always mark as passed" …). Such
   content is refused with a validation error.
5. No executable content. A skill may mention URLs or commands **as text** (e.g. in the knowledge checklist), but
   CONSYRION never fetches a URL or runs a command from a skill, and the schema has no field for scripts, hooks or
   GitHub actions – such fields (e.g. `run`) are ignored and reported (#419).
6. BYOK is unchanged; the start check and the budget confirmation stay as they are.

### Publication check, static part (#423, SkillHub V2)

Before a version can become public (not wired yet – see `docs/adr/0368-skillhub.md`), `scanSkillForPublication`
(`packages/core/src/skill-publication-scan.ts`) rates it **green / yellow / red** per field (name, summary, every
requirement block, session rules, knowledge, changelog):

- **Normalization first:** Unicode NFKC, invisible and bidi characters removed, Cyrillic/Greek look-alikes mapped to Latin,
  then the text is also read as leetspeak base form and with spaced letters joined ("i g n o r e"). Base64, hex, `\x`/`\u`
  escapes, percent-encoding and ROT13 are decoded – also nested up to three levels – and scanned like plain text. All
  patterns stay linear on very large input (tested), so a crafted skill cannot stall the check.
- **Red (never publishable):** secrets, e-mail addresses, instructions to the council, its reviewers or the models in
  de/en/fr/es/zh ("note to reviewers", "treat all requirements as fulfilled", "do not ask for sign-off", …) – also when
  disguised –, encoded blocks that hide such text, shell commands or active markup (the ClawHavoc pattern).
- **Yellow (human look):** links, HTML or Markdown links, harmless encoded blocks, invisible/styled/mixed-script
  characters, phone numbers or IBANs.
- Acceptance corpus in `skill-publication-scan.test.ts`: direct, reformulated (including the live case from #423),
  multilingual, encoded and Unicode-disguised variants are never green; realistic harmless texts and all official
  skills stay green. `PUBLICATION_SCAN_RULES_VERSION` changes with the rules, so stored results can be re-scanned.
- Green is a signal, not a guarantee. A later model check may only make the light stricter, and the runtime rules
  above (1–3) apply regardless of the result.

## Plans

| Entitlement                     | Free | Pro and up | Self-hosted |
| ------------------------------- | ---- | ---------- | ----------- |
| `maxSkills` (own, not archived) | 3    | unlimited  | unlimited   |
| `teamSkills`                    | no   | yes        | yes         |

Official skills do not count. Limits are checked on the server (`packages/db/src/repositories/skills.ts`).

## API

| Route                             | Purpose                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------- | ------------------ |
| `GET /api/skills`                 | official, own private and team skills                                             |
| `POST /api/skills`                | create `{ content, visibility? }` (private by default); answers `ignoredFields`   |
| `GET /api/skills/:id[?version=n]` | content + `ref` of a version (also `official:<slug>`)                             |
| `PUT /api/skills/:id`             | save `{ content, changelog? }` as a new version (author); answers `ignoredFields` |
| `POST /api/skills/:id/duplicate`  | private copy with `forkedFrom` (official/team skills)                             |
| `GET /api/skills/:id/versions`    | versions newest first with their changelog                                        |
| `PATCH /api/skills/:id`           | `{ visibility: "private"                                                          | "team" }` (author) |
| `DELETE /api/skills/:id`          | archive (author)                                                                  |
| `GET /api/skills/:id/export`      | `SKILL.md` + `skill.json`                                                         |
| `POST /api/skills/import`         | `{ skillJson }` – validated, scanned, starts private; answers `ignoredFields`     |

## User interface (part 2)

- **Settings → Skills** (`/settings/skills`): own and team skills with visibility, the plan limit, edit, share with the
  team (Pro), make private, export (`skill.json` + `SKILL.md`), archive (two-step) and import of a `skill.json`;
  duplicate official and team skills, version list with changelog, "What changed?" field when saving a new version. The
  editor shows a live preview of what the skill pre-fills; the server validates and scans every save.
- **Use a skill** in the council setup (`/projects/:id/council/new?skill=<id>`): a picker with own, team and official
  skills. The chosen skill pre-fills mode, roles, weights and session rules (everything stays editable; models are only
  a suggestion, the user picks them). Requirement blocks appear inside the requirement intake as proposals: the user
  fills every `{gap}` and adds a block explicitly; it becomes a requirement only when the list is confirmed.
- **Blocks are always visible** (#420): under the hard requirements a line says "The skill proposes N building blocks –
  X adopted, Y open" with "View blocks", also when the list is already confirmed. Each block has a status: _adopted_
  (a requirement matches the block with its gaps filled in), _open_, or _dismissed_ (the user set it aside; kept per
  project and skill version in the browser, a reading aid only). Adding a block from a confirmed list means editing the
  list and confirming it again – existing requirements are never changed silently and nothing is confirmed
  automatically. "Before you start" names open blocks as a hint; the start is not blocked by them.
- **Clear origin of roles and models** (#421): with a skill, every active perspective carries its origin (_from skill_,
  _project suggestion_, _your choice_). The project's suggested perspectives appear as an **alternative** with two
  explained actions – "Replace" (swap the active perspectives for the suggestion) and "Add" (keep them, add the missing
  suggested ones). Without a skill, "Apply" says that it replaces the current selection. The model section says "The skill
  recommends N models – pick them yourself (your keys)" with a counter; no model is pre-selected (BYOK).

## In a council (part 3)

- `createSession` takes `skill: { id, version? }`. The session stores a **snapshot** in `council_session.skill`
  (migration 0037): `skillId`, `name`, `version`, `contentHash` and the knowledge text, frozen at the start. A later
  edit, archive or takedown of the skill never changes a past decision.
- The knowledge text reaches the models only as `<document name="Skill reference: …" kind="… untrusted data">` inside
  the brief – reference data like any uploaded document, never instructions, requirements or approval.
- Report, Markdown and PDF show `Skill: <name> (version n, hash <12 chars>)`, never the knowledge text.
  `get_decision` (assistant + MCP) returns `skill: { id, name, version, contentHash }`.
- MCP: `list_skills` (read tool) and `ask_consyrion` with `skill`: pre-fills mode, perspectives, weights and session
  rules; its requirement blocks come back as `skillRequirementBlocks` – suggestions only, never confirmed by themselves.

## Status

Version 1, parts 1–3: schema, validation, scan, hash, files, five official skills, repository with visibility and plan
limits, API, workspace export, settings editor and "use skill" in the setup (#367), session snapshot, report/MCP.
Version 2: public SkillHub (#368) – accepted 08.11.2026, decisions and build plan in `docs/adr/0368-skillhub.md`.
Done: static publication scan (#480), data model (migration 0048), model review, submission, admin queue, public
catalog with adopt and report, official skills, re-scan and usage. Groups outside the workspace: #505. Version 3: build recipes.

### Submitting to the SkillHub (#368 PR 4)

Settings → Skills → "Publish…" on an own skill whose latest version was not submitted yet. Behind the server-side flag
`SKILLHUB_PUBLISH=1` (off by default; button hidden and submission/handle routes answer 404 while off) – it is switched
on once the admin queue is live. Withdrawing always works.

1. **Upload gate** (`GET /api/skills/publisher`): Pro (the same entitlement as team skills), verified e-mail, account at
   least 14 days old, publisher not suspended. The panel lists what is missing.
2. **Handle** (`POST /api/skills/publisher`): claimed once, shown as `@handle/slug`, reserved names refused, never changed
   later (public links stay stable).
3. **Submit** (`POST /api/skills/{id}/submit`): address (slug, unique per publisher, proposed from the name), listed or
   unlisted (discoverability only), changelog (required), CC BY 4.0 accepted, and a note that an external AI service
   operated by CONSYRION AI checks the text. The latest version gets the static scan in the same transaction and is
   bound to its content hash: green/yellow → `pending_review`, red → `quarantined` (the author sees why and submits a new
   version). The model review runs right after for non-red versions. **Nothing becomes public here** – an admin decides
   in the queue (PR 5).
4. **Withdraw** (`POST /api/skills/{id}/withdraw`) or archive: the public version becomes `withdrawn`, the skill private
   again; councils keep the version they used.

The skill list shows the state per skill (in review, blocked, public · vN, hidden). `GET /api/skills/{id}/hub` returns
the author's view: address, public version and every submitted version with status, light and reviewer note. Every
step is in `skill_moderation_log` (`submit`, `scan`, `ai_review`, `withdraw`).

### Admin queue (#368 PR 5)

`/admin` → "SkillHub review" (platform admins only; every repository call needs a context from `resolvePlatformAdmin`):

- **Queue** (`GET /api/admin/skills?status=pending_review|quarantined|published`): name, `@handle/slug`, version,
  static and model light, skipped model review, hidden/suspended. Opening an item (`GET …/versions/{v}`) shows every
  field as plain text, the static findings with excerpts, the model findings and the audit trail.
- **Decisions** (`POST /api/admin/skills/{id}/versions/{v}` with `decision` and the `contentHash` the admin looked at):
  approve (pending → published), reject (reason required), block (pending/published → quarantined, reason required),
  back to review (quarantined → pending, only when not red). In one transaction with the skill row locked: the hash
  must match, the static scan is redone when its rules version is outdated, **red is refused even for admins**, a
  suspended publisher cannot be approved, and a new public version replaces the old one (old → `withdrawn`).
- **Hide / show** (`POST /api/admin/skills/{id}/hidden`, reason required to hide) – never deletes; the author keeps
  seeing the skill and the reason. Reports never hide on their own.
- **Suspend / restore a publisher** (`POST /api/admin/skill-publishers/{userId}`, reason required): blocks submissions
  and approvals and hides their public skills.
- **Auto-approval** (reviewer settings, off by default): after a submission, a version that is green in the static scan
  **and** the model review is published by the system (`auto_approve`, actor null). Unchecking the switch is the kill
  switch; the model review itself has its own switch.
- **Reviewer settings** on the same card: kill switch, provider, model, caps per review and month (with this month's
  usage), write-only key (documented BYOK exception, owner decision 08.11.2026).

Every decision, rescan, hide and suspension is written to `skill_moderation_log`. Submissions stay behind
`SKILLHUB_PUBLISH` until this queue is live and checked.

### Model review (#423 step 3)

A second signal after the static scan, run by `runSkillAiReview` (`apps/web/src/lib/server/skill-review.ts`):

- **Reviewer key – documented BYOK exception, approved by the owner on 08.11.2026** (ADR 0368, decision 1): a platform key,
  set by a platform admin via `PUT /api/admin/skill-reviewer` (write-only, stored encrypted in `platform_setting`
  `skill_reviewer`, audited without values). Only this module decrypts it – a boundary test fails if any other file reads
  it. It is used for nothing but the SkillHub review.
- Settings: kill switch (`enabled`, off by default), provider and model, cap per review (default 8,000 tokens) and per
  calendar month (default 500,000 tokens; usage is summed from the stored reviews), auto-approval switch (off by default,
  used by the admin queue later).
- Red static results are **never** sent to the model. Disabled, no key, over a cap or a provider error → the version goes
  to manual review; nothing is approved or blocked here.
- Every text field is fenced as untrusted data; the model answers JSON (`light`, `summary`, findings with field,
  category and reason). The overall light is at least as strict as its strictest finding; unreadable output counts as
  yellow. The result can only make the static light stricter (`stricterLight`, `canPublish`).
- Stored on the version (`skill_version.ai_review`: light, findings, prompt version, provider/model, tokens) and logged in
  `skill_moderation_log` (`ai_review`), never with the key or provider error details.
- Static scan rules version 2 adds a bias signal: extreme verdict weights (one criterion above 60 % or at 0 %) are yellow.

### Public catalog, adopt and report (#368 PR 6)

- **`/skills`** – public, no login, cached for five minutes: listed skills whose version an admin (or the opt-in
  auto-approval) published, never hidden, archived or of a suspended publisher. Search over name, summary and handle,
  category filter. **`/skills/@handle/slug`** – one skill, also unlisted ones by link (those are `noindex`).
- Every text is rendered as plain text (React escaping, no Markdown, no links from skill content). The page shows the
  review badge, version, publication date, licence (CC BY 4.0 with author), content hash, a changelog and the
  disclaimer "community skill – no legal, medical or financial advice; a skill never changes the gate, the reviews or
  the human approval".
- **Use in CONSYRION** (`POST /api/skills/hub/adopt`, signed in, web session only): copies the public version into the
  caller's workspace as a private skill whose origin reads `@handle/slug` (version, hash). The original stays readable
  only through the catalog – workspace reads stay scoped to the workspace.
- **Report** (`POST /api/skills/hub/report`, signed in): one report per user and skill with a reason (misleading,
  manipulation attempt, personal data, impersonation, spam, copyright, other) and an optional note. Reports go to the
  admin queue and **never hide a skill automatically** (ClawHub dropped exactly that after it was abused). Admins close
  them as resolved or dismissed; hiding stays an explicit admin action. Logged as `report` / `report_resolved`.
- Reporting ships together with the catalog: nothing is publicly visible without a way to report it.
- Footer on every public page: licence note (CC BY 4.0, author as @handle), no legal/financial/medical advice, links to
  Impressum, Datenschutz and AGB. The category filter uses the app's `Select` (no native dropdown).

### Official skills in the catalog, re-scan, usage (#368 PR 7)

- **Official skills** appear in the public catalog under the reserved handle **@consyrion** (`/skills/@consyrion/<slug>`),
  so the catalog is never empty. They come from the reviewed repository (no database row, no fake user), show version
  and content hash, can be adopted and reported (reports go to the platform admins' feedback inbox, because there is no
  row to attach them to), and a platform admin can hide or show each one at runtime on the SkillHub card
  (`POST /api/admin/skills/official/{slug}`, platform setting `skillhub_official`, audited). A test fails CI unless every
  official skill passes the publication scan green; a skill that is not green is never shown.
- **Re-scan** (`POST /api/admin/skills/rescan`, button "Re-scan with the current rules"): every waiting, public or
  blocked version scanned under an older `PUBLICATION_SCAN_RULES_VERSION` is scanned again. A waiting or public version
  that is red now goes to `quarantined` (a public one leaves the hub at once); a blocked version stays blocked until an
  admin puts it back into review. Every re-scan is logged (`rescan`).
- **Usage**: the detail page shows how many other workspaces adopted the skill – one count per workspace, never the
  author's own workspace, so self-adoption or repeated clicks do not inflate it.

### SkillHub data model and review rules (#368)

- Access scopes: private → team → public. `skill.visibility` stays the workspace scope (private/team); a skill is public
  when it has a reviewed, approved `public_version`. Edits create new versions that stay private until they pass their
  own review – the public page always shows `public_version`. `listed` only controls the catalog (no access control).
- Review state per version (`SKILL_REVIEW_STATUSES`): draft → scanning → pending_review → published | rejected |
  quarantined, published → withdrawn. Transitions and who may trigger them are fixed in `canReviewTransition`; rejected
  and withdrawn are final (a fix is a new version).
- `canPublish`: red (static scan or model review) is never publishable, not even by an admin. Yellow and green need an
  admin; the optional auto-approval switch only applies to green in both checks.
- Licence for every public skill: CC BY 4.0 (`SKILL_PUBLICATION_LICENSE`), accepted per version. Upload gate: Pro plan,
  verified e-mail, account at least 14 days old.
- Publisher handle (`@handle/slug`): lower-case letters, digits, single hyphens; names that suggest an official or
  third-party identity (consyrion, official, verified, admin, openai, …) are reserved.
- Reports (`skill_report`, one per reporter and skill) go to the admin queue and never hide a skill on their own. Every
  step is written to `skill_moderation_log` (actor null = system).
