import { describe, expect, it } from "vitest";
import { independenceKey, independentGroupCount } from "./independence";

describe("independence groups (user decision 08.11.26)", () => {
  it("puts dated snapshots, aliases and case variants of one model into one group", () => {
    const key = independenceKey("anthropic", "claude-opus-5-5");
    for (const id of ["claude-opus-5-5-20261001", "Claude-Opus-5-5", " claude-opus-5-5-latest ", "claude-opus-5-5@20261001", "anthropic/claude-opus-5-5"])
      expect(independenceKey("anthropic", id)).toBe(key);
    expect(independenceKey("openai", "gpt-5.4-mini-2026-03-01")).toBe(independenceKey("openai", "gpt-5.4-mini"));
    expect(independenceKey("google", "models/gemini-3.6-flash")).toBe(independenceKey("google", "gemini-3.6-flash"));
  });

  it("keeps different models, sizes and versions apart", () => {
    const keys = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5-1", "claude-haiku-5-5"].map((m) => independenceKey("anthropic", m));
    expect(new Set(keys).size).toBe(4);
    expect(independenceKey("openai", "gpt-5.4")).not.toBe(independenceKey("openai", "gpt-5.4-mini"));
  });

  it("counts 3× Opus as one group and 3× Opus + GPT as two", () => {
    const opus = { provider: "anthropic", modelId: "claude-opus-5-5" };
    expect(independentGroupCount([opus, opus, { ...opus, modelId: "claude-opus-5-5-20261001" }])).toBe(1);
    expect(independentGroupCount([opus, opus, opus, { provider: "openai", modelId: "gpt-5.4" }])).toBe(2);
  });
});
