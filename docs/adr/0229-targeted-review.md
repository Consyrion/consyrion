# ADR #229 – Targeted independent re-review instead of a "main model"

Status: proposed (30.10.2026) – analysis only. No change to the gate, no new phase, no live BYOK calls.
Policy details of the gate stay in the engine (#188); this document names only public behaviour.

## 1. Is the problem model weakness? (question 1)

Every council of 30.10.2026 without a recommendation, classified by its main cause:

| Council                    | Outcome                | Main cause                                                                                                | Class                                                                   |
| -------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| GPT-1, run 1               | needs verification     | DeepSeek's Final Verdict cut off; the repair asked for the wrong thing (fixed in #224)                    | (c) cut-off output – **our** repair logic                               |
| GPT-1, run 2               | needs verification     | an evaluator gave availability as "best case = low", exactly as our schema text said (fixed in #225)      | (b) number format – **our** wording                                     |
| GPT-1, run 3               | **recommended**        | –                                                                                                         | –                                                                       |
| GPT-2 Patient platform     | no qualifying solution | Germany-only vs. full processing in the USA; every proposal fails R2 with 2 of 2 evaluators               | (a)/(f) correct                                                         |
| GPT-3 Offline booking      | needs verification     | ranges across 12 weeks, availability below 99.95 %; one requirement wrongly excluded at intake (#227)     | (f) correct + intake                                                    |
| Gemini-1 E-invoice archive | no qualifying solution | 6–16 weeks against at most 4                                                                              | (a) correct                                                             |
| Gemini-2 Crypto paradox    | no qualifying solution | requirements that exclude each other                                                                      | (a) correct                                                             |
| Gemini-3 Logistics         | no qualifying solution | clear FAILs; a disguised meta rule got contradictory checks (one PASS "because the word does not appear") | (a) correct + (d) on a requirement that should not have been one (#227) |

**Finding:** in none of the eight runs was the decisive cause a weak model judgement on a real requirement. Three
causes were CONSYRION's own (repair, schema wording, intake) and are fixed or proposed (#224, #225, #227). The one
contradictory evaluation (Gemini-3, R5) concerned a meta rule, not a product requirement. A stronger "main model"
would not have changed any of these outcomes – the positive control was recommended once the plumbing was right.

Counter-argument to my own finding: eight councils with three cheap models are a small sample, and the cases were
designed to fail. The benchmark in #182 has to test this with solvable cases before the question is closed.

## 2. What deserves a second look (question 2)

Only a single `(proposal, requirement)` of the frozen round, and only when the first round shows one of:

| Trigger                                         | Example                                 | Second call useful?                                                 |
| ----------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| UNKNOWN for lack of evidence                    | "restore time not quantified"           | yes – a reviewer can read the same frozen text again                |
| PASS/FAIL whose evidence contradicts its status | "PASS because the word does not appear" | yes                                                                 |
| evaluators disagree (PASS vs FAIL)              | –                                       | yes, but a third opinion is not a majority vote                     |
| estimate ranges far apart                       | 8–18 weeks vs 10–12                     | sometimes – usually the proposal is vague; better: ask the author   |
| sole blocker that is also a competitor          | –                                       | yes, shown as a fact, never as an accusation                        |
| missing answer (cut off, timeout)               | –                                       | no – that is #228 (complete the missing check), not a new judgement |

## 3. Alternatives (question 3)

|                      | A – review on demand (user-triggered)  | B – automatic 4th evaluator                                          | C – stronger model as an additional reviewer | D – tool/measurement check     |
| -------------------- | -------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------- | ------------------------------ |
| Who triggers         | the user, per requirement              | always                                                               | the user                                     | the user, where measurable     |
| Independence         | new reviewer ≠ author; old checks stay | –                                                                    | –                                            | strongest: not a model opinion |
| Can it lift a block? | only by the rule in §4                 | changes quorum for every council                                     | same as A                                    | yes, for measurable facts      |
| Cost (BYOK)          | only when used; estimate shown first   | +1 call per proposal, every time                                     | as A, higher price per call                  | depends; often none            |
| Safety risk          | low, if §4 holds                       | medium – more models under unanimity _lower_ the recommendation rate | **high if it becomes the judge**             | low                            |
| Effort               | medium                                 | small                                                                | small on top of A                            | large, case by case            |

Rejected: a main model that decides. It would turn "independent evaluators" into "one model's opinion with
witnesses", and a stronger model is still a language model – four PASS do not verify a security or privacy claim.

## 4. How a new round may lift an old block (question 4) – the open product decision

Invariants (not negotiable without a new owner policy):

1. Round 1 is immutable. A review is **round 2** with its own id, snapshot (frozen revision, requirement ids),
   reviewers, budget, reason and timestamps.
2. Round 2 never removes a FAIL by majority. A FAIL is lifted only if **its own author** changes it in round 2 after
   seeing the reviewer's evidence, or the requirement is changed by the user (new list version = new council).
3. Round 2 may turn UNKNOWN into PASS only with the same rule as round 1: every expected evaluator of that proposal
   confirms with evidence. The added reviewer can add evidence; it cannot replace a missing confirmation.
4. Every changed status shows old status, new status, who changed it and why.

Options for the owner (choose one):

- **4a (recommended):** round 2 = the _same_ expected evaluators re-check only the flagged items, with the added
  reviewer's evidence attached. Lifts UNKNOWN that came from thin evidence; cannot outvote a FAIL.
- **4b:** as 4a, plus the added reviewer counts as one more required PASS (stricter, more blocks).
- **4c:** advisory only – round 2 is shown next to round 1 and never changes the gate (safest, least useful).

## 5. Conflicts of interest (question 5)

Every model writes a proposal and evaluates the others, so a block by a competitor is structural, not suspicious.
The UI should state facts ("Proposal B's only FAIL on R2 comes from the author of Proposal A, the current runner-up")
and offer the targeted review – never imply sabotage, never discount the vote.

## 6. Cost, UX, privacy (questions 6–9)

- Opt-in per council; the dialog shows the items, the reviewers, estimated tokens and a hard cap; one round per
  council by default; cancellable; actual tokens reported separately from round 1. Customer keys only.
- Wording: "3/3 models took part; on R2 they disagree; proposal not approvable. Optional: re-check R2 (≈ N tokens)."
- Unsolvable conflicts (Gemini-2, GPT-2): no review offered – the way on is changing the requirements.
- Medical, security and privacy claims stay "model judgement, not verified" after any number of PASS.

## 7. Recommendation

1. Do **not** build a main model. Close the question with the #182 benchmark (A vs. stronger models vs. single shot).
2. Build **A with rule 4a** behind a feature flag, after the owner picks 4a/4b/4c. Start with the two triggers that
   occurred: "evidence contradicts status" and "UNKNOWN for lack of evidence".
3. Keep #228 (missing answers) strictly separate: completing a lost check is not a new judgement.
4. Tests before the feature (from the issue): a wrong UNKNOWN is lifted only by the expected evaluators; two wrong
   PASS plus a reviewer FAIL never qualify; a sole blocker stays visible; parallel retries and crashes leave round 1
   unchanged.
