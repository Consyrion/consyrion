import { describe, expect, it } from "vitest";
import { matchStrength, modelNameKey, strengthSuggestion, tierOf, voteWeightWarnings, type StrengthCatalog, type StrengthEntry } from "./model-strength";

// Test data in the shape of a ranking source; names and scores are made up for the test, not real rankings.
const entries: StrengthEntry[] = [
  { sourceModelId: "1", slug: "test-strong-1", name: "Test Strong 1", creator: "Anthropic", score: 70 },
  { sourceModelId: "2", slug: "claude-4-5-haiku", name: "Claude 4.5 Haiku", creator: "Anthropic", score: 40 },
  { sourceModelId: "3", slug: "gemini-2-5-flash", name: "Gemini 2.5 Flash", creator: "Google", score: 50 },
  { sourceModelId: "4", slug: "gemini-2-5-flash-reasoning", name: "Gemini 2.5 Flash (Reasoning)", creator: "Google", score: 55 },
  { sourceModelId: "5", slug: "kimi-k2-6", name: "Kimi K2.6", creator: "Moonshot AI", score: 60 },
  { sourceModelId: "6", slug: "test-weak", name: "Test Weak", creator: "OpenAI", score: 10 },
];
const catalog: StrengthCatalog = { source: "Test ranking", sourceUrl: "https://example.test", fetchedAt: "2026-10-27T00:00:00Z", entries };

describe("model strength catalog (#139)", () => {
  it("matches provider ids to ranking names regardless of word order, dots, dates and 'latest'", () => {
    expect(modelNameKey("claude-haiku-4-5-20251001")).toBe(modelNameKey("Claude 4.5 Haiku"));
    expect(matchStrength("anthropic", "claude-haiku-4-5", entries)?.name).toBe("Claude 4.5 Haiku");
    expect(matchStrength("google", "gemini-2.5-flash", entries)?.name).toBe("Gemini 2.5 Flash");
    expect(matchStrength("kimi", "kimi-k2.6", entries)?.name).toBe("Kimi K2.6");
    // Same name, other creator: no match. Unknown models: no match, never a guess.
    expect(matchStrength("openai", "claude-haiku-4-5", entries)).toBeNull();
    expect(matchStrength("anthropic", "claude-opus-9", entries)).toBeNull();
  });

  it("turns scores into percentile tiers 1–10", () => {
    expect(tierOf(70, entries)).toBe(10);
    expect(tierOf(10, entries)).toBe(1);
    expect(tierOf(50, entries)).toBe(1 + Math.round((9 * 2) / 5));
  });

  it("suggests the tier with source and date, 5 and 'unknown' without a match, and marks old catalogs as stale", () => {
    const now = new Date("2026-10-28T00:00:00Z");
    expect(strengthSuggestion("kimi", "kimi-k2.6", catalog, now)).toMatchObject({
      tier: tierOf(60, entries),
      status: "known",
      sourceModel: "Kimi K2.6",
      source: "Test ranking",
    });
    expect(strengthSuggestion("anthropic", "claude-opus-9", catalog, now)).toMatchObject({ tier: 5, status: "unknown", source: "Test ranking" });
    expect(strengthSuggestion("kimi", "kimi-k2.6", null, now)).toMatchObject({ tier: 5, status: "unknown", source: null });
    expect(strengthSuggestion("kimi", "kimi-k2.6", catalog, new Date("2026-11-10T00:00:00Z")).status).toBe("stale");
  });
});

// Entries in the shape of the Artificial Analysis data API (names, creators, variant labels); scores are made up.
const aa: StrengthEntry[] = [
  { sourceModelId: "a1", slug: "gpt-5-4-mini", name: "GPT-5.4 mini (Xhigh)", creator: "OpenAI", score: 60 },
  { sourceModelId: "a2", slug: "gpt-5-4-mini-medium", name: "GPT-5.4 mini (medium)", creator: "OpenAI", score: 50 },
  { sourceModelId: "a3", slug: "gpt-5-4-mini-non-reasoning", name: "GPT-5.4 mini (Non-reasoning)", creator: "OpenAI", score: 40 },
  { sourceModelId: "a4", slug: "gpt-5-2", name: "GPT-5.2 (Xhigh)", creator: "OpenAI", score: 65 },
  { sourceModelId: "a5", slug: "kimi-k3", name: "Kimi K3 (Max)", creator: "Moonshot AI", score: 62 },
  { sourceModelId: "a6", slug: "kimi-k3-high", name: "Kimi K3 (High)", creator: "Moonshot AI", score: 58 },
  { sourceModelId: "a10", slug: "glm-4-7", name: "GLM-4.7", creator: "Z AI", score: 52 },
  { sourceModelId: "a11", slug: "glm-4-7-reasoning", name: "GLM-4.7 (Reasoning)", creator: "Z AI", score: 57 },
  { sourceModelId: "a12", slug: "deepseek-v4-pro", name: "DeepSeek V4 Pro 0813 (Max)", creator: "DeepSeek", score: 61 },
  { sourceModelId: "a13", slug: "deepseek-v3-flash", name: "DeepSeek V3 Flash", creator: "DeepSeek", score: 30 },
  { sourceModelId: "a14", slug: "deepseek-v4-flash", name: "DeepSeek V4 Flash", creator: "DeepSeek", score: 48 },
  { sourceModelId: "a15", slug: "kimi-k3-1-pro", name: "Kimi K3.1 Pro", creator: "Moonshot AI", score: 59 },
  { sourceModelId: "a16", slug: "gemini-3-flash", name: "Gemini 3 Flash", creator: "Google", score: 55 },
  { sourceModelId: "a17", slug: "gemini-2-5-flash", name: "Gemini 2.5 Flash", creator: "Google", score: 45 },
  { sourceModelId: "a18", slug: "qwen3-235b-a22b-2507", name: "Qwen3 235B A22B 2507", creator: "Alibaba", score: 44 },
  { sourceModelId: "a19", slug: "gemini-2-5-flash-preview", name: "Gemini 2.5 Flash Preview (Non-reasoning)", creator: "Google", score: 40 },
  { sourceModelId: "a20", slug: "gemini-3-1-pro-preview", name: "Gemini 3.1 Pro Preview", creator: "Google", score: 66 },
  { sourceModelId: "a21", slug: "gemini-3-8-flash-medium", name: "Gemini 3.8 Flash (Medium)", creator: "Google", score: 58 },
];

// xAI entries with the names, slugs and creator Artificial Analysis really uses (artificialanalysis.ai/providers/xai,
// 27.10.2026): creator display name "SpaceXAI", creator slug "xai", MMDD stamps inside the name. Scores are made up.
const grok = (sourceModelId: string, slug: string, name: string, score: number): StrengthEntry => ({
  sourceModelId,
  slug,
  name,
  creator: "SpaceXAI",
  creatorSlug: "xai",
  score,
});
const xai: StrengthEntry[] = [
  grok("x1", "grok-4-7", "Grok 4.7 (xhigh)", 70),
  grok("x2", "grok-4-7-high", "Grok 4.7 (high)", 68),
  grok("x3", "grok-4-7-low", "Grok 4.7 (low)", 60),
  grok("x4", "grok-4-6", "Grok 4.6 (high)", 66),
  grok("x5", "grok-4-6-xhigh", "Grok 4.6 (xhigh)", 67),
  grok("x6", "grok-4-6-medium", "Grok 4.6 (medium)", 63),
  grok("x7", "grok-4-6-low", "Grok 4.6 (low)", 58),
  grok("x8", "grok-4-5", "Grok 4.5 (high)", 62),
  grok("x9", "grok-build-0-1-06-16", "Grok Build 0.1 0616", 57),
  grok("x10", "grok-4-20", "Grok 4.20 0309 v2", 56),
  grok("x11", "grok-4-20-0309", "Grok 4.20 0309", 55),
  grok("x12", "grok-4-20-0309-non-reasoning", "Grok 4.20 0309 (non-reasoning)", 45),
  grok("x13", "grok-4-20-non-reasoning", "Grok 4.20 0309 v2 (non-reasoning)", 46),
  grok("x14", "grok-4-3", "Grok 4.3 (high)", 54),
  grok("x15", "grok-4-3-medium", "Grok 4.3 (medium)", 52),
  grok("x16", "grok-4-3-low", "Grok 4.3 (low)", 50),
  grok("x17", "grok-4-3-non-reasoning", "Grok 4.3 (non-reasoning)", 40),
  grok("x18", "grok-3", "Grok 3", 30),
];

describe("variant choice and aliases (#170, #171)", () => {
  it("takes the variant matching the default call, not Xhigh/Max", () => {
    expect(matchStrength("openai", "gpt-5.4-mini", aa)?.name).toBe("GPT-5.4 mini (Non-reasoning)");
    expect(
      matchStrength(
        "openai",
        "gpt-5.4-mini",
        aa.filter((e) => e.sourceModelId !== "a3"),
      )?.name,
    ).toBe("GPT-5.4 mini (medium)");
    // Only effort variants: the weakest, not the strongest.
    expect(matchStrength("kimi", "kimi-k3", aa)?.name).toBe("Kimi K3 (High)");
    // A single variant is all the ranking has; the UI shows which one (sourceModel).
    expect(strengthSuggestion("deepseek", "deepseek-v4-pro", { ...catalog, entries: aa }).sourceModel).toBe("DeepSeek V4 Pro 0813 (Max)");
  });

  it("never gives a chat (non-reasoning) model the reasoning score", () => {
    expect(matchStrength("openai", "gpt-5.2-chat-latest", aa)).toBeNull();
    expect(matchStrength("openai", "gpt-5.4-mini-chat-latest", aa)?.name).toBe("GPT-5.4 mini (Non-reasoning)");
  });

  it("matches the xAI ids of production to Artificial Analysis' real Grok naming (creator 'SpaceXAI')", () => {
    const name = (id: string) => matchStrength("xai", id, xai)?.name ?? null;
    expect(name("grok-4.20-0309-non-reasoning")).toBe("Grok 4.20 0309 (non-reasoning)");
    // The reasoning id takes the plain entry – AA's default variant of Grok 4.20 0309, not the "v2" re-release.
    expect(name("grok-4.20-0309-reasoning")).toBe("Grok 4.20 0309");
    expect(name("grok-4.3")).toBe("Grok 4.3 (non-reasoning)");
    expect(name("grok-4.5")).toBe("Grok 4.5 (high)");
    expect(name("grok-4.6")).toBe("Grok 4.6 (medium)");
    expect(name("grok-4.7")).toBe("Grok 4.7 (low)");
    expect(name("grok-build-0.1")).toBe("Grok Build 0.1 0616");
    // Not ranked by AA: stays unknown.
    expect(name("grok-4.20-multi-agent-0309")).toBeNull();
    // The creator slug alone is enough, and the display name alone too.
    expect(
      matchStrength(
        "xai",
        "grok-4.3",
        xai.map(({ creatorSlug: _, ...e }) => e),
      )?.name,
    ).toBe("Grok 4.3 (non-reasoning)");
    expect(
      matchStrength(
        "xai",
        "grok-4.3",
        xai.map((e) => ({ ...e, creator: "" })),
      )?.name,
    ).toBe("Grok 4.3 (non-reasoning)");
    // Same names under another provider: no match.
    expect(matchStrength("openai", "grok-4.3", xai)).toBeNull();
    expect(modelNameKey("grok-4.20-0309")).toBe(modelNameKey("Grok 4.20"));
    // YYMM release stamps are no MMDD and stay part of the name.
    expect(matchStrength("qwen", "qwen3-235b-a22b-instruct-2507", aa)?.name).toBe("Qwen3 235B A22B 2507");
    expect(matchStrength("qwen", "qwen3-235b-a22b-instruct-2504", aa)).toBeNull();
  });

  it("takes preview entries only for preview ids (#171)", () => {
    expect(matchStrength("google", "gemini-2.5-flash", aa)?.name).toBe("Gemini 2.5 Flash");
    expect(matchStrength("google", "gemini-2.5-flash-preview", aa)?.name).toBe("Gemini 2.5 Flash Preview (Non-reasoning)");
    // Only a preview in the ranking: the GA id stays unknown, the preview id matches.
    const previewOnly = aa.filter((e) => e.sourceModelId !== "a17");
    expect(matchStrength("google", "gemini-2.5-flash", previewOnly)).toBeNull();
    expect(matchStrength("google", "gemini-3.1-pro-preview", aa)?.name).toBe("Gemini 3.1 Pro Preview");
    expect(matchStrength("google", "gemini-3.1-pro", aa)).toBeNull();
    // A preview id falls back to the GA entry when the ranking has no preview of it.
    expect(matchStrength("google", "gemini-3-flash-preview", aa)?.name).toBe("Gemini 3 Flash");
  });

  it("normalizes creator names like 'Z AI' for GLM", () => {
    expect(matchStrength("glm", "glm-4.7", aa)?.name).toBe("GLM-4.7");
    expect(
      matchStrength(
        "glm",
        "glm-4.7",
        aa.map((e) => ({ ...e, creator: e.creator === "Z AI" ? "z.ai" : e.creator })),
      )?.name,
    ).toBe("GLM-4.7");
    expect(matchStrength("glm", "glm-5.3-flashx", aa)).toBeNull();
    expect(matchStrength("xai", "glm-4.7", aa)).toBeNull();
  });

  it("resolves -highspeed and versionless aliases, and keeps truly unknown models unknown", () => {
    expect(matchStrength("kimi", "kimi-k3.1-pro-highspeed", aa)?.name).toBe("Kimi K3.1 Pro");
    expect(matchStrength("deepseek", "deepseek-flash", aa)?.name).toBe("DeepSeek V4 Flash");
    // `*-latest` aliases: the provider model list names no target release, so no guess at the newest one (#171).
    expect(matchStrength("google", "gemini-flash-latest", aa)).toBeNull();
    expect(matchStrength("google", "gemini-pro-latest", aa)).toBeNull();
    // A versioned id keeps "latest" as a filler word.
    expect(matchStrength("openai", "gpt-5.4-mini-chat-latest", aa)?.name).toBe("GPT-5.4 mini (Non-reasoning)");
    expect(matchStrength("deepseek", "deepseek-chat", aa)).toBeNull();
  });
});

describe("vote weight warnings (#170)", () => {
  const known = { tier: 9, status: "known" as const };
  it("flags a model holding more than half of the vote and weights far from the suggestion", () => {
    const warnings = voteWeightWarnings([
      { model: "gpt-4o-mini", weight: 10, suggestion: { tier: 3, status: "known" } },
      { model: "claude-haiku-5-5", weight: 1, suggestion: known },
      { model: "grok", weight: 1, suggestion: { tier: 5, status: "unknown" } },
    ]);
    expect(warnings.map((w) => [w.kind, w.model])).toEqual([
      ["dominant_share", "gpt-4o-mini"],
      ["far_from_suggestion", "gpt-4o-mini"],
      ["far_from_suggestion", "claude-haiku-5-5"],
    ]);
    expect(warnings[0]).toMatchObject({ sharePercent: 83 });
  });

  it("with two models warns only from a 2:1 lead and without alarm (#182)", () => {
    const pair = (a: number, b: number) =>
      voteWeightWarnings([
        { model: "gpt-4o-mini", weight: a, suggestion: null },
        { model: "claude", weight: b, suggestion: null },
      ]);
    expect(pair(6, 5)).toEqual([]);
    expect(pair(9, 5)).toEqual([]);
    expect(pair(10, 5)).toMatchObject([{ kind: "dominant_share", model: "gpt-4o-mini", sharePercent: 67 }]);
    const [w] = pair(2, 8);
    expect(w).toMatchObject({ model: "claude", sharePercent: 80 });
    expect(w!.message).toBe("claude holds 80 % of the vote – at least twice the weight of gpt-4o-mini, so its evaluation mostly sets the ranking.");
    // Three or more models keep the > 50 % rule.
    expect(
      voteWeightWarnings([
        { model: "a", weight: 6, suggestion: null },
        { model: "b", weight: 3, suggestion: null },
        { model: "c", weight: 2, suggestion: null },
      ]).map((x) => x.model),
    ).toEqual(["a"]);
  });

  it("stays quiet for balanced weights and exactly half of the vote", () => {
    expect(
      voteWeightWarnings([
        { model: "a", weight: 9, suggestion: known },
        { model: "b", weight: 7, suggestion: known },
        { model: "c", weight: 6, suggestion: null },
      ]),
    ).toEqual([]);
    expect(
      voteWeightWarnings([
        { model: "a", weight: 5, suggestion: null },
        { model: "b", weight: 5, suggestion: null },
      ]),
    ).toEqual([]);
  });
});
