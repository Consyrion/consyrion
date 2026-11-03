import { describe, expect, it } from "vitest";
import { COUNCIL_PHASES, COUNCIL_PHASE_LABELS, COUNCIL_ROLES, DEFAULT_EVALUATION_WEIGHTS, validateWeights } from "./phases";

describe("council phases", () => {
  it("defines exactly the seven canonical phases in order", () => {
    expect(COUNCIL_PHASES.map((phase) => COUNCIL_PHASE_LABELS[phase])).toEqual([
      "Independent Thinking",
      "Open Council",
      "12 Minds Council",
      "Minority Review",
      "Consensus Round",
      "Final Verdict",
      "Execution Council",
    ]);
  });

  it("offers twelve perspectives", () => {
    expect(new Set(COUNCIL_ROLES).size).toBe(12);
  });

  it("accepts the default weights and rejects invalid ones", () => {
    expect(validateWeights(DEFAULT_EVALUATION_WEIGHTS)).toEqual([]);
    expect(validateWeights({ ...DEFAULT_EVALUATION_WEIGHTS, security: 30 })).toContain("weights must add up to 100 (got 105)");
    expect(validateWeights({ ...DEFAULT_EVALUATION_WEIGHTS, security: -5, technicalQuality: 60 }).length).toBeGreaterThan(0);
  });
});

describe("weight fields (#97)", () => {
  it("rejects empty, negative and too large single values even when the total is 100", async () => {
    const { weightFieldError, validateWeights } = await import("./phases");
    expect(weightFieldError("")).toBe("Enter a number from 0 to 100.");
    expect(weightFieldError("-5")).toBe("Must not be negative.");
    expect(weightFieldError("101")).toBe("Must be at most 100.");
    expect(weightFieldError("abc")).toBe("Enter a number from 0 to 100.");
    expect(weightFieldError("25")).toBeNull();
    // The server rule stays: a correct total does not make a negative weight valid.
    expect(validateWeights({ technicalQuality: 60, security: -5, maintainability: 20, operatingCost: 15, implementationSpeed: 10 })).toContain("security must be between 0 and 100");
  });
});
