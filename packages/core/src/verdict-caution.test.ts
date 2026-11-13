import { describe, expect, it } from "vitest";
import { hasCaution, verdictCaution } from "./verdict-caution";

const objections = [
  { proposalId: "D", severity: "critical", status: "accepted" },
  { proposalId: "D", severity: "high", status: "unresolved" },
  { proposalId: "D", severity: "high", status: "refuted" },
  { proposalId: "D", severity: "high", status: "accepted", moot: { againstVersion: 1 } },
  { proposalId: "B", severity: "high", status: "open" },
];

describe("verdict caution – one rule for screen and report", () => {
  it("counts open critical and high objections against the recommendation separately, ignoring moot and settled ones", () => {
    expect(verdictCaution({ recommendedProposalId: "D", objections, confidence: "high" })).toEqual({ openCritical: 1, openHigh: 1, lowConfidence: false });
  });

  it("reads low confidence from the stored confidence, not from 'reduced'", () => {
    expect(verdictCaution({ recommendedProposalId: "D", objections: [], confidence: "reduced", legacyIssueCount: 3 }).lowConfidence).toBe(false);
    expect(verdictCaution({ recommendedProposalId: "D", objections: [], confidence: "low" }).lowConfidence).toBe(true);
    expect(verdictCaution({ recommendedProposalId: "D", objections: [], confidence: null, legacyIssueCount: 1 }).lowConfidence).toBe(true);
  });

  it("has no reservation without a recommendation and without issues", () => {
    expect(hasCaution(verdictCaution({ recommendedProposalId: null, objections, confidence: "high" }))).toBe(false);
  });
});
