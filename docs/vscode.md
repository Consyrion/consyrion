# VS Code extension (#28)

`apps/vscode`. Build: `pnpm --filter consyrium package` → `apps/vscode/dist/consyrium.vsix` (CI uploads it as an
artifact). Install: VS Code → Extensions → … → *Install from VSIX*.

1. In Consyrium: *Settings → API tokens* → create a token with **Full access** (approvals and builds need it; integration tokens `cni_…` are refused).
2. VS Code: *Consyrium: Sign in with API token* (stored in VS Code SecretStorage). Server URL setting
   `consyrium.serverUrl` (default `https://app.consyrium.com`; for local development `http://localhost:3000`). The
   website domain `consyrium.com` only redirects and is mapped to the app automatically (a redirect to another host
   would drop the token); an address that answers with a web page gives a clear error instead of a JSON failure.
3. Activity bar → Consyrium: projects and their council sessions (bell icon = awaiting your decision).
4. Open a decision: phases, verdict, minority report; approve / more debate / request changes / reject
   (modal confirmation; the server enforces roles); open the Markdown report.
5. *Open generated changes*: pick a changed file of the latest Execution Council run and see a diff (base vs.
   generated) in the editor.

Security: webview with strict CSP and a per-render nonce; all server data HTML-escaped; token never written to
settings or logs. Not yet verified inside a running VS Code instance (unit tests cover the API client and the
webview rendering).

### Restricted Mode (QA 07.11.26)

The extension declares `capabilities.untrustedWorkspaces: supported`: it only talks to the CONSYRIUM AI server and never
runs workspace code, so it also works in folders VS Code opens in Restricted Mode (before, the activity-bar icon was
missing there). Display name and view container are "CONSYRIUM AI".

### Language (QA 07.11.26)

Tree, decision view and messages follow the setting `consyrium.language` (`auto` = VS Code display language; `en`,
`de`, `fr`, `es`). Phase and mode names are product names and stay unchanged; model output is shown as written.
"Open decision" from the command palette focuses the CONSYRIUM AI view instead of failing.
