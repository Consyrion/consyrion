import { describe, expect, it } from "vitest";
import { contextFits, fitCallToModel } from "./call-size";

describe("size check before every model call (#243)", () => {
  it("keeps the wanted output when the model's limits are unknown or large enough", () => {
    expect(fitCallToModel(20_000, 8_000, { contextWindow: null, maxOutputTokens: null })).toEqual({ ok: true, maxOutput: 8_000, capped: null });
    expect(fitCallToModel(20_000, 8_000, { contextWindow: 200_000, maxOutputTokens: 64_000 })).toEqual({ ok: true, maxOutput: 8_000, capped: null });
  });

  it("never asks for more output than the model can write", () => {
    expect(fitCallToModel(10_000, 32_000, { contextWindow: 128_000, maxOutputTokens: 8_192 })).toEqual({ ok: true, maxOutput: 8_192, capped: "model_output_limit" });
  });

  it("lowers the output limit to what is left of the window, with a margin for the estimate", () => {
    // 64k window × 0.9 = 57,600; 50,000 input → 7,600 left.
    expect(fitCallToModel(50_000, 16_000, { contextWindow: 64_000, maxOutputTokens: null })).toEqual({ ok: true, maxOutput: 7_600, capped: "context_window" });
  });

  it("refuses a call whose input leaves no room for a usable answer – content is never cut", () => {
    const result = fitCallToModel(60_000, 8_000, { contextWindow: 64_000, maxOutputTokens: 8_000 });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toMatch(/no room for an answer.*64,000/);
  });

  it("tells the start screen whether a model's window fits the brief", () => {
    expect(contextFits(30_000, 8_000, 128_000)).toBe(true);
    expect(contextFits(120_000, 8_000, 128_000)).toBe(false);
    expect(contextFits(30_000, 8_000, null)).toBeNull();
  });
});
