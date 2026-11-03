import { describe, expect, it } from "vitest";
import { ProviderError } from "./errors";
import { discoverModels } from "./registry";
import { MockProviderAdapter } from "./testing/mock-adapter";

describe("discoverModels", () => {
  it("returns models per provider and isolates failures", async () => {
    const result = await discoverModels(
      [
        { provider: "anthropic", apiKey: "a" },
        { provider: "openai", apiKey: "b" },
      ],
      {
        factory: (provider) =>
          provider === "anthropic"
            ? new MockProviderAdapter(provider, { models: [{ provider, modelId: "m1", displayName: "M1", contextWindow: null, maxOutputTokens: null, supportsStructuredOutput: null }] })
            : new MockProviderAdapter(provider, { fail: new ProviderError(provider, "auth", "OpenAI API error 401", 401) }),
      },
    );
    expect(result[0]).toMatchObject({ provider: "anthropic", error: null });
    expect(result[0]!.models).toHaveLength(1);
    expect(result[1]).toMatchObject({ provider: "openai", models: [], error: { kind: "auth" } });
  });
});
