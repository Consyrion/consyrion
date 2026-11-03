# Sending decisions (#165)

A council's result is the **decision**, not necessarily code. Besides the in-app report and the downloads
(Markdown, JSON, PDF, Word – #164) a verdict can be sent where the team works. A GitHub draft pull request stays the
separate, optional Execution Council and needs a connected repository.

| Target     | What is sent                                                                                          | Setup                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E-mail     | Subject "Decision: <project>", short verdict, link to the session, report as PDF attachment           | Operator: `SMTP_URL` (e.g. `smtps://user:pass@smtp.example.com:465`) and `MAIL_FROM` in the server env. Recipients: **only workspace members** (no free addresses) |
| Telegram   | Short verdict (outcome, recommendation, confidence, link) as caption of the PDF                       | Settings → Integrations → _Send decisions_: bot token from @BotFather and the chat/group/channel id; add the bot to the chat first                                 |
| Confluence | A page "Decision: <project> (<date>, <session>)" in the chosen space, the full report as storage HTML | Atlassian Cloud site URL, space key, account e-mail and an API token (id.atlassian.com → Security → API tokens)                                                    |
| Obsidian   | planned – via the plugin of #103; until then the Markdown export                                      | –                                                                                                                                                                  |

## How it works

- **Connections** (`delivery_connection`, migration 0019): per workspace, kind `telegram` or `confluence`. The token is
  an AES-256-GCM envelope (same keyring and pattern as provider keys), shown only as a hint, never returned by an API,
  never written to logs or errors. Creating and deleting needs `credential:write`.
- **Send** (`POST /api/sessions/:id/deliveries`, "Send to …" on the Final Verdict, `decision:run`): needs a verdict.
  Rendering reuses the PDF/Markdown report, so every target carries the same content and no new model output.
- **Log** (`delivery_log`): every send with target, recipient (addresses or connection name – no secrets), status,
  reason of a failure and the Confluence link; plus an audit event `decision.delivered` / `decision.delivery_failed`.
  A failure blocks nothing and can be retried from the list.
- **Project default:** "Use this as the default for this project" stores the target on the project
  (`project.delivery_default`); "Send to …" preselects it next time. Sending stays an explicit click – nothing is sent
  automatically.
- Rate limit: 20 sends per user per minute.

## Not yet

- Automatic sending when a verdict is ready (would need the worker to render and send) – planned.
- Obsidian plugin (#103).
