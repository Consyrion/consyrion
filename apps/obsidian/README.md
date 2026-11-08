# CONSYRION AI for Obsidian

Send **explicitly selected** text from a note to a CONSYRION AI council – several AI models on your own provider keys
think independently, challenge each other and reach a documented verdict – and save the report as a **new** note.

Desktop only for now (`isDesktopOnly: true`); mobile has not been verified.

## Setup

1. In CONSYRION AI: _Settings → API tokens_ → create a token with the scope **Councils only** (prefix `cni_`). It can
   create projects, confirm requirement lists, preview costs, start and cancel councils and read reports – it can
   never approve a verdict, start a build, open pull requests or read provider keys.
2. Build the plugin: `pnpm --filter consyrion-obsidian build` → `apps/obsidian/dist/` contains `main.js` and
   `manifest.json`. Copy both into `<your vault>/.obsidian/plugins/consyrion/` and enable _CONSYRION AI_ under
   _Settings → Community plugins_.
3. _Settings → CONSYRION AI_: server address (hosted: `https://app.consyrion.com`; remote servers must use HTTPS) and
   the token. _Test connection_ lists how many provider keys with models the workspace has.

Provider keys stay in CONSYRION AI; the plugin never asks for them.

## Use

- Select text → command **Consult CONSYRION AI on the selection**. _Consult CONSYRION AI on the whole note_ sends the
  whole current note – only when you choose it.
- The dialog shows **exactly the text that will be sent**; nothing else from the vault (no other notes, no linked
  files, no attachments) is transmitted. Set the question, an optional goal and optional hard requirements (one per
  line), pick 2–6 models of your keys, the mode and the token budget.
- **Check cost** creates the project once and shows the server's estimate (upper bound, typical use, minimum budget,
  plan limits, model warnings). Only then **Start council** is enabled. Tokens are paid to your providers with your
  own keys.
- Requirements: only your requirement lines are confirmed; sentences of the selected text stay context. Lines that
  look like instructions to the models are refused – rephrase them, or decide them in the app.
- Progress shows in the status bar (phase, tokens used/budget). **Show running CONSYRION AI councils** lists them with
  _Open in CONSYRION AI_ and _Cancel council_.
- When the council is finished, the plugin saves the server's Markdown report as a new note in the report folder
  (default `CONSYRION/`), named `CONSYRION <date> <question>.md`. An existing note is never overwritten: the next free
  name `… (2).md` is used. The note starts with front matter (`consyrion_session`, `consyrion_url`, status, models,
  link to the source note) – never the token.

## Reliability

- **No double charge:** the prepared project is reused for the start, and the start carries an `Idempotency-Key`; a
  double click or a retry after a timeout returns the same council (`replayed`).
- **Restart:** running councils are stored in the plugin data; after restarting Obsidian the plugin keeps polling the
  same councils – it never starts a new paid run by itself.
- **Errors** are shown in plain words: offline (nothing started), 401 (token invalid/expired), 403 (not allowed with
  this token or role), 429 (wait; nothing started twice), provider refusals (check keys in CONSYRION AI), models that
  dropped out during the run (each one as a notice with the server's reason), failed or cancelled councils.

## Token storage – read this

Obsidian has no OS keychain API for plugins. The token is stored in plain text in
`<vault>/.obsidian/plugins/consyrion/data.json`. If you sync or back up the vault (Obsidian Sync, iCloud, Dropbox,
git), the token travels with it. Use a **Councils only** token, give it an expiry, exclude `data.json` from git, and
revoke it in CONSYRION AI if the vault leaves your control. _Remove token_ in the plugin settings deletes it from
`data.json`. The token never appears in notes, reports or notices.

## Development

- `pnpm --filter consyrion-obsidian test` – unit tests with a fake server (no real model calls).
- `pnpm --filter consyrion-obsidian typecheck`, `pnpm --filter consyrion-obsidian build`.
- Local server: enable _Allow http://localhost (development)_ and use `http://localhost:3000`.

Dependencies: only `obsidian` (MIT, provided by the app at runtime, not bundled) and `esbuild` for the build. License:
AGPL-3.0-only like the rest of the repository.
