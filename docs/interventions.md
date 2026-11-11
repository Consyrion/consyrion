# Human interventions after the verdict (#15/#41, stage 1)

After a council has reached its verdict (status awaiting approval, approved, rejected or changes requested) a person
with the right to decide (`decision:approve`) can:

- **ask the council a question** – every active model answers once, about its *own* proposal;
- **request a statement on an objection** – the author of the objected proposal and the model that raised the
  objection answer once each;
- **mark an objection or key dispute as important** – no model call.

## What it never does
- No intervention while the council runs: the debate and the S1 round stay independent (same input for every model).
- Nothing is written into proposals, revisions, scores, votes, requirement checks or the verdict. Answers are stored
  apart (`human_intervention`, `human_intervention_answer`) and shown as "a human's question – no effect on the verdict
  or the checks". For a real change use the follow-up round (#228/#229) or a new council.
- Archived projects are read-only (`assertSessionProjectWritable`).

## Calls and cost
- One call per asked model, without tools; the question, the model's own proposal and the objection go in as marked
  data (`<human_question>`, `<your_proposal>`, `<objection>`), never as instructions. Timeout from the session policy
  (raised to the provider minimum), one quick retry for a rate limit or an unavailable provider.
- Preview first (models and estimated tokens), then the user confirms the costs. At most 30,000 tokens per
  intervention, 10 interventions per hour per user, one at a time per session.
- Every call writes a `usage_record` with the session, the participant, **no phase** and `kind = "intervention"`
  (outcome ok / error / refusal / invalid_output / max_tokens). It is real cost of the session (session token totals
  include it) but no phase contribution: the per-model contribution chart and the activity nodes leave it out. It never
  uses the monthly council quota.

## API
- `GET /api/sessions/{id}/interventions` – interventions with answers (also in the session view as `interventions`).
- `POST /api/sessions/{id}/interventions` `{ kind: "question" | "statement_request", targetId?, text, preview?, confirmCosts? }`.
- `POST /api/sessions/{id}/interventions/mark` `{ targetType: "objection" | "crux", targetId }` – toggles the mark.

Migration: tables `human_intervention`, `human_intervention_answer`, column `usage_record.kind`. Both tables are part of
the workspace export. Code: `packages/db/src/repositories/interventions.ts`, `apps/web/src/lib/server/interventions.ts`.
## Screens
- **Objections** (Minority Review tab): under each objection "Mark as important" / "Remove mark" and "Request a
  statement" (optional text → "Check costs" → models and tokens → "I confirm the costs" → "Ask"). Earlier statements stay
  visible as "A human's question – no effect on the verdict or the checks".
- **Final Verdict**: "Ask the council" – the same flow for a question to every model.
- **Key disputes** (#267): a read-only line "Human questions: n · marked: m" – never part of the ranking.
- Asking is offered only to people who may decide, only after the verdict and never in an archived project; others see
  the answers. Component: `apps/web/src/components/session/human-questions.tsx`. Replay and report are added by the
  council-room owner from `view.interventions`.

## Output limit and display (10 Nov 2026)

Each call gets the provider's minimum output limit of the council (`PROVIDER_MIN_OUTPUT_TOKENS`, e.g. 16,000 for
Gemini and Kimi) instead of a flat 700: models that reason first were cut off after one sentence. This is only a
reservation; the session is charged with the tokens actually used. The cost preview adds 2,000 tokens for such a
model. Answers are shown with the same small Markdown subset as the assistant (`components/ui/markdown.tsx`).
