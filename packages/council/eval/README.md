# Council evaluation harness (#33)

Golden cases run the **real council engine** end to end (in-memory PostgreSQL, all seven phases) with
deterministic test models from `test/scripted-adapter.ts`. Each case states properties the outcome must
have, for example:

| Case | Guards against |
|---|---|
| `clear-winner` | wrong aggregation, unneeded low-confidence flags |
| `no-self-vote` | models winning by scoring their own proposal |
| `tie` | arbitrary winners when scores are equal |
| `minority-blocks-majority` | a majority overruling a proven critical security risk (11:1) |
| `missing-evaluator` | verdicts silently resting on fewer evaluations |
| `failed-model` | one broken provider stopping the whole council |

```
pnpm --filter @consyrium/council eval     # Markdown report, exit code 1 on any failure
pnpm --filter @consyrium/council test     # includes eval/eval.test.ts (CI regression)
```

Add a case by appending to `GOLDEN_CASES` in `eval/cases.ts`. Every check must be able to fail: a wrong
expectation produces `✗ … (got …)` in the report.

## Known limits
- These cases test the **decision logic**, not real model quality. Scripted models do not reason.
- Live benchmarks with real providers are not part of CI because they spend the user's API budget. They
  should run opt-in with an explicit budget per run.
- Blind human evaluation (rating anonymised verdicts) is not built yet.

## Reference set for real councils (#182)
`reference-cases.ts`, `reference-score.ts` and `reference-cli.ts` score exported Decision Reports of real councils
against gold labels (`pnpm --filter @consyrium/council reference <dir>`). See `docs/reference-set.md`.
