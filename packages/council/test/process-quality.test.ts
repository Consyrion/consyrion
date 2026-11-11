import { describe, expect, it } from "vitest";
import { convergenceOf, jaccard, objectionEffectOf, processQuality, weightDominanceOf } from "../src/process-quality";

const rev = (proposalId: string, version: number, text: string, createdAt = `2026-11-08T10:0${version}:00Z`) => ({
  proposalId,
  version,
  createdAt,
  content: { title: text, summary: "", architecture: text, components: [] },
});

describe("#182 process quality (stored data only)", () => {
  it("convergence: proposals moving towards the same wording are 'strong'; unchanged ones are not measurable", () => {
    const strong = convergenceOf([
      { id: "A", revisions: [rev("A", 1, "postgres monolith rest api cache"), rev("A", 2, "serverless queue lambda postgres cache")] },
      { id: "B", revisions: [rev("B", 1, "serverless queue lambda dynamo events"), rev("B", 2, "serverless queue lambda postgres cache")] },
    ]);
    expect(strong).toMatchObject({ measurable: true, level: "strong" });
    if (strong.measurable) expect(strong.latest).toBeGreaterThan(strong.initial);
    expect(
      convergenceOf([
        { id: "A", revisions: [rev("A", 1, "x")] },
        { id: "B", revisions: [rev("B", 1, "y")] },
      ]),
    ).toEqual({ measurable: false, reason: "no_revisions" });
    expect(convergenceOf([{ id: "A", revisions: [rev("A", 1, "x")] }])).toEqual({ measurable: false, reason: "fewer_than_two_proposals" });
    expect(jaccard(new Set(), new Set())).toBe(1);
  });

  it("objections: survival and a structural effect – revision after it, blocking, or none; zero objections stay zero", () => {
    const effect = objectionEffectOf(
      [
        { proposalId: "A", status: "accepted", blocking: false, createdAt: "2026-11-08T10:00:30Z" },
        { proposalId: "B", status: "unresolved", blocking: true, createdAt: "2026-11-08T10:00:30Z" },
        { proposalId: "C", status: "accepted", blocking: false, createdAt: "2026-11-08T10:05:00Z" },
        { proposalId: "A", status: "refuted", blocking: false, createdAt: "2026-11-08T10:00:30Z" },
      ],
      [rev("A", 2, "x", "2026-11-08T10:02:00Z"), rev("C", 2, "y", "2026-11-08T10:02:00Z")],
    );
    expect(effect).toEqual({ total: 4, survived: 3, refuted: 1, resolved: 0, open: 0, effects: { revised: 1, blocking: 1, none: 1 } });
    expect(objectionEffectOf([], [])).toMatchObject({ total: 0, survived: 0 });
  });

  it("weight: one voice per independence group; 'changed winner' comes from the stored verdict", () => {
    const matrix = {
      evaluatorWeights: { o1: 8, o2: 8, g: 4, m: 4 },
      evaluatorGroups: { o1: "opus", o2: "opus", g: "gpt", m: "gemini" },
      confidenceIssues: [{ kind: "weighting_changed_winner", weightedWinnerId: "A", unweightedWinnerId: "B" }],
    };
    expect(weightDominanceOf(matrix, "A")).toEqual({
      measurable: true,
      topGroupShare: 0.5,
      topGroupParticipantIds: ["o1", "o2"],
      groups: 3,
      changedWinner: true,
      weightedWinnerId: "A",
      unweightedWinnerId: "B",
    });
    expect(weightDominanceOf({ evaluatorWeights: { a: 6, b: 5 } }, "A")).toMatchObject({ changedWinner: false, topGroupShare: 0.55 });
    expect(weightDominanceOf(null, null)).toEqual({ measurable: false, reason: "no_verdict" });
    // Gesamttest 08.11.26: nothing approvable – "the weights did not change the winner" would say nothing.
    expect(weightDominanceOf({ evaluatorWeights: { a: 6, b: 5 } }, null)).toEqual({ measurable: false, reason: "no_winner" });
    expect(weightDominanceOf({}, null)).toEqual({ measurable: false, reason: "no_weights" });
  });

  it("participation per group: two instances of one model are one voice", () => {
    const q = processQuality({
      participation: { valid: 2, total: 3, percent: 67, shortfalls: [{ participantId: "o2", phases: ["final_verdict"] }] },
      participantIds: ["o1", "o2", "g"],
      proposals: [],
      objections: [],
      decision: { matrix: { evaluatorWeights: { o1: 5, o2: 5, g: 5 }, evaluatorGroups: { o1: "opus", o2: "opus", g: "gpt" } }, recommendedProposalId: null },
    });
    expect(q.participationGroups).toEqual({ valid: 2, total: 2 });
  });
});
