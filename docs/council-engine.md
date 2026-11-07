# Council engine (Milestone 2)

Package `packages/council`. Runs the seven Consyrion phases as persistent workflow stages.

A council starts only on a requirement list the user confirmed for the current brief version and documents (#190,
`docs/requirements-intake.md`). The session is bound to that list version for its whole run; the list is part of
the frozen brief every phase sees, and verdict, approval and execution check that they belong to it.

## Flow

| #   | Phase                | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Stored as                                                   |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | Independent Thinking | Every model gets the identical frozen brief in its own request, in parallel. No peer output exists yet. After all calls finished (or failed) the proposals are revealed **atomically** with neutral labels A, B, C in random order. Fewer than two proposals → session fails honestly.                                                                                                                                                                                                                                                                                                                                                                                                         | `proposal`, `proposal_revision` v1                          |
| 2   | Open Council         | Each model compares all anonymous proposals (common ground, differences) and – depending on the mode – asks targeted questions that the authors answer. No winner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `debate_message` (comparison/question/answer)               |
| 3   | 12 Minds Council     | Configurable perspectives (1–12) are spread over the models. Each role reviews all proposals in one call: concrete critiques with category, severity, evidence – or "no substantiated objection" – plus a current preference. Rebuttal threads in modes with rebuttals. Bounded rounds.                                                                                                                                                                                                                                                                                                                                                                                                        | `debate_message` (critique/rebuttal/preference/role_failed) |
| 4   | Minority Review      | Favourite = majority **per model** (several roles of one model count once). Critiques above the mode threshold, and every medium+ critique of the favourite from a dissenting role, become objections. The author answers; independent models (never author or raiser) decide refuted/resolved/accepted/unresolved. Disagreeing or missing reviewers → unresolved. Unresolved/accepted critical security objections **block**.                                                                                                                                                                                                                                                                 | `minority_objection`, `minority_review`                     |
| 5   | Consensus Round      | Authors revise or keep their position, citing objection ids. Revisions are new immutable versions. Consensus mode may create a hybrid, which gets its own security review. Unresolved objections always become outstanding risks. "No consensus" is valid.                                                                                                                                                                                                                                                                                                                                                                                                                                     | `proposal_revision` v2+, `consensus_result`                 |
| 6   | Final Verdict        | Every model scores all proposals **except its own** (0–10 per criterion, rationale) and ranks them. Deterministic aggregation (`@consyrion/core` `aggregateVerdict`): self-scores ignored, gates first (security minimum, blocking objections, minimum total, missing scores), close totals = tie, majority vote (Borda) reported separately. **Confidence:** the verdict is marked _low_ when a proposal was scored by fewer evaluators than expected (all participants except its author) or the majority vote favours another proposal; models whose evaluation failed are listed with the reason (`failedEvaluators`). The UI and report show this as a warning – the human still decides. | `evaluation_score`, `vote`, `final_decision`                |
| 7   | Execution Council    | Not started automatically. Requires a human approval (Milestone 4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | –                                                           |

Human actions after the verdict (`POST /api/sessions/:id/approval`, owners/admins only): approve,
select alternative (with reason), reject, request changes, request more debate (bounded extra rounds;
re-runs 12 Minds Council → Final Verdict, the old verdict is kept as superseded). Blocked proposals cannot
be approved by any action.

## Modes (orchestration, not just wording)

|                                              | Independent Expert | Adversarial Review | Consensus      |
| -------------------------------------------- | ------------------ | ------------------ | -------------- |
| Roles                                        | 4                  | 12                 | 6              |
| Debate rounds                                | 1                  | 2                  | 1              |
| Rebuttals                                    | no                 | yes                | yes            |
| Open Council questions                       | yes                | yes                | no             |
| Objection threshold                          | high               | medium             | high           |
| Independent verification (2 judges)          | no                 | yes                | no             |
| Consensus revision passes                    | 1                  | 1                  | 2              |
| Hybrid proposal                              | no                 | no                 | yes            |
| Weights (quality/security/maint./cost/speed) | 30/25/20/15/10     | 30/35/15/10/10     | 30/25/20/15/10 |

Clients may override roles, rounds, hybrid, weights and budget within validated bounds; gates cannot be
switched off. The policy snapshot is stored with the session (`policy`, `policyVersion`).

## Safety and cost controls

- At most 3 councils run at the same time per workspace (`MAX_CONCURRENT_SESSIONS`); starting a fourth is
  refused with a clear message until one finishes or is stopped.
- Server-side token budget: before every call an estimate (input chars / 4 + max output) is reserved
  atomically; parallel calls cannot overrun it. Actual usage replaces the reservation. Tokenizer
  differences can make the real input count deviate slightly from the estimate. `council_session.tokens_used`
  therefore includes the reservations of running calls and can drop when one finishes; the Council Room shows the
  recorded usage (sum of `usage_record`) as "Tokens used" and the rest as "reserved for running calls" (#173).
  A call a worker restart interrupts never settles its reservation; `reconcileTokens` therefore resets the counter
  to the recorded council usage (without Execution Council rows) when a run starts or resumes and when it reaches
  the approval (night test 07.11.26: 916,799 counted vs. 789,888 recorded).
- Every call: cancellation check, retries only for transient errors, timeout, usage row with outcome
  (ok/error/refusal/invalid_output/max_tokens) and – for every failed call – the error kind and HTTP status
  (`usage_record.error_kind`, `http_status`, #175), zod validation of the JSON answer.
- Corrective retry: an answer that is cut off (`max_tokens`) or does not match the schema
  (`invalid_output`) gets exactly one more attempt – with the schema violations (paths only) or a
  "complete and more concise" note appended, and for cut-off answers a doubled output limit (max 32,000).
  Each attempt is budgeted and recorded as its own usage row.
- Overloaded provider (HTTP 503) or rate limit (#146): after the quick transient retries (a few seconds) the call
  waits `TRANSIENT_RETRY_DELAY_MS` (45 s, other models usually still work on the same phase) and tries once more.
  Budget and cancellation are checked during the wait (every 5 s) and again before the attempt. A model that still
  fails drops out with the reason "<provider> overloaded or unavailable (HTTP 503)" or "<provider> rate limit",
  distinct from invalid answers.
- Provider output minimum (`PROVIDER_MIN_OUTPUT_TOKENS`): DeepSeek, GLM, Qwen and xAI at least 8,000 output
  tokens, Kimi and Google at least 16,000 (#147: Kimi K2.6 and Gemini spend part of it on reasoning). Anthropic
  calls for large answers – proposal, revision, hybrid, scorecard (`LARGE_ANSWER_SCHEMAS`) – start at 8,000: Claude
  Haiku 5.5 was cut off at 4,000 in almost every run and paid each step twice. The cost preview includes all of it.
  Since #172 Anthropic starts at 8,000 for every call, and answers that grow with what they cover get a limit per
  item (`OUTPUT_TOKENS_PER_ITEM`, at most 32,000): role review 2,000 per proposal, scorecard 1,500 per proposal,
  Open Council 800 per proposal, 500 per question, critique or objection answered, 400 per objection judged.
  The system prompt asks for concise fields (a few sentences, each point once).
- Since #243 (measured with `deploy/hetzner/call-report.sh`, 27.–30.10.26: 6.8 % of the calls on 30.10. cut off or
  invalid, none near a context window – largest input 49k tokens): OpenAI starts at 8,000 (gpt-5-mini spends part of
  the output on reasoning and was cut off at 4,000 in 7 of 94 calls), and OpenAI and DeepSeek start large answers at
  16,000 (with repository context DeepSeek V4.1 Flash was cut off at 8,000 in 10 Independent Thinking calls). Only
  the reservation grows; usage is charged as measured. Re-run the report after the next councils to compare.

## Provider failures and output limits (#172, #175)

Live councils showed three failure patterns: Claude Haiku 5.5 cut off in almost every phase (36 % of the budget,
0 critiques in the 12 Minds Council), DeepSeek Flash writing 8,000 + 16,000 output tokens for one proposal, and a
phase waiting 50+ minutes for Gemini 3.5 Flash while the token counter stood still. What the engine does now:

- **Raised limit is remembered.** When an answer is cut off (`max_tokens`), the repair uses the doubled limit and
  the participant's later calls of the whole run start at that limit (`SessionContext.outputFloors`) instead of
  being cut off again. A resumed run rebuilds it from the usage rows.
- **Runaway answers.** A cut-off answer whose raw text repeats the same passage or pads with whitespace
  (`looksRepetitive`, a cheap check on the last 6,000 characters) is recorded with error kind `runaway` and asked
  again with an explicit length instruction (each point once, at most three sentences per field, seven entries per
  list) at the same limit – doubling it only doubled the repetition.
- **Why the phase waited.** Each role review, rebuttal and answer is its own call, and every call ran its own chain:
  three quick retries, the 45 s pause and a late retry for 503/429, or timeout → 1.5× repair → last attempt
  (Gemini: 300 + 450 + 450 s). Four roles of one model, then its rebuttals, then round 2 repeated the same chain
  for a model that was down, so a phase took up to 4 × 20 minutes. Now:
  - all follow-ups of one call end within `CALL_DEADLINE_FACTOR` (2.5) × its timeout; a follow-up starts only if a
    quarter of a timeout is left and waits at most what is left;
  - a model with a provider-side failure (timeout, overload, rate limit, network, auth, …) in a phase gets no late
    retry and no timeout repair for its further calls of that phase;
  - after `PHASE_FAILURE_LIMIT` (2) such failures its remaining calls of the phase are not sent at all
    ("skipped: … already failed in this phase (last: overloaded)").
    A failed 12 Minds role is stored as `debate_message` kind `role_failed` (body = reason, evidence = error kind):
    the phase continues, a resumed run does not ask it again, and the Council Room shows it as failed, not pending.
- **Council Room.** Every model shows its failed calls and the last error kind (e.g. "8 failed calls · last:
  overloaded (HTTP 503)", from `callFailures` in the session view). In the 12 Minds Council a model is "Working"
  until every one of its role reviews of the current round is in and "Roles failed" when some failed – never
  "Submitted" while reviews are pending or failed.
- **Not defended.** When an author's answer call in the Minority Review fails (or the author dropped out), its open
  objections get `minority_objection.undefended_reason` (e.g. "provider error (timeout)"). The judges are told that
  there is no answer for that reason, the Council Room and the report mark them "not defended", and the verdict
  carries the confidence issue `undefended_proposal` – unanswered, not uncontested.
- **Batched, parallel adjudication (#184).** Before #184 each judge got one call with every open objection, and the
  judges ran one after another: with 87 objections a slow model timed out on the giant answer, its repair repeated
  the same task, and the phase hung for 35+ minutes with 0 objections decided. Now
  (`adjudicate` in `packages/council/src/phases.ts`):
  - objections are sent in batches of `ADJUDICATION_BATCH_SIZE` (12), grouped by proposal; each prompt carries only
    the proposals of its batch;
  - all judges run in parallel, each with at most `JUDGE_PARALLEL_CALLS` (3) calls at a time; every batch is its own
    `callStructured` call, so the budget gate, cancellation and output limits apply per batch. A budget refusal ends
    the phase (`skipped`, shortened) after the calls in flight have settled; batches answered before stay decided;
  - each objection still needs `needed` judges (2 with `independentVerification`) that neither wrote the proposal nor
    raised it, least loaded judge first; no judge is asked twice for the same objection;
  - a failed batch (or an objection a judge left out) goes to another eligible judge in the next round. A judge that
    reached `PHASE_FAILURE_LIMIT` provider failures in the phase (#175) gets no further batches;
  - an objection is stored as decided as soon as its judges answered. Objections with no available judge end
    `unresolved` with the reason, e.g. "No independent reviewer was available – provider error (timeout) for every
    eligible judge"; with fewer reviews than required the reason says "1 of 2 required independent reviews". The
    rules for disagreement (→ unresolved), conceded objections (#94) and blocking are unchanged;
  - the Council Room shows the progress next to "Objections & evidence" while the phase runs, e.g. "34 of 87
    objections decided" (`objectionProgress`, derived from the stored objection statuses).
  - Not done: merging duplicate claims of different models before adjudication – the raiser decides who may judge an
    objection, so a merge needs its own rules (see #182).
- **No debate contribution.** An active model without a single successful role review while others reviewed gets
  the confidence issue `no_debate_contribution` (low confidence); its vote still counts if it evaluated.
- **Budget confirmation.** The confirmation (UI checkbox and API error) states that when the budget runs short,
  Minority Review and Consensus Round may be dropped and no proposal is revised.
- Prompt injection: brief, proposals, critiques and answers are wrapped in tags and declared untrusted data.
- Proposal texts are not returned before the reveal; authorship is hidden until a verdict exists.
- Refusals are recorded; no other model silently answers in place of the selected one.

## Running

- Development (PGlite): the web server starts an inline worker (`src/instrumentation.ts`).
- PostgreSQL: run `pnpm --filter @consyrion/worker start` (one or more instances), web with `COUNCIL_WORKER=external`.
- Jobs are durable (`job` table, `SKIP LOCKED`, lock heartbeat); a crashed run resumes from the last
  completed stage and skips model calls whose results are already stored.

## Cost preview

`POST /api/projects/:id/sessions/preview` returns the policy and the number of model calls plus an
upper bound of tokens. No prices are hardcoded; providers bill the user's own keys.

- `planLimit` (#173): the plan gate of the start (models per session, councils per month) is checked by the preview
  too and returned as the refusal message (or `null`) instead of an error, so the estimate stays visible; the team
  screen lists it as a problem and disables "Start council session". The start still enforces it (403).

- The upper bound uses the mean output limit of the selected providers (calls are spread over them) and the larger
  limit of large answers (proposal, revision, hybrid, scorecard) for Independent Thinking, Consensus Round and
  Final Verdict.
- `estimate.typical` (#148): the median tokens of the workspace's last ≤ 500 successful calls × the calls of this
  configuration – only with at least 20 recorded calls, otherwise `null` and the screen says so. Never invented.
- `modelWarnings` (#175): a selected model whose calls in this workspace's councils of the last 14 days failed in at
  least a third of the cases (at least 6 calls) is named with the most frequent error kind, e.g. "gemini-flash-latest:
  9 of 20 calls … failed (mostly timeout)", with a note when the council has three or fewer models. Based only on
  the workspace's own usage rows – there is no hardcoded list of "slow" models.
- If the upper bound exceeds the budget, starting needs `confirmBudget: true` (checkbox "I accept that debate phases
  may be shortened …: if the budget runs short, Minority Review and Consensus Round are dropped and the proposals
  are not revised"); without it the API answers with a validation error that says the same.

## Budget kept for the Final Verdict (#148)

Before #148 a council with 392,117 of 400,000 tokens used failed in the Consensus Round – no verdict, although
every earlier phase was complete. Now:

- Before every phase except the Final Verdict the engine computes `verdictReserve` (`packages/council/src/budget.ts`):
  per active model the Final Verdict prompt (brief + all current proposals + overhead) plus its full output limit,
  because those calls reserve in parallel. Calls of earlier phases may only use the budget above it.
- Open Council, 12 Minds Council, Minority Review and Consensus Round may end early: the stage is `skipped` with
  the error "Shortened: the remaining token budget was kept for the Final Verdict", the next phases try with what
  is left, and the Final Verdict judges the current revisions. The verdict carries the confidence issue
  `phase_shortened` (low confidence) and the report names the shortened phase.
- Independent Thinking cannot be shortened: if even it does not fit next to the reserve, the council fails at once
  ("would leave too little for the Final Verdict") instead of spending tokens on a run that cannot end in a verdict.

## Decision report

Markdown and JSON exports (`/api/sessions/:id/report?format=md|json`) contain the outcome, recommended solution
with independent rationales, evaluation matrix (incl. confidence), the **full debate transcript** (questions,
answers, critiques, rebuttals with model, role, round, target proposal, severity and evidence), remaining risks,
objections, alternatives, consensus and human decisions.

**Valid participation rate (#182):** the report (`validParticipation`, Markdown line "Valid participation: 5/6
(83 %); short: …") and the Final Verdict screen show how many participants delivered a valid contribution in
**every phase they were called in**. It is derived from the stored `usage_record` rows only
(`validParticipation()` in `packages/council/src/participation.ts`, exposed as `participation` in the session view):
a phase counts as delivered when at least one of the model's calls in it ended `ok` (a successful retry counts); a
model marked failed, or without any successful call, falls short and is listed with the phases it missed. Before the
first model call there is no rate. Further quality metrics from #182 (convergence, objection survival, weight
dominance, single-shot benchmark) are not implemented yet.

**Objections, not "minority opinions" (#169):** a critique's `claim` is defined in the schema and the prompt as the
reviewer's **own objection in one sentence**; the attacked statement of the proposal belongs in `evidence`. Before,
some models quoted the attacked statement in `claim`, and the report printed "accepted" in front of it – which read
as if the council had confirmed the (wrong) statement. Report (section "Objections (Minority Review)", JSON field
`objections` – formerly `minorityOpinions`, now with `evidence`), Final Verdict, Minority Review screen and VS Code
render each entry as "Objection by <model> against Proposal X: … Reasoning: … – objection accepted (decision
reason)" via `describeObjection` / `objectionStatusText` in `@consyrion/core`. Stored runs from before keep working:
nothing is migrated; the reasoning shown next to the old `claim` makes clear it was the subject of an objection.
Disagreements between the models remain in the Consensus Round section.

**Conflicting requirements (#173)** are de-duplicated across proposals (`dedupeStatements`: case, punctuation and
whitespace ignored); the same conflict in different words stays, since telling that apart would need a model.

**PDF and Word (#164):** `?format=pdf` and `?format=docx` (buttons "Download PDF" / "Download Word" on the Final
Verdict) render the same Markdown report (`apps/web/src/lib/server/report-documents.ts`), so every format has the
same content and no new model output. PDF: A4, light and print-friendly, CONSYRION AI header with session id and
date, page numbers; standard fonts (Windows-1252 – umlauts, €, dashes and quotes work; a few symbols such as Σ, ≥,
→ become readable ASCII). Word: real headings, lists and tables, editable. Libraries `pdf-lib` and `docx` (both
MIT). Example with demo text: `docs/design/previews/report-example-demo.pdf`.

## OpenAI-compatible providers (DeepSeek, GLM, Kimi, Qwen, Grok)

`packages/ai/src/adapters/openai-compatible.ts` serves every provider that speaks the OpenAI Chat Completions
format without strict JSON schemas. Structured output uses JSON mode (`response_format: json_object`) with the
schema in the system prompt; answers are validated like for every provider. Requests ask for up to 32,768 output
tokens (8,192 again if a model rejects the larger limit) and start at 8,000 (`PROVIDER_MIN_OUTPUT_TOKENS`).

| Provider      | International endpoint                                   | China mainland fallback                             | Key page                                                    |
| ------------- | -------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| DeepSeek      | `https://api.deepseek.com`                               | –                                                   | platform.deepseek.com/api_keys                              |
| Z.ai GLM      | `https://api.z.ai/api/paas/v4`                           | `https://open.bigmodel.cn/api/paas/v4`              | z.ai/manage-apikey/apikey-list                              |
| Moonshot Kimi | `https://api.moonshot.ai/v1`                             | `https://api.moonshot.cn/v1`                        | platform.kimi.ai/console/api-keys                           |
| Alibaba Qwen  | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | per region, see help.aliyun.com/en/model-studio/get-api-key |
| xAI Grok      | `https://api.x.ai/v1`                                    | –                                                   | console.x.ai                                                |

- **Region-locked keys**: a key rejected with 401/403 is retried against the next endpoint; the endpoint that
  accepted a key is remembered in memory under a SHA-256 hash of provider + key (never the key itself).
- **Model lists** come live from `GET /models` (verified to exist for Kimi and Qwen). If a provider answers 404
  after accepting the key, the list is empty and model ids are added manually in the team configuration.
- Media models of Qwen (Wan, Paraformer, CosyVoice, Sambert, rerankers), GLM (CogView, CogVideo) and Grok Imagine are
  filtered out of council model lists (`model-filter.ts`), applied in every adapter's `listModels` – also the
  OpenAI-compatible one (#118: it had missed the filter, so Grok Imagine models were offered). The key check therefore
  reports only council-capable models, and `previewSession` / `createSession` refuse a media model id sent manually or
  via the API.
- Not yet verified with real keys and paid calls: JSON-mode quality and output limits of Qwen (xAI Grok, GLM, Kimi and DeepSeek ran in live tests on 26.10.26).

## Only models the key can run (#144)

- The live lists hide media and agent models (`isCouncilCapableModel`): besides speech, image, video and music
  models also Google's Nano Banana image models and Antigravity agent models.
- Starting a council checks every model id against the live list of the selected key (`ModelCatalog`, cached 10
  minutes in the web app, filled by the model picker): an invented id, a model of another provider or one the key
  may not use is refused with a validation error before any provider is called. Ids are compared
  case-insensitively and stored in the provider's spelling; duplicates are found the same way. Keys whose models
  cannot be listed right now (provider down, no models endpoint) are not checked; a rejected key is refused.
- A role assignment for a role that is not part of the council is refused.
- A provider's 404 is the kind `model_not_found`; the model drops out with "<model> is not available for this
  <provider> key (HTTP 404)" (seen with Gemini 2.5 Flash-Lite, which is listed but answers 404).
- **Start check (07.11.26).** A listed model is not proof that the key may call it: Google lists `gemini-2.5-pro`
  for new keys but answers 404 ("no longer available to new users"), which cost a real council one of three voices.
  So the start also calls every selected model once with a tiny request (`ModelCatalog.probe`, 16 output tokens on
  the user's key, logged in `usage_record` like every call). Only a definite 404 refuses the start ("The provider
  lists these models but refuses calls with your key …") – before the session exists, so nothing of the council is
  charged. A timeout, rate limit or provider outage is "unknown" and never blocks.
- **Hint in the model picker, never a block.** `/api/models` marks a model whose latest call in this workspace
  within 24 hours ended with `model_not_found` (`recentlyUnavailableModels`) as "404 on <date>": struck through but
  still selectable. A later successful call (also the next start check) clears it, and it expires after 24 hours –
  when the provider enables the model again, nobody has to unlock anything.

## Scores bound to the proposal they name (#93)

Proposal labels (A, B, …) can collide with options a user names in the brief ("Option A = CSV, B = Push"). In a
real run an evaluator scored the CSV proposal with arguments about push. Since then:

- When the brief itself names lettered options ("A) …, B) …" or "Option A / Variante B", at least two letters), the
  proposals are numbered 1, 2, 3 instead of A, B, C (`packages/council/src/labels.ts`, QA live test 07.11.26: "Proposal A"
  recommended option C). A hybrid continues the style of the existing labels. The model cards in the Council Room show
  the proposal's label once proposals are revealed (before that the provider's initial), never a positional letter.
- Every prompt that lists proposals says that their labels are unrelated to options named in the brief.
- The evaluator copies each proposal's title and states its core recommendation (`proposalTitle`,
  `proposalSummary`) before scoring.
- `checkBinding` (`packages/council/src/binding.ts`) binds the scores by the **restated title** (#145): if the
  title an evaluator gives for Proposal B is clearly the title of another proposal of the session (word overlap
  ≥ 0.6 and 0.2 above B's own title; the evaluator's own proposal included), B is mixed up. Small variations,
  a "Proposal B:" prefix and proposals with identical titles are never a mix-up.
- A mix-up, a missing or an unknown label gets one corrective retry that names the problem (`callStructured`
  `check`). After the retry only the still mixed-up proposals of that evaluator are dropped (`repairCheck`,
  `vote.rejected_proposal_ids`, confidence issue `evaluation_rejected`) – its correctly bound scores and its
  ranking of them stay. Only when nothing usable is left is the evaluator recorded as failed.
- Word similarity of summaries and rationales is only a **warning** in the log (`answer binding warning`), never a
  reason to drop scores. Before #145 it was: in German councils function words made up 35–66 % of the word
  vectors and revisions converge after the Consensus Round, so the check rejected most evaluators of a run and the
  verdict rested on one model. Stop words now include German function words.

### Too few evaluators: no recommendation (#145)

If fewer than half of the active models that have a proposal to score deliver usable scores, the outcome is
`insufficient_evidence` (confidence issue `insufficient_evaluators`) instead of `recommended`. The decision
screen then offers **Repeat the evaluation** (`repeat_evaluation` approval action): the Final Verdict runs again
only for the models without a stored vote; scores already given stay.

## One point, one objection (night test 07.11.26)

The Minority Review turns 12 Minds critiques into objections. A model often raises the same point several times –
from several of its roles and again in the second debate round, slightly reworded (one real council had 68 objections,
many near-identical). Within one model, one proposal and one category, a critique counts as a repeat when the shorter
statement's content words (normalised, at least four letters) are at least 60 % contained in an already kept one
(`sameObjectionPoint`, `packages/core/src/objections.ts`); candidates are taken most severe first, so the strongest
wording stays. Different models are independent voices and always stay separate. The rule is deliberately
conservative: a strong rewording (German compounds, inflection) stays a second objection – deciding that would need a
model call.

## Objections against a replaced revision (#150)

A revision may replace a proposal's whole solution (a real run: Go + Redis on one server → Django + PostgreSQL
constraint on two servers). `packages/core/src/revisions.ts` compares stored revisions, lexically and without new
model calls:

- `architectureChange`: title, summary and architecture of the current revision overlap less than 0.3 with the
  first one → **architecture change**; `adoptedFrom` names other proposals whose first version it resembles (≥ 0.2
  and clearly more than its own). Shown on the proposal card ("architecture changed"), in the Final Verdict and in
  the report.
- `splitObjections`: an accepted or unresolved objection raised against an earlier revision whose named subject
  (terms it shares with that revision) is mostly (≥ 60 %) gone from the current one is not a remaining risk. It is
  listed as "no longer applies to vN (not independently re-reviewed)" (`mootObjections` in the report).

## Network and cards show the real participation (#151)

- After the verdict a model without a stored vote shows "No evaluation" in the council network (not "Submitted").
- Proposal cards show the number of independent evaluations next to the score; the header says
  "6 started · 4 active" once models dropped out; expected evaluators count only active models (see #145).
- With an even number of models the network is rotated by half a step, so no node sits directly below the core
  and its role chips no longer cover a neighbour's status label.

## Revisions must carry what they claim (#94)

- `keepPosition` only means the core recommendation stays; the revised `content` is always stored, so a kept
  position can still carry corrections (before, a kept position silently discarded the corrected content).
- `revisionProblem` (`packages/council/src/revision-check.ts`): claimed changes with identical content, or a
  conceded objection that is not fixed in the content and referenced in `motivatedBy`, reject the answer with
  one corrective retry.
- Authors can concede an objection (`concedes`, stored as `minority_objection.conceded`). A conceded objection is
  never recorded as refuted or resolved by a promise: it stays **accepted** until a revision changes the content;
  then it is noted as "Addressed by the author in v2, v3. … Not independently re-reviewed." – one short sentence per kind
  that lists the revisions (`withRevisionNote`), not one long sentence with all changed fields per revision (live run
  27 Oct 2026: unreadable objection lists). Long notes of older runs are folded in the Council Room ("… more").
  Blocking security objections stay blocking until re-reviewed.

## Real review depth (#96)

Confidence is `normal`, `reduced` or `low` (`confidenceOf` in `packages/core/src/verdict.ts`):

- **low** – a configured model dropped out (`participant_failed`, with phase/reason, no secrets), evaluations
  are missing against the models still _active_ in the Final Verdict (`missing_evaluators`; dropped-out models
  are named separately and no longer counted as expected evaluators, #151), an evaluator failed, or the majority vote
  disagrees with the weighted score.
- **reduced** – complete but thin: proposals scored by a single evaluator in a two-model council
  (`single_evaluator`, only two active models), objections no independent reviewer could check (`unreviewed_objections`).
  Final Verdict, JSON/Markdown export use the same wording (`describeConfidenceIssue`).

## Weight fields (#97)

Each Final Verdict weight is validated in the form before the request (`weightFieldError`, same rule as the
server's `validateWeights`): empty, negative or > 100 shows an inline message at the field and blocks the start,
even if the total happens to be 100. The API still rejects invalid weights.

## Honest status after a provider failure (#106)

- If fewer than two proposals arrive, the council ends in Independent Thinking. The error names how many of the
  models delivered and why the others failed (`Only 1 of 2 proposals were submitted (gemini-2.5-flash: google
rate_limit); …`). The proposals that did arrive are revealed – the council is over, so blindness protects
  nothing – and are marked everywhere as _incomplete: not debated, evaluated or approved, no verdict_.
- After a terminal failure or stop, no screen says "in progress" any more: the council room reads "ended without
  a verdict", unanswered models show as waiting, not working. Queued sessions never show models as working.
- The failure alert explains the restart path: a new council runs every phase again with the chosen models;
  earlier calls are not reused and are billed again. A rate limit gets a wait/switch hint only when the provider
  actually reported one. Below the quorum there is no recommendation and no build.
- Every failed provider call is logged without content (provider, model, schema, error kind, HTTP status,
  duration) after the retries.

## Consensus summary from the current revisions (#105)

- The moderator sees every proposal with its version (`<proposal label="B" version="2">`) and every open
  objection with the proposal it targets and, if the author changed the content since, the note "changed in v2;
  not independently re-verified". It is told to describe proposals only from their current version.
- `consensus-check.ts` compares the summary with the current revisions: a statement that calls measures missing
  ("Proposal B lacks staging, rollback copies and integrity checks", also "… while B lacks these specifics")
  although B's current text contains most of those terms is a contradiction. Lexical only – it catches clear
  contradictions, it does not judge whether a measure is good enough.
- One bounded correction call names the contradiction. If it persists, the statement stays with a visible note
  `[Quality note: Proposal B v2 does contain … – added by its author, not independently verified.]` – real
  remaining differences are kept, nothing is silently deleted.
- Open objections in "Outstanding risks" carry their review state ("changed by its author in v2, not
  independently re-reviewed"); critical gates are not lifted by a promise.
- `consensus_result.based_on` (migration 0013) stores which revisions the summary used; UI ("Based on A v2 · B v2"),
  JSON and Markdown report show the same list.

## Score rounding (#122)

- One rule for every score (criterion means and weighted totals): **half up to two decimals on the decimal
  value** (`roundScore` in `packages/core/src/verdict.ts`). The value in hundredths is normalised to 12
  significant digits before rounding, so binary artefacts (an exact 9.275 summed as 9.2749999999999986) no longer
  round down and the result does not depend on the order of the contributions.
- Ties are decided in whole hundredths: a difference of exactly the tie margin is a clear winner, not a tie.
- UI, JSON and Markdown export all show the stored rounded value, so they agree.

## Slow providers and call timeouts

- Every call waits `callTimeoutMs` (180 s) by default; providers measured to be slower get a higher minimum
  (`PROVIDER_MIN_CALL_TIMEOUT_MS` in `packages/core/src/policy.ts`: GLM, Kimi and Google 300 s – a GLM 4.7 role
  review, Kimi K2.6 proposals in 3 of 3 runs and a Gemini Flash Latest proposal took longer than 180 s, #147).
- A call that did not answer in time is logged as `kind: "timeout"` and gets exactly one corrective attempt with a
  1.5× longer timeout and the instruction to answer more concisely. It is not part of the transient retries: three waits of
  several minutes would stall the whole council. Both attempts are budgeted and recorded. If that faster answer is
  then cut off at the output limit, a last attempt with a doubled limit follows (#147) instead of dropping the model.
- Answers that are not valid JSON already get one corrective attempt (see above). In the same real run GLM once
  returned degenerate text inside its JSON; the repair attempt answered correctly.

## Contradictory requirements: a finding is not a solution (#121)

- Feasibility is a gate of its own, separate from the quality scores. Every proposal states
  `solvesRequirements` (false = "the hard requirements cannot be met together") and lists the
  `requirementConflicts`. Every independent evaluator additionally checks each proposal it scores
  (`meetsRequirements` + note, stored per vote in `vote.requirement_checks`, migration `0014`).
- A proposal is **implementable** only if its author does not declare the requirements unsolvable and no
  majority of independent evaluators finds a hard requirement unmet (the author's own check does not count).
  Exactly half → still implementable, but a `requirements_disputed` issue lowers the confidence. A
  non-implementable proposal is not eligible, however high its analysis scores (a STOP finding can score 10).
- When no proposal is implementable, the matrix sets `requirementsConflict: true`, the outcome is
  `no_qualifying_solution` and every surface says the same: UI "No solution can meet these requirements" with
  the conflicting requirements, JSON `requirementsConflict` / `requirementConflicts` / per-proposal
  `implementable`, Markdown "Conflicting requirements" and an "Implementable" column.
- Server-side gates: `approve` and `select_alternative` refuse a non-implementable proposal; the Execution
  Council refuses to start for one even if an older approval exists. Confirming the finding is "Reject" (no
  build). Changed requirements need a new council and a new human approval – the brief of a run is frozen.
- Decisions from before this check have no `implementable` field and stay approvable as before.

## Decision format versions (#181, stage 1)

The feasibility gate will change (S1, #181). So that no release approves, builds or re-evaluates a decision it does
not understand, every decision carries a format version and every reader treats the unknown as "not approvable".

- **Where the version lives.** `final_decision.gate_version` (integer, migration `0021`) – a column, not a field
  inside `matrix`, so approval, Execution Council and the session view read it without parsing the matrix and a
  matrix of an unknown shape is never interpreted.
- **Versions.** `1` = the feasibility gate of production e33a3bb (self-veto of the author plus the half rule of the
  independent checks, above). This release still computes exactly that gate and writes `1`. `2` = the S1 gate, which
  the S1 PR will write. Releases support versions up to `MAX_SUPPORTED_GATE_VERSION` (`packages/council/src/decision-format.ts`).
- **Legacy marking.** Migration `0021` sets `gate_version = 1` on every decision that exists when it runs. Nothing is
  recomputed: outcome, recommendation and matrix stay as stored. The column stays nullable on purpose: a decision
  written later without a version can only come from a release older than stage 1, and it is never approvable or
  buildable (it does not block re-evaluation, it is simply not trusted).
- **New outcome.** `verdict_outcome` gains `needs_verification` (additive). Gate version 1 never writes it; the S1
  gate will.
- **One server-side check** (`decision-format.ts`, to move into the engine later, #188):
  - `approve`, `select_alternative` and `startExecution` accept a decision only if its version is supported, its
    outcome is one gate version 1 produces, the matrix has a proposal list with exactly one entry for the proposal,
    the row and the matrix agree on outcome and recommendation, and the entry is implementable (version 1 keeps
    today's rule: an entry without the `implementable` field stays approvable). Anything else → `CONFLICT` with a
    plain reason. `startExecution` loads version, outcome, recommendation and matrix of the approved decision and
    refuses a missing decision.
  - The session view returns `decisionStatus` (`gateVersion`, `readable`, `approvable`, `reason`,
    `canApproveRecommendation`, `approvableProposalIds`). Web UI and VS Code only display it; they do not re-check.
    The Final Verdict shows "Needs verification – not approvable" or "Not approvable" with the server's reason and
    preselects "Request changes"; the evaluation matrix of an unreadable format is not shown.
  - Report (JSON, Markdown and therefore PDF/Word) and delivery (e-mail, Telegram, Confluence) state the neutral
    reason, mark the verdict "Not approvable" and call a proposal "Leading proposal (not approvable)" instead of
    "Recommended solution". JSON adds `decisionFormat`.
- **Old writers do not re-evaluate newer runs.** If any decision of a session (also a superseded one) has a version
  above the supported maximum, `request_more_debate` and `repeat_evaluation` are refused, and the worker fails such a
  session with a clear message before any phase or model call (also checked again at the start of the Final
  Verdict). No newer decision is superseded or rewritten with an older gate.
- **Rollout stages.** (1) This stage: column, legacy marking, tolerant readers, server-side checks, rollback guard –
  no change of the feasibility gate compared with production e33a3bb. (2) Requirement capture with confirmation
  (#190). (3) S1 gate, writes version 2; rolling back from it to stage 1 is safe because stage 1 refuses version 2.
  A rollback below stage 1 is refused by `rollback.sh` (see `docs/hetzner.md`, "Rollback guard").

- Abort classification in every adapter (#120): the signal's reason tells the call deadline (`TimeoutError` →
  `timeout`, marked `deadline`) from a cancellation by the caller (`cancelled`, never retried automatically); an
  SDK connection timeout stays a transient `timeout`. A reached deadline is not part of the transient retries
  (`ProviderError.retryable` is false) – in councils and coding tasks alike; the council gives it one longer attempt.
- SDK timeouts are only a backstop (`SDK_BACKSTOP_TIMEOUT_MS`, 15 min). They used to be 120–180 s, below the call
  deadlines (180 s, GLM 300 s, coding tasks 300 s), so slow answers were cut by the SDK first and retried up to
  three times.

## Requirement gate S1 (#181, gate version 2)

New councils are started for gate version 2 (`council_session.gate_version`). Councils started before this release
keep version 1 and finish with the production gate above. The rules of the gate live in the engine (#188,
`docs/engine.md`); this section describes the behaviour, not the implementation.

- **Frozen round.** Before the first Final Verdict call one `evaluation_round` is written: the requirement ids of the
  confirmed list (#190), the revision per proposal and E(p) – the participants active at that moment, without the
  author. A resume reuses it; a model that drops out later stays expected, so its missing checks stay open.
- **One check per requirement.** Each evaluator gives, per proposal and confirmed requirement, `PASS`, `FAIL` or
  `UNKNOWN` with evidence and the explicit statement `allPartsMet`. Every raw check is stored in `requirement_check`
  (append-only, also duplicates and contradictions). Checks for a requirement id outside the round, a revision other
  than the round's, a proposal the evaluator is not expected for, or an evaluation bound to another proposal's title
  are stored with the reason and never count.
- **Meaning.** A requirement is met only if every expected evaluator confirmed every part of it with a reason.
  A missing, inconclusive or partial check keeps it open. A FAIL is never lost by a later PASS of the same evaluator.
  PASS and FAIL are stored model judgements with reasons, not an independent fact check.
- **Per proposal.** `qualified` (approvable and buildable), `needs_verification`, `fail` (a requirement not met
  according to the evaluators) or `incomplete` (no architecture or no named components). The author's own
  "does not solve the requirements" is no veto (that self-disqualification is what #181 fixes): it is named as a cause
  when the proposal is not qualified anyway, and decides nothing when every expected evaluator confirmed every part.
- **Outcome.** `insufficient_evidence` (quorum, unchanged) → `recommended`/`tie` among qualified proposals that pass
  the other gates → `needs_verification` → `no_qualifying_solution`. No automatic recommendation when the proposals
  were not compared on equal terms (an expected evaluator delivered nothing) or when a higher-scored proposal is
  blocked only by the checks of the winner's author (conflict of interest). The verdict never states that the
  requirements cannot be met together; it says that none of the evaluated proposals meets all confirmed requirements
  according to these evaluations.
- **Corrections after the own review of PR #217.** (1) The author's own "does not solve" never switches off the
  protection against a competitor's sole objection (conflict of interest) – it decides nothing in either direction.
  (2) One PASS of an evaluator without "every part met" or without a reason makes its statement UNKNOWN, even next to a
  full PASS of the same evaluator. (3) Checks an evaluator left out (it delivered, but said nothing about a proposal or
  a requirement) make the comparison incomplete whenever giving them would change a proposal's result; then there is
  neither a recommendation nor "no qualifying solution", only `needs_verification`.
- **Display after the first live run (29.10.26).** A requirement that is not confirmed names its two causes
  separately: "n of m evaluators could not confirm it" (a stated UNKNOWN or partial PASS) and "n of m evaluators gave no
  valid answer" (missing check). The formula line in the Evaluation screen and in the report names evaluators by model
  instead of participant id; the stored formula keeps the ids. The majority vote is labelled "for information only – it
  never overrides the requirement check".
- **Measured requirements (owner decision 30.10.26, engine contract 3).** Council 1 showed that a model can never
  confirm "go-live in 4 months with 2 developers" on paper. A confirmed requirement with exactly one measurable limit –
  a time limit (months, weeks), a monthly cost limit (EUR per month) or a minimum availability (%) – is detected from
  its wording when the list is confirmed (`packages/core/src/requirement-measure.ts`, deterministic, no model; two
  limits in one sentence are not measured) and shown as "estimated by the models: at most 4 months". The evaluators
  then give a realistic range (`estimateLow`/`estimateHigh`, best and worst realistic case, with a breakdown in the
  evidence) instead of only PASS/FAIL. The engine compares the ranges with the limit, strictly: met only if **every**
  evaluator's whole range keeps the limit; not met if a range lies entirely beyond it; a range across the limit, a
  missing or malformed estimate is "not confirmed". An evaluator's own FAIL always stays FAIL. The verdict shows the
  lowest–highest estimate and the median of the evaluators' midpoints next to the limit ("estimates 3–5 months (median
  4), limit at most 4 months"). Estimates are model judgements, not a guarantee. Lists confirmed before this release
  have no measures; confirm the list again to use them. Rounds frozen before keep their behaviour.
- **What the user can do.** Approve a recommendation or choose a qualified alternative; `repeat_evaluation` only
  fetches completely missing evaluations of the frozen round from models that are still available; `request_more_debate`
  is refused (409, before any change) because it would discard the stored checks. Otherwise: request changes, edit the
  brief or the requirements, confirm them and start a new council.
- **Display.** Evaluation shows per proposal and requirement the status, who said what and the evidence (also checks
  that did not count); Final Verdict and report name the cause per proposal.
- **Rollback.** `RELEASE_LEVEL` 3/2: a rollback lands on stage 1b, which neither runs a version-2 council nor
  continues its build. Stage 1 is refused as a target (`docs/hetzner.md`). Verified on PostgreSQL 17 with the 1b release
  (`c141cf2`, engine `393ad9e`) against data written by S1 – per state of a version-2 session:
  | State before the rollback | After the rollback to 1b |
  |---|---|
  | Council queued, not started | Ends `failed` with a message; no model call |
  | Council running (crashed inside the Final Verdict, round frozen) | Ends `failed`; no model call, no verdict written |
  | Verdict waiting for approval | Stays readable; approval and `repeat_evaluation` are refused, nothing changes |
  | Build queued or running | Ends `failed` on its next run; no model call, no sandbox |
  | 1b migrations on the newer schema | Run without error (S1 tables and columns are left untouched) |

  Nothing is retried or resumed automatically after a rollback: councils and builds that ended `failed` must be started
  again by the user once S1 is deployed again. The same scenario with stage 1 (`42fb6d0`) re-evaluated version-2
  councils with the old gate and called models for the builds – which is why stage 1 is refused as a target.

- **Start.** Brief versions, document upload and deletion, requirement confirmation and the council start lock the
  project row (`lockProjectSources`) inside their transaction; the start checks the requirement list again under that
  lock. A change either is seen by the start (refused) or waits until the session is stored.
- **Integrity (fail closed).** Every check carries the revision it was given for; only the frozen revision counts, and a
  resume evaluates exactly the frozen revisions. Raw checks are stored only together with the evaluator's vote (a
  second, concurrent evaluation of the same evaluator adds nothing). The engine's result is checked structurally before
  it is stored (every proposal and requirement exactly once, known values, `qualified` only with every requirement PASS);
  an inconsistent result stores no verdict. Approval and every build run check the stored matrix (round, requirement
  ids, one gate entry per proposal, complete comparison for a recommendation) and its binding to the session's frozen
  round and requirement list in the database.
- **Security minimum.** With gate version 2 a proposal below the policy's security minimum can be neither approved nor
  chosen as an alternative nor built (`securityBelowMinimum` in the matrix; missing = refused). Version 1 keeps its
  behaviour.
- **Known limits.** PASS/FAIL are model judgements, not facts. The conflict-of-interest rule covers one author
  blocking alone; two models blocking together are not detected (every participant is also an author). Strict
  unanimity will often end in `needs_verification`; a targeted re-check of single requirements is not built yet.

## Why there is no recommendation (#230)

The Final Verdict names the main reason before the details:

- **Evaluation incomplete** (a model's Final Verdict was lost, e.g. cut off twice): shown first as _Main reason: the
  evaluation is incomplete_ with the model and the failure, how many proposals could therefore not be confirmed, and
  that this is a technical gap, not a finding about the proposals. _Repeat the evaluation_ is preselected; it asks
  only the missing model again (BYOK, within the council's budget). Missing single requirement checks of a stored
  evaluation stay open (see `docs/adr/0228-final-verdict-recovery.md`).
- The gate summary tells **not confirmed** from **not met**: "None of the N evaluated proposals could be confirmed …
  Not confirmed is not the same as not met" when nothing is unmet; "k of N miss a confirmed requirement; m could not
  be confirmed" when both occur; "none meets all confirmed requirements according to these evaluations" only when
  every proposal fails.
- _No qualifying solution_ reads "None of the proposals meets the requirements" – about this council's proposals,
  never a claim that no solution exists.

## Final Verdict size check (#228)

Every evaluator checks the proposals of all other models against every confirmed requirement in **one** answer of
at most 32,000 output tokens. Before the start (preview and `createSession`) CONSYRION counts
(models − 1) × requirements check items at 1,250 tokens each (highest measured value, 30.10.26):

- does not fit (3 models: more than 12 requirements; 4: more than 8; 5: more than 6; 6: more than 5) → the start is
  refused with the largest list that fits, before any model is paid;
- more than three quarters → a warning on the start screen.

Splitting the Final Verdict per proposal (alternative B in `docs/adr/0228-final-verdict-recovery.md`) would lift this
limit; it is not built yet.

## Minimum review breadth (#249, engine contract 4)

Owner decision 30.10.2026: a recommendation needs **at least two independent evaluators per proposal** (the author
never evaluates its own proposal). Trigger: the self-improvement council of 30.10.2026 lost one model in the first
phase, each proposal kept a single evaluator, and the verdict still read "recommended".

- A proposal that passed every check of fewer evaluators is a **provisional favourite – limited review**: feasibility
  stays `needs_verification`, the gate result carries `limitedReview: true`, it is never approvable or buildable.
- The Final Verdict title, the requirement table and the report name it as such; the gate summary says that too few
  independent evaluators took part. A FAIL or UNKNOWN is shown as before – the flag marks only a proposal that passed
  every check.
- With exactly two models every proposal has one evaluator by design; the start page says so and suggests three or
  more models. The public test engine is unchanged (it checks the workflow, not the product rule).
- Since 31.10.2026 (external review): the same model may join a council only once, also through a second API key of
  the same provider – it would not be an independent evaluator. Independently of the engine, the public approval check
  refuses every proposal with `limitedReview: true` and treats "qualified" together with it as an inconsistent verdict.
- Not yet built (#249, part 2): a two-stage check that separates the architecture decision from the later acceptance
  measurement for requirements that can only be measured after implementation.

## Verdict at a glance (stage 1 result visualisations, 05.11.26)

The Final Verdict tab opens with a dashboard (`apps/web/src/components/session/verdict-dashboard.tsx`) and the PDF
export starts with a graphical "Decision summary" page (`drawSummary` in `apps/web/src/lib/server/report-documents.ts`):

- **Status:** recommended / tie / needs verification / not approvable with the server's reason and the human decision.
- **Overall score:** one bar per proposal (0–10, one decimal). Proposals the server does not allow to approve are grey,
  hatched and labelled "not approvable" – a higher score never outranks a failed or unconfirmed requirement.
- **Scores per criterion:** small multiples on one scale with the weights.
- **Hard requirements × proposals:** icon + word + "met n/m" per cell (from the stored gate result, never recomputed);
  hovering a cell lists each evaluator's statement.
- **Open objections:** counts by severity per proposal (obsolete objections excluded) and the top critical/high ones.
- A table view carries the same numbers (accessibility, copy/paste). The PDF summary is light and print-friendly.
  Data for the PDF comes from `buildDecisionReport` (`requirementMatrix`, `approvableProposals`). Stage 2 (evaluator
  differences, phase timeline, tokens per model) and stage 3 (task graph, findings matrix) follow.

## Key disputes (#267, 05.11.26)

The Final Verdict shows up to three key disputes (`apps/web/src/components/session/cruxes.ts`, deterministic, no model
call): objections ranked by blocking, status (open/unresolved before upheld before refuted/resolved), severity and
whether they concern the recommendation; an objection made obsolete by a revision ranks last. Each shows the stored
claim with raiser and role, the author's answer (or "conceded" / why it is unanswered), the independent review and
whether the proposal was revised afterwards – plus the Consensus Round's remaining disagreements, as stored. A
finished session now opens on the Final Verdict tab; a running one on the Council Room.

## Verdict dashboard (#266, 05.11.26)

Top of the Final Verdict (`apps/web/src/components/session/verdict-dashboard.tsx`), all texts in 5 languages
(`verdict.dashboard.*`): status hero with approvable yes/no, the human decision and a "Next step" link that jumps to the
decision form with the first allowed action preselected (only while the owner can decide); a "Review facts" block
(fewest independent evaluators per proposal, requirement checks not met/open, critical/high objections, models without a
usable evaluation); overall score bars with author and counted evaluators beside each bar; criteria as one number
matrix (criteria × proposals, highest approvable value highlighted); requirement × proposal matrix where a click on a cell
shows every stored evaluator check with its reason. Design review with ChatGPT 05.11.26: no hatching – a proposal that
cannot be approved is a calm grey bar with a lock and the words "not approvable", never coloured like a contender. The
PDF page 1 uses the same rules.

## PDF in three levels (#268, 05.11.26)

`/api/sessions/:id/report?format=pdf&level=brief|report|full` – one report snapshot, three depths: **brief** = the
graphical decision summary only (1–2 pages for decision makers), **report** (default) = summary + full text report,
**full** = report + audit appendix (`apps/web/src/lib/server/report-audit.ts`): every stored requirement check
(requirement × proposal × actual evaluator, status, evidence, estimate exactly as stored, checks that did not count with
the reason) and the model calls per model and phase with tokens, plus brief/requirement/gate versions. No model call,
nothing recomputed. The Final Verdict offers the three as buttons.

## Stage-2 charts (05.11.26)

Below the verdict dashboard (`apps/web/src/components/session/process-charts.tsx`), from stored rows only: **evaluator
agreement** – a dot plot per criterion with every independent evaluator's raw score (0–10) for the chosen proposal, the
server mean as a tick and a spread warning at ≥ 3 points (rationale on hover); **phase timeline** from the stage
timestamps; **tokens per model** (input/output, failed calls). Series colours come from `--viz-1…6` (dataviz reference
palette, light and dark steps); each dot also shows the model's number, so identity never depends on colour.

## Suggested perspectives (#269, 05.11.26)

`suggestRoles` (`packages/core/src/role-suggestion.ts`) suggests up to six 12 Minds Council perspectives from the brief
(idea, goal, requirements) and the confirmed requirement list – deterministic topic words in EN/DE/FR/ES, no model
call. A security/downside check and an independent critic are always suggested; every other role names the words and
requirements (R1, R2, …) that led to it, the rest are listed as "not suggested" with the reason. The team setup shows
each role's core question and applies the suggestion only on the user's click. Roles stay perspectives, not votes.

## Next steps (#273 MVP, 05.11.26)

`deriveNextSteps` (`apps/web/src/components/session/next-steps.ts`) builds a read-only checklist for the recommended
proposal – or, when nothing can be approved, for the best-scored one – from stored data only: requirements not
confirmed for it and its open objections ("settle before any irreversible step"), the author's own assumptions ("test
these first"), high/critical risks with the planned mitigation ("stop and re-check if …") and the points the Consensus
Round left open ("ask the council again when …"). Empty sections say "not specified"; nothing is generated, a test plan
never confirms a requirement and nothing starts without the user.

## Answer language and the interface language (QA live test 07.11.26)

- The base system prompt asks every model to write free text (titles, claims, evidence, answers, reasons) in the
  language of the brief; JSON keys, enum values, labels and quotes stay unchanged (`PROMPT_VERSION` 2026-11-07.1).
- The server's fixed reasons why a verdict is not approvable (`decision-format.ts`, English) are shown in the interface
  language (`useVerdictReason`, messages `verdictScreen.reasons`); unknown text is shown as sent.
- "Open objections" on PDF page 1 uses the dashboard's rule: objections made moot by a revision (#150) are not open.
- The report (Markdown, PDF incl. summary page and audit appendix, Word) uses the interface language for its fixed
  wording (#322): `?lang=` on the report URL, otherwise the locale cookie, otherwise the browser language – the same
  rule as the UI. Translations live in `packages/council/src/report-i18n.ts` (keys are the English texts; a missing
  one falls back to English). German, French and Spanish are translated; Chinese stays English because the PDF standard
  fonts cannot draw CJK characters. Model output is never translated. Reports sent by delivery (Telegram, e-mail,
  Confluence) are still English.

## Night test 07.11.26 – fixes

- Answer language: `briefBlock` adds a line naming the language of the brief (`briefLanguage`, stopword heuristic for
  en/de/fr/es; no line when unsure), so a model does not switch to the language of other text in the request
  (`PROMPT_VERSION` 2026-11-08.1).
- No qualifying solution: the approval form preselects "Request changes", "Select alternative" is disabled, and the
  verdict hero names the requirements no proposal meets (`verdict.dashboard.unmetByAll`).
- Conflict of interest: when the recommendation is withheld only because the author of the qualified proposal blocked
  a better one, the verdict says exactly that (`verdictScreen.reasons.conflictOfInterest`) instead of "could not
  confirm that a proposal meets every requirement".
- Repo context: `suggestContextFiles` puts files the brief names (by path or file name) before README/docs.
- Requirement gate texts (R2-04, 08.11.26): the engine writes the gate summary and causes in English; the interface
  shows the known sentences in its language (`useGateText`, messages `requirementGate.text.*`). Estimate causes and
  any new wording stay as sent.
- Needs verification (R2-02, 08.11.26): when every proposal leaves the same requirement unconfirmed, the verdict hero
  names it ("Bei keinem Vorschlag bestätigt: R4 …", `verdict.dashboard.openByAll`).
