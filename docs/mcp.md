# MCP server (06.11.26)

CONSYRIUM AI can be used from any MCP client – Claude Code, Claude Desktop, Cursor, VS Code, … – through a
**Model Context Protocol** server built into the app. Hosted (app.consyrium.com): **Pro and up** (plan entitlement
`mcp`, editable in /admin); self-hosted: always on.

## Connect

- Address: `https://<your domain>/api/mcp` (Streamable HTTP, stateless; POST with JSON-RPC, answers as JSON).
- Auth: an API token from **Settings → API tokens** as `Authorization: Bearer …`.
- Claude Code: `claude mcp add --transport http consyrium https://app.consyrium.com/api/mcp --header "Authorization: Bearer <TOKEN>"`
- OAuth sign-in (needed for claude.ai and ChatGPT connectors) is the next stage and not built yet.

## Tokens and tools

| Token                                                                | Tools                                                                                                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `cnr_` **Read only** (new; MCP only, refused by every REST endpoint) | `list_projects`, `list_decisions`, `get_decision`, `list_open_steps`, `list_models`, `get_requirements`, `preview_council`, `list_skills` |
| `cni_` Councils only / `cns_` Full access                            | the read tools + `ask_consyrium`, `create_project_draft`, `update_brief`, `propose_requirements`, `start_council`                         |

## Ask for a decision while working: `ask_consyrium`

Someone coding with Claude (or Cursor, VS Code …) hits a decision – "PostgreSQL or SQLite?", "queue or cron?" – and
asks CONSYRIUM in **one call**: `question`, `context`, optional `options`, `requirements`, `tokenBudget` (required,
max 1,000,000), optional `participants`/`mode`. CONSYRIUM creates a ready project (type technology choice), confirms the
requirement list **from the user's own requirement lines** (sentences of question/context stay context; statements
that look like instructions to the models are refused, never auto-decided), starts the council and returns the
`sessionId` at once. The client then calls `get_decision` (phase, tokens, and at the end the verdict).

- The client asks the user before running the tool – that approval is the human confirmation of the requirements
  (audit `mcp.decision_requested`, `confirmedVia: "mcp"`, `packages/db/src/repositories/client-requests.ts`).
- Without `participants` the models of the workspace's last council are used.
- Optional `skill` (id from `list_skills` or `official:<slug>`): pre-fills mode, perspectives, weights and session
  rules and is pinned (version + hash) in the verdict. Its requirement blocks come back as `skillRequirementBlocks` –
  only suggestions; put the ones the user confirms into `requirements` (docs/skills.md).
- Optional `files` (#331): up to 20 `{ path, content }` excerpts the decision is about – the code to change, its tests,
  `package.json` – at most 200 kB together, text only. They become **one context document** ("Files from MCP (n).md",
  `role: "context"`, origin `{ kind: "client", client: "mcp", paths }`, audit `document.client_files`): every model
  reads it as untrusted `<document>` data, it is never scanned for requirements, and the requirement list is confirmed
  against it. Without such excerpts requirements like "existing tests stay green" cannot be verified and the verdict
  ends as _needs verification_ (developer test 07.11.26). The response lists them as `filesAttached`. The client should
  tell the user which files it sends and never send secrets (`.env`, keys). The server enforces this too: files
  named like secrets (`.env*` except `.env.example`, `id_rsa`, `*.pem`/`*.key`, `credentials.json`, `.npmrc` …) and
  content with API keys, tokens or private keys are refused before anything is stored. A request refused after the
  project was created (e.g. instructions among the requirements) archives that project with its files.
- Approving or building the verdict stays in the app; for advice the verdict itself is the answer.

- Every tool runs with the token owner's actor and the same repository functions as the app (`apps/web/src/lib/server/mcp-tools.ts`):
  only that workspace, same permissions, plan limits and audit (`mcp.action_executed`). Write tools go through the
  assistant's allowlist (`runActionForClient`, `packages/db/src/repositories/assistant-actions.ts`): projects only as
  draft, requirements unconfirmed until the user confirms the list in the app.
- `start_council` costs tokens on the workspace's own keys (BYOK): `tokenBudget` is required and at most
  **1,000,000** (`MCP_MAX_TOKEN_BUDGET`); needs a current confirmed requirement list; rate limit 5/min. The client
  should call `preview_council` first and tell the user the estimate.
- **Daily budget (#405):** `start_council` and `ask_consyrium` are refused once what this user's **client-started**
  councils of the last 24 hours (MCP, Telegram, REST with an API token – marked by the audit event
  `client.council_started`; councils started in the web app never count) **really used** – finished councils with their recorded
  usage, queued or running ones with their full budget – plus the new one exceed **5,000,000** tokens
  (`MCP_DAILY_TOKEN_BUDGET` on the server). Until 08.11.26 (#429 live finding) finished councils counted their whole
  budget, which hit the limit far too early. A prompt-injected agent can thus spend at most one
  day's budget of the user's keys. Councils started in the web app are not limited by it.
- **Batches (#405):** a JSON-RPC batch holds at most 20 messages, and every message counts against the limit of
  120 requests per minute and user – a batch does not multiply what one request may do.
- **Never over MCP:** approve/reject, builds, delete/archive, confirming requirements, keys, billing, settings,
  members, tokens.
- **Who confirms requirements (#405):** only the human. Over MCP that is the user's approval of the `ask_consyrium`
  call, which carries the requirement lines (the client must show them first); `propose_requirements` never confirms.
  Over REST an integration token may confirm a list (`POST /api/projects/:id/requirements`, #101) only for an
  integration that shows the list to its user first – an agent must never confirm on its own.
- Write tools carry `readOnlyHint: false` so clients ask the user before running them.

## Protocol

`apps/web/src/lib/server/mcp.ts`: `initialize` (versions 2025-11-25, 2025-06-18, 2025-03-26), `ping`, `tools/list`,
`tools/call`; notifications → 202. No sessions, no SSE stream (GET → 405), no resources/prompts. Errors: 401 with
`WWW-Authenticate: Bearer`, 403 without Pro. Tool errors come back as `isError` results with the domain message only.

## Tests

`apps/web/src/lib/server/mcp.test.ts` (protocol, 401/403, Pro gate, tool sets per scope, nothing that approves,
builds or deletes, draft creation, budget limit), `actor.test.ts` (read-only token refused by REST endpoints).

### Requirements of an `ask_consyrium` call (QA 07.11.26)

Only the `requirements` lines the user gave are confirmed as hard requirements. Sentences of `question` and `context`
stay context even when they sound binding ("max. 50 users"): this flow confirms without a review screen, so they are
stored as excluded ("context of the question"). The same applies to `/frage` in Telegram. Invalid tool input names the
fields (`Invalid session configuration – participants: …`).
A refused `ask_consyrium` start (budget not confirmed, unknown model, plan limit) archives the project it created, so a
retry does not leave a duplicate behind; Telegram `/frage` behaves the same.

### What was decided – for the editor agent (07.11.26)

`get_decision` also returns `decided`: the chosen proposal in full – the one the human approved, else the council's
recommendation, else the best-scored (leading) one – with architecture, components, advantages, disadvantages, risks
with mitigations, cost estimate, assumptions and next steps, plus the hard requirements with their check status
(PASS/FAIL/UNKNOWN/DISPUTED) and the open objections against it. `implementationBrief` is the same as Markdown, ready for
an agent in Cursor or Claude Code to implement in the local project. `decided.basis` says how binding it is:
`approved_by_human`, `recommended_awaiting_approval` or `leading_not_approvable` – the tool description tells the agent to
ask the user before implementing anything but an approved decision. Approval itself stays in the app.

- `verdict.approvable` (get_decision, session status): true only when something can be approved now – the
  recommendation or an alternative. A `no_qualifying_solution` verdict without an approvable proposal reads false,
  as in the web UI (Windows smoke test 08.11.26).

## Integrations page (08.11.26)

Public overview at **`/integrations`** (linked in the homepage navigation and footer, no sign-in needed) and the same
card grid at the top of **Settings → Integrations**: AI clients (Claude Code, Cursor, VS Code, Claude Desktop), apps
(Telegram; VS Code extension and claude.ai/ChatGPT connectors marked "planned") and delivery & code (GitHub, e-mail,
Confluence – these jump to their section in Settings → Integrations).

Each available client has a setup page `/integrations/<slug>` with numbered steps and copyable snippets built from this
server's address (`BETTER_AUTH_URL` + `/api/mcp`); tokens appear only as the placeholder `<TOKEN>`. Structure and
snippets: `apps/web/src/lib/connect-catalog.ts` (test `connect-catalog.test.ts`); texts: `settings.connect` in
`apps/web/messages/settings/*.json`. Claude Desktop uses the `mcp-remote` bridge (needs Node.js) because its config file
only starts local servers.
