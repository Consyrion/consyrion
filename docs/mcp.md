# MCP server (06.11.26)

CONSYRIUM AI can be used from any MCP client – Claude Code, Claude Desktop, Cursor, VS Code, … – through a
**Model Context Protocol** server built into the app. Hosted (app.consyrium.com): **Pro and up** (plan entitlement
`mcp`, editable in /admin); self-hosted: always on.

## Connect

- Address: `https://<your domain>/api/mcp` (Streamable HTTP, stateless; POST with JSON-RPC, answers as JSON).
- Auth, two ways that end in the same kind of API token:
  - **Sign in (OAuth):** give the client only the address. It gets a 401, finds the sign-in through the metadata
    documents, opens the consent page in the browser and receives its token – see "Sign-in (OAuth)" below.
  - **Token:** an API token from **Settings → API tokens** as `Authorization: Bearer …`. Works unchanged.
- Claude Code with a token: `claude mcp add --transport http consyrium https://app.consyrium.com/api/mcp --header "Authorization: Bearer <TOKEN>"`
- Claude Code with sign-in: `claude mcp add --transport http consyrium https://app.consyrium.com/api/mcp`, then `/mcp` → authenticate.

## Sign-in (OAuth) (11.11.26)

"Connect by signing in instead of copying a token": the MCP authorization flow – OAuth 2.1 authorization code with
PKCE for public clients, protected-resource metadata (RFC 9728), authorization-server metadata (RFC 8414) and dynamic
client registration (RFC 7591). The Obsidian plugin uses the same flow as a built-in client (`docs/obsidian.md`).

| Step                                                 | Endpoint                                                                                                                         | Notes                                                                                                                                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The client calls the MCP endpoint without a token | `POST /api/mcp` → 401                                                                                                            | `WWW-Authenticate: Bearer realm="consyrium", resource_metadata="<origin>/.well-known/oauth-protected-resource"`                                                                                           |
| 2. Which server signs users in?                      | `GET /.well-known/oauth-protected-resource` (also `…/oauth-protected-resource/api/mcp`)                                          | `resource: <origin>/api/mcp`, `authorization_servers: [<origin>]`, `scopes_supported: ["councils","read"]`                                                                                                |
| 3. Where are its endpoints?                          | `GET /.well-known/oauth-authorization-server`                                                                                    | issuer `<origin>`; `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]` |
| 4. The client registers itself                       | `POST /api/oauth/register` (JSON: `client_name`, `redirect_uris`) → 201 `client_id`                                              | open, 20 per hour and address; public clients only – never a secret                                                                                                                                       |
| 5. The user consents in the browser                  | `GET /oauth/authorize?response_type=code&client_id=…&redirect_uri=…&code_challenge=…&code_challenge_method=S256&state=…&scope=…` | signed-out visitors sign in first (`/sign-in?next=…`) and come back; "Allow" redirects to the redirect URI with `code` and `state`, "Deny" with `error=access_denied`                                     |
| 6. The client exchanges the code                     | `POST /api/oauth/token` (form or JSON: `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`)    | → `{ access_token, token_type: "Bearer", expires_in, scope }`, `Cache-Control: no-store`; 30 per minute and address                                                                                       |

`<origin>` is `BETTER_AUTH_URL` without a trailing slash (the request origin in local development) – the same value
the MCP endpoint uses for its links.

- **Scopes:** `councils` (default; also what `councils read` becomes) → a "Councils only" token (`cni_`): read tools
  plus preparing projects and starting councils on the workspace's own keys. `read` → a read-only token (`cnr_`).
  Anything else is refused. Full access (`cns_`) cannot be obtained by signing in.
- **The access token is an ordinary API token:** named "Connected: <client name>", bound to the user and the
  workspace shown on the consent page, **valid 90 days**, listed and revocable under Settings → API tokens, membership
  re-checked on every request. Audit: `oauth.authorized` (consent: client, redirect target, scope) and
  `api_token.created` (`via: "oauth:<client id>"`).
- **Plan:** signing in does not need the `mcp` entitlement (the Obsidian plugin uses the REST API on the Free plan);
  `/api/mcp` keeps checking it and answers 403 without it.
- **Redirect URIs** a client may register (at most 5, 300 characters each, no fragment): `https://…`; `http://` only on
  `localhost`, `127.0.0.1` or `[::1]` (any port); and of the app schemes only `cursor://`, `vscode://`,
  `vscode-insiders://`, `claude://` and exactly `obsidian://consyrium-auth`. The redirect URI of an authorization
  request must equal a registered one character for character (also the port of a loopback address).
- **Codes:** valid 2 minutes, usable once. The first exchange attempt consumes the code – a wrong verifier, client or
  redirect URI fails with the same `invalid_grant` and the code is gone.
- **Errors** of the register and token endpoints are RFC shaped: `{ "error", "error_description" }` (400; 429 with
  `temporarily_unavailable` when limited). An invalid authorization request is explained on the page and never
  redirected.
- **CORS:** the two metadata documents, register and token answer `OPTIONS` and send
  `Access-Control-Allow-Origin: *` (they read no cookie). `/api/mcp` itself is unchanged.
- **Not implemented:** refresh tokens (after 90 days the MCP endpoint answers 401 again and the client asks the user to
  sign in again), client secrets / confidential clients, a revocation endpoint (revoke under Settings → API tokens),
  OpenID Connect (`/.well-known/openid-configuration` does not exist), the `resource` parameter (RFC 8707) is accepted
  and ignored – this server has one protected resource.
- **Verified so far:** unit and route tests only (below). Not yet tried against real clients (Claude Code, claude.ai
  and ChatGPT connectors, Cursor); the setup pages under `/integrations` still describe the token way.
- **Former domain:** the metadata names the current address (`BETTER_AUTH_URL`). A client configured with the former
  domain keeps working with a token; for sign-in use the current address.

Code: `packages/core/src/oauth.ts` (redirect URI rules, scopes), `packages/db/src/repositories/oauth.ts` (clients,
codes, exchange; tables `oauth_client`, `oauth_code`, migration 0057), `apps/web/src/lib/server/oauth.ts` (metadata,
request validation), `apps/web/src/app/oauth/authorize/` (consent page and action), `apps/web/src/app/api/oauth/`,
`apps/web/src/app/.well-known/`. Threat notes: `docs/security.md`.

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
`WWW-Authenticate: Bearer realm="consyrium", resource_metadata="…"` (start of the OAuth sign-in), 403 without Pro. Tool
errors come back as `isError` results with the domain message only.

## Tests

`apps/web/src/lib/server/mcp.test.ts` (protocol, 401/403 incl. the `resource_metadata` challenge, Pro gate, tool sets
per scope, nothing that approves, builds or deletes, draft creation, budget limit), `actor.test.ts` (read-only token
refused by REST endpoints). OAuth sign-in: `packages/core/src/oauth.test.ts` (redirect URI rules, scopes),
`packages/db/src/repositories/oauth.test.ts` (register → code → token accepted by `resolveApiToken`; replay, parallel
exchange, wrong verifier burns the code, wrong client/redirect URI, expiry, lost membership),
`apps/web/src/lib/server/oauth.test.ts` (metadata documents, register and token routes, consent action incl. tampered
forms), `apps/web/src/app/oauth/authorize/authorize-page.test.tsx` (consent page, no redirect for invalid requests),
`apps/web/src/lib/safe-next.test.ts` (`/sign-in?next=`).

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
card grid at the top of **Settings → Integrations**: AI clients (Claude Code, Cursor, VS Code, Claude via custom
connector, ChatGPT, Codex CLI, Gemini CLI, Hermes Agent, OpenClaw), apps (Telegram, Obsidian; VS Code extension marked
"planned") and delivery & code (GitHub, e-mail, Confluence – these jump to their section in Settings → Integrations).

Each available client has a setup page `/integrations/<slug>` with numbered steps and copyable snippets built from this
server's address (`BETTER_AUTH_URL` + `/api/mcp`). Structure and snippets: `apps/web/src/lib/connect-catalog.ts` (test
`connect-catalog.test.ts`); texts: `settings.connect` in `apps/web/messages/settings/*.json`.

**Sign-in first (12.11.26):** every MCP client guide (`SIGN_IN_SLUGS`) uses the browser sign-in of this server (see
"Sign-in (OAuth)"): add the address, sign in, click "Allow". A token appears only in the shared last step "token as the
alternative" and only as the placeholder `<TOKEN>`. Steps that are the same for every client live under
`settings.connect.shared` (`signIn`, `askAgent`, `tokenAlt`). Cursor and VS Code get a one-click install button built
from their documented link formats (`cursor://anysphere.cursor-deeplink/mcp/install?name=…&config=<base64>`,
`vscode:mcp/install?<url-encoded json>`).

What was verified: the guides follow each vendor's documentation as read on 12.11.26 (Claude Code, Claude custom
connectors, ChatGPT plugins, Codex `config.toml`, Cursor, VS Code, Gemini CLI `httpUrl`, Hermes `config.yaml`, OpenClaw
`mcp add`); discovery, dynamic registration and the redirect to the consent page were run against production with the
official MCP SDK client (1.32). Walked through completely on 12.11.26: Claude Code 2.1.322 (`claude mcp add` without a header → `claude mcp login` → consent → tool call answered; `TESTED_SIGN_IN_SLUGS`), Codex CLI 0.167.2 (`[mcp_servers.consyrium]` url only → `codex mcp login consyrium` → consent shows "Codex" → `list_projects` and `list_models` answered via `codex exec`), the Claude connector on claude.ai (Customize → Connectors → Add custom connector; OAuth "sign in now" + dynamic registration detected; consent names Claude; `List projects` answered in a chat – the desktop app uses the same account connector), ChatGPT on chatgpt.com/plugins (Add → custom MCP server, OAuth detected, "Create as plugin" → "Connect"; consent names ChatGPT; `@CONSYRIUM AI` → `list_projects` answered), Gemini CLI 0.68.0 (`httpUrl` only → `/mcp auth consyrium` → consent → `list_projects` answered via `gemini -p`; note: Google rejects "Sign in with Google" for personal accounts in Gemini CLI since Nov 2026 – the guide points to "Use Gemini API Key") and the Obsidian plugin (connect button, by the owner). The complete flow inside the other products has NOT been walked through yet – every such page
says so (`settings.connect.shared.untested`). ChatGPT plan requirements could not be verified and are not stated.
Redirect URIs the clients register (all accepted by `isAllowedRedirectUri`): claude.ai `https://claude.ai/api/mcp/auth_callback`,
ChatGPT `https://chatgpt.com/connector_platform_oauth_redirect` or `…/connector/oauth/{id}`, Cursor
`http://localhost:8787/callback`, VS Code `http://127.0.0.1:33418` and `https://vscode.dev/redirect`, the CLIs a
loopback address with a random port.

**Company marks (11.11.26):** cards and setup pages show the company's mark in its brand colour for Claude Code and
Claude Desktop (Claude), Cursor, Telegram, Obsidian, GitHub and Confluence; the black/white marks (Cursor, GitHub)
follow the text colour so they work in both themes. Paths are from Simple Icons (CC0) in
`apps/web/src/components/connect/connect-brands.ts`; an item gets one through `brand` in the catalog. VS Code keeps its
line glyph on purpose: Microsoft's brand guidelines (code.visualstudio.com/brand) forbid the icon on third-party
product pages. E-mail and the planned claude.ai/ChatGPT card have no single company and keep their glyphs too.
