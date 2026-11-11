import { describe, expect, it } from "vitest";
import { MAX_TOKEN_BUDGET } from "@consyrium/core/browser";
import { suggestedBudget } from "./budget-suggestion";

describe("budget suggestion of the council form (#587)", () => {
  it("raises a budget below the minimum to the upper bound, rounded up to 10,000 (user report 09.11.26)", () => {
    expect(suggestedBudget({ tokenBudget: 400_000, minimumBudget: 1_005_120, upperBound: 2_130_559 })).toBe(2_140_000);
  });

  it("also offers the upper bound when the minimum is covered but phases could be shortened", () => {
    expect(suggestedBudget({ tokenBudget: 250_000, minimumBudget: 120_000, upperBound: 310_001 })).toBe(320_000);
  });

  it("suggests nothing when the budget already covers the upper bound", () => {
    expect(suggestedBudget({ tokenBudget: 400_000, minimumBudget: 120_000, upperBound: 400_000 })).toBeNull();
    expect(suggestedBudget({ tokenBudget: 400_000, minimumBudget: 120_000, upperBound: 0 })).toBeNull();
  });

  it("never goes above the allowed maximum, and gives up when even that is below the minimum", () => {
    expect(suggestedBudget({ tokenBudget: 400_000, minimumBudget: 1_000_000, upperBound: MAX_TOKEN_BUDGET + 500_000 })).toBe(MAX_TOKEN_BUDGET);
    expect(suggestedBudget({ tokenBudget: 400_000, minimumBudget: MAX_TOKEN_BUDGET + 1, upperBound: MAX_TOKEN_BUDGET + 500_000 })).toBeNull();
    expect(suggestedBudget({ tokenBudget: MAX_TOKEN_BUDGET, minimumBudget: 1_000_000, upperBound: MAX_TOKEN_BUDGET + 500_000 })).toBeNull();
  });
});
