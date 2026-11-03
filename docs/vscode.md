# VS Code extension (#28)

`apps/vscode`. Build: `pnpm --filter consyrion package` → `apps/vscode/dist/consyrion.vsix` (CI uploads it as an
artifact). Install: VS Code → Extensions → … → *Install from VSIX*.

1. In Consyrion: *Settings → API tokens* → create a token with **Full access** (approvals and builds need it; integration tokens `cni_…` are refused).
2. VS Code: *Consyrion: Sign in with API token* (stored in VS Code SecretStorage). Server URL setting
   `consyrion.serverUrl` (default `https://consyrion.com`; for local development `http://localhost:3000`).
3. Activity bar → Consyrion: projects and their council sessions (bell icon = awaiting your decision).
4. Open a decision: phases, verdict, minority report; approve / more debate / request changes / reject
   (modal confirmation; the server enforces roles); open the Markdown report.
5. *Open generated changes*: pick a changed file of the latest Execution Council run and see a diff (base vs.
   generated) in the editor.

Security: webview with strict CSP and a per-render nonce; all server data HTML-escaped; token never written to
settings or logs. Not yet verified inside a running VS Code instance (unit tests cover the API client and the
webview rendering).
