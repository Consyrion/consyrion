# Model weighting (#139, #140, #141)

Stronger models' votes may count more in the Final Verdict. CONSYRION suggests a vote weight from 1 to 10 per model
from a current external ranking; the user sees it before the run and can change it.

## Strength catalog (#139)

- **Source:** the [Artificial Analysis](https://artificialanalysis.ai/) data API (`GET /api/v2/data/llms/models`,
  field `evaluations.artificial_analysis_intelligence_index`). It needs the platform's own free key
  `ARTIFICIAL_ANALYSIS_API_KEY` (server env only; 1,000 requests a day). This is not a model key and sells no AI
  usage, so it does not conflict with BYOK (#30). **Attribution is required**: every suggestion names the source and
  its date. Check the Artificial Analysis terms of use before a commercial launch.
- **Storage:** table `model_strength_sync` (platform-wide, public ranking data). Every fetch is a row; failed fetches
  keep their error and never replace the last good catalog.
- **Schedule:** the worker enqueues `model_strength.sync` at start and hourly with a per-day dedupe key – one fetch a
  day. Platform admins can refresh at once: `POST /api/admin/model-strength` (status: `GET`).
- **Matching** (`packages/core/src/model-strength.ts`): a provider model id and a ranking entry match when their name
  keys are equal **and** the entry's creator belongs to the provider. Name keys are lower case, dots as separators,
  word order ignored, without dates (`2025-10-01`, `20251001`), 4-digit **MMDD build stamps** (`grok-4.20-0309`,
  "DeepSeek V4 Pro 0813"; YYMM stamps like Qwen's `2507` are no MMDD and stay), fillers like "latest"/"preview"/"chat"
  and the serving suffix **`-highspeed`** (`kimi-k3.1-pro-highspeed` = Kimi K3.1 Pro). Creator names are normalized
  to letters and digits, so "Z AI", "z.ai" and "Z-AI" all count for GLM (#171). The creator **slug** of the source
  counts as well: Artificial Analysis shows xAI as **"SpaceXAI"** (creator slug `xai`, see
  [artificialanalysis.ai/providers/xai](https://artificialanalysis.ai/providers/xai)) and names Grok models like
  "Grok 4.20 0309 (non-reasoning)", "Grok 4.3 (high)", "Grok Build 0.1 0616" – both "SpaceXAI" and the slug map to
  the provider `xai` (#171). `grok-4.20-multi-agent-0309` has no ranking entry and stays unknown.
- **Preview entries** (#171): "preview" is dropped from name keys, but a preview entry only stands in for an id that
  itself contains "preview". `gemini-2.5-flash` takes "Gemini 2.5 Flash", never "Gemini 2.5 Flash Preview"; with only
  a preview in the ranking it stays unknown. A preview id prefers the preview entry and falls back to the GA one.
- **Variants** (#170): a ranking often lists one model several times – "GPT-5.4 mini (Xhigh)", "(medium)",
  "(Non-reasoning)". The provider adapters send **no reasoning effort**, so CONSYRION runs every model at its
  provider default. The match therefore takes:
  - an explicit variant in the id (`grok-4.20-0309-non-reasoning`, `…-reasoning`, `…-thinking`; chat models such as
    `gpt-5.2-chat-latest` count as non-reasoning) – that variant, else the plain entry, else **unknown** (a chat model
    never inherits the Xhigh reasoning score);
  - otherwise the plain entry, then "Non-reasoning", then "medium", then the **weakest** remaining variant – never
    the strongest. A model the ranking lists only as "(Max)" keeps that entry.
  The matched entry name, including its variant, is the suggestion's `sourceModel` and is shown next to every
  suggestion.
- **`*-latest` aliases** (#171): an id with "latest" and no version (`gemini-flash-latest`, `gemini-pro-latest`) is
  **unknown**. Google moves such an alias between releases (stable, preview or experimental), and its models list
  gives no concrete target model – only the alias itself – so mapping it to the newest version in the ranking would
  be a guess. A versioned id keeps "latest" as a filler (`gpt-5.4-mini-chat-latest`).
- **Other versionless aliases** (#171): an id without any version number and without "latest" (`deepseek-flash`)
  matches the highest version of exactly the same name in the ranking ("DeepSeek V4 Flash"). Everything else that
  does not match is **unknown** with the neutral tier 5 – never a guess.
- **Tier:** the percentile of the entry's score among all entries of the catalog: the strongest 10, the weakest 1.
- **Staleness:** a catalog older than 7 days is still used and marked **stale** with its date.
- `GET /api/models` returns `strength` per model: `{ tier, status, sourceModel, rawScore, source, sourceUrl, fetchedAt }`.

Without a key or before the first fetch every model is unknown (tier 5); weighting then equals the unweighted verdict.

## Weighted Final Verdict (#140)

- Each participant has a **vote weight 1–10** (`council_participant.vote_weight`, migration 0018), fixed when the
  council starts: the value the user chose (`participants[].voteWeight`) or the catalog suggestion. The suggestion
  is stored next to it (`vote_weight_suggestion`) – the report shows "7/10 (suggested 5)".
- Weighted is what a model **gives as evaluator**, never its own proposal (self-evaluations stay excluded):
  - Scorecard: per criterion the weighted mean `Σ score × w / Σ w`.
  - Majority vote (Borda): each ranking counts `w / mean weight of the voters`, so equal weights give exactly the
    previous points.
- **Not weighted:** the feasibility gate (#121) – one evaluator, one check. A single strong model must not outvote
  an unmet hard requirement.
- Weights are clamped to 1–10; no model is silenced. Missing evaluators simply drop out of the sums.
- With equal weights the verdict is exactly the unweighted one (test). With unequal weights the verdict is also
  computed with equal weights; if the outcome differs, the confidence issue `weighting_changed_winner` names both
  winners (reduced confidence, not low).
- `formula` in the decision matrix lists the vote weights; the matrix stores `evaluatorWeights`; Final Verdict and
  the score drill-down show each model's weight; Markdown/JSON export list them.
- Runs before #140 have weight 1 everywhere – equal vote, as before.

## Before the run (#141)

The team configuration shows a **Vote weights** card as soon as a model is selected
(`apps/web/src/components/vote-weights.tsx`):

- per model the AI suggestion `8/10` with source, matched ranking model and date; badges **unknown** (not in the
  ranking, neutral 5), **ranking older than 7 days** and **adjusted** (the user changed it);
- a 1–10 slider, the share of the total vote in whole percent (largest remainder, always 100 %) and a bar;
- **Use AI suggestion** resets every model to the suggestion, **All equal** sets every model to 5 (= the
  unweighted verdict);
- **warnings before the start** (#170): with three or more models when one holds **more than 50 %** of the total
  vote ("holds 83 % of the vote and outweighs all other models together."); with **exactly two** models only from a
  clear lead of **at least two thirds** – a weight ratio of 2:1 or more, e.g. 10 vs 5 – because with two models any
  difference gives one of them over 50 % (6 vs 5 is no warning; #182). The two-model message is factual: "holds 67 %
  of the vote – at least twice the weight of …, so its evaluation mostly sets the ranking." A further warning fires
  when a weight is **4 or more** away from a known suggestion (unknown models are never flagged). They appear in the
  card (badges **dominant vote share**, **far
  from suggestion**) and again under "Before you start"; `POST /api/projects/:id/sessions/preview` returns them as
  `voteWeightWarnings` (`voteWeightWarnings()` in `packages/core/src/model-strength.ts`). They do not block the
  start and there is **no server-side cap**: the weights are an explicit user choice, the clamp 1–10 already keeps
  every model in the vote, and a cap would silently change a weight the user saw and confirmed – the report would
  then show a weight that was never chosen;
- the weight shown is the weight sent (`participants[].voteWeight`) and fixed at the start; the Final Verdict and the
  report show it afterwards.

Screenshots (demo fixture from `/design`): `docs/design/previews/vote-weights-desktop.png`,
`docs/design/previews/vote-weights-mobile.png`.
