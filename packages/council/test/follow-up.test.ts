import { describe, expect, it } from "vitest";
import { COUNCIL_JOB, estimateFollowUpTokens, FOLLOW_UP_JOB, followUpRoundEnabled, mergeFollowUpChecks, selectFollowUpItems } from "../src";

const check = (evaluatorParticipantId: string, proposalId: string, requirementId: string, status: string, valid = true) => ({
  evaluatorParticipantId,
  proposalId,
  requirementId,
  status,
  valid,
});

describe("follow-up round (#228/#229): pure rules", () => {
  it("a follow-up answer fills a missing or UNKNOWN check of the same evaluator, never replaces a FAIL", () => {
    const base = [check("e1", "pA", "R1", "UNKNOWN"), check("e1", "pA", "R2", "FAIL"), check("e2", "pA", "R1", "PASS"), check("e1", "pA", "R3", "PASS", false)];
    const merged = mergeFollowUpChecks(base, [
      {
        items: [
          { evaluatorParticipantId: "e1", proposalId: "pA", requirementId: "R1" },
          { evaluatorParticipantId: "e1", proposalId: "pA", requirementId: "R2" },
          { evaluatorParticipantId: "e1", proposalId: "pA", requirementId: "R3" },
        ],
        rows: [check("e1", "pA", "R1", "PASS"), check("e1", "pA", "R2", "PASS"), check("e1", "pA", "R3", "PASS"), check("e1", "pA", "R4", "PASS")],
      },
    ]);
    const valid = merged
      .filter((c) => c.valid)
      .map((c) => `${c.evaluatorParticipantId}:${c.requirementId}:${c.status}`)
      .sort();
    // R1 UNKNOWN → PASS; R2 FAIL stays; R3 had only an invalid row → filled; R4 was not asked → ignored; e2 untouched.
    expect(valid).toEqual(["e1:R1:PASS", "e1:R2:FAIL", "e1:R3:PASS", "e2:R1:PASS"]);
    // The invalid row stays for display.
    expect(merged.some((c) => !c.valid)).toBe(true);
  });

  it("an invalid follow-up answer changes nothing", () => {
    const base = [check("e1", "pA", "R1", "UNKNOWN")];
    expect(
      mergeFollowUpChecks(base, [
        { items: [{ evaluatorParticipantId: "e1", proposalId: "pA", requirementId: "R1" }], rows: [check("e1", "pA", "R1", "PASS", false)] },
      ]),
    ).toEqual(base);
  });

  it("selects missing checks for completion and own UNKNOWN checks for a targeted review – only of delivered evaluators", () => {
    const round = { requirementIds: ["R1", "R2"], proposals: [{ proposalId: "pA", expectedEvaluatorIds: ["e1", "e2", "e3"] }] };
    const items = selectFollowUpItems(
      round,
      [check("e1", "pA", "R1", "PASS"), check("e1", "pA", "R2", "UNKNOWN"), check("e2", "pA", "R1", "FAIL")],
      new Set(["e1", "e2"]),
    );
    expect(items.completion).toEqual([{ evaluatorParticipantId: "e2", proposalId: "pA", requirementId: "R2" }]);
    expect(items.targeted_review).toEqual([{ evaluatorParticipantId: "e1", proposalId: "pA", requirementId: "R2" }]);
  });

  it("estimates one call per evaluator: brief and proposals once, measured output per item", () => {
    const items = [
      { evaluatorParticipantId: "e1", proposalId: "pA", requirementId: "R1" },
      { evaluatorParticipantId: "e1", proposalId: "pA", requirementId: "R2" },
    ];
    // (4,000 + 2,000) / 4 + 1,500 input, 2 × 1,250 + 500 output.
    expect(estimateFollowUpTokens(items, 4_000, new Map([["pA", 2_000]]))).toBe(1_500 + 1_500 + 2_500 + 500);
  });

  it("is on for the hosted app, off for self-hosting unless switched on, and uses the council job", () => {
    expect(followUpRoundEnabled({})).toBe(true);
    expect(followUpRoundEnabled({ SELF_HOSTED: "true" })).toBe(false);
    expect(followUpRoundEnabled({ SELF_HOSTED: "true", FOLLOW_UP_ROUND: "true" })).toBe(true);
    expect(followUpRoundEnabled({ FOLLOW_UP_ROUND: "false" })).toBe(false);
    expect(FOLLOW_UP_JOB).toBe(COUNCIL_JOB);
  });
});
