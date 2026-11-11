import { describe, expect, it } from "vitest";
import { councilPurpose, ideaCheck, type IdeaCheckMatrix } from "./idea-check";

type Status = "PASS" | "FAIL" | "DISPUTED" | "UNKNOWN";
const req = (requirementId: string, status: Status, measurementPending = false) => ({
  requirementId,
  status,
  pass: [],
  fail: [],
  unknown: [],
  open: [],
  conflicts: [],
  measurementPending,
});
const gate = (proposals: Array<{ id: string; feasibility: "qualified" | "needs_verification" | "fail" | "incomplete"; reqs: ReturnType<typeof req>[] }>) => ({
  proposals: proposals.map((p) => ({ proposalId: p.id, feasibility: p.feasibility, requirements: p.reqs, causes: [] })),
  comparisonComplete: true,
  comparisonNote: null,
  summary: null,
});

describe("idea check (#597): reading a verdict nothing can be approved in", () => {
  it("names the best proposal no evaluator ruled out, its open points and the excluded proposals (test council 11.11.26)", () => {
    // Club membership list: all three models chose the same option; one evaluator estimate broke R2 for one proposal.
    const matrix: IdeaCheckMatrix = {
      proposals: [
        { proposalId: "p1", total: 8.1 },
        { proposalId: "p2", total: 7.2 },
        { proposalId: "p3", total: 8.6 },
      ],
      requirementGate: gate([
        { id: "p1", feasibility: "needs_verification", reqs: [req("r1", "PASS"), req("r2", "UNKNOWN"), req("r3", "PASS"), req("r4", "UNKNOWN")] },
        { id: "p2", feasibility: "needs_verification", reqs: [req("r1", "PASS"), req("r2", "UNKNOWN"), req("r3", "PASS"), req("r4", "PASS")] },
        { id: "p3", feasibility: "fail", reqs: [req("r1", "PASS"), req("r2", "FAIL"), req("r3", "DISPUTED"), req("r4", "PASS")] },
      ]),
    };
    expect(ideaCheck(matrix)).toEqual({
      kind: "favorite",
      leaders: ["p1"],
      toClarify: ["r2", "r4"],
      // The highest total does not help a proposal that fails a requirement.
      excluded: [{ proposalId: "p3", requirementIds: ["r2", "r3"] }],
    });
  });

  it("lists a requirement whose check only confirmed a measurement plan as open", () => {
    const matrix: IdeaCheckMatrix = {
      proposals: [{ proposalId: "p1", total: 8 }],
      requirementGate: gate([{ id: "p1", feasibility: "needs_verification", reqs: [req("r1", "PASS"), req("r2", "PASS", true)] }]),
    };
    expect(ideaCheck(matrix)).toMatchObject({ kind: "favorite", toClarify: ["r2"] });
  });

  it("does not rank proposals within the tie margin against each other", () => {
    const matrix: IdeaCheckMatrix = {
      proposals: [
        { proposalId: "p1", total: 8.0 },
        { proposalId: "p2", total: 8.2 },
        { proposalId: "p3", total: 7.0 },
      ],
      requirementGate: gate(["p1", "p2", "p3"].map((id) => ({ id, feasibility: "needs_verification" as const, reqs: [req("r1", "UNKNOWN")] }))),
    };
    expect(ideaCheck(matrix)).toMatchObject({ kind: "several", leaders: ["p2", "p1"] });
  });

  it("says the idea does not hold up when every proposal fails a requirement", () => {
    const matrix: IdeaCheckMatrix = {
      proposals: [
        { proposalId: "p1", total: 8 },
        { proposalId: "p2", total: 7 },
      ],
      requirementGate: gate([
        { id: "p1", feasibility: "fail", reqs: [req("r1", "FAIL")] },
        { id: "p2", feasibility: "fail", reqs: [req("r1", "FAIL")] },
      ]),
    };
    expect(ideaCheck(matrix)).toMatchObject({ kind: "none", leaders: [], excluded: [{ proposalId: "p1" }, { proposalId: "p2" }] });
  });

  it("gives no reading when the matrix cannot carry one: no gate, unequal comparison, missing evaluators, incomplete proposals", () => {
    const g = gate([{ id: "p1", feasibility: "needs_verification", reqs: [req("r1", "UNKNOWN")] }]);
    const proposals = [{ proposalId: "p1", total: 8 }];
    expect(ideaCheck(null)).toBeNull();
    expect(ideaCheck({ proposals })).toBeNull();
    expect(ideaCheck({ proposals, requirementGate: { ...g, comparisonComplete: false } })).toBeNull();
    expect(ideaCheck({ proposals, requirementGate: g, failedEvaluators: [{}] })).toBeNull();
    expect(ideaCheck({ proposals, requirementGate: gate([{ id: "p1", feasibility: "incomplete", reqs: [req("r1", "UNKNOWN")] }]) })).toBeNull();
  });

  it("treats only an explicit idea_check as one – older councils and unknown values are approval councils", () => {
    expect(councilPurpose({ purpose: "idea_check" })).toBe("idea_check");
    expect(councilPurpose({ purpose: "approval" })).toBe("approval");
    expect(councilPurpose({})).toBe("approval");
    expect(councilPurpose(null)).toBe("approval");
    expect(councilPurpose({ purpose: "anything" })).toBe("approval");
  });
});
