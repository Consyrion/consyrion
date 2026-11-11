# Engine

The engine holds the decision logic of CONSYRIUM AI: the verdict, the S1 requirement gate (#181), content checks,
prompts and the model-strength catalog. It lives in `packages/engine`:

| Part           | Path                          | Purpose                                               |
| -------------- | ----------------------------- | ----------------------------------------------------- |
| Contract       | `packages/engine/contract.ts` | Types and `ENGINE_CONTRACT_VERSION`; no logic         |
| Implementation | `packages/engine/src/`        | The engine itself (`engine.json` says `"production"`) |

The application only talks to the engine through the contract. `assertEngineInstalled()` runs on `createSession`,
on `startExecution` and before a queued council runs in the worker; it refuses an engine built for another
`ENGINE_CONTRACT_VERSION`. `/api/health` reports the engine kind, nothing else.

## Not in the browser (#189)

Client components get results, not rules: the session view carries `architectureChange` per proposal and `moot` per
objection, the execution view carries `readiness`, the session preview carries `voteWeightWarnings`.
`@consyrium/core/browser` exports only constants, labels, types and display helpers, each by name.
`scripts/check-client-bundle.mjs` (CI, after `pnpm build`) fails when text from server-side logic (verdict, gate,
strength warnings, readiness, stopword lists, prompts) appears in `apps/web/.next/static`; extra markers come from
`packages/engine/src/bundle-markers.json`. This keeps the browser bundle small and the rules on the server, where
they are applied.

## Rules

- The engine may only import what `packages/engine/package.json` declares; a new dependency is a change of that file.
- Changing the contract: raise `ENGINE_CONTRACT_VERSION` and update `packages/engine/src` in the same change.
- Engine tests: `pnpm --filter @consyrium/engine test`.
