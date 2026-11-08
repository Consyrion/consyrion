import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { costOf } = await import("./assistant-cost");

const hints = [
  { provider: "anthropic", modelId: "claude-haiku-5-5", inputPerMillion: "1", outputPerMillion: "5", currency: "USD" },
  { provider: "openai", modelId: "shared-name", inputPerMillion: "2", outputPerMillion: "8", currency: "EUR" },
];

describe("assistant answer cost (#281)", () => {
  it("prices an answer from the workspace's price for that provider and model", () => {
    expect(costOf({ role: "assistant", model: "anthropic/claude-haiku-5-5", inputTokens: 1_000_000, outputTokens: 200_000 }, hints)).toEqual({
      amount: 2,
      currency: "USD",
    });
  });

  it("matches the provider, so the same model name of another provider is not used", () => {
    expect(costOf({ role: "assistant", model: "deepseek/shared-name", inputTokens: 10, outputTokens: 10 }, hints)).toBeNull();
    expect(costOf({ role: "assistant", model: "openai/shared-name", inputTokens: 500_000, outputTokens: 0 }, hints)).toEqual({ amount: 1, currency: "EUR" });
  });

  it("invents nothing: no price, no tokens or a question have no cost", () => {
    expect(costOf({ role: "assistant", model: "anthropic/unknown", inputTokens: 10, outputTokens: 10 }, hints)).toBeNull();
    expect(costOf({ role: "assistant", model: "anthropic/claude-haiku-5-5", inputTokens: null, outputTokens: null }, hints)).toBeNull();
    expect(costOf({ role: "user", model: null, inputTokens: null }, hints)).toBeNull();
  });
});
