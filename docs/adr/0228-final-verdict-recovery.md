# ADR #228 – Final Verdict: cut-off answers, lost checks and the size limit

Status: step 1 (A, size check before the start) implemented 30.10.2026; B and D still proposed.

## 1. What happened (root cause)

First GPT-1 run (`ses_31dccde2…`, before #224): DeepSeek V4.1 Flash wrote two unusable Final Verdict answers –
one call stopped at the output limit (18,000 tokens = 2 proposals × 6 requirements × 1,500), one ended as
"finished" with 8,097 tokens of JSON that was not closed. Before #224 the second kind counted as `invalid_output`;
its repair asked for "follow the schema" instead of "shorter", and after a failed repair there is no further
attempt. The evaluator's vote was lost, its two proposals stayed unconfirmed, and the gate correctly answered
_needs verification_.

What it was **not**: no endless repetition (no runaway was detected), no schema the model could not follow (the same
model answered the same schema in 7 other councils), and no budget refusal.

## 2. Measurements (8 councils, 30.10.2026, 24 Final Verdict calls)

| Model               | output tokens per check item¹ | calls failed                   |
| ------------------- | ----------------------------- | ------------------------------ |
| Claude Haiku 5.5    | 400–830                       | 0                              |
| GPT-5 mini          | 330–500                       | 0                              |
| DeepSeek V4.1 Flash | 420–1,230                     | 1 (the run above, before #224) |

¹ item = one foreign proposal × one confirmed requirement; the five scores per proposal are included.

After #224 (2 reruns of GPT-1): 6 of 6 calls valid; one GPT-5 mini answer earlier in the same run was cut off and
repaired. The third run recommended a proposal.

**Conclusion for the observed case:** #224 removes the cause (a cut-off answer reported as finished now gets the
"shorter, larger limit" repair). Evidence: 7 of 7 DeepSeek Final Verdicts since then were valid.

## 3. Remaining gaps (each with a reproducible probe)

| #   | Gap                                                                                                                                                                                                                                                                                                                   | Probe                                                                                    | Today                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| G1  | **Size limit.** One call per evaluator covers _all_ foreign proposals × _all_ requirements, at most 32,000 output tokens. At the measured worst case (1,230/item) that holds ~26 items: 3 models → ≤ 13 requirements, 4 → ≤ 8, 5 → ≤ 6, 6 → ≤ 5. A list may have 100 requirements and a council 6 models (500 items). | arithmetic above; `outputTokensFor("deepseek", …, "evaluation", 28)` returns the 32k cap | The council starts and pays for every phase, then the Final Verdict cannot fit. **Not detected before the start.** |
| G2  | **Repair cut off again.** A repair that is itself cut off ends the evaluator for this council.                                                                                                                                                                                                                        | test `#228: a Final Verdict cut off twice …` (s1-gate.test.ts)                           | Fail-closed, named in `failedEvaluators`, no checks stored, no recommendation. Correct, but the checks are lost.   |
| G3  | **Partial answer.** A valid answer that leaves out the checks of one proposal is stored; the missing checks are never asked for again (only completely missing votes are retried).                                                                                                                                    | test `an evaluator that leaves the checks of one proposal out …`                         | Fail-closed (_needs verification_). Correct, but not recoverable.                                                  |
| G4  | **Concurrency.** Two workers on one Final Verdict.                                                                                                                                                                                                                                                                    | test `two workers on the same Final Verdict …` (release-postgres)                        | Covered: one vote and one set of raw checks per evaluator.                                                         |

## 4. Alternatives

|                    | A – keep one call, check the size before the start | B – split per foreign proposal                                             | C – batches of requirements                             | D – targeted completion of missing checks                                                           |
| ------------------ | -------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Fixes              | G1 (refuses or warns)                              | G1 up to ~26 requirements per proposal; G2 loses only one proposal         | G1 for any list size                                    | G2, G3                                                                                              |
| Extra calls        | 0                                                  | +1 per evaluator per extra proposal (3 models: 2 instead of 1)             | +⌈R/batch⌉ per proposal                                 | only after a failure, one per missing (evaluator, proposal)                                         |
| Comparison quality | unchanged                                          | scores no longer side by side in one answer; ranking must come from scores | as B, and one proposal's requirements spread over calls | unchanged for the answered part                                                                     |
| Independence       | unchanged                                          | unchanged (same evaluator, same frozen revision)                           | unchanged                                               | must bind evaluator, frozen revision and requirement ids; append-only, never replace a stored check |
| Effort / risk      | small                                              | medium – changes the vote shape (ranking)                                  | large                                                   | medium – new state "partially evaluated", idempotency per (round, evaluator, proposal, requirement) |

Counter-arguments I see myself:

- **B/C cost more for every council**, also the 95 % where one call works. Splitting only above a threshold keeps the
  cost but adds a second code path that is rarely exercised.
- **More output room is not the fix**: 32k is already the maximum, and DeepSeek's 18k cut-off happened with 1.5× the
  room it uses on average.
- **D looks attractive but is the riskiest for S1**: a repaired check is written later, under a different prompt, and
  must never look like the original answer. It also needs a second Final Verdict pass on resume.
- A **different model** stepping in for a lost evaluator is excluded: it would change who judges a proposal
  (see #229 for an _additional_, labelled review).

## 5. Recommendation

1. **Now (small, no schema change):** A – compute the Final Verdict size before the start (models × requirements ×
   measured per-item cost per provider). Above the limit: block the start with a clear text ("6 models × 40
   requirements do not fit into one evaluation; split the list or use fewer models"). Below but close: a warning in
   the cost preview.
2. **Next, after owner approval:** B as an automatic split only when A says one call does not fit – then G1 becomes a
   larger limit instead of a refusal.
3. **Later, only with #229 decided:** D for G2/G3, as an explicit, labelled and budgeted "complete missing checks"
   step, never automatic.

No live BYOK calls are needed for 1; 2 needs one approved test council (~0.20 $).

## Update 08.11.2026 – split evaluator built (#246)

Step 2 is built as a split **by requirement groups** (alternative C, as specified in #246) instead of per proposal:
groups keep the per-call output bounded for any number of requirements, while a split per proposal would still overflow
with many requirements. The split happens only when one call does not fit (councils that fit keep exactly one call, so
the 95 % case costs nothing extra). G1 (refusal above the limit) is replaced by more calls, shown before the start and
counted in estimate, minimum budget, reserve and hard budget. Details: `docs/council-engine.md`, section
"Final Verdict size check (#228) and split evaluator (#246)".

