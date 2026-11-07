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
the inbox. Subject `CONSYRION Fehler|Feature|Kontakt: <subject>`, body with sender, page, language, browser, version,
the message and the link `<BETTER_AUTH_URL>/admin/feedback?id=<id>`.

## Access and data

- Tables `feedback` and `feedback_reply` (migration `0032`), repository `packages/db/src/repositories/feedback.ts`.
- Reports are platform-wide, not tenant data: a user lists only reports with their own `user_id` (from every
  workspace); workspace owners and admins see nothing of their members' reports.
- Admin functions take a `PlatformAdminContext` that only `resolvePlatformAdmin(db, userId, PLATFORM_ADMIN_EMAILS)`
  issues (checked against the stored e-mail of the user); a forged object is rejected. Non-admins get 404, like `/admin`.
- Deleting the account deletes the user's reports (cascade); admins delete single reports on request (hard delete
  including replies). The privacy policy (`/datenschutz`) has a section on feedback data.

## API

| Method                           | Path                                                                                      | Who            |
| -------------------------------- | ----------------------------------------------------------------------------------------- | -------------- |
| POST                             | `/api/feedback` – `{ kind, subject, text, page?, email? (visitors), website (honeypot) }` | anyone         |
| GET                              | `/api/feedback/mine`                                                                      | signed-in user |
| GET                              | `/api/admin/feedback?kind=&state=` – `{ reports, newCount }`                              | platform admin |
| GET / PATCH `{ state }` / DELETE | `/api/admin/feedback/:id`                                                                 | platform admin |
| POST                             | `/api/admin/feedback/:id/reply` – `{ text }`                                              | platform admin |

## Follow-ups (not in stage 1)

- Screenshot upload (image ≤ 3 MB, same checks as document upload); the column `screenshot` is reserved.
- Optional e-mail to the user when an admin replies, and a notification badge ("bell") for unread answers.
- Session/project ID with the user's consent when reporting from such a page.
- Shared rate-limit store for several web instances (the limiter is per process).
- Admin: create a GitHub issue from a report (after confirmation, without personal data); AI summary on the admin key.
- Automatic deletion of old, finished reports (retention period to be decided).
