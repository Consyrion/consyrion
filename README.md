# CONSYRION AI

**Multiple AI Minds. Better Decisions. Real Execution.**

CONSYRION AI lets several AI models analyse an idea independently, challenge each other, protect minority
positions and reach a documented decision. After human approval, coding agents implement the decision as
a reviewed pull request.

**Open source (AGPL-3.0), self-hosted, bring your own keys.** You run CONSYRION AI on your own machine or server
and connect your own API keys from Anthropic, OpenAI, Google, DeepSeek and others. AI usage is billed by those
providers directly to you; there is no hosted service, no account with us and no fee.

## Quick start (Docker)
Requirements: Docker with Compose, `openssl`.

```bash
git clone <this repository> consyrion && cd consyrion
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
  support (`docs/design/consyrion-futuristic-glassmorphism.md`)
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

- **VS Code extension** and personal API tokens (`docs/vscode.md`); Docker images, health endpoint, redacted logs,
  CSP and rate limits (`docs/deployment.md`, `docs/operations.md`, `docs/security-review.md`)


To look at every screen without provider keys, sign up locally and run
`pnpm --filter @consyrion/council seed:demo -- <your email>` while the dev server is stopped. It creates a
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
- [Design system](docs/design/consyrion-futuristic-glassmorphism.md) · [API](docs/api.md) · [VS Code](docs/vscode.md) · [Deployment](docs/deployment.md) · [Operations](docs/operations.md) · [Security review](docs/security-review.md) · [Release checklist](docs/release-checklist.md)
- [Self-hosting](docs/self-hosting.md) · [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md)
- Contributor and agent rules: [CLAUDE.md](CLAUDE.md)

## License
CONSYRION AI is free software under the [GNU Affero General Public License v3.0](LICENSE). You may use, change and
share it; if you offer a modified version to others over a network, you must make its source code available to them
under the same license.
