# Decision brief #228 D + #229 – one follow-up round for missing and flagged checks

Status: **implemented** (owner decision 08.11.2026: option A; see `docs/council-engine.md`, section "Follow-up round"). Input: ADR 0228 (`0228-final-verdict-recovery.md`),
ADR 0229 (`0229-targeted-review.md`, owner decision 31.10.2026: rule **4a**).

## What is still open

| Issue | Gap                                                                                                                                                                                           | Today (fail-closed, correct)                         |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| #228  | **G2** a repaired Final Verdict answer is cut off again → that evaluator's checks are lost. **G3** a valid answer leaves out one proposal's checks → never asked again.                          | _needs verification_, evaluator named as failed       |
| #229  | **Flagged checks**: `UNKNOWN` without evidence, a PASS without reference to the text, two independent checks that contradict each other – owner chose 4a: the same evaluators re-check only these items, with an added reviewer's evidence; a FAIL is never outvoted. | _needs verification_; 4a decided but not implemented |

Size (G1) and concurrency (G4) are solved (#228 step A, #246 split evaluator).

## The observation that connects them

Both are a **second, smaller evaluation round on selected items** – `(evaluator, proposal, requirement)` – of the
frozen first round:

- #228 D: items with **no** valid check; the round asks the **same** evaluator for exactly these.
- #229 4a: items with a **flagged** check; the round asks the **same** expected evaluators again, with the added
  reviewer's evidence attached.

The data model is ready for it: `evaluation_round` (frozen, numbered per session) and `requirement_check`
(append-only, bound to round, revision and expected evaluators). A follow-up round is one more `evaluation_round` row
with its item list; its checks are appended, round 1 is never changed.

## Options

| | **A – one shared follow-up round** (recommended) | **B – #228 D alone now, #229 later** | **C – wait** |
| --- | --- | --- | --- |
| Scope | one mechanism, two triggers ("complete missing checks", "re-check flagged items") | only missing checks | nothing |
| Rule | 4a for both: same evaluators, frozen revision, append-only; a later PASS fills a gap but **never outvotes a FAIL** | same for missing items | – |
| Start | never automatic: the verdict shows "DeepSeek: 2 of 3 proposals not fully checked – complete (≈ X tokens)" or "R2: checks contradict – re-check (≈ X tokens)"; the user clicks; server enforces the budget | same, one trigger | – |
| Report/API | round 2 shown separately ("completed later" / "re-checked"), round 1 stays visible | same | – |
| Migration | **yes**, small: `evaluation_round.kind` (`final` / `completion` / `targeted_review`), `parent_round_id`, item list | yes, same columns | no |
| Effort | medium (one round runner, two item selectors, one UI block) | small–medium, but #229 later re-does the round runner | – |
| Extra cost | only after a click; per item ≈ 1,250 output tokens (ADR 0228 measurement) + one brief/proposal input per call; e.g. 12 missing items ≈ 15k output + ~20k input | same | 0 |

Invariants for every option: no different model stepping in for a lost evaluator (#229 §4), no main judge, no silent
gate relaxation, no automatic paid call, idempotent per `(round, evaluator, proposal, requirement)` – two workers or a
resume never write a check twice.

## Recommendation

**A**, behind a feature flag, in this order:

1. Migration + round runner + "complete missing checks" (#228 D) – the simpler selector, verifies the mechanism.
2. "Re-check flagged items" (#229 4a) on the same runner, first with the two triggers ADR 0229 names first.
3. Measure: share of _needs verification_ that qualifies after a follow-up, at the same number of FAIL; extra tokens
   per follow-up (from `usage_record`, #244).

Tests only with test adapters (no live calls above 0.10 $). Engine rules stay in the private engine; only the public
contract (round kinds, item binding, append-only) is documented here.

## Decisions needed from the owner

1. A, B or C?
2. Feature flag default off for everyone, or on for the hosted app after the tests?
3. Does a follow-up count against the council's original token budget, or does the click ask for an extra budget?
