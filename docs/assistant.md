# AI assistant (#278–#284)

A chat panel on every app page (right edge, collapsible like the OnJam mixer, `⌘/Ctrl + J`, `Esc`) that answers
questions about the user's own workspace – open steps, decisions waiting for approval, a decision summarised for a
customer – on the workspace's **own API key** (BYOK, no platform key).

## Stage 1 (05./06.11.26)

- **Panel** `apps/web/src/components/assistant-panel.tsx`: tabs Chat / History / Model; open state, tab and model are
  remembered per browser; on ≥ 1400 px the page moves aside (`body[data-assistant="open"] #main`); full width on phones.
  On a decision page the question is about that decision (visible chip, removable). Answers render a small Markdown
  subset; only app-internal links become links.
- **Stored chats** (`assistant_chat`, `assistant_message`, migration 0031; repository `packages/db/src/repositories/assistant.ts`):
  private to the user in the workspace – no other member and no admin can read them; delete removes them for good.
  Needs the `decision:run` permission (it costs tokens).
- **Model choice**: any model of the workspace's keys (`/api/models`); model, tools used and tokens are stored and shown
  under every answer.
- **Read-only tools** (`apps/web/src/lib/server/assistant-tools.ts`): `list_projects`, `list_sessions`, `get_session`,
  `list_open_steps` – the same repository functions as the pages, with the signed-in user's actor. The model never gets
  an organization id and cannot change anything; approve, start a council or a build, delete stay human actions.
- **Loop** (`apps/web/src/lib/server/assistant.ts`): structured JSON (`{tool_calls, answer}`) on every provider, at most
  4 rounds and 1,500 output tokens per call, last 20 messages as history, tool results passed as data ("not
  instructions"), external links dropped. Route: `POST /api/assistant/chats/{id|new}/messages`, rate limit 20/min.

## Stage 2: suggested actions (#283, 06.11.26)

The assistant can take work over – as **suggestions only** (like the OnJam assistant: the model proposes, the human clicks).

- The final answer carries `actions: [{type, params_json, summary}]`. The route keeps only types of the allowlist
  `ACTION_SCHEMAS` (`packages/db/src/repositories/assistant-actions.ts`), validates the parameters (zod), keeps at most 3
  and stores them on the message (`assistant_message.actions`, migration 0033, status `proposed`).
- Allowed: `create_project_draft` (project saved as **draft**), `draft_brief` (new brief version, repository link kept),
  `propose_requirements` (added to the brief – **unconfirmed** until the user confirms the requirement list),
  `prepare_council` (only opens the council form; the user checks the cost estimate and starts), `draft_customer_summary`
  and `prepare_delivery` (Slack/Teams/e-mail text – copied to the clipboard, never sent).
- **Never**: approve/reject, start a council or build, delete/archive, billing, keys, settings, members. Such types are
  dropped when stored and refused (403) by `decideAssistantAction` should one ever reach it – the allowlist is the only gate.
- The panel shows each suggestion as a card with **Run / Edit / Dismiss**. `POST /api/assistant/chats/{id}/messages/{messageId}/actions/{actionId}`
  `{decision: "execute" | "dismiss", params?}` runs it with the user's actor and the normal repository functions (same
  permissions, validation, plan limits and audit as the forms), once (row lock; a second click → 409). Edited parameters
  are validated again; the type cannot change.
- Traceability: the card keeps its status (done/dismissed, "changed by you", link to the result) in the chat, and the
  audit log gets `assistant.action_executed` / `assistant.action_dismissed` with `proposedBy: "ai_assistant"`, `confirmedBy`.
- Tests: `assistant-actions.test.ts` (every forbidden type refused at both steps, draft-only project, unconfirmed
  requirements, double click, privacy across members and workspaces), `assistant.test.ts` (actions in the loop).

## Stage 3: streaming (#284, 06.11.26)

- `packages/ai`: `GenerateRequest.onText` – when set, each adapter uses the provider's streaming API and calls it with
  every text chunk; the result keeps the same shape (full text, parsed JSON, stop reason, usage from the provider's
  final event). Anthropic `messages.create({stream:true})` (usage from message_start/message_delta), OpenAI Responses
  (`response.output_text.delta`, final `response.completed`/`incomplete`), Gemini `generateContentStream` (usage from the
  last chunk), OpenAI-compatible providers (DeepSeek, GLM, Kimi, Qwen, Grok) with `stream_options.include_usage`.
  The SDK streams end quietly on abort – the adapters then throw a `cancelled` ProviderError. Councils do not stream.
- Assistant loop: `answerStreamer` reads the `"answer"` string out of the growing JSON and emits only new text
  (escapes split across chunks are held back); `reset` when a round with streamed text turns into tool calls; `tool`
  events while reading.
- Route: `Accept: text/event-stream` → Server-Sent Events `delta` / `reset` / `tool`, then `done` with the stored
  message (same body as the JSON answer) or `error`; without that header one JSON response as before.
  `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no` so compression and proxies do not buffer.
  Closing the tab or **Stop** aborts the provider call; the stopped answer is not stored (the question is).
  The key is checked before the chat is created (an unknown credential is a 404, no longer a 500).
- Panel: text appears as it arrives with a cursor, "Reading list_projects …" while a tool runs, **Stop** replaces Send;
  an unfinished trailing Markdown link waits until complete.
- Checked 06.11.26 with real keys (tiny prompts): Anthropic Haiku 5.5, OpenAI gpt-5.4-mini, Gemini 2.5 Flash, DeepSeek
  Flash – chunks joined = final text, usage reported, abort → cancelled.

## Stage 4: more read tools (#282, 08.11.26)

- `get_project` (brief shortened, requirement list version and whether it is **current** – a council starts only on a
  current list –, documents, councils), `list_documents` (role in words: source of requirements or context only,
  origin, image description state), `get_build_status` (latest build of a decision: status, tasks done, last test run,
  reviews, whether a draft PR may be opened with the blocking reasons, PR link) and `search` (all words of the query in
  project name, idea, goal or requirements; matching decisions). Same rule as before: repository functions with the
  user's actor, a foreign id is "not found", every result carries links to the real pages (chips in the panel).
- The panel names the tools in the interface language ("Liest Projekte …", "gelesen: das Projekt") instead of
  `list_projects`.
- Tests: `apps/web/src/lib/server/assistant-tools.test.ts` (content, links, search, another workspace sees nothing).

## Fixes from the overall test (#275, 08.11.26)
- **Answer language:** the assistant answers in the language of the user's latest message (a German question gets a
  German answer even with an English interface); only when that is unclear it falls back to the interface language.
  Chat summaries follow the language of the conversation.
- **Links with brackets:** link labels may contain one level of square brackets, so project names like
  "[Benchmark] Todo" stay one clickable link in the panel and one "label (link)" line in the PDF.
- **Saved repository context:** the saved line stands on its own and the Change/Remove buttons sit below it, so the
  narrow side column no longer squeezes the text.

## Cost per answer (#281, 08.11.26)

Under every answer the panel shows the approximate cost next to the tokens ("≈ 0,0021 $"), computed from the price the
workspace entered for that provider and model (Settings → Billing & usage, `model_price_hint`;
`apps/web/src/lib/server/assistant-cost.ts`). Without a price for that model nothing is shown – no invented numbers.
The chat API (`GET /api/assistant/chats/{id}`, the answer of `POST …/messages`) returns `cost: { amount, currency } | null`
per message. Still open in #281: second model as reviewer / second opinion, server-side default model per user,
daily/monthly assistant budget (these need new columns).

## Chat export (#280, 08.11.26)

History tab → ⤓ next to a chat downloads it as Markdown (`GET /api/assistant/chats/{id}/export`, only the owner, like
reading it): title, export time, every message with author, time and model, the app pages it linked (absolute links;
external links are left out) and its suggested actions with their status. Labels in the interface language
(`assistant.export`). `apps/web/src/lib/server/assistant-export.ts`. PDF export and the stored summary of long chats
(with the user's consent) stay open in #280.

## PDF and Word (#280, #282, 08.11.26)

- **Chat as PDF/Word**: History tab → *PDF* next to ⤓; `GET /api/assistant/chats/{id}/export?format=pdf|docx` (default
  `md`). Same content as the Markdown export, with a header "Assistant chat · exported …" and the note that model
  statements are not a fact check.
- **Customer summary as PDF/Word**: after the user accepted a `draft_customer_summary` suggestion (with their edits), the
  card offers *PDF · Word*: `GET /api/assistant/chats/{id}/messages/{messageId}/actions/{actionId}/document?format=pdf|docx`.
  The file holds exactly the accepted text – no new model call –, titled "Customer summary: <project>", marked as an
  **AI summary** and "not a council verdict". Only the chat's owner; other actions or not accepted ones → 404.
- Rendering: `apps/web/src/lib/server/assistant-pdf.ts` uses the block parser and PDF-safe text of the decision report
  (`reportBlocks`, `pdfSafe`) without changing the decision report files. Labels in 5 languages (`assistant.document`).
- Still open in #280: a stored summary of long chats (only with the user's consent, it costs tokens).

## Open from anywhere (#279, 08.11.26)

`openAssistant({ prompt? })` (`apps/web/src/components/assistant-open.tsx`) opens the panel on the chat tab with the
question pre-filled – it is **not sent**; the user reads, edits and sends it (a question costs tokens). The page context
(e.g. the decision) is switched on. `AskAssistantButton` ("Ask the AI") uses it; the Final Verdict screen shows it with
"Summarise this decision …" as the question. The panel listens for the window event `consyrium:open-assistant`.

## Native tool calling in packages/ai (#284, 08.11.26)

`GenerateRequest.tools` (`{ name, description, parameters }`, JSON Schema) and `GenerateResult.toolCalls`
(`{ id, name, args }`); earlier rounds go back as `ChatMessage.toolCalls` (assistant) and `ChatMessage.toolResults`
(user, `{ callId, name, content }`). Mapping per provider:

| Provider | Tools | Call in history | Result in history |
| --- | --- | --- | --- |
| Anthropic | `tools[].input_schema` | `tool_use` block | `tool_result` block |
| OpenAI (Responses) | `{type:"function", strict:false}` | `function_call` item | `function_call_output` item |
| Gemini | `functionDeclarations[].parametersJsonSchema` | `functionCall` part | `functionResponse` part |
| DeepSeek, GLM, Kimi, Qwen, Grok | chat `tools[].function` | assistant `tool_calls` | `role: "tool"` message |

Arguments are parsed into objects (`parseToolArgs`; broken JSON becomes `{ _invalid_json }` for the model instead of
an exception); Gemini calls without ids get numbered ids. With tools the adapters use the non-streaming call and pass
the text to `onText` once; tools are not combined with `jsonSchema`. Without tools every adapter behaves exactly as
before (councils unchanged). Tests: `packages/ai/src/adapters/tools.test.ts`.

## Settings, second opinion and limits (#281, 08.11.26)

- **Stored per user and workspace** (`assistant_preference`, migration 0039; `packages/db/src/repositories/assistant.ts`):
  default model, an optional second model for second opinions, optional token limits per day and per month. Only the
  user reads and changes them; a key of another workspace is "not found". `GET/PUT /api/assistant/preferences` returns
  the settings with today's and this month's usage. Choosing a model in the panel also saves it as the default, so
  another device starts with it; a question without a model uses the default.
- **Second opinion**: with a second model set, every answer shows _Second opinion_. `POST
/api/assistant/chats/{id}/messages/{messageId}/review` lets that model check the answer with the same read-only tools
  (question and answer passed as data); it answers with a verdict line and the errors or gaps, suggests no actions, and
  is stored as an answer with `assistant_message.review_of` (shown indented, marked "Second opinion"). One per answer.
- **Limits** (hard since #519): before every paid call (question, council-chat answer, second opinion, cross-check,
  summary) its estimated tokens are reserved against the user's limits (UTC day, UTC month) under a workspace lock; a
  call that would pass a limit is refused with the tokens it needs and what is left. After the call the reservation is
  replaced by the real tokens (or given back). A limit can only be passed when one call uses more than its estimate.
  Councils keep their own budget.
- **Plan limit** (08.11.26): entitlement `maxAssistantQuestionsPerDay` – questions of the whole workspace per UTC day
  (answers and second opinions do not count). A guard against misuse of the platform, not a token limit (tokens are
  paid by the customer's own key). Defaults: Free 50, Pro 500, Developer 1,000, Business and self-hosted unlimited;
  the platform admin changes it per plan in `/admin` (existing plan rows get the default automatically).

## Native tool loop (#284, 08.11.26)

`ASSISTANT_TOOL_MODE=native` switches the assistant (questions and second opinions) to the providers' own tool calling
(`runNativeAssistant` in `apps/web/src/lib/server/assistant.ts`): the read tools become tool definitions (argument
schemas derived from their `args` text), suggested actions come as a call of the pseudo tool `suggest_actions` and pass
the same allowlist, at most 4 rounds and 4 calls per round, the last round offers only `suggest_actions` so the model
answers. Results go back by call id as data; external links are dropped as before. A provider that rejects native tools
(`bad_request` / `invalid_output`) falls back to the JSON loop in the same request; other errors (key, rate limit) are
reported as before.

**Default stays `json`**: the JSON loop works on every provider and streams the answer word by word; in native mode the
answer arrives at once (the adapters do not stream tool calls). Switch per deployment once streaming of native rounds
is needed or token savings matter more than the streamed text.

## Summary of long chats (#280, 08.11.26)

The model reads the last 20 messages of a chat. In a longer chat the panel says how many older messages it no longer
reads and offers **Create summary** – one call on the chat's model (or the default) without tools, only on the user's
click, after the user's assistant limits are checked. `POST /api/assistant/chats/{id}/summary` stores it in
`assistant_chat.summary` with `summary_until` (migration 0040); a later summary includes the previous one. Questions
then get the summary as data (`<summary>` in the system prompt) plus only the messages after it; second opinions stay
out of the history. Nothing is summarised automatically.

## Usage ledger (ChatGPT review 08.11.26, migration 0042)

Every paid assistant call – answer, second opinion, summary – writes one row to `assistant_usage` (organization, user,
kind, tokens, time; no content and no link to the chat). The user's daily/monthly token limits and the plan's daily
question count read this ledger, so deleting a chat (privacy) no longer resets them, summaries count toward the token
limits, and a question whose answer failed does not count as a question. Migration 0042 copies the tokens of answers
stored so far into the ledger and adds a unique index on `assistant_message.review_of` (one second opinion per answer,
also for parallel requests).

## Review findings fixed (ChatGPT code review, 08.11.26)

- Native mode: tool results are marked as data in the system prompt like in the JSON loop; tokens of native rounds
  before a fallback to the JSON loop are counted.
- PDF: characters outside the PDF fonts (e.g. Chinese) are replaced by "?"; the file then says so and points to the
  Word file, which keeps the full text.
- `search` reads briefs and filters the same 100 projects.
- The token limits were **soft** (checked before a call); since #519 the estimate is reserved before the call, see
  "Limits" above. Usage that survives deleting a chat and counts summaries (findings
  1, 2, 12) comes from the usage ledger (see below, migration 0042).

## Council chat and single perspective (#241 stage 1/1b, 08.11.26)

The chat tab has two modes: **1 model** and **Council chat**.

- **Council chat:** pick 2–4 models of your keys. Each answers the question as its own voice (in parallel), sees the
  earlier answers of the others labelled with their model (as data) and may agree or disagree. A question starting with
  `@model` (id, id prefix or name) is answered only by that model. Before sending, the panel shows an upper token estimate ("up to …", live 08.11.26: 14,092 estimated vs. 4,159 real for two short answers without tools) for
  the answers and – separately – for the optional cross-check (stage 2, only on click). Every answer is a stored
  message with its model, goes into the usage ledger (`answer` once per question, further answers `council_answer`, so
  the plan's daily question count counts a question once) and counts toward the user's token limits. Council-chat
  answers suggest no action cards; a model that fails is named, the others still answer.
- **Single perspective (1 model):** an optional expert perspective (security, cost, product, architecture,
  operations, legal & compliance). The answer is marked "Single perspective: … – unverified" – no score, no gate, not
  an independent check.
- `POST /api/assistant/chats/{id|new}/council` `{ content, participants: [{credentialId, modelId, label?}], perspective?,
  context?, preview? }` – `preview: true` returns `{ estimate: { answers, withCheck, checks }, answering }` without a
  model call. Code: `apps/web/src/lib/server/council-chat.ts`.
- Stage 3 "Make it a council": see below.

## Cross-check in the council chat (#241 stage 2, 08.11.26, migration 0047)

- In council-chat mode every answer has a **Cross-check** button. The first click shows how many other models check it
  and the estimated tokens; nothing is paid until **Check now**. Never automatic.
- Each *other* model of the council chat (never the model that wrote the answer, each model once per answer) judges the
  answer: **✓ confirmed**, **⚠ contradicted** (what is wrong and what is right) or **? not checkable** (e.g. workspace
  facts it cannot see), with a short reason in the language of the question. One call per checker without tools; it
  sees the question, the answer and the other answers of the same turn – all marked as data. Output that is not a valid
  verdict counts as "not checkable", never as confirmed.
- Overall label under the answer: *Confirmed by the other models* only when every check confirms; one contradiction
  makes it *Contradicted – read the objections* (the answer and the objection both stay visible); otherwise *Not
  verified*. Questions about **medicine, law, security or data protection** are never "confirmed", however many models
  agree, and carry the note to have a professional check them. The topic is taken from the question only (answers use
  words like "Sicherheit" or "rechtfertigen" without being about it – live test 08.11.26).
- Model ids are compared without provider prefix, trailing date and "-latest": providers return dated ids
  (`gpt-5.4-mini-2026-03-17`) for the picked `gpt-5.4-mini`, so a model never checks its own answer and is not offered a
  second time; the button disappears when every other council model has checked.
- Table `assistant_check` (chat, answer, checking model, verdict, reason, tokens; unique per answer and model, also for
  parallel requests); deleted with the chat. Every check also goes into the usage ledger as `cross_check` and counts
  toward the user's token limits; the plan's daily question count counts questions, not checks. The second opinion of
  the 1-model chat stays unchanged.
- `POST /api/assistant/chats/{id}/messages/{messageId}/check` `{ participants: [{credentialId, modelId, label?}],
  preview? }` – `preview: true` returns `{ estimate: { tokens, checks }, checkers, sensitive }`; otherwise
  `{ checks, failures, sensitive }`. `GET /api/assistant/chats/{id}` returns the checks with the chat.
- Code: `apps/web/src/lib/council-check.ts` (labels, shared with the panel), `apps/web/src/lib/server/council-chat.ts`
  (`runCheck`, `parseCheck`). Tests: `council-chat.test.ts`, `packages/db/src/repositories/assistant.test.ts`.

## Make it a council (#241 stage 3, 08.11.26)

- After at least two different models have answered in a council chat, the panel shows **Make it a council**. One click
  sends a prepared question to the first model of the council chat in the normal 1-model path (one answer, plan quota
  and limits as usual).
- The answer comes with the existing action cards: a project draft (`create_project_draft`, or `draft_brief` for the
  project in context) with idea and goal from the question, the points the models agreed on as requirements and every
  open disagreement as a requirement that must be checked. Nothing starts by itself: the user runs the card, confirms
  the requirement list and starts the council from its form with the cost estimate (normal intake, #215).
- Live test 08.11.26: Haiku announced a project draft, but the card was dropped as invalid (it sent `requirements` as a
  list). `create_project_draft`/`draft_brief` now accept a list and join it into "- " lines; the prompt names the
  format; dropped suggestions are logged by type and reason (no content). Answer and cards use the language of the
  council chat's question; the button hides right after it was used.
- #583 (11.11.26), from a real council chat where several voices said "I prepared a card" and none was there:
  - Voices of a council chat are told that they cannot create cards and must not announce one; they point to
    **Make it a council**. (Their suggestions were always dropped by the route – only the wording was wrong.)
  - The project card's button reads **Create project now**: one click saves the project as a draft and shows its link.
  - An answer whose card was dropped, or that was asked for a card and brought none, is stored with the marker
    `_card_missing`: the chat says that there is no card and that nothing was created, with **Ask for the card again**
    under the latest answer – also after a reload or from the history.
  - Small slips no longer cost the card: an overlong name, goal or idea is cut to its limit, an unknown project type
    becomes "idea", `null` for goal or requirements counts as empty. Values the user edits are validated strictly.
  - What happened to earlier cards goes into the history as an app record (ran with result link, still waiting,
    dismissed), so later answers name the real project instead of "there is no project yet".
  - Tool calls a model writes as text (`[{"name": …}]</tool_calls>`, DeepSeek) are run as tool calls and never shown.
  - Still open in #583: context for the cross-check and paging of the project list in the assistant.
- For follow-up questions after a council chat the history keeps each answer's model label (`[provider/model] …`), so
  the model knows who said what. The rule is in the assistant's system prompt; the cards keep the server allowlist.

## Load and race tests (#510, 08.11.26)

`apps/web/src/app/api/assistant/assistant-load.test.ts` runs the real route handlers on PGlite with a scripted provider
(no key, no network; each answer waits a little so parallel requests overlap).

- **Plan quota (questions per day):** before the fix, 20 parallel questions with a limit of 5 were all answered – the
  check counted booked answers, and none was booked yet. Now `reserveAssistantQuestion` reserves the question under a
  row lock of the workspace before the model runs (an "answer" row with 0 tokens), `settleAssistantQuestion` books the
  real tokens, `releaseAssistantQuestion` gives it back when no answer came. The council chat reserves once per question.
  Result: at most 5 of 20 (assistant) and 5 of 10 (council chat), each booked once.
- **Double click** on second opinion or cross-check: one record each (unique indexes) and, since #510, only one paid call –
  `onceAtATime` refuses the second identical request with 409 while the first runs (per server process; the indexes stay
  the guarantee across processes).
- **Abort** mid-answer: no answer stored, nothing booked (the reservation is released).
- **Rate limit** 20 per minute per user: the 21st request gets 429.
- **Personal token limit** (#519): measured +50 % with 10 parallel questions before; now each call reserves its estimate
  (`estimateAnswerTokens`, `estimateCheckTokens`, `estimateSummaryTokens`) under the workspace lock
  (`reserveAssistantUsage`) – with room for three estimates, exactly 3 of 10 parallel questions run and only their real
  tokens stay booked.

## Export with cross-checks (#486, 08.11.26)
The chat export (Markdown, PDF, Word) puts every cross-check under the answer it checked: the overall label (confirmed /
contradicted – read the objections / not verified, plus the medicine/law/security note) and each verdict with model and
reason, in the same words as the panel. So the document never looks more certain than the chat. The PDF shows the words
without ✓/⚠ (its font has no such characters). Code: `chatMarkdown` in `apps/web/src/lib/server/assistant-export.ts`.
- **Personal token limit** stays soft (checked before the call): measured +50 % with 10 parallel questions → #519.

## Quick questions per page (#486, 08.11.26)
An empty chat offers questions that fit the page (chips, nothing is sent until the user presses Send):
- decision page: summary for a customer, what speaks against the recommendation / open objections, next step;
- project page: what is missing in the brief, ready for a council (unconfirmed requirements), risks to check;
- elsewhere: open steps, decisions waiting for approval, summary.
On a project page the question carries the project as context (chip "About this project", removable), like the
decision context on a decision page; the model reads it with its tools.
## Report a conversation (#486 part 3, 08.11.26)
Under a chat, **Report this conversation** opens a box: an explanation (required), a preview of exactly the excerpt that
would be sent, and a checkbox to agree. Only after consent the explanation plus that excerpt go to the feedback inbox
(#295) as a bug report (page `/assistant`); admins are notified like for any report.
- The excerpt is built on the server only (`reportExcerpt`, `apps/web/src/lib/server/assistant-report.ts`): the last 10
  messages, each at most 1,500 characters, at most 3,000 in total; who wrote it, the model and the text – no tool data,
  links, actions, ids or tokens; anything that looks like a key is replaced (`redactSecrets`).
- Stored in the feedback text, so it is part of the user's data export and is deleted like feedback reports (no fixed
  period – docs/feedback.md). Privacy page and `docs/privacy-data-map.md` name it.
- `POST /api/assistant/chats/{id}/report` `{ explanation, consent, preview? }`; only the chat's owner; 10 reports per day.

## Prepare a project with me – interview (#215 stage 1, 08.11.26)
An empty chat (1-model mode) offers **Prepare a project with me**. In this mode every answer:
- asks at most 3 questions, the most decision-relevant open points first, and skips what does not matter for the question;
- fills a fixed checklist: decision, options (status quo / small trial only when the user agrees), goal and success
  measure, hard limits, decision or build, reversibility, and optionally the user's leaning (context the models must
  question, never a weight) – each **answered**, **assumed** (never turned into a requirement) or **open**;
- ends with a short draft and the existing `create_project_draft` / `draft_brief` card. The requirement list is still
  confirmed by the user on the project page; a council still starts from the council form (stage 2 adds a start card).

The panel shows "Preparing a project · 4 of 6 points clear", the open points and the unconfirmed assumptions, and an
End button. The checklist is stored as a marker on the answer (`_interview`), so a reopened chat continues the
interview. Interview answers always use the JSON loop (schema `assistant_interview_step` with `checklist`), also when
`ASSISTANT_TOOL_MODE=native`. Costs like any question (reserved, plan quota, limits). Code: `withInterview`,
`INTERVIEW_KEYS`, `parseChecklist` in `apps/web/src/lib/server/assistant.ts`; request flag `interview: true`.

## Start a council from the chat (#215 stage 2, 08.11.26)
When the user asks to start a council and the project's requirement list is confirmed for the current brief, the
assistant may suggest a **start_council** card (`{ projectId, tokenBudget? }`, at most 1,000,000). The card:
- loads the **cost preview** with the same service as the council form (`previewSession`): project, models of the
  workspace's last council (as for MCP and Telegram), budget, upper bound, typical use, plan limit, Final Verdict fit,
  a note when phases may be shortened, and whether the requirement list is current;
- starts only after the user ticks **"I confirm the costs: up to N tokens on my own keys"** and presses Start;
- at the click the server builds the preview again; if brief, requirement list, models, budget or estimate changed it
  refuses with 409 and the new preview (no start without a fresh confirmation);
- starts exactly one council (`createSession`, idempotency key per card, `onceAtATime` for a double click), marks the
  card executed (`completeCouncilStartAction`, audit `assistant.council_started` with chat, session and budget – no
  prompt, no keys) and then shows the session's live status (server-sent `usage` event of `/api/sessions/{id}/events`, #12; polling every 5 s only as fallback when the stream breaks) with a link;
- offers "Adjust in the form" for other models or settings, and "Dismiss".
The generic action route never runs `start_council` (409), and the model cannot start anything by itself. Route:
`POST /api/assistant/chats/{id}/messages/{messageId}/actions/{actionId}/council` `{ preview: true }` or
`{ confirmCosts: true, previewHash }`. Tests: `council-start-route.test.ts`, `assistant-actions.test.ts`.
## Decision facts like the screen (Gesamttest 0d, finding 10, 08.11.26)
`get_session` also returns `statusText` (the readable verdict status from `reportStatus` – the same derivation as the
verdict screen and the PDF), `humanMarks` (favourite / prototype build), `openMeasurements`, `nextSteps`, and
`projectArchived` with a note. The prompt tells the model to use these words instead of raw values such as
`needs_verification`, and never to suggest a decision, a council or a build in an archived project (restore it first).
`list_open_steps` leaves councils of archived projects out.

## Options, assumptions and leaning (#215 stage 3, 08.11.26)
In the interview the assistant lists the options as A/B/C; "status quo" or "a small reversible trial" is added only
after the user says yes. The draft puts options, unconfirmed assumptions and the user's leaning into sections whose
heading ends with `[context]` (e.g. `## Assumptions (unconfirmed) [context]`); the requirement intake skips those
sections (`stripContextSections` in `packages/core/src/engine/requirement-extraction.ts`), so they are never proposed
as hard requirements, and no card can carry weights or roles – the leaning is context for the models to question. The
brief's source hash still covers the whole text. The interview banner shows the options; after the council the start
card points to the verdict and its next steps.
- Live test 08.11.26 (one real council, 110,805 tokens): `get_project` now says `requirementList.confirmed` and
  `councilCanStart` explicitly (the model was unsure with version + current alone), and the start card names the
  minimum budget when the budget is too small instead of only disabling the start.
