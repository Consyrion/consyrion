/**
 * Model strength catalog (#139): how strong each selectable model currently is, as a vote-weight suggestion from 1
 * to 10. The numbers come from an external ranking (see `docs/model-weighting.md`), never from this code: a model
 * that cannot be matched to a ranking entry is "unknown" with the neutral tier 5 – no guessing.
 */

/** One entry of a ranking source: its own id/slug/name, the model's creator and a score (higher = stronger). */
export interface StrengthEntry {
  sourceModelId: string;
  slug: string;
  name: string;
  creator: string;
  /** The creator's slug at the source, when it has one ("xai" for the display name "SpaceXAI"). */
  creatorSlug?: string;
  score: number;
}

export interface StrengthCatalog {
  /** Display name of the source, shown with every suggestion (attribution). */
  source: string;
  sourceUrl: string;
  fetchedAt: Date | string;
  entries: StrengthEntry[];
}

export type StrengthStatus = "known" | "unknown" | "stale";

export interface StrengthSuggestion {
  tier: number;
  status: StrengthStatus;
  /** The matched ranking entry, when there is one – including its variant, e.g. "GPT-5.4 mini (Non-reasoning)". */
  sourceModel: string | null;
  rawScore: number | null;
  source: string | null;
  sourceUrl: string | null;
  fetchedAt: string | null;
}

/** Neutral tier for models without a ranking entry. */
export const UNKNOWN_TIER = 5;
/** A catalog older than this is still used but marked as stale. */
export const STRENGTH_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Creator names of ranking sources per provider of this platform, normalized (lower case, letters and digits only). */
const CREATORS: Readonly<Record<string, readonly string[]>> = {
  anthropic: ["anthropic"],
  openai: ["openai"],
  google: ["google"],
  deepseek: ["deepseek"],
  // Artificial Analysis lists GLM under "Z AI"; other sources use "Zhipu AI", "z.ai" or "Z-AI".
  glm: ["zhipu", "zai"],
  kimi: ["moonshot", "kimi"],
  qwen: ["alibaba", "qwen"],
  // Artificial Analysis shows xAI as "SpaceXAI" (creator slug "xai"), e.g. artificialanalysis.ai/providers/xai.
  xai: ["xai", "spacexai"],
};

/** Words dropped from every name: they never tell two models apart. */
const FILLER = new Set(["latest", "preview", "exp", "experimental", "instruct", "chat", "model"]);
/** Serving variants of the same model: "kimi-k3.1-pro-highspeed" is Kimi K3.1 Pro, served faster. */
const SERVING_SUFFIXES = new Set(["highspeed"]);
/**
 * A 4-digit build stamp MMDD ("grok-4.20-0309", "DeepSeek V4 Pro 0813"). Stamps that are no valid MMDD, such as
 * the YYMM "2507" of Qwen releases, stay part of the name – they mark different models.
 */
const MMDD = /^(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
const VERSION_WORD = /^v?\d+$/;

/** Reasoning variant of a ranking entry or a provider model id ("nonreasoning", "reasoning", "xhigh", …); null = plain. */
export type ModelVariant = string | null;

/** Lower case, letters and digits only: "Z AI", "z.ai" and "Z-AI" are all "zai". */
function normalizeCreator(creator: string) {
  return creator.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A variant label in comparable form: "Non-reasoning" → "nonreasoning", "Thinking" → "reasoning", "Xhigh" → "xhigh". */
function normalizeVariant(label: string): string {
  const v = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (v === "thinking" || v === "reasoning") return "reasoning";
  if (v === "nonreasoning" || v === "noreasoning" || v === "nonthinking") return "nonreasoning";
  return v;
}

/** The comparable words of a name: lower case, dots as separators, without "models/", dates, MMDD stamps and fillers. */
function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/^models\//, "")
    .replace(/\b(20\d{2})-?(\d{2})-?(\d{2})\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w, i) => w && !FILLER.has(w) && !SERVING_SUFFIXES.has(w) && !(i > 0 && MMDD.test(w)));
}

/**
 * Words of a model name in a comparable form: lower case, dots as separators ("2.5" = "2-5"), without dates, MMDD
 * build stamps, "latest", "preview", "-highspeed" or a "models/" prefix, sorted – so "claude-haiku-4-5" and
 * "Claude 4.5 Haiku" meet.
 */
export function modelNameKey(name: string): string {
  return nameWords(name).sort().join(" ");
}

/**
 * Name key and reasoning variant of a ranking entry or a provider model id: "Grok 4.20 (Non-reasoning)" and
 * "grok-4.20-0309-non-reasoning" both give the key of "grok 4.20" with variant "nonreasoning"; "GPT-5.4 mini (Xhigh)"
 * gives "xhigh". A label in parentheses is always the variant. Outside parentheses only a trailing reasoning word
 * ("reasoning", "non-reasoning", "thinking") is, because effort words like "max" are part of real names ("Qwen3 Max").
 * A chat model ("gpt-5.2-chat-latest") is the instant, non-reasoning flavour of its family.
 */
export function splitModelVariant(name: string): { key: string; variant: ModelVariant } {
  const labels: string[] = [];
  const words = nameWords(
    name.replace(/\(([^)]*)\)/g, (_, label: string) => {
      if (label.trim()) labels.push(normalizeVariant(label));
      return " ";
    }),
  );
  let variant: ModelVariant = labels[0] ?? null;
  const last = words.length - 1;
  if (last > 0 && (words[last] === "reasoning" || words[last] === "thinking" || words[last] === "nonreasoning")) {
    const negated = words[last] === "nonreasoning" || (last > 1 && words[last - 1] === "non");
    variant ??= negated ? "nonreasoning" : "reasoning";
    words.splice(words[last] !== "nonreasoning" && negated ? last - 1 : last);
  }
  if (variant === null && /(^|[^a-z])chat([^a-z]|$)/i.test(name)) variant = "nonreasoning";
  return { key: words.sort().join(" "), variant };
}

function creatorMatches(provider: string, entry: Pick<StrengthEntry, "creator" | "creatorSlug">) {
  const known = CREATORS[provider];
  if (!known) return false;
  return [entry.creator, entry.creatorSlug ?? ""].some((name) => {
    const c = normalizeCreator(name);
    return c !== "" && known.some((k) => c.startsWith(k));
  });
}

const PREVIEW_WORD = /(^|[^a-z])preview([^a-z]|$)/i;
const LATEST_WORD = /(^|[^a-z])latest([^a-z]|$)/i;

/**
 * Preview entries only stand in for a preview id (#171): "gemini-2.5-flash" never takes "Gemini 2.5 Flash Preview",
 * because "preview" is a dropped filler word. An id with "preview" prefers the preview entries.
 */
function byPreview<T extends { entry: StrengthEntry }>(candidates: T[], modelId: string): T[] {
  const isPreview = (c: T) => PREVIEW_WORD.test(c.entry.name) || PREVIEW_WORD.test(c.entry.slug);
  if (!PREVIEW_WORD.test(modelId)) return candidates.filter((c) => !isPreview(c));
  const preview = candidates.filter(isPreview);
  return preview.length ? preview : candidates;
}

/** Version words of a name in their order ("DeepSeek V4 Flash" → [4], "Gemini 2.5 Flash" → [2, 5]). */
function versionOf(name: string): number[] {
  return nameWords(name.replace(/\([^)]*\)/g, " ")).flatMap((w) => (VERSION_WORD.test(w) ? [Number(w.replace(/^v/, ""))] : []));
}

function compareVersions(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

interface Candidate {
  entry: StrengthEntry;
  variant: ModelVariant;
}

/**
 * The entry among several variants of one model that fits how CONSYRION calls it (#170). The provider adapters send
 * no reasoning effort, so a model runs with its provider's default. An explicit variant in the id ("-non-reasoning",
 * "-reasoning", "-chat") needs that variant or the plain entry. Otherwise: the plain entry, then "non-reasoning",
 * then "medium", then the weakest variant – never "Xhigh"/"Max" just because it scores higher.
 */
function pickVariant(candidates: ReadonlyArray<Candidate>, wanted: ModelVariant): StrengthEntry | null {
  const weakestOf = (list: ReadonlyArray<Candidate>) => [...list].sort((a, b) => a.entry.score - b.entry.score)[0]?.entry;
  const by = (variant: ModelVariant) => weakestOf(candidates.filter((c) => c.variant === variant));
  if (wanted !== null) return by(wanted) ?? by(null) ?? null;
  return by(null) ?? by("nonreasoning") ?? by("medium") ?? weakestOf(candidates) ?? null;
}

/**
 * The ranking entry for a provider model, or null. Only equal name keys of the same creator count; among several
 * variants of the name the one matching the actual call is taken (`pickVariant`), and preview entries only for preview
 * ids (`byPreview`). A `*-latest` alias without a version ("gemini-flash-latest") stays unknown: the provider's model
 * list does not say which release it points to, and the newest version in the ranking is not necessarily it (#171).
 * Another versionless alias ("deepseek-flash") resolves to the highest version of exactly that name in the ranking.
 * Anything else stays unknown – no guessing.
 */
export function matchStrength(provider: string, modelId: string, entries: ReadonlyArray<StrengthEntry>): StrengthEntry | null {
  const wanted = splitModelVariant(modelId);
  if (!wanted.key) return null;
  if (LATEST_WORD.test(modelId) && versionOf(modelId).length === 0) return null;
  const own = entries
    .filter((e) => creatorMatches(provider, e))
    .map((entry) => {
      const fromName = splitModelVariant(entry.name);
      // Slug and source id may carry the variant as a word ("…-reasoning"); the variant comes from the name.
      const keys = new Set([fromName.key, splitModelVariant(entry.slug).key, splitModelVariant(entry.sourceModelId).key]);
      return { entry, keys, variant: fromName.variant };
    });
  const exact = byPreview(
    own.filter((c) => c.keys.has(wanted.key)),
    modelId,
  );
  if (exact.length) return pickVariant(exact, wanted.variant);

  // Versionless alias: the id has no version number, the ranking has exactly the same words plus a version.
  if (versionOf(modelId).length > 0) return null;
  let versioned = own
    .map((c) => ({
      ...c,
      version: versionOf(c.entry.name),
      aliasKey: splitModelVariant(c.entry.name)
        .key.split(" ")
        .filter((w) => !VERSION_WORD.test(w))
        .join(" "),
    }))
    .filter((c) => c.version.length > 0 && c.aliasKey === wanted.key);
  versioned = byPreview(versioned, modelId);
  if (!versioned.length) return null;
  const newest = versioned.reduce((best, c) => (compareVersions(c.version, best.version) > 0 ? c : best)).version;
  return pickVariant(
    versioned.filter((c) => compareVersions(c.version, newest) === 0),
    wanted.variant,
  );
}

/**
 * Tier 1–10 of a score: its percentile among all entries of the catalog (equal scores share a tier). The best
 * entry gets 10, the weakest 1.
 */
export function tierOf(score: number, entries: ReadonlyArray<StrengthEntry>): number {
  const scores = entries.map((e) => e.score).filter((s) => Number.isFinite(s));
  if (scores.length < 2) return UNKNOWN_TIER;
  const below = scores.filter((s) => s < score).length;
  return 1 + Math.round((9 * below) / (scores.length - 1));
}

/** The suggestion shown before a run and stored with it: tier, status and where it comes from. */
export function strengthSuggestion(provider: string, modelId: string, catalog: StrengthCatalog | null, now: Date = new Date()): StrengthSuggestion {
  if (!catalog || catalog.entries.length === 0) {
    return { tier: UNKNOWN_TIER, status: "unknown", sourceModel: null, rawScore: null, source: null, sourceUrl: null, fetchedAt: null };
  }
  const fetchedAt = new Date(catalog.fetchedAt);
  const base = { source: catalog.source, sourceUrl: catalog.sourceUrl, fetchedAt: fetchedAt.toISOString() };
  const entry = matchStrength(provider, modelId, catalog.entries);
  if (!entry) return { tier: UNKNOWN_TIER, status: "unknown", sourceModel: null, rawScore: null, ...base };
  const stale = now.getTime() - fetchedAt.getTime() > STRENGTH_STALE_MS;
  return { tier: tierOf(entry.score, catalog.entries), status: stale ? "stale" : "known", sourceModel: entry.name, rawScore: entry.score, ...base };
}

/** With three or more models, one holding more than this share of the total vote outweighs all others together (#170). */
export const DOMINANT_VOTE_SHARE = 0.5;
/**
 * With exactly two models one of them always holds over half unless the weights are equal, so the warning waits for a
 * clear lead: at least two thirds of the vote, i.e. a weight ratio of 2:1 or more (#182).
 */
export const DOMINANT_VOTE_SHARE_TWO_MODELS = 2 / 3;
/** A chosen weight this far (or further) from a known suggestion is flagged (#170). */
export const WEIGHT_DEVIATION_WARNING = 4;

export type VoteWeightWarning =
  | { kind: "dominant_share"; index: number; model: string; sharePercent: number; message: string }
  | { kind: "far_from_suggestion"; index: number; model: string; weight: number; suggested: number; message: string };

/**
 * Warnings before the run (#170): a model holding more than half of the total vote (two models: at least two thirds,
 * #182) outweighs the others, and a weight far from the ranking suggestion is easy to set by mistake. Warnings only – the weights stay the user's
 * choice; unknown models (neutral 5, no ranking) are never flagged for deviating.
 */
export function voteWeightWarnings(
  rows: ReadonlyArray<{ model: string; weight: number; suggestion: Pick<StrengthSuggestion, "tier" | "status"> | null }>,
): VoteWeightWarning[] {
  const warnings: VoteWeightWarning[] = [];
  const total = rows.reduce((a, r) => a + r.weight, 0);
  const two = rows.length === 2;
  rows.forEach((row, index) => {
    const share = total > 0 ? row.weight / total : 0;
    // Small epsilon: 10 vs 5 is exactly 2/3 and must count.
    const dominant = two ? share >= DOMINANT_VOTE_SHARE_TWO_MODELS - 1e-9 : rows.length > 2 && share > DOMINANT_VOTE_SHARE;
    if (dominant) {
      const sharePercent = Math.round(share * 100);
      const other = rows[1 - index]?.model;
      warnings.push({
        kind: "dominant_share",
        index,
        model: row.model,
        sharePercent,
        message: two
          ? `${row.model} holds ${sharePercent} % of the vote – at least twice the weight of ${other}, so its evaluation mostly sets the ranking.`
          : `${row.model} holds ${sharePercent} % of the vote and outweighs all other models together.`,
      });
    }
    const s = row.suggestion;
    if (s && s.status !== "unknown" && Math.abs(row.weight - s.tier) >= WEIGHT_DEVIATION_WARNING) {
      warnings.push({
        kind: "far_from_suggestion",
        index,
        model: row.model,
        weight: row.weight,
        suggested: s.tier,
        message: `${row.model} has weight ${row.weight}, the ranking suggests ${s.tier}.`,
      });
    }
  });
  return warnings;
}
