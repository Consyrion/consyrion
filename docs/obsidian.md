# Obsidian plugin (#103)

`apps/obsidian` – send explicitly selected note text to a council and save the report as a new note. User guide:
`apps/obsidian/README.md`.

## Getting the plugin

- Hosted and Docker installs: the web image builds the plugin (`Dockerfile.web`) and serves `main.js` and
  `manifest.json` under `/downloads/obsidian/`. The public setup page `/integrations/obsidian` links both files and
  lists the steps (texts: `settings.connect.items.obsidian`, catalog: `apps/web/src/lib/connect-catalog.ts`).
- From source: `pnpm --filter consyrium-obsidian build` → `apps/obsidian/dist/`.
- The plugin uses the REST API with a "Councils only" token and needs no MCP entitlement (works on the Free plan).
- Connecting (plugin 0.3.0, 11.11.26): **Connect with CONSYRIUM AI** in the plugin settings opens
  `<server>/oauth/authorize` in the browser (built-in public client `consyrium-obsidian`, redirect URI exactly
  `obsidian://consyrium-auth`, PKCE S256, scope `councils`). After "Allow" the browser opens the Obsidian link, the
  plugin checks the `state`, redeems the code at `POST /api/oauth/token` and stores the token like a pasted one. State
  and PKCE verifier stay in memory for ten minutes and never reach `data.json`. Pasting a token stays possible. Flow and
  rules: `docs/mcp.md` → "Sign-in (OAuth)"; pure parts in `apps/obsidian/src/connect.ts`.
- MCP: Obsidian has no MCP client of its own (checked up to 1.15). Community plugins with an MCP client that speak
  Streamable HTTP with a custom `Authorization` header can use `/api/mcp` (see `docs/mcp.md`); the setup page shows
  the address and header. Not verified by us inside a specific community plugin.

## Data flow

```
Obsidian (selected text) ──HTTPS, Bearer cni_…──▶ CONSYRIUM AI REST API ──your provider keys──▶ AI models
          ◀── Markdown report (GET /api/sessions/:id/report) ──
```

The hosted server never reads the vault; the plugin is the outgoing bridge. Requests use Obsidian's `requestUrl`.

## Endpoints (all accept integration tokens, see docs/api.md)

| Step                                                                          | Call                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| Models of the workspace's keys                                                | `GET /api/models`                                        |
| Project with the selected text as brief (`status: ready`, `intent: decision`) | `POST /api/projects`                                     |
| Requirement proposal → confirm only the user's lines                          | `GET` / `POST /api/projects/:id/requirements`            |
| Cost estimate                                                                 | `POST /api/projects/:id/sessions/preview`                |
| Start (with `Idempotency-Key`)                                                | `POST /api/projects/:id/sessions`                        |
| Progress, partial failures                                                    | `GET /api/sessions/:id` (`participants[].failureReason`) |
| Report                                                                        | `GET /api/sessions/:id/report` (Markdown)                |
| Cancel                                                                        | `POST /api/sessions/:id/cancel`                          |

No new endpoint was needed. The token cannot approve, build, merge or read keys (403).

## Rules kept

- BYOK only; the cost preview comes before every start; the user confirms a shortened budget explicitly.
- The requirement list is confirmed from the user's own lines only (same rule as `ask_consyrium`); instruction-like
  lines are refused, never decided automatically.
- Existing notes are never overwritten (`vault.create` + next free name); reports carry real run data only.
- The token is stored in the vault's plugin data (plain text) – documented in the README with sync/backup advice.

## Tests

`apps/obsidian/test/plugin.test.ts` (fake server, no real model calls): server address rules, error kinds incl.
offline, token only in the header, idempotent start, status with partial failures, brief = exactly the selected text,
only the user's requirements confirmed, instruction-like lines refused, free file names, note front matter without
token, texts in en/de, connecting by sign-in (PKCE helpers, consent address, answers with a foreign or missing state
ignored, code exchange). A real end-to-end run in Obsidian is listed separately in the PR (manual, ≤ 0.10 $).
