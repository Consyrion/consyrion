# CONSYRIUM AI for Obsidian

Send **explicitly selected** text from a note to a CONSYRIUM AI council – several AI models on your own provider keys
think independently, challenge each other and reach a documented verdict – and save the report as a **new** note.

Desktop only for now (`isDesktopOnly: true`); mobile has not been verified.

## Setup

1. Build the plugin: `pnpm --filter consyrium-obsidian build` → `apps/obsidian/dist/` contains `main.js` and
   `manifest.json`. Copy both into `<your vault>/.obsidian/plugins/consyrium/` and enable _CONSYRIUM AI_ under
   _Settings → Community plugins_.
2. _Settings → CONSYRIUM AI_: check the server address (hosted: `https://app.consyrium.com`; remote servers must use
   HTTPS) and click **Connect with CONSYRIUM AI**. Your browser opens CONSYRIUM AI: sign in if needed, check the
   workspace and click **Allow**. The browser then asks to open Obsidian – confirm, and the plugin shows _Connected_.
   No token to copy.
3. _Test connection_ lists how many provider keys with models the workspace has.

What connecting grants: the plugin can create projects, confirm requirement lists, preview costs, start and cancel
councils and read reports – it can never approve a verdict, start a build, open pull requests or read provider keys.
The access is valid for 90 days (then click **Connect** again) and is listed under _Settings → API tokens_ in
CONSYRIUM AI as "Connected: CONSYRIUM AI for Obsidian", where you can revoke it at any time. It belongs to the
workspace that was active in CONSYRIUM AI when you clicked Allow.

**Alternative – paste a token:** in CONSYRIUM AI under _Settings → API tokens_ create a token with the scope
**Councils only** (prefix `cni_`) and paste it into the field _API token (alternative)_. Same rights as above; you
choose the validity yourself.

How connecting works: the plugin opens `<server>/oauth/authorize` with a one-time random `state` and a PKCE challenge.
After you allow it, CONSYRIUM AI sends a one-time code to `obsidian://consyrium-auth`; the plugin accepts it only when
the `state` matches the request you started in the last ten minutes, and exchanges it for the token together with the
PKCE secret that never left Obsidian. A link somebody else makes you open is ignored.

Provider keys stay in CONSYRIUM AI; the plugin never asks for them.

## Use

- Select text → right-click → **Consult CONSYRIUM AI on the selection** (also: the ribbon icon on the left, or the
  command palette). _Consult CONSYRIUM AI on the whole note_ sends the
  whole current note – only when you choose it.
- The dialog shows **exactly the text that will be sent**; nothing else from the vault (no other notes, no linked
  files, no attachments) is transmitted. Set the question, an optional goal and optional hard requirements (one per
  line), pick 2–6 models of your keys, the mode and the token budget.
- The model list is grouped per key, with a filter, a counter and "show selected models only". Changing the team
  locks the start until the cost was checked again.
- **Check cost** also runs the tiny start check for every chosen model (a few tokens on your key); models your
  provider lists but refuses are named in red and the start stays locked.
- **Check cost** creates the project once and shows the server's estimate (upper bound, typical use, minimum budget,
  plan limits, model warnings). Only then **Start council** is enabled. Tokens are paid to your providers with your
  own keys.
- List items under a line such as "Requirements:" / "Feste Anforderungen:" in the selection are proposed in the
  requirement field; edit or delete them before you check the cost.
- Requirements: only your requirement lines are confirmed; sentences of the selected text stay context. Lines that
  look like instructions to the models are refused – rephrase them, or decide them in the app.
- Progress shows in the status bar (phase, tokens used/budget). **Show running CONSYRIUM AI councils** lists them with
  _Open in CONSYRIUM AI_ and _Cancel council_.
- The note starts with **the answer in short** – title, summary and recommended steps of the recommended solution,
  unchanged from the structured report; the full report follows below it.
- The question field is filled in only when the first line of the selection is a question; otherwise you enter it.
- When the council is finished, the plugin saves the server's Markdown report as a new note in the report folder
  (default `CONSYRIUM/`), named `CONSYRIUM <date> <question>.md`. An existing note is never overwritten: the next free
  name `… (2).md` is used. The note starts with front matter (`consyrium_session`, `consyrium_url`, status, models,
  link to the source note) – never the token.

## Reliability

- **No double charge:** the prepared project is reused for the start, and the start carries an `Idempotency-Key`; a
  double click or a retry after a timeout returns the same council (`replayed`).
- **Restart:** running councils are stored in the plugin data; after restarting Obsidian the plugin keeps polling the
  same councils – it never starts a new paid run by itself.
- **Errors** are shown in plain words: offline (nothing started), 401 (access invalid/expired – connect again), 403 (not allowed with
  this token or role), 429 (wait; nothing started twice), provider refusals (check keys in CONSYRIUM AI), models that
  dropped out during the run (each one as a notice with the server's reason), failed or cancelled councils.

## Token storage – read this

Obsidian has no OS keychain API for plugins. The token – connected or pasted – is stored in plain text in
`<vault>/.obsidian/plugins/consyrium/data.json`. If you sync or back up the vault (Obsidian Sync, iCloud, Dropbox,
git), the token travels with it. Connect (or use a **Councils only** token with an expiry), exclude `data.json` from
git, and revoke the access in CONSYRIUM AI if the vault leaves your control. _Remove token_ in the plugin settings deletes it from
`data.json`. The token never appears in notes, reports or notices.

## Development

- `pnpm --filter consyrium-obsidian test` – unit tests with a fake server (no real model calls).
- `pnpm --filter consyrium-obsidian typecheck`, `pnpm --filter consyrium-obsidian build`.
- Local server: enable _Allow http://localhost (development)_ and use `http://localhost:3000`.

Dependencies: only `obsidian` (MIT, provided by the app at runtime, not bundled) and `esbuild` for the build. License:
AGPL-3.0-only like the rest of the repository.
