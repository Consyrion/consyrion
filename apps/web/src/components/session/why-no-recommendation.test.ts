import { describe, expect, it } from "vitest";
import type { View } from "./helpers";
import { explainNoRecommendation } from "./why-no-recommendation";

const view = { requirementList: { id: "l", version: 1, items: [{ id: "q1", text: "Max 4 weeks" }, { id: "q2", text: "Data in Germany" }, { id: "q3", text: "99.9 % uptime" }], excluded: [] } } as unknown as View;
const req = (requirementId: string, status: "PASS" | "FAIL" | "DISPUTED" | "UNKNOWN", pass: string[], fail: string[], unknown: string[] = [], open: string[] = []) => ({ requirementId, status, pass, fail, unknown, open, conflicts: [] });
const gate = (proposals: unknown[]) => ({ proposals, comparisonComplete: true, comparisonNote: null, summary: null }) as never;

describe("why there is no approvable recommendation (#230)", () => {
  it("names the most concrete reason per proposal: violated before disputed before not evaluated before not proven", () => {
    const why = explainNoRecommendation(
      view,
      gate([
        { proposalId: "a", feasibility: "fail", causes: [], requirements: [req("q1", "FAIL", [], ["e1", "e2"]), req("q3", "UNKNOWN", ["e1"], [], ["e2"])] },
        { proposalId: "b", feasibility: "needs_verification", causes: [], requirements: [req("q2", "DISPUTED", ["e1"], ["e3"])] },
        { proposalId: "c", feasibility: "needs_verification", causes: [], requirements: [req("q2", "UNKNOWN", ["e1"], [], [], ["e2"])] },
        { proposalId: "d", feasibility: "needs_verification", causes: [], requirements: [req("q3", "UNKNOWN", ["e1"], [], ["e2"])] },
        { proposalId: "e", feasibility: "needs_verification", causes: [], limitedReview: true, requirements: [req("q1", "PASS", ["e1"], [])] },
      ]),
    )!;
    expect(why.proposals).toEqual([
      { proposalId: "a", kind: "violated", requirements: ["R1"], counts: { pass: 0, fail: 2, total: 2 } },
      { proposalId: "b", kind: "disputed", requirements: ["R2"], counts: { pass: 1, fail: 1, total: 2 } },
      { proposalId: "c", kind: "notEvaluated", requirements: ["R2"] },
      { proposalId: "d", kind: "notProven", requirements: ["R3"] },
      { proposalId: "e", kind: "limitedReview", requirements: [] },
    ]);
    expect(why.steps).toEqual(["repeatEvaluation", "addEvidence", "reviewRequirement"]);
  });

  it("offers only steps that exist today – never a targeted re-check (#228/#229 not decided)", () => {
    const why = explainNoRecommendation(view, gate([{ proposalId: "a", feasibility: "fail", causes: [], requirements: [req("q1", "FAIL", [], ["e1"])] }]), {
      requirementsConflict: true,
      approvableProposals: 1,
    })!;
    expect(why.requirementsConflict).toBe(true);
    expect(why.steps).toEqual(["resolveConflict", "reviewRequirement", "chooseOther"]);
    expect(explainNoRecommendation(view, undefined)).toBeNull();
  });
});

describe("#511 architecture candidate", () => {
  it("names the candidate's open measurement and offers favourite, prototype build and measurement as next steps", () => {
    const candidateGate = {
      comparisonComplete: true,
      comparisonNote: null,
      summary: null,
      proposals: [
        {
          proposalId: "A",
          feasibility: "needs_verification" as const,
          architectureCandidate: true,
          causes: [],
          requirements: [{ requirementId: "R1", status: "PASS" as const, measurementPending: true, pass: ["e1", "e2"], fail: [], unknown: [], open: [], conflicts: [] }],
        },
      ],
    };
    const why = explainNoRecommendation({ requirementList: { items: [{ id: "R1", text: "p95 below 200 ms" }] } } as never, candidateGate as never);
    expect(why!.proposals).toEqual([{ proposalId: "A", kind: "architectureCandidate", requirements: ["R1"] }]);
    expect(why!.steps).toEqual(expect.arrayContaining(["markFavorite", "prototypeBuild", "recordMeasurement"]));
  });
});
