# ADR 0272 – Quick Council for reversible decisions

- Status: **proposed** – no new mode is built before the #182 benchmark (Go/No-Go below)
- Date: 08.11.2026
- Issue: #272 (related: #182, #244, #246, #249, #243, #38)

## 1. Question

Can CONSYRION offer a cheaper council for reversible decisions **without** a weaker gate than the full council
(confirmed requirements, at least two independent foreign evaluators per proposal (#249), security and minority
rules, human approval)?

## 2. Current state (main, 08.11.2026)

Calls per council for **3 models** (`estimateCalls`, `packages/core/src/policy.ts`):

| Phase                | Independent Expert | Adversarial Review | Consensus |
| -------------------- | -----------------: | -----------------: | --------: |
| Independent Thinking |                  3 |                  3 |         3 |
| Open Council         |                  6 |                  6 |         3 |
| 12 Minds Council     |                  8 |                 42 |        15 |
| Minority Review      |                  4 |                  5 |         4 |
| Consensus Round      |                  3 |                  3 |         8 |
| Final Verdict        | 3 (more with #246) |                  3 |         3 |
| **Total**            |             **27** |             **62** |    **36** |

- Independent Expert is already the light mode: one debate round, no rebuttals, four roles.
- Measured typical size (workspace sample, preview of 08.11.26): about **154,000 tokens** for an Independent Expert
  council with 3 models. The 741k runs named in #272 were **repository-context** councils: their cost comes from the
  context sent with every call, not from the number of debate rounds. #244 (cache repository context per commit) attacks
  exactly that.
- Phases that **cannot** shrink without weakening the gate: Independent Thinking (one proposal per model), Minority
  Review (security/minority gate), Final Verdict (every requirement × two foreign evaluators). Together 10 of 27 calls –
  and the largest outputs.
- Policy limits today: debate rounds 1–3, consensus rounds 1–3, roles 1–12; #136 adds roles until every model has a
  perspective (3 models → at least 3 roles). Users can override roles, debate and consensus rounds, but not the Open
  Council questions – so B needs its own preset entry in `MODE_POLICIES`, not just different start-screen defaults.

## 3. Options

|                  | A – Quick Advisory                                                                                                     | B – Lean Verified (preset)                                                                                             | C – no new mode now                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| What             | short run, explicitly **not approvable**, no build                                                                     | existing engine with the leanest allowed policy: 3 roles, 1 debate round, no Open Council questions, 1 consensus round | keep the three modes; reduce cost where it really arises (#244 context, #246 split only when needed, budget shortening #148) |
| Calls (3 models) | ~12 (IT + one review + summary)                                                                                        | **22** (−19 % vs. 27)                                                                                                  | 27                                                                                                                           |
| Gate             | none (orientation only)                                                                                                | **unchanged** (same Final Verdict, #249, minority, approval)                                                           | unchanged                                                                                                                    |
| Risk             | users read an orientation as a decision; a second product path to maintain; "cheap" result competes with the gated one | small saving, extra mode card to explain; still the same Final Verdict cost                                            | none new                                                                                                                     |
| Engine change    | new phase plan                                                                                                         | none (policy preset only)                                                                                              | none                                                                                                                         |

Estimate for B (same formula): Independent Thinking 3 + Open Council 3 + 12 Minds 6 + Minority Review 4 + Consensus 3 +
Final Verdict 3 = 22 calls. Because the remaining calls are the large ones, the token saving is expected to be **below**
the call saving (to be measured, see §5).

## 4. Proposal

1. **Now: C.** No fourth mode. The biggest measured cost driver (repository context) is handled by #244; a council that
   does not fit into one Final Verdict call is split only then (#246).
2. **B only after the benchmark** and only as a **preset of the existing engine** (no new engine path, no changed gate,
   same snapshot fields), offered on the start screen as "Verified – lean" with call count, measured typical tokens and
   the statement that the gate is the same. It may be called "faster" only with measured numbers.
3. **A not now.** An unverifiable "orientation" next to a gated product invites exactly the misuse #272 warns about
   (a way around a blocking gate). If it is ever built: own outcome "Orientation – not approvable", never `recommended`,
   never a build, and an upgrade is always a **new** frozen run with its own costs.

Invariants for any variant: at least 3 models for a regular recommendation (#249), confirmed requirements frozen, no
paid extra run without new consent, BYOK keys and budget under the user's control, historical sessions unchanged.

## 5. Go/No-Go measurement (with #182)

Offline first (no provider costs): the reference set (`packages/council/eval`, `docs/reference-set.md`) with the
scripted adapter for **calls, reserved tokens and gate results** of Independent Expert vs. B on ≥ 10 fixtures:

- false PASS / false approvable verdicts: **must be 0** for B (any difference to Independent Expert = No-Go);
- unnecessary blocks (B blocks where Independent Expert qualifies);
- calls and reserved tokens per council.

Live (only with the owner's explicit cost approval, BYOK): the same 10 fixtures, 3 cheap models, Independent Expert
vs. B vs. single-shot – real tokens, runtime, outcome. Rough cost: 20 councils × ~150k tokens with Haiku/mini/Flash
class models ≈ **3–6 $** in total; exact budget is shown before any run.

**Go for B** only if: 0 false PASS, no more unnecessary blocks than Independent Expert, and a real token saving of at
least 20 %. Otherwise this ADR closes #272 with C.

## 6. Consequences

- No code change from this ADR. #272 stays open until the benchmark decides.
- The start screen keeps three modes; nothing is labelled "quick" without measured data.
