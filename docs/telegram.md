# Questions over Telegram (06.11.26)

Ask CONSYRION AI for a decision from Telegram – with the workspace's **own** bot (like its own AI keys; works the same
self-hosted). Hosted: Pro and up (entitlement `mcp`, shown as "MCP & Telegram").

## Set up

1. Create a bot with @BotFather **only for CONSYRION** (a webhook replaces polling – a bot used by another program
   stops working there).
2. Send the bot any message, get your chat id (e.g. via @userinfobot).
3. Settings → Integrations → Telegram connection (bot token + **private** chat id, a positive number).
4. Click **"Allow questions over Telegram"**. The server registers the webhook `https://<domain>/api/telegram/<connectionId>`
   with a fresh secret (`X-Telegram-Bot-Api-Secret-Token`, stored as SHA-256), sets the bot commands and greets the chat.
   Needs a public https `BETTER_AUTH_URL`.

## Use

- `/frage Should we use PostgreSQL or SQLite?` – lines starting with `- ` are hard requirements; plain text works too.
- The bot answers with question, requirements, the models of the last council and the budget (300,000 tokens; phases may
  be shortened) and the buttons **Start** / **Cancel**. Nothing runs without the tap; a second tap does nothing.
- Start = the `ask_consyrion` flow (`docs/mcp.md`): ready project, requirement list confirmed from the user's lines
  (audit `telegram.decision_requested`), council on the workspace's keys.
- When the council is done, the verdict (summary + PDF) comes back to the chat – the web process checks every 30 s
  (`apps/web/src/lib/server/telegram-notifier.ts`, off with `TELEGRAM_NOTIFIER=off`). Failed/cancelled → a short note.
- `/offen` lists what is waiting for you; `/hilfe` shows help.

## Security

- Only the connection's private chat is listened to (chat id and sender must match); groups cannot be enabled.
- Every question runs as the user who switched it on, with permissions and plan re-checked each time.
- Wrong secret, unknown connection or foreign chat: 200 without effect. Unanswered questions expire after a day.
- Approving and building stay in the app.

Code: `packages/db/src/repositories/telegram.ts` (`telegram_request`, migration 0034), `apps/web/src/lib/server/telegram-bot.ts`,
routes `api/telegram/[connectionId]` (webhook) and `api/delivery-connections/[id]/inbound` (on/off).
Bot texts: German and English (other languages get English).

**Language (live test 08.11.26).** The bot speaks the language the interface shows when "Allow questions over Telegram"
is clicked: the language cookie, else the browser's Accept-Language (before, without a cookie it fell back to English).
The verdict summary and the PDF sent to the chat use the same language (`deliverDecision` `locale`). A connection
switched on before this fix keeps its stored language until it is switched off and on again.

## Language and requirement lines (night test R4, 08.11.26)

- Summary, buttons, status messages, the verdict and the PDF follow the **language of the question** (German, English,
  French, Spanish detected from common words; bot texts in German or English). The language stored when questions were
  switched on is only the fallback for very short questions.
- Lines starting with "- " are the hard requirements. Without such lines, later lines that read like a requirement
  ("must", "at least", "muss", "mindestens" …) are proposed as requirements – the summary lists them and nothing starts
  before the user taps "Start".
- **Budget:** a line `Budget: 150000` (or `budget 150k`) sets a lower token ceiling for this question (50,000 up to
  the default 300,000); the summary shows it before the tap, and the start still refuses a budget below the team's
  minimum (night test R4).
