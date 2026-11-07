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

## Next

- Native tool calling (Anthropic tools, OpenAI tools, Gemini functionDeclarations) instead of the JSON loop – the JSON
  loop works on every provider today; native calls would save tokens. Stays open in #284.
