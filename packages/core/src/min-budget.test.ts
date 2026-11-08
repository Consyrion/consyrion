import { describe, expect, it } from "vitest";
import { buildPolicy, minimumCouncilBudget } from "./index";

describe("minimum council budget (night test R4)", () => {
  it("refuses 120,000 for three models and five requirements, allows 160,000", () => {
    const { policy } = buildPolicy("independent_expert", { tokenBudget: 160_000 } as never);
    const min = minimumCouncilBudget(policy, 1_500, ["anthropic", "openai", "google"], 5);
    expect(min).toBeGreaterThan(120_000);
    expect(min).toBeLessThanOrEqual(160_000);
  });
});
