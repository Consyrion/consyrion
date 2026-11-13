# CONSYRIUM AI

**Multiple AI Minds. Better Decisions. Real Execution.**

CONSYRIUM AI lets several AI models analyse an idea independently, challenge each other, protect minority
positions and reach a documented decision. After human approval, coding agents implement the decision as
a reviewed pull request.

**Open source (AGPL-3.0), self-hosted, bring your own keys.** You run CONSYRIUM AI on your own machine or server
and connect your own API keys from Anthropic, OpenAI, Google, DeepSeek and others. AI usage is billed by those
providers directly to you; there is no hosted service, no account with us and no fee.

## Quick start (Docker)

Requirements: Docker with Compose, `openssl`.

```bash
git clone <this repository> consyrium && cd consyrium
deploy/selfhost/init.sh                                   # writes deploy/selfhost/.env with fresh secrets
docker compose -f deploy/selfhost/compose.yml up -d --build
```

Open http://localhost:3000, create an account and add your provider keys under
**AI providers**. Details, updates, backups and running it on a server: [docs/self-hosting.md](docs/self-hosting.md).

## What works today

- Sign-up / sign-in (email + password, optional GitHub OAuth), sessions via Better Auth
- Personal workspace per user, organizations with roles owner / admin / member / viewer
- Projects with versioned, immutable briefs; tenant isolation; audit log
- Bring-your-own-key for Anthropic, OpenAI, Google Gemini, DeepSeek, Z.ai (GLM), Moonshot (Kimi), Alibaba (Qwen) and xAI (Grok),
  encrypted with AES-256-GCM
- Key check and live model discovery from the providers' own model endpoints
- Futuristic glassmorphism design system (ink navy, cyan/emerald/violet), original animated Electric Logo,
  public homepage at `/` as a scroll-driven 3D process story (`docs/design/homepage-story.md`), sign-in with
  three 3D spheres orbiting the original logo, component gallery at `/design`, light mode, reduced-motion
  support (`docs/design/consyrium-futuristic-glassmorphism.md`)
- **Council sessions** with the seven phases, three modes, token budget, live progress, minority review,
  deterministic verdict with a separate feasibility gate (a finding that the requirements conflict is never
  approvable or buildable), human approval and Markdown/JSON report (`docs/council-engine.md`)
- Project wizard with document upload (text, PDF, Word, PowerPoint, images described first – `docs/documents.md`), AI team configuration and one screen per phase (#37–#46)
- **Requirement intake** (#190): before a council starts, the server proposes the hard requirements from the brief
  and documents, the user edits and confirms them (R1…Rn, excluded statements with a reason), and a council only
  starts on a list confirmed for the current brief version and documents; verdict, approval and build are bound to
  that list version (`docs/requirements-intake.md`)

- **Execution Council** after approval: plan, coding agents, tests in a Docker sandbox, repair loop, AI reviews,
  patch download (`docs/execution-council.md`)

- **GitHub App**: connect repositories, start from the default branch, publish draft pull requests, show CI
  (`docs/github-app.md`)

- **Workspaces**: team invitations, workspace switcher, data export and deletion; self-hosted installations
  (`SELF_HOSTED=true`) have no plans or limits. Optional hosted-service mode with plans and Stripe (`docs/saas.md`)

- **VS Code extension** and personal API tokens (`docs/vscode.md`); **Obsidian plugin** – selected note text to a
  council, report as a new note (`docs/obsidian.md`); Docker images, health endpoint, redacted logs,
  CSP and rate limits (`docs/deployment.md`, `docs/operations.md`, `docs/security-review.md`)

To look at every screen without provider keys, sign up locally and run
`pnpm --filter @consyrium/council seed:demo -- <your email>` while the dev server is stopped. It creates a
session from scripted test models, clearly labelled as demo data.

## Local development

Requirements: Node.js 24, pnpm 10 (`corepack enable pnpm`). Docker is optional.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
# fill BETTER_AUTH_SECRET and CREDENTIALS_MASTER_KEY_V1 with `openssl rand -base64 32`
pnpm dev
```

Without `DATABASE_URL` the app uses embedded PGlite (real PostgreSQL in WebAssembly) in `.data/pglite`
and migrates it automatically. Only one process may open that directory at a time. For PostgreSQL:
`docker compose up -d`, set `DATABASE_URL=postgres://consyrion:consyrion@localhost:5432/consyrion`, then
`pnpm db:migrate`. Production refuses to start on PGlite.

## Quality

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

CI runs the same steps plus a check that the committed migrations match the schema.

Formatting: Prettier (`.prettierrc.json`, 160 columns, double quotes, semicolons, trailing commas). Format the files
you change – `pnpm format <files>` / `pnpm format:check <files>`. The existing code is not reformatted in one go
(that would touch over 100 files); files converge as they are edited.

## Documentation

- [Concept](docs/KONZEPT.md) · [Architecture](docs/architecture.md) · [Data model](docs/data-model.md)
- [Security: credentials & tenancy](docs/security.md) · [Testing](docs/testing.md) · [Roadmap](docs/roadmap.md)
- [Council engine](docs/council-engine.md) · [Engine](docs/engine.md) · [Requirement intake](docs/requirements-intake.md) · [Execution Council](docs/execution-council.md) · [GitHub App](docs/github-app.md) · [SaaS](docs/saas.md)
- [Design system](docs/design/consyrium-futuristic-glassmorphism.md) · [API](docs/api.md) · [VS Code](docs/vscode.md) · [Obsidian](docs/obsidian.md) · [Deployment](docs/deployment.md) · [Operations](docs/operations.md) · [Security review](docs/security-review.md) · [Release checklist](docs/release-checklist.md)
- [Self-hosting](docs/self-hosting.md) · [Feedback inbox](docs/feedback.md) · [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md)
- Contributor and agent rules: [CLAUDE.md](CLAUDE.md)

## License

CONSYRIUM AI is free software under the [GNU Affero General Public License v3.0](LICENSE). You may use, change and
share it; if you offer a modified version to others over a network, you must make its source code available to them
under the same license.

## Languages

The interface is available in English, German, French, Spanish and Chinese (`apps/web/messages/*.json`, next-intl,
no locale in the URL): the user's choice is stored in the `consyrium-locale` cookie, otherwise the browser language
is used. Adding a language = one messages file plus an entry in `apps/web/src/i18n/locales.ts`; a test checks that
every file has the same keys, placeholders and list lengths as English. The seven phase names stay the canonical
product names in every language. The language the models write in is a separate per-council setting (planned).
German texts use "ß" (standard German, QA 12.11.26 normalised the mixed "ss"/"ß"); addresses keep their own
spelling. Page titles and descriptions follow the page language too, and an unknown address shows a translated 404 page
with a way back (`app/not-found.tsx`).

**Long lists (QA 12.11.26).** Projects and Decisions have a search (name; for sessions also the mode) and filter chips
(project type / session status) with counts that follow the search – a plain GET form (`components/list-filter.tsx`),
so a filtered view has its own URL. The dashboard tiles "Awaiting approval" and "Running" open the filtered list
(`/decisions?status=awaiting_approval`), or the session itself when there is exactly one.

## AI assistant

A collapsible chat panel on every page answers questions about your workspace (open steps, decisions waiting
for approval, customer summaries) on your own API key, with read-only tools and stored private chats. It can also
suggest actions (draft a project or brief, propose requirements, prepare a council, write a customer or Slack/Teams/e-mail
text) as cards you run, edit or dismiss – nothing happens without your click, and it can never approve, start, delete or
change settings – see `docs/assistant.md`.

## MCP server

Use CONSYRIUM AI from Claude Code, Claude Desktop, Cursor or VS Code: `POST /api/mcp` with an API token (Pro and up on
the hosted app, always when self-hosted). Read decisions, prepare projects and requirements, start councils on your own
keys with a budget limit – approving, building and deleting stay in the app. See `docs/mcp.md`.

**Demo project:** every workspace gets one read-only copy of a finished council chosen by the platform admin, so new customers see a decision before spending a token. See `docs/demo-project.md`.

## Questions over Telegram

Your own Telegram bot can take decision questions: `/frage …` with `- ` requirement lines → tap Start → council on your
keys → the verdict comes back to the chat. Private chat only, Pro on the hosted app – see `docs/telegram.md`.

## Feedback inbox

Users report bugs, wish features or get in touch from the sidebar ("Feedback & bugs") or, without an account, from
the landing page footer (`/feedback`, e-mail required, honeypot, 10 messages per day). Reports land in the platform
admins' inbox under `/admin/feedback` (filter, details, status, reply, delete) and – with `ADMIN_EMAILS` and SMTP
configured – also by e-mail. Users read the answers under Settings → My reports – see `docs/feedback.md`.
