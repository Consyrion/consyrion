# MCP server (06.11.26)

CONSYRION AI can be used from any MCP client – Claude Code, Claude Desktop, Cursor, VS Code, … – through a
**Model Context Protocol** server built into the app. Hosted (app.consyrion.com): **Pro and up** (plan entitlement
`mcp`, editable in /admin); self-hosted: always on.

## Connect

- Address: `https://<your domain>/api/mcp` (Streamable HTTP, stateless; POST with JSON-RPC, answers as JSON).
- Auth: an API token from **Settings → API tokens** as `Authorization: Bearer …`.
- Claude Code: `claude mcp add --transport http consyrion https://app.consyrion.com/api/mcp --header "Authorization: Bearer <TOKEN>"`
- OAuth sign-in (needed for claude.ai and ChatGPT connectors) is the next stage and not built yet.

## Tokens and tools

| Token                                                                | Tools                                                                                                                      |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `cnr_` **Read only** (new; MCP only, refused by every REST endpoint) | `list_projects`, `list_decisions`, `get_decision`, `list_open_steps`, `list_models`, `get_requirements`, `preview_council` |
| `cni_` Councils only / `cns_` Full access                            | the read tools + `ask_consyrion`, `create_project_draft`, `update_brief`, `propose_requirements`, `start_council`          |

## Ask for a decision while working: `ask_consyrion`

Someone coding with Claude (or Cursor, VS Code …) hits a decision – "PostgreSQL or SQLite?", "queue or cron?" – and
asks CONSYRION in **one call**: `question`, `context`, optional `options`, `requirements`, `tokenBudget` (required,
max 1,000,000), optional `participants`/`mode`. CONSYRION creates a ready project (type technology choice), confirms the
requirement list **from the user's own requirement lines** (sentences of question/context stay context; statements
that look like instructions to the models are refused, never auto-decided), starts the council and returns the
`sessionId` at once. The client then calls `get_decision` (phase, tokens, and at the end the verdict).

- The client asks the user before running the tool – that approval is the human confirmation of the requirements
  (audit `mcp.decision_requested`, `confirmedVia: "mcp"`, `packages/db/src/repositories/client-requests.ts`).
- Without `participants` the models of the workspace's last council are used.
- Approving or building the verdict stays in the app; for advice the verdict itself is the answer.

- Every tool runs with the token owner's actor and the same repository functions as the app (`apps/web/src/lib/server/mcp-tools.ts`):
  only that workspace, same permissions, plan limits and audit (`mcp.action_executed`). Write tools go through the
  assistant's allowlist (`runActionForClient`, `packages/db/src/repositories/assistant-actions.ts`): projects only as
  draft, requirements unconfirmed until the user confirms the list in the app.
- `start_council` costs tokens on the workspace's own keys (BYOK): `tokenBudget` is required and at most
  **1,000,000** (`MCP_MAX_TOKEN_BUDGET`); needs a current confirmed requirement list; rate limit 5/min. The client
  should call `preview_council` first and tell the user the estimate.
- **Never over MCP:** approve/reject, builds, delete/archive, confirming requirements, keys, billing, settings,
  members, tokens.
- Write tools carry `readOnlyHint: false` so clients ask the user before running them.

## Protocol

`apps/web/src/lib/server/mcp.ts`: `initialize` (versions 2025-11-25, 2025-06-18, 2025-03-26), `ping`, `tools/list`,
`tools/call`; notifications → 202. No sessions, no SSE stream (GET → 405), no resources/prompts. Errors: 401 with
`WWW-Authenticate: Bearer`, 403 without Pro. Tool errors come back as `isError` results with the domain message only.

## Tests

`apps/web/src/lib/server/mcp.test.ts` (protocol, 401/403, Pro gate, tool sets per scope, nothing that approves,
builds or deletes, draft creation, budget limit), `actor.test.ts` (read-only token refused by REST endpoints).

### Requirements of an `ask_consyrion` call (QA 07.11.26)

Only the `requirements` lines the user gave are confirmed as hard requirements. Sentences of `question` and `context`
stay context even when they sound binding ("max. 50 users"): this flow confirms without a review screen, so they are
stored as excluded ("context of the question"). The same applies to `/frage` in Telegram. Invalid tool input names the
fields (`Invalid session configuration – participants: …`).
