# Feedback inbox (#295)

Users report bugs, wish features or get in touch directly in the app; every report lands in the platform admins'
inbox and, if configured, also goes to the admins by e-mail. Admins answer from the inbox; the user reads the answer
in the app. Model: the OnJam feedback feature. No AI calls.

## Where

| Who            | Where                                                                                             | What                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Signed-in user | Sidebar footer "Feedback & bugs" → `/settings/feedback` (tab "My reports")                        | Form (type, subject, message) and the list of own reports with the admins' replies                          |
| Visitor        | Landing page footer "Contact & feedback" → `/feedback`                                            | Same form plus an e-mail address (required); signed-in users are redirected to `/settings/feedback`         |
| Platform admin | `/admin` card "Feedback inbox" and the counter next to "Admin" in the sidebar → `/admin/feedback` | Filter by type and status, details, mark in progress / done / new, reply, delete (confirmation in the page) |

Types: `bug` (Fehler), `feature` (Feature-Wunsch), `contact` (Kontakt/Frage). States: `new` → `in_progress` → `done`
(the first reply moves a new report to `in_progress`; "Mark as new" reopens it). Subject ≤ 120, message ≤ 4000 characters.

Attached automatically: the app page the user came from (path only – query string and fragment are dropped, they may
carry tokens), the interface language (cookie), the browser's user agent and the app version (`APP_VERSION`, the same
value `/api/health` shows). The workspace the user was acting in is stored as context for the admin.

## Screenshot (stage 2)

Optional, one image per report: PNG, JPEG, WebP or GIF, at most 3 MB. The form checks size and type in the browser;
the server checks again with the same file-signature test as the document upload (`sniffImageType` in
`packages/db/src/repositories/documents.ts` – name and claimed type are not trusted, so e.g. an SVG is rejected).
The API takes it as base64 in the JSON body (`screenshot`), the column `screenshot` stores it as a data URL. The admin
sees it in the report detail (click opens it full size) and gets it as an attachment of the admin e-mail. The form
reminds users that no passwords or keys should be visible.

## Page context and unread answers (stage 3)

- **Page context only with consent.** On a project or council page (`/projects/<id>…`, `/sessions/<id>…`) the form
  offers "Send the project/council of this page" – unchecked by default. Only when it is ticked does the request carry
  `shareContext: true` and the id; the repository keeps it only if it belongs to the author's current workspace (a
  foreign or made-up id is dropped) and stores it in `feedback.context`. Visitors never send one. The admin detail shows
  it as "Page (with consent)".
- **Storage notice.** The form says that the report is stored with the author's e-mail address to answer and can be
  deleted on request (next to the link to `/datenschutz`).
- **Unread answers.** `feedback.reply_seen_at` remembers when the author last opened "My reports". Answers after that
  count as unread: a counter next to "Feedback & bugs" in the sidebar, a "new" badge on the answer. Opening the page
  marks them as read.

## Abuse protection

- Max. 10 reports per day per user, for visitors per IP address (`X-Forwarded-For` set by Caddy), with the in-memory
  limiter `apps/web/src/lib/server/rate-limit.ts` (per process – a restart resets it).
- Visitors: honeypot field `website` (invisible for people and screen readers). If a bot fills it, the API answers
  201 but stores nothing and sends no e-mail.
- Visitor e-mail addresses are validated; signed-in users always report with their account address.

## E-mail to the admins

`ADMIN_EMAILS` (comma-separated) plus the platform SMTP server (`SMTP_URL`, `MAIL_FROM`, see `docs/delivery.md`).
The mail is sent after the response (`after()` from `next/server`): a failure is logged (`Feedback e-mail to admins
failed`, without content) and never fails the report. Without `ADMIN_EMAILS` or without `SMTP_URL` reports are only in
the inbox. Subject `CONSYRIUM Fehler|Feature|Kontakt: <subject>`, body with sender, page, language, browser, version,
the message and the link `<BETTER_AUTH_URL>/admin/feedback?id=<id>`.

## Reply by e-mail (stage 2)

When SMTP is configured, the reply form in the admin inbox has the option "Also send the answer by e-mail to …"
(checked by default for visitors, who have no account; optional for users, who also see it under My reports). The
mail goes to the report's address in the report's language (en, de, fr, es, zh; English otherwise), quotes the original
message, links `/settings/feedback` for users and sets `Reply-To` to the first `ADMIN_EMAILS` address, so the author's
answer reaches the team instead of the no-reply sender. It is sent after the response; a failure is logged
(`Feedback reply e-mail failed`) and never fails the reply. Without `SMTP_URL` the option is hidden and the answer is
only in the app.

## Access and data

- Tables `feedback` and `feedback_reply` (migration `0032`), repository `packages/db/src/repositories/feedback.ts`.
- Reports are platform-wide, not tenant data: a user lists only reports with their own `user_id` (from every
  workspace); workspace owners and admins see nothing of their members' reports.
- Admin functions take a `PlatformAdminContext` that only `resolvePlatformAdmin(db, userId, PLATFORM_ADMIN_EMAILS)`
  issues (checked against the stored e-mail of the user); a forged object is rejected. Non-admins get 404, like `/admin`.
- Deleting the account deletes the user's reports (cascade); admins delete single reports on request (hard delete
  including replies). The privacy policy (`/datenschutz`) has a section on feedback data.
- Data export (`/api/privacy/export`, workspace owner): contains `feedback` and `feedbackReplies` – only the exporting
  user's own reports and the replies to them (without the replying admin's id), never the members' reports.

## API

| Method                           | Path                                                                                                            | Who            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------- |
| POST                             | `/api/feedback` – `{ kind, subject, text, page?, screenshot? (base64), email? (visitors), website (honeypot) }` | anyone         |
| GET                              | `/api/feedback/mine`                                                                                            | signed-in user |
| GET                              | `/api/admin/feedback?kind=&state=` – `{ reports, newCount }`                                                    | platform admin |
| GET / PATCH `{ state }` / DELETE | `/api/admin/feedback/:id`                                                                                       | platform admin |
| POST                             | `/api/admin/feedback/:id/reply` – `{ text, email? }` → `{ id, createdAt, emailed }`                             | platform admin |

## Follow-ups

- Done in stage 2: screenshot upload, reply by e-mail, own reports in the data export.
- Done in stage 3: unread-answer badge, page context with consent, storage notice.
- Shared rate-limit store for several web instances (the limiter is per process).
- Admin: create a GitHub issue from a report (after confirmation, without personal data); AI summary on the admin key.
- Automatic deletion of old, finished reports (retention period to be decided).
