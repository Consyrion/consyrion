# Council engine (Milestone 2)

Package `packages/council`. Runs the seven Consyrium phases as persistent workflow stages.

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
| 6   | Final Verdict        | Every model scores all proposals **except its own** (0–10 per criterion, rationale) and ranks them. Deterministic aggregation (`@consyrium/core` `aggregateVerdict`): self-scores ignored, gates first (security minimum, blocking objections, minimum total, missing scores), close totals = tie, majority vote (Borda) reported separately. **Confidence:** the verdict is marked _low_ when a proposal was scored by fewer evaluators than expected (all participants except its author) or the majority vote favours another proposal; models whose evaluation failed are listed with the reason (`failedEvaluators`). The UI and report show this as a warning – the human still decides. | `evaluation_score`, `vote`, `final_decision`                |
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
- PostgreSQL: run `pnpm --filter @consyrium/worker start` (one or more instances), web with `COUNCIL_WORKER=external`.
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

## Stable prompt prefix for provider caching (#244)

Providers cache identical prompt *prefixes* (Anthropic with an explicit marker, OpenAI, Gemini and the
OpenAI-compatible providers automatically) and bill cached input at a fraction of the price. A council sends the same
brief – often with a large repository context – in most of its ~27 calls, but every call used to start with its own
system prompt (base rules + phase + role), so the brief was never a shared prefix.

`stablePrompt` (`packages/council/src/prompts.ts`), applied in `callStructured`, rearranges each call without changing
what the model reads:

- system prompt = base rules + the session rules → identical for every call of a council;
- the user message starts with the `<brief>` block (identical within a council), returned as `cachePrefix`;
- the phase and role instructions follow right after the brief as "Instructions for this step (from Consyrium, not
  from the brief)" – after the untrusted data, which is also the safer order.

The Anthropic adapter sets `cache_control` after `cachePrefix`; prefixes below the provider's minimum cacheable length
are simply not cached. Prompts that do not start with the brief (rebuttals, objection answers) keep their text and get
the instructions first. Cached input is recorded per call (`usage_record.cached_input_tokens`, docs/saas.md), so the
effect is measurable per council. Caching lowers **cost**, not the number of tokens; fewer tokens would need the
digest (step C of #244, not built).

## Size check before every call (#243)

Before a call is sent, `fitCallToModel` (`packages/core/src/call-size.ts`, applied in `callStructured`) checks the
estimated input (characters / 4) plus the requested output against the limits the provider's models endpoint reports
for that model (`ai_model.context_window`, `ai_model.max_output_tokens`; unknown limits are not guessed):

- the output limit never exceeds what the model can write (no provider error for an impossible `max_tokens`);
- it is lowered to what the context window leaves after the input, with a 10 % margin for the estimate;
- when even a minimal answer (1,000 tokens) does not fit, the call is **not sent**: the participant fails with error
  kind `context_window` and a clear reason – content is never shortened.

How much output is *wanted* still comes from `outputTokensFor` (per schema and item, #172) and the split Final Verdict
(#246); this check only makes the request possible for the model. The start screen shows, per model, when the brief
with its documents and repository context plus all proposals does not fit its window (`contextFit` in the preview).
The baseline of #251 (30.10.26: 6.8 % cut off/invalid, largest input 49k) was caused by output limits, not windows;
whether the share drops below 2 % has to be measured on the next real councils (`deploy/hetzner/call-report.sh`).

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

## Session header: review status and approval status (#477)

While a verdict waits for the owner but nothing can be approved (needs verification, no qualifying solution, provisional
favourite), the session header no longer says "Awaiting your decision" next to "not approvable". It shows the workflow
status "Awaiting your review" and, apart from it, the approval status "No approvable proposal" – the same message as
the verdict card (#230). The server already refuses every approval of such a verdict, also by a direct API call
(`submitApproval`: `approve` needs a recommendation, `select_alternative` runs `assertDecisionApprovable`; test in
`packages/council/test/s1-gate.test.ts`). The PDF/Markdown wording follows with #268.

## Why there is no recommendation (#230)

When a gate-version-2 council ends without an approvable recommendation, the Final Verdict card first says why, in
plain words, before the details (`WhyNoRecommendationCard`, `apps/web/src/components/session/why-no-recommendation.ts`).
It only **explains** the stored gate result – the gate stays the single source and nothing is re-decided in the
browser. One reason per proposal, the most concrete first:

| Reason        | Meaning shown to the user                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| violated      | "R1 not met – 2 of 2 AI evaluators say so" (FAIL)                                                           |
| disputed      | "the AI evaluators disagree on R2: 1 says met, 1 says not met" (DISPUTED)                                   |
| not evaluated | an expected evaluator gave no valid answer – a technical gap, not a finding against the proposal             |
| not proven    | "could not be confirmed from the proposal text – not confirmed is not the same as not met" (UNKNOWN)       |
| limited review| every check passed, but too few independent evaluators took part (#249)                                     |
| architecture candidate | every check passed, but a requirement can only be confirmed by measuring the running implementation (#249 part 2) |

A requirements conflict (#121) is named first. For "no qualifying solution" the card adds that this concerns the
submitted proposals only, not whether a solution exists at all. Every line is labelled as AI evaluators' judgement.

The **next steps** are only those that exist today: repeat the evaluation for models without a valid answer, add
missing facts and start a new council, check whether a violated requirement is really hard (new list version),
change one of two contradicting requirements, or choose an approvable proposal. A targeted re-check of single items
is **not** offered until #228/#229 are decided. Model failures keep their own main-reason block (`MainReason`).
The PDF report is unchanged in this step.

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
reason)" via `describeObjection` / `objectionStatusText` in `@consyrium/core`. Stored runs from before keep working:
nothing is migrated; the reasoning shown next to the old `claim` makes clear it was the subject of an objection.
Disagreements between the models remain in the Consensus Round section.

**Conflicting requirements (#173)** are de-duplicated across proposals (`dedupeStatements`: case, punctuation and
whitespace ignored); the same conflict in different words stays, since telling that apart would need a model.

**PDF and Word (#164):** `?format=pdf` and `?format=docx` (buttons "Download PDF" / "Download Word" on the Final
Verdict) render the same Markdown report (`apps/web/src/lib/server/report-documents.ts`), so every format has the
same content and no new model output. PDF: A4, light and print-friendly, CONSYRIUM AI header with session id and
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
- #226 (08.11.26): a performance limit in ms/s ("at least 95 % of page loads within 300 ms") has **no** estimated measure – it is a measurement check (#249 variant A); next to an availability it counts as a second limit ("split it"). Spaces and no-break spaces group thousands ("1 000 €"); "not more than" is recognised. Lists confirmed earlier keep their stored measure.
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

## Final Verdict size check (#228) and split evaluator (#246)

Every evaluator checks the proposals of all other models against every confirmed requirement. Before the start
(preview and `createSession`) CONSYRIUM counts (models − 1) × requirements check items at 1,250 tokens each (highest
measured value, 30.10.26) against the call limit of 32,000 output tokens (`finalVerdictFit`, `packages/core`):

- fits into one answer (3 models: up to 12 requirements; 4: up to 8; 5: up to 6; 6: up to 5) → **one call**, unchanged;
  above three quarters a warning on the start screen;
- larger → **split evaluator (#246)**: the evaluator checks the requirements in balanced groups in list order
  (`splitRequirementIds`), each filling at most 75 % of a call. The first call scores, ranks and checks group 1
  (`evaluation` schema); every further call only checks its group (`evaluation_checks`), names the group in
  `<requirement_scope>` and restates title and summary, so its checks bind to the proposal they name exactly like the
  first call's. The start screen says how many calls each evaluator makes;
- refused only if not even one requirement per call fits (not reachable with at most 6 models).

Same rules as one call: only the expected evaluators, the same frozen round, no extra evaluator, no majority over a
FAIL – the engine gate sees the same raw checks. A check of a requirement that belongs to another call of the split is
stored, but as invalid ("requirement id belongs to another call of this split evaluation"), so every requirement counts
from exactly one call. Nothing of an evaluator is stored before all its calls answered; a failed call fails that
evaluator, and a resume redoes all of its calls (never two evaluations of one evaluator mixed, #181).

Cost: each extra call sends the brief and the proposals again. The cost estimate (`estimateCalls`, `estimateTokens`),
the minimum budget (`minimumCouncilBudget`) and the Final Verdict reserve (`verdictReserve`) count every call, and the
hard token budget applies as always. Test: `packages/council/test/s1-gate.test.ts` (#246 – same answers give the same
gate, also when a model ignores the scope).

### Council form: what blocks the start is marked at its field (#587, 11.11.2026)

User report 09.11.26: six models, default budget 400,000, at least 1,005,120 tokens needed – the note stood far below
the field and the budget field itself was not marked.

- A budget below the minimum marks the **budget field red** and says at the field "Needs at least X tokens – set to Y".
- Above the start button a red box lists what is still open ("2 things left before you can start"), with a link to the
  field for the budget and the model choice; under the disabled button stands the first reason ("Start blocked: …").
- **Set budget to X tokens** (at the field and in the box) sets the budget to the preview's upper bound, rounded up to
  10,000 and never above the maximum (`suggestedBudget`, `apps/web/src/lib/budget-suggestion.ts`). No model call; the
  form then shows "Budget adjusted: 400,000 → X" and the value stays editable. When even the maximum is below the
  minimum, the form says to choose fewer models or roles instead.
- A budget that covers the minimum but not the upper bound keeps its confirmation checkbox and also offers the button.
- Not yet: the same button in the quick start (#586) and on the assistant's start card (#559).
- Typical consumption as a range (#598): "Typically about 142,000–240,000 tokens" – median to upper quartile of the
  tokens per call of the workspace's last calls × the calls of this configuration (`typicalRange`), capped by the upper
  bound. The single median was too low (announced 142,000, used 194,870 and 231,740 on 10.11.26). A budget below the
  upper value of the range gets a warning that debate phases will likely be shortened. The assistant's start card and
  the Obsidian plugin still show the lower value only.

## Purpose of a council: idea check or approval (#597, 11.11.2026)

Two test councils on 11.11.26 ended with "Needs verification – not approvable" although all three models chose the
expected option: nobody can prove before a contract exists that a provider signs a data-processing agreement. User
feedback: "Verification needed – by whom? Not approved – does the user do that?" and "many are at the very start and
only want to know whether the idea holds up".

- The council form asks **What is this council for?** – "Check an idea" (preselected, except for repository projects
  and projects with a linked repository: those are there to be built and start as "Approve a decision") or "Approve a decision".
  The choice is stored as `policy.purpose` (`idea_check` | `approval`); councils started without it (older ones, MCP,
  the assistant's start card, Obsidian, VS Code) are approval councils.
- **The purpose changes only how the result is presented.** Phases, prompts, cost, the requirement gate, the stored
  outcome, approval and build are identical. An idea check never makes an unconfirmed requirement count as confirmed
  and never makes anything approvable.
- An idea-check council whose verdict leaves nothing approvable is read from the stored matrix (`ideaCheck`,
  `apps/web/src/components/session/idea-check.ts`):
  - **favourite with open points** – the best-scored proposal that no evaluator ruled out (no FAIL, not incomplete);
  - **several proposals hold up** – more than one within the tie margin of 0.25;
  - **does not hold up as described** – every proposal fails at least one requirement.
  The hero lists "Clarify before the next step" (the favourite's requirements that are not confirmed, or whose check
  only confirmed a measurement plan) and "Ruled out" (proposals with the requirements they fail), and says that this is
  an idea check, not an approval. The session header shows "Idea checked" instead of "No approvable proposal".
- No reading is given when the matrix cannot carry one (no gate result, proposals not compared on equal terms, missing
  evaluators): then the normal verdict says what has to happen first.
- In an approval council a verdict without anything approvable now says who acts: the lock is a rule of the app, and
  the user adds the missing evidence to the brief or changes the requirements and starts a new council.
- Readers outside the verdict screen keep the strict wording on purpose: MCP `get_decision` (an agent must not build
  from an idea check), the decision list and the VS Code tree.
- Level totals (live test 11.11.26): among the proposals within the tie margin the one that leaves the fewest
  requirements open is the favourite, and the text says that it is level on score with the others; only when the open
  points are equal too does the reading say "several proposals hold up". The list "clarify before the next step" names
  the proposal it belongs to.
- The same reading in the reports (one derivation, `ideaCheck` in `packages/core/src/idea-check.ts`): the PDF shows the
  idea-check title, the status "Idea checked" and the block with open points and ruled-out proposals
  (`report-status.ts`, also used by delivery messages and the assistant); the Markdown/Word/JSON report has the section
  "Idea check" and `ideaCheck` in its data. The reading disappears once a human decided.
- Not yet: one merged gate result per option when several proposals choose the same option (#597 point 4).

## Independence groups (engine contract 6, owner decision 08.11.2026)

The same model may take part through several API keys, but it counts as **one** independent evaluator. The application
passes `GateRound.participantGroups` (participant id → independence group, e.g. the normalised provider/model family;
filled by the council, #31's part). In the gate:

- Instances of the author's group never evaluate that proposal.
- Per requirement every group gives one statement: any FAIL of an instance is FAIL; PASS only when every stated check
  of the group is a confirmed PASS; otherwise UNKNOWN; open only when no instance answered. The lists still name every
  instance, the counts are groups.
- Minimum review breadth (#249), majorities (DISPUTED), causes and the equal-terms check count groups.
- Without `participantGroups` every participant is its own group – the behaviour of contract 5.

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

## Architecture candidate: measurement checks (#249 part 2, gate version 3, engine contract 5)

Owner decision 08.11.2026 (strict variant first). Some requirements nobody can confirm before the solution exists –
OnJam R5 "muss 2–4 Musikern rhythmisch stabiles Zusammenspiel ermöglichen". Until now every evaluator said UNKNOWN and
the requirement blocked every proposal without telling the user why.

- **Gate 1 – architecture (this release).** From gate version 3 such a requirement (`requirementVerification` →
  `"measurement"`, detected from the wording by `measurableOnlyAfterImplementation`, also for lists confirmed earlier)
  is checked as a **measurement plan**: the evaluators get a `[measurement check …]` note in `<confirmed_requirements>` –
  PASS only if the proposal names method, target value with unit, measurement setup and conditions; UNKNOWN without
  such a plan; FAIL if the proposal contradicts it. The round passes `GateRound.measurementChecks` to the engine.
- **Never met by a plan.** The engine marks these requirements `measurementPending`. A proposal whose every check passed
  with enough independent evaluators is an **architecture candidate – performance proof open** (`architectureCandidate:
  true`): feasibility stays `needs_verification`, never qualified, never a recommendation, never regularly approvable.
  Below the minimum review breadth it is a provisional favourite instead. A missing plan or a FAIL stays what it is.
- **The requirement stays hard.** Its text is never changed; a measurement plan never replaces it.
- **Fail closed in the app.** `assertGateResultConsistent` and the approval check refuse "qualified" together with an
  open measurement, and the approval check refuses every architecture candidate with its own message.
- **Display.** Final Verdict title, requirement table (badge "measurement plan named – measured after implementation"),
  dashboard cell `MEASURE`, "why no recommendation" card, report (feasibility "architecture candidate (performance proof
  open)", requirement note "measurement check", matrix status `MEASUREMENT_PLAN`) and PDF – in every interface and
  report language.
- **Versions.** New councils start for gate version 3. Councils started for version 2 finish with version 2: no
  measurement note in the prompt, no `measurementChecks`, unchanged result (regression test
  `packages/council/test/measurement-gate.test.ts`).
- **Favourite, prototype build and gate 2:** see the section "Favourite, prototype build and acceptance by measurement".
- **Performance limits (owner decision 08.11.2026, variant A).** A limit in milliseconds or seconds – latency, response
  or load time ("95 % of page loads within 300 ms") – is always a measurement check from gate version 3
  (`performanceLimit`): a proposal is at best an architecture candidate, even when every estimate is far below the
  limit. Cost and availability limits stay estimates (engine contract 3); hours, days, weeks and months are not
  performance limits. The owner chose this over a narrower variant (only estimates that reach across the limit) after
  the minimal benchmark of 09.11.2026, whose only unnecessary block was `pos-latency-limit`. The reference set now
  labels that case `architecture_candidate`; offline regression in `packages/council/test/measurement-gate.test.ts`.

## Follow-up round (#228 D + #229, owner decision 08.11.26, option A)

When the Final Verdict ends without a recommendation because checks are missing or unclear, the owner can start **one
small follow-up round** from the verdict card ("Why is there no recommendation?"). It is the same mechanism with two
triggers (ADR `docs/adr/0228-0229-follow-up-round.md`):

| Kind              | Items asked                                                                 | Who answers                                        |
| ----------------- | --------------------------------------------------------------------------- | -------------------------------------------------- |
| `completion`      | `(evaluator, proposal, requirement)` with no valid check from that evaluator | the same evaluator, only for these items           |
| `targeted_review` | the evaluator's own `UNKNOWN` checks                                        | the same evaluator; the other evaluators' evidence is passed as an untrusted hint |

Rules:

- **Frozen and append-only.** The follow-up is a new `evaluation_round` (`kind`, `parent_round_id`, `items`,
  `token_budget`, `status`, `created_by_id`) on round 1's frozen proposals and requirements. New checks are new
  `requirement_check` rows; nothing is overwritten.
- **A FAIL is never outvoted.** `mergeFollowUpChecks` lets a valid follow-up answer replace the same evaluator's valid
  checks of an asked item only when none of them is a valid FAIL. Invalid rows stay visible.
- **Only per click, with an extra budget.** `GET /api/sessions/:id/follow-up` returns the items and a token estimate per
  kind; `POST` needs `decision:approve`, status `awaiting_approval`, a budget ≥ the estimate (max 1,000,000 tokens) and
  an explicit confirmation. The budget is added to the session budget and spent on the owner's own keys (BYOK). At most
  two follow-ups per decision, one at a time; the request is audited (`council.follow_up_requested`).
- **Then the verdict is recomputed.** The job runs only the follow-up evaluation and `computeDecision`; the matrix lists
  the rounds in `followUpRounds` (`round`, `kind`, `items`, `applied`). If nobody answered, the round is `failed` and the
  verdict stays as it was.
- **Feature flag.** `FOLLOW_UP_ROUND=true|false`; default on for the hosted app, off for self-hosted installations.

## Favourite, prototype build and acceptance by measurement (#249 part 2, #478, gate version 3)

Owner decisions 08.11.2026: variant B (a marked prototype/measurement build for an architecture candidate) and the same
"favourite – not regularly approved" state for a qualified proposal of a needs-verification verdict (#478). Gate
version 3 only; councils of version 2 get none of it.

- **Who may.** A person with the approval role, from a signed-in session only: the web route refuses API tokens for
  these actions, and neither MCP nor the assistant offers them. Every step is audited.
- **Eligible proposals** (`checkPrototypeEligibility`): an architecture candidate, or a proposal the gate qualified
  while the verdict as a whole needs verification – consistent matrix, every check PASS, enough evaluators, security
  minimum met, not blocked by a critical objection. The session view lists them in `decisionStatus.prototypeProposalIds`.
- **Mark as favourite** (`mark_favorite`, written reason): a human statement, no approval and no build. The session keeps
  waiting for a decision; the view returns it as `humanMark`.
- **Approve a prototype / measurement build** (`approve_prototype`, written reason): the session still waits for a
  decision; the Execution Council starts only a run of kind `prototype`. It is marked everywhere: builder prompt
  ("prototype / measurement build – not a finished solution"), draft pull request title prefix
  `[Prototype – not a finished solution]` and body, audit (`kind: "prototype"`), execution screen and Final Verdict. It
  is never a regular approval: `approve` and `select_alternative` stay closed for a needs-verification verdict.
- **Gate 2 – acceptance by measurement** (`measurement_result`, append-only): for every requirement the gate marked
  `measurementPending`, a person records method, target value, measured value, met / not met and **mandatory
  evidence**. It is a self-declaration and shown as such everywhere ("Measurement: self-declared by <person>, evidence:
  …"). A single recorded "not met" blocks the proposal for good. When every open measurement is recorded as met,
  `approve_after_measurement` is the regular approval (`checkApprovalAfterMeasurement`): all other rules stay, including
  a comparison on equal terms, and the build re-checks it on every run. The requirement stays hard – only the measured
  value fulfils it.
- **Not built yet:** a second person confirming a measurement (four-eyes principle, optional per workspace) – #496.

## Process quality (#182, deterministic part)

`processQuality()` (`packages/council/src/process-quality.ts`) describes how a council worked, computed on read from
stored data – no model call, no migration, no benchmark (the single-shot comparison of #182 stays separate and needs a
cost approval). The session view returns figures and status keys only; web card (tab Evaluation, below the requirement
table) and PDF word them. It describes the process, it is no proof that a verdict is right.

| Figure | Definition | Limit shown to the user |
| --- | --- | --- |
| Participation | `validParticipation` per participant, plus per independence group (`matrix.evaluatorGroups`, #522): a group counts when one instance delivered in every phase | – |
| Convergence | mean pairwise word overlap (Jaccard of normalised words from title, summary, architecture, components) of the latest revisions minus that of the first versions; level strong ≥ 0.15, moderate ≥ 0.05, else little; drift per proposal | measured by shared words, not by meaning; not measurable with fewer than two proposals or without revisions |
| Effect of objections | survived = accepted or unresolved; per survivor: blocking, followed by a later revision of its proposal (or moot), or no visible effect | assigned by time and target, not proven as the cause; zero objections are no quality sign |
| Weight of the votes | share of the vote held by the strongest independence group (one voice per group); "weights decided the winner" when the stored verdict carries `weighting_changed_winner` (computed by `aggregateVerdict`) | only warns when the winner changes – no warning for a mere majority share (two-model fatigue of #170) |

Workspace overview (`/decisions/quality`, link "Process quality" on the decisions list, `workspaceProcessQuality`): the
same figures for the last 50 councils of the workspace that have a verdict, plus a summary (full participation,
convergence levels, standing objections and those without visible effect, councils where the weights decided the
winner). Readers of the workspace see it; figures only – no proposal or brief text, no other workspace, nothing
platform-wide.

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

Stage 2 (08.11.26): the same card also sits above the objection list in the Minority Review & Consensus Round tab.
- Filter chips with counts: all, open (open/unresolved, or upheld but not yet fixed – not moot), high/critical (or blocking), resolved
  (refuted/resolved or moot) – `matchesFilter`.
- A step row per dispute: objection raised → answer (answered / conceded / unanswered) → independent review → revision
  → status, with a time only where one is stored (objection and revision; answers and reviews have none).
- "Belege ansehen": the objection id and time, the original message (id, phase, round, time, full stored text), the
  attacked and the current proposal version ("damals: v1 · aktuell: v2" – the newest revision stored before the
  objection) and the review. Missing data reads "not stored", never filled in.
- Empty state: once the Minority Review is done or a verdict exists and no objection or remaining disagreement was
  stored, the card says "no documented decisive disagreement" instead of disappearing – never an invented conflict.
  Before that point it stays hidden.
- Tests (`cruxes.test.tsx`): objection on A v1, A revised to v2, review still unresolved → open, never resolved, sources
  then v1 / now v2; every shown dispute points to a stored objection row; a council without objections shows the empty
  state only after the review. No model call, no migration; the PDF report is unchanged.

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

**Gate before score (08.11.26).** The requirement × proposal matrix now comes right after the status hero and the
review facts, **before** any score, and every score bar carries the proposal's gate status as a chip beside it
(qualified / needs verification / does not meet / provisional favourite, `requirementGate.feasibility.*`). So a high
score can never be read as "passed" before the reader has seen which requirements are not met or still open. Order:
1 status, 2 requirements (gate), 3 overall scores, 4 criteria, 5 key disputes (#267, `CruxesCard`, built separately),
6 objections. The plain-language "why no recommendation" card (#230) stays in the decision card below the dashboard.
The 30-second usability measurement of #266 still needs a test with real people.

## PDF in three levels (#268, 05.11.26)

`/api/sessions/:id/report?format=pdf&level=brief|report|full` – one report snapshot, three depths: **brief** = the
graphical decision summary only (1–2 pages for decision makers), **report** (default) = summary + full text report,
**full** = report + audit appendix (`apps/web/src/lib/server/report-audit.ts`): every stored requirement check
(requirement × proposal × actual evaluator, status, evidence, estimate exactly as stored, checks that did not count with
the reason) and the model calls per model and phase with tokens, plus brief/requirement/gate versions. No model call,
nothing recomputed. The Final Verdict offers the three as buttons.

**Chinese report (#268, 08.11.26):** the report speaks all five interface languages. `reportLocale("zh")` gives
Chinese fixed wording (`ZH` in `report-i18n.ts`, plus the engine sentences in `report-engine-text.ts`) for Markdown,
Word, the delivery message, Confluence and the PDF; model text stays as written. The PDF embeds **Noto Sans SC** (SIL OFL
1.1, `apps/web/public/fonts`, see `THIRD_PARTY_NOTICES.md`) through `@pdf-lib/fontkit` – loaded only for zh and
embedded as a subset of the characters used (a test report: ~80 KB instead of the 8 MB font file; other languages keep
the standard fonts, ~6 KB). Lines of Chinese text without spaces are cut to fit the page. Image size: the web build drops the traced copy of `public/`
(it is copied into the image once), and the worker image leaves `apps/web/public` out
(`Dockerfile.worker.dockerignore`); `packages/build/src/sandbox.ts` no longer makes Turbopack trace the whole project.

**One status for screen and PDF (#268 PR 1, 08.11.26):** `verdictStatus(view)`
(`apps/web/src/components/session/verdict-status.ts`) is the only derivation of the verdict title (`outcomeKey`), the
first offered action, the S1 locks (gate versions 2 and 3) and the #477 split "awaiting your review · no approvable
proposal". The verdict screen, the session header and the PDF use it; the PDF takes the screen's words
(`reportStatus`, `apps/web/src/lib/server/report-status.ts`, via next-intl messages) and prints the status line and the
title on top, before any score – downloaded PDF and delivered PDF alike. `humanMark` and typed `marks` are reserved for
#249 part 2 (a favourite or prototype build is a human action, never a verdict).

**Brief page from the screen's derivations (#268 PR 2):** on the summary page the hard-requirement matrix now comes
before the overall score and the criteria (gate before score, #266). Below the scores the PDF shows the key disputes
(top 3, `deriveCruxes`, as on the Minority Review tab) and the next steps for the same proposal and mode as the verdict
screen (`nextStepsTarget` + `deriveNextSteps`: what to settle, strongest counter-position, riskiest assumptions,
cheapest test, stop criteria) – worded with the screen's messages, stored statements as written. The human decision
is printed in words (`approvalActionText`), never as the raw action id. Callers without the shared derivation keep the
per-proposal objection counts.

**Page master and long reports (#268 PR 3):** every page carries the AI note ("AI assessment – not independent factual
verification") and "x / y"; from page 2 the document id "project · session · verdict · created … UTC". The requirement
matrix on the summary page shrinks its columns for up to six proposals (narrow cells show OK / x / ? / ! / P / M with a
legend), wraps long requirement texts instead of cutting them and repeats its header on a new page; the audit's
model-call table repeats its header too. In the audit, statuses are translated, phases carry their product names and
"not every part confirmed" is translated. Layout fixtures (`report-layout.test.ts`): A 3×6 → brief 2 pages; B 6×45
with long DE/EN texts → full report 21 pages, ~56 KB, ~0.1 s; C 2 models, limited review, rejected.

**Human marks, measurements, review status (#268 with #249 part 2 and #477):** `verdictStatus` carries `humanMark`
and the typed `marks` (`favoriteNotRegular`, `prototypeBuild`); the PDF prints the screen's sentence under the verdict
(a favourite or prototype build is a human action, the verdict stays as it is). Acceptance by measurement uses one
derivation for the panel and the PDF (`measurementRows`, `apps/web/src/components/session/measurements.ts`): every result
is "Measurement: self-declared by …, evidence: …", one measured miss stays decisive. The rule "awaiting your review ·
no approvable proposal" (`awaitingReviewWithoutApproval`, `packages/core/src/approval-status.ts`) is shared by the
header, `verdictStatus` and the report: Markdown/Word print it as the status, JSON carries `workflowStatus` and
`approvalStatus`. The new human actions (marked as favourite, prototype/measurement build approved, approved after
measurement) are worded in every report.

**Course of the council (#268 part 4):** the report and full PDFs open with "Course of the council" before the full
text: the phase timeline (stored stage times as in the replay, `buildReplayEvents`, UTC and minutes), participation and
tokens per model (the Council Room's `participationMatrix`: calls, contributions, failed calls, "no contribution",
instances of one model marked as one independent voice), follow-up check rounds as stored with the verdict
(`followUpRounds`: requested checks, done and taken over or not finished) and the human decisions (the verdict
screen's history, in its words). The brief stays the summary alone.
Process quality (#182) follows in the same section with the Evaluation card's own wording and limits
(`processQualityLines`, `apps/web/src/components/session/process-quality-lines.ts`, shared by the card and the PDF).

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

**Stage 2 (08.11.26): profiles, snapshot, role ≠ vote, golden set**

- Role profiles (#270) are suggested with their role (`suggestRoleProfiles`): exactly one own or team profile for the
  role → that one; none → the curated profile of the role; several → none preselected ("N of your profiles – choose").
  Applying sets the roles and, only for roles without a chosen profile, the suggested profile (`profilesAfterApply`) –
  the user's own choice is never overwritten. Nothing starts without the user.
- `council_session.role_selection` (migration 0046, `roleSelectionSnapshot`): what was suggested (roles, topic words,
  R-ids, suggested profile), what was not suggested, and where every active role came from (`suggestion`, `skill`,
  `own`, `coverage` for #136 extra perspectives) plus the number of models. Computed in `createSession` from the brief and
  the confirmed list the council is bound to – never taken from the client. Older runs: null.
- The setup states role ≠ vote as numbers ("3 models · 5 perspectives · each proposal is checked by up to 2 other
  models") and names a model selected twice (also through a second key): it is no second independent evaluator, the
  start stays blocked – the same rule the server enforces (#249).
- Gate, votes, weights, thresholds and the minimum of two foreign evaluators are unchanged.
- Session view, 12 Minds Council tab: "Why these perspectives?" (`why-perspectives.tsx`) shows, only from
  `role_selection`, where each active role came from, the topic words and R-ids behind a suggested one, the frozen role
  profile and what was not suggested. Councils without the snapshot (before 0046) show nothing – no reconstruction.

Golden set (`packages/core/src/role-suggestion.golden.test.ts`, ten projects, relevant roles written by hand, no model
call): average coverage of the relevant roles **95 %** with the suggestion versus **32 %** with the default team of
Independent Expert; at most one role without a reason per project (0.3 on average; default team 1.6). Known gap: "runs on
the existing server" (OnJam) suggests the backend engineer rather than DevOps – topic words only, no inference.

## Next steps (#273 MVP, 05.11.26)

`deriveNextSteps` (`apps/web/src/components/session/next-steps.ts`) builds a read-only checklist for the recommended
proposal – or, when nothing can be approved, for the best-scored one – from stored data only: requirements not
confirmed for it and its open objections ("settle before any irreversible step"), the author's own assumptions ("test
these first"), high/critical risks with the planned mitigation ("stop and re-check if …") and the points the Consensus
Round left open ("ask the council again when …"). Empty sections say "not specified"; nothing is generated, a test plan
never confirms a requirement and nothing starts without the user.

**Stage 1 (08.11.26), still without any model call:** every open objection names the model that raised it; a new section
"Strongest counter-position" shows the top open, unresolved or upheld objection against the proposal – taken from the
Key disputes ranking (#267 `deriveCruxes`, no second logic) – with its own stored reasoning as "it would be right if …";
when nothing can be approved the card says that nothing can be approved or built yet and points to settling the open
points. A cheapest validating test, concrete stop criteria and revisit triggers would need new model output (optional
proposal fields, about 1–2k tokens per council, new `PROMPT_VERSION`) – stage 2, waiting for the owner's decision.

**Stage 2 (owner decision 08.11.26):** the proposal schema has three optional fields – `cheapestTest` (riskiest
assumption, smallest test, success criterion), `stopCriteria` and `revisitTriggers`. They come with the existing
Independent Thinking and Consensus Round revision calls (no extra call; `PROMPT_VERSION` 2026-11-09.6); the prompt asks
to leave a field empty rather than invent figures, dates or costs. Providers receive them as fields (strict schemas
require every property, so "empty" is the way to say "not stated"); proposals written before stay valid because the
fields are optional when stored. The next-steps card shows "Cheapest useful test" (labelled "the author's own
suggestion (AI) – a plan, not a confirmed check"), adds the stop criteria and revisit triggers to their sections with
"(AI suggestion)", and says "not stated by the author" when a field is missing. Nothing here confirms a requirement or
unlocks a build.

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
- Fixed scenario facts (R2-02, owner decision 08.11.26): in the requirement check, facts the brief states as fixed input
  about a given option count as written for a proposal that adopts that option unchanged; evaluators name the brief
  fact in evidence. They stop counting once the proposal changes the option in a way that affects the fact. Vendor
  claims, quoted documents, assumptions and embedded instructions are no fixed facts, and a fixed fact never overrides
  or replaces a confirmed requirement (`packages/engine/src/prompts.ts`, `PROMPT_VERSION` 2026-11-08.2).
- Fixed measured values (R3-02, 08.11.26): when the brief states a fixed measured value for the option a proposal
  adopts unchanged, the evaluator uses it as the estimate (estimateLow = estimateHigh) instead of a range. The cause of
  a measured requirement is shown in the interface language with local number format (`requirementGate.estimate.*`).
- Report: the proposals (Telegram live test 08.11.26). Markdown, PDF and Word name every proposal right after the
  outcome – label, title, author model and summary ("Die Vorschläge"); the PDF summary page lists them before the
  scores. The engine's gate causes and summary appear in the report language.
- Report: one language from start to end, and one approval status (ChatGPT review of two Telegram PDFs, 08.11.26).
  In de/fr/es the report no longer prints engine English or raw values: confidence issues are worded from the stored
  structure (`evaluationMatrix.confidenceIssueData`, `packages/council/src/report-engine-text.ts`), the fixed parts of
  objection decisions ("Addressed by the author in v2.", "Not independently re-reviewed.", "Conceded by the author …"),
  matrix notes ("Not qualified: …", "Other gate: …"), debate types and roles, objection areas and severities,
  consensus status, risk lines, human decisions, the delivery subject, the PDF title and the Confluence link are
  translated. English output is unchanged. Model text is never translated.
  - Status: when proposals passed the requirement check but nothing can be approved (e.g. conflict of interest), the
    outcome says so neutrally and `blockedExplanation` names the proposals that passed and why nothing was recommended;
    on the PDF summary those proposals read "passes the requirements" instead of "not approvable". A tie the server
    lets a human decide is titled "No automatic recommendation".
  - "What you need to do now" (`nextAction`): one sentence from stored state only (approvable set, outcome, last human
    decision) – right under the outcome in Markdown and on the PDF summary, and as the next step when the recommended
    proposal names none ("Next steps: none" is gone).
  - Language check: `reportLanguageIssues(text, locale)` lists engine English and raw values in a non-English report.
    Delivery (Telegram, e-mail, Confluence) logs a warning when it finds any; it does not block a verdict. Test:
    `packages/council/test/report-language.test.ts` (the Telegram run "E-Mail oder Messenger-Gruppe?", de/fr/es).
  - Stored exclusion reasons ("Not taken over") appear in the report language too; the ask_consyrium / Telegram
    context sentence is a known reason (`CLIENT_CONTEXT_EXCLUSION_REASON`, live test of #410, 08.11.26).

## Every model gets a perspective (#136)

Roles are spread round-robin over the models. When there are more models than chosen perspectives (six models,
four default roles), the models without a role get an extra perspective that is not chosen yet – generalist reviewers
first (independent critical thinker, maintainability reviewer, QA expert, …; `coverAllParticipants`,
`packages/core/src/role-coverage.ts`). This also applies when every role is assigned to one model by hand. The setup
page lists the added perspectives before the start, the preview counts their calls, and the session stores them in its
policy. A role is a review perspective, not a vote: every model still has exactly one vote and never scores its own
proposal. The extra perspectives can be switched off on the setup page (`extraRoles: false`, ChatGPT review 09.11.26);
the page shows how many extra 12 Minds calls they add, and that two perspectives of one model are not two independent
opinions.
proposal.

## Replay ("Verlauf" tab, #271 part 1, 08.11.26)

The session workspace has a "Verlauf" (Replay) tab next to the Council room: the council as a timeline of **stored
events only**, replayable step by step. Every entry is one persisted row with its own timestamp – stage start/end
(`workflow_stage`), proposal revision, debate message, objection, Minority Review, scores (one entry per evaluator at its
last score), vote, Consensus Round, verdict (also superseded ones) and human decisions. Nothing is generated: no quotes,
no estimated times, no reconstructed events; rows without a timestamp are left out and counted ("{n} entries have no
time stamp"). Same order after every reload: time, then phase, then a fixed kind order, then the row id
(`buildReplayEvents`, `apps/web/src/components/session/replay-events.ts`).

- Controls: previous/next event, play/pause, speed 1×/2×/4× (display only), scrubber, "Jump to the end" / "Jump to live".
  The phase bar shows the state at the cursor in words; message and objection counts up to the cursor.
- Honest limits: a dropped-out model is shown as dropped out from the start (the time of the dropout is not stored, so it
  is never shown as active); objection decisions have no time of their own and appear only at the end of the replay;
  authors stay hidden until the verdict, as everywhere else.
- Read-only: no writes, no model calls, no new endpoint – it reads the session view the page already has, and a running
  session follows the existing live stream. Screen readers get one polite announcement per manual step, not every
  playback step; scrolling respects reduced motion.
- Long sessions (part 2): the timeline renders at most `REPLAY_PAGE` (150) events ending at the cursor; "Show 150
  earlier" loads more on request, the scrubber always covers every event.
- Network view (part 3, "Zeitleiste | Netzwerk"): models left, proposals right, one line per model → proposal and kind
  (question, critique incl. rebuttal, answer, objection) built only from stored rows up to the cursor
  (`replayEdges`); line width = number of rows, colour plus dash pattern per kind, no animation. No model → model lines
  (they would reveal authors before the verdict), nothing inferred from activity. Every line is also a button in the
  "Connections" list, which shows the stored original texts – the list is the primary view on phones.
- Table view (part 4, "Zeitleiste | Netzwerk | Tabelle"): the same stored events as the timeline, one row each with
  time, phase, event, model and proposal, in the same window of 150 ending at the cursor; the cursor row is marked
  (`aria-current`). Authors appear only once the verdict revealed them, as everywhere else.
- Follow-ups of #271: demo mode "Simulation" (#449), user test and measurements (#450).

## Participation per model (ChatGPT P0, 09.11.26)

The Council Room shows a table **Beteiligung je Modell**: per model and phase the successful calls, failed calls and
stored contributions (proposal, debate messages, scores) – counted only from stored rows (`participationMatrix`,
`apps/web/src/components/session/participation.ts`). A phase that ran without any call or contribution of a model is
marked "kein Beitrag", so a silent model is visible instead of being counted as taking part. Several perspectives of
one model remain one vote.

Several instances of one model (different keys, user decision 08.11.26) are marked per row as "Instance 2/3 – one
independent voice" (`independenceKey` from `@consyrium/core`), matching the counting in verdict, majority and gate (#522).

## Same model through several keys (user decision 08.11.26)

The same model may join a council several times through different API keys or accounts – each instance with its own
role and role profile. Instances of one model are never independent of each other: `independenceKey`
(`packages/core/src/independence.ts`) puts them into one group (provider + model id, lower case, without a date or
version stamp such as `-20261001`, `@20261001`, `-latest`). Part 1 (this, no behaviour change while the start still
refuses a second instance):

- Final Verdict (`aggregateVerdict`, `evaluatorGroups`): a group never scores or ranks a proposal of its own group, its
  instances share one voice (their weights are split) and it counts once as an independent evaluator.
- Majority (`modelMajority`): one preference per group.
- Minority Review judges: a judge is independent of author and raiser by model, not by key; one verdict per model per
  objection (another instance may stand in only for one that failed).
- Requirement round: `expectedEvaluatorIds` are frozen without the instances of the author's group.

Part 2 (engine contract 6, #523; the council passes `participantGroups` from `groupsOf` to the gate): the gate counts groups for n, majorities and the minimum of two
independent evaluators (#249), one statement per group (any FAIL → FAIL). Part 3 (user decision 08.11.26, replaces the #253 block): the start allows the same model again through **another**
key or account (the same model twice through the same key stays refused). The setup shows a clear note instead of
the former red block ("Claude Opus: 3 instances (different keys) count as 1 independent voice …"), the role line counts
groups, the report names every instance ("anthropic/claude-opus-5-5 (instance 2 of 3 – one independent voice)") and
the audit appendix numbers them ("#2/3"). Tests: `packages/council/test/s1-gate.test.ts` (2× m1 + m2 is a limited
review, never approvable; 2× m1 + m2 + m3 can still qualify), `engine.test.ts` (second key allowed, same key refused).

## After the favourite (Gesamttest 08.11.26)

- `verdictStatus.initialAction` moves on after the human mark: architecture candidate → "mark_favorite"; favourite
  marked → "approve_prototype"; prototype build approved → "record_measurement" (the dashboard links to the measurement
  panel), or "approve_after_measurement" once a met measurement allows it. "Your decision" uses the past tense
  (`verdict.dashboard.decided.*`). The PDF's "What you need to do now" follows the same marks (`report.humanMark`).
- Next steps list a measurement check as open ("Measurement plan confirmed – measurement open") until a recorded
  measurement of this verdict meets it; one measured miss stays decisive.
- Project page: "Latest decision" shows the verdict title of the session screen (`verdictStatus.outcomeKey`) and the
  #477 split "awaiting your review · no approvable proposal".

## Decision dashboard: one requirement status (#266, 09.11.26)

`requirementCellKey` (`apps/web/src/components/session/requirement-status.ts`) is the only derivation of a requirement ×
proposal status for the heatmap cell, its detail panel and the requirement table of the Evaluation tab: PASS, FAIL,
DISPUTED, UNKNOWN, and PLAN / MEASURE for a confirmed build or measurement plan (never "met"). DISPUTED is set apart
from UNKNOWN by its own symbol (≠), a dashed red frame and its own count ("1 confirm, 1 not met"); a legend under the
heatmap names every state. The Evaluation tab shows words with symbols instead of the raw codes PASS/FAIL ("Confirmed
by: …", "Not met according to: …").

