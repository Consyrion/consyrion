import { describe, expect, it } from "vitest";
import { DEFAULT_EVALUATION_WEIGHTS } from "./phases";
import { aggregateVerdict, CRITERIA, isImplementable, roundScore, type ObjectionInput, type ScoreInput, type VoteInput } from "./verdict";

const config = { weights: DEFAULT_EVALUATION_WEIGHTS, minSecurityScore: 5, minTotalScore: 5, tieMargin: 0.25 };
const proposals = [
  { proposalId: "A", authorParticipantId: "p1" },
  { proposalId: "B", authorParticipantId: "p2" },
  { proposalId: "C", authorParticipantId: "p3" },
];

function scoresFor(proposalId: string, author: string, evaluators: string[], value: number | ((criterion: string) => number)): ScoreInput[] {
  return evaluators.flatMap((evaluator) =>
    CRITERIA.map((criterion) => ({
      proposalId,
      authorParticipantId: author,
      evaluatorParticipantId: evaluator,
      criterion,
      score: typeof value === "number" ? value : value(criterion),
    })),
  );
}

describe("aggregateVerdict", () => {
  it("recommends the highest weighted total and keeps the formula reproducible", () => {
    const scores = [...scoresFor("A", "p1", ["p2", "p3"], 8), ...scoresFor("B", "p2", ["p1", "p3"], 6), ...scoresFor("C", "p3", ["p1", "p2"], 7)];
    const result = aggregateVerdict(proposals, scores, [], [], config);
    expect(result.outcome).toBe("recommended");
    expect(result.recommendedProposalId).toBe("A");
    expect(result.proposals.find((p) => p.proposalId === "A")!.total).toBe(8);
    expect(aggregateVerdict(proposals, [...scores].reverse(), [], [], config)).toEqual(result);
  });

  it("rounds the exact decimal total half up, independent of the order of contributions (#122)", () => {
    // Stored means of the real run: 9.5 / 8.5 / 9 / 10 / 10 with weights 30/25/20/15/10 = exactly 9.275.
    const pairs: Record<string, [number, number]> = {
      technicalQuality: [9, 10],
      security: [8, 9],
      maintainability: [9, 9],
      operatingCost: [10, 10],
      implementationSpeed: [10, 10],
    };
    const scores = [
      ...scoresFor("A", "p1", ["p2"], (c) => pairs[c]![0]),
      ...scoresFor("A", "p1", ["p3"], (c) => pairs[c]![1]),
      ...scoresFor("B", "p2", ["p1", "p3"], 6),
      ...scoresFor("C", "p3", ["p1", "p2"], 6),
    ];
    const a = aggregateVerdict(proposals, scores, [], [], config).proposals.find((p) => p.proposalId === "A")!;
    expect(a.total).toBe(9.28);
    expect(a.criterionMeans).toEqual({ technicalQuality: 9.5, security: 8.5, maintainability: 9, operatingCost: 10, implementationSpeed: 10 });
    // Every summation order of the same contributions gives the same rounded value.
    const parts = [9.5 * 0.3, 8.5 * 0.25, 9 * 0.2, 10 * 0.15, 10 * 0.1];
    const orders = [parts, [...parts].reverse(), [parts[3]!, parts[0]!, parts[4]!, parts[1]!, parts[2]!]];
    for (const order of orders) expect(roundScore(order.reduce((x, y) => x + y, 0))).toBe(9.28);
    // Further half boundaries and multi-evaluator means.
    expect(roundScore(1.005)).toBe(1.01);
    expect(roundScore(8.125)).toBe(8.13);
    expect(roundScore((7 + 8 + 8) / 3)).toBe(7.67);
    expect(roundScore(6.664999)).toBe(6.66);
    expect(roundScore(10)).toBe(10);
  });

  it("treats a difference of exactly the tie margin as a clear winner, not a tie (#122)", () => {
    // 9.28 vs 9.00 with a margin of exactly 0.28: in binary the difference is 0.2799…, which used to count as a tie.
    const pairs: Record<string, [number, number]> = {
      technicalQuality: [9, 10],
      security: [8, 9],
      maintainability: [9, 9],
      operatingCost: [10, 10],
      implementationSpeed: [10, 10],
    };
    const scores = [
      ...scoresFor("A", "p1", ["p2"], (c) => pairs[c]![0]),
      ...scoresFor("A", "p1", ["p3"], (c) => pairs[c]![1]),
      ...scoresFor("B", "p2", ["p1", "p3"], (c) => pairs[c]![0]),
      ...scoresFor("C", "p3", ["p1", "p2"], 5),
    ];
    const totals = aggregateVerdict(proposals, scores, [], [], config).proposals.map((p) => p.total);
    expect(totals[0]).toBe(9.28);
    const margin = { ...config, tieMargin: roundScore(totals[0]! - totals[1]!) };
    const result = aggregateVerdict(proposals, scores, [], [], margin);
    expect(result.outcome).toBe("recommended");
    expect(result.recommendedProposalId).toBe("A");
    // Just below the margin it is a tie.
    expect(aggregateVerdict(proposals, scores, [], [], { ...margin, tieMargin: margin.tieMargin + 0.01 }).outcome).toBe("tie");
  });

  it("never recommends a high-scoring finding that the hard requirements cannot be met (#121)", () => {
    // Real negative test: three proposals explain why no architecture can satisfy H1–H3; the analysis scores 9+.
    const findings = proposals.map((p) => ({ ...p, solvesRequirements: false }));
    const scores = [...scoresFor("A", "p1", ["p2", "p3"], 9), ...scoresFor("B", "p2", ["p1", "p3"], 9), ...scoresFor("C", "p3", ["p1", "p2"], 10)];
    const votes: VoteInput[] = ["p1", "p2", "p3"].map((evaluator) => ({
      evaluatorParticipantId: evaluator,
      ranking: [],
      requirementChecks: ["A", "B", "C"].map((proposalId) => ({ proposalId, meets: false })),
    }));
    const result = aggregateVerdict(findings, scores, [], votes, config);
    expect(result.outcome).toBe("no_qualifying_solution");
    expect(result.recommendedProposalId).toBeNull();
    expect(result.requirementsConflict).toBe(true);
    const c = result.proposals.find((p) => p.proposalId === "C")!;
    expect(c.total).toBe(10);
    expect(c.implementable).toBe(false);
    expect(c.eligible).toBe(false);
    expect(c.requirementChecks).toEqual({ failed: 2, total: 2 });
    expect(c.ineligibleReasons.join(" ")).toMatch(/states that the hard requirements cannot be met/);
    expect(isImplementable(result, "C")).toBe(false);
  });

  it("separates feasibility from quality: an independent majority finding a requirement unmet blocks, half only warns (#121)", () => {
    const scores = [...scoresFor("A", "p1", ["p2", "p3"], 9), ...scoresFor("B", "p2", ["p1", "p3"], 7), ...scoresFor("C", "p3", ["p1", "p2"], 6)];
    const vote = (evaluator: string, checks: Record<string, boolean>): VoteInput => ({
      evaluatorParticipantId: evaluator,
      ranking: [],
      requirementChecks: Object.entries(checks).map(([proposalId, meets]) => ({ proposalId, meets })),
    });
    // A claims to solve everything, but both independent evaluators find a hard requirement unmet.
    const majority = aggregateVerdict(
      proposals,
      scores,
      [],
      [vote("p2", { A: false, C: true }), vote("p3", { A: false, B: true }), vote("p1", { B: true, C: true })],
      config,
    );
    expect(majority.recommendedProposalId).toBe("B");
    expect(majority.requirementsConflict).toBe(false);
    expect(majority.proposals.find((p) => p.proposalId === "A")!.ineligibleReasons.join(" ")).toMatch(/2 of 2 independent evaluators/);
    // One of two: still implementable, but the verdict carries the dispute and loses confidence.
    const half = aggregateVerdict(
      proposals,
      scores,
      [],
      [vote("p2", { A: false, C: true }), vote("p3", { A: true, B: true }), vote("p1", { B: true, C: true })],
      config,
    );
    expect(half.recommendedProposalId).toBe("A");
    expect(half.confidenceIssues).toContainEqual({ kind: "requirements_disputed", proposalId: "A", failed: 1, total: 2 });
    expect(half.confidence).toBe("low");
    // The author's own check of its proposal does not count.
    const own = aggregateVerdict(proposals, scores, [], [vote("p1", { A: false })], config);
    expect(own.proposals.find((p) => p.proposalId === "A")!.requirementChecks).toEqual({ failed: 0, total: 0 });
  });

  it("keeps decisions from before the feasibility check approvable", () => {
    const scores = [...scoresFor("A", "p1", ["p2", "p3"], 8), ...scoresFor("B", "p2", ["p1", "p3"], 6), ...scoresFor("C", "p3", ["p1", "p2"], 7)];
    const result = aggregateVerdict(proposals, scores, [], [], config);
    expect(result.proposals.every((p) => p.implementable)).toBe(true);
    expect(isImplementable({ proposals: [{ proposalId: "A", total: 8 }] }, "A")).toBe(true);
    expect(isImplementable(null, "A")).toBe(true);
  });

  it("ignores self-evaluations", () => {
    const scores = [
      ...scoresFor("A", "p1", ["p1"], 10),
      ...scoresFor("A", "p1", ["p2"], 4),
      ...scoresFor("B", "p2", ["p1"], 6),
      ...scoresFor("C", "p3", ["p1"], 5),
    ];
    const a = aggregateVerdict(proposals, scores, [], [], config).proposals.find((p) => p.proposalId === "A")!;
    expect(a.total).toBe(4);
    expect(a.independentEvaluators).toBe(1);
  });

  it("blocks the favourite when a critical security objection is unresolved (11:1 case)", () => {
    const scores = [...scoresFor("A", "p1", ["p2", "p3"], 9), ...scoresFor("B", "p2", ["p1", "p3"], 7), ...scoresFor("C", "p3", ["p1", "p2"], 6)];
    const objections: ObjectionInput[] = [{ proposalId: "A", blocking: true, status: "unresolved", severity: "critical" }];
    const result = aggregateVerdict(proposals, scores, objections, [], config);
    expect(result.recommendedProposalId).toBe("B");
    expect(result.proposals.find((p) => p.proposalId === "A")!.ineligibleReasons[0]).toMatch(/blocking/);
  });

  it("closes a refuted objection without blocking", () => {
    const scores = [...scoresFor("A", "p1", ["p2"], 9), ...scoresFor("B", "p2", ["p1"], 6)];
    const result = aggregateVerdict(proposals.slice(0, 2), scores, [{ proposalId: "A", blocking: true, status: "refuted", severity: "critical" }], [], config);
    expect(result.recommendedProposalId).toBe("A");
  });

  it("applies the security hard gate before the total", () => {
    const scores = [...scoresFor("A", "p1", ["p2"], (c) => (c === "security" ? 3 : 10)), ...scoresFor("B", "p2", ["p1"], 6)];
    const result = aggregateVerdict(proposals.slice(0, 2), scores, [], [], config);
    expect(result.recommendedProposalId).toBe("B");
  });

  it("reports ties instead of a false winner", () => {
    const scores = [...scoresFor("A", "p1", ["p2"], 7), ...scoresFor("B", "p2", ["p1"], 7)];
    const result = aggregateVerdict(proposals.slice(0, 2), scores, [], [], config);
    expect(result.outcome).toBe("tie");
    expect(result.tiedProposalIds.sort()).toEqual(["A", "B"]);
  });

  it("returns no qualifying solution when nothing passes the gates", () => {
    const scores = [...scoresFor("A", "p1", ["p2"], 3), ...scoresFor("B", "p2", ["p1"], 4)];
    expect(aggregateVerdict(proposals.slice(0, 2), scores, [], [], config).outcome).toBe("no_qualifying_solution");
  });

  it("returns insufficient evidence without independent scores", () => {
    expect(aggregateVerdict(proposals, scoresFor("A", "p1", ["p1"], 10), [], [], config).outcome).toBe("insufficient_evidence");
  });

  it("treats missing scores as ineligible", () => {
    const partial = scoresFor("A", "p1", ["p2"], 9).filter((s) => s.criterion !== "security");
    const result = aggregateVerdict(proposals.slice(0, 2), [...partial, ...scoresFor("B", "p2", ["p1"], 6)], [], [], config);
    expect(result.recommendedProposalId).toBe("B");
  });

  it("keeps the majority vote separate and ignores votes for own proposals", () => {
    const scores = [...scoresFor("A", "p1", ["p2", "p3"], 6), ...scoresFor("B", "p2", ["p1", "p3"], 9), ...scoresFor("C", "p3", ["p1", "p2"], 5)];
    const votes = [
      { evaluatorParticipantId: "p1", ranking: ["A", "C", "B"] },
      { evaluatorParticipantId: "p2", ranking: ["A", "C"] },
      { evaluatorParticipantId: "p3", ranking: ["A", "B"] },
    ];
    const result = aggregateVerdict(proposals, scores, [], votes, config);
    expect(result.majorityVoteWinnerId).toBe("A");
    expect(result.recommendedProposalId).toBe("B");
  });

  it("flags low confidence when an evaluator is missing, as in a real run where one model failed", () => {
    // p3 failed to evaluate: A and B have one evaluator each, C has two. The score still picks A.
    const scores = [...scoresFor("A", "p1", ["p2"], 9), ...scoresFor("B", "p2", ["p1"], 7), ...scoresFor("C", "p3", ["p1", "p2"], 8.3)];
    const votes = [
      { evaluatorParticipantId: "p1", ranking: ["C", "B"] },
      { evaluatorParticipantId: "p2", ranking: ["C", "A"] },
    ];
    const result = aggregateVerdict(proposals, scores, [], votes, config, ["p1", "p2", "p3"]);
    expect(result.recommendedProposalId).toBe("A");
    expect(result.confidence).toBe("low");
    expect(result.confidenceIssues).toEqual([
      { kind: "missing_evaluators", proposalId: "A", evaluators: 1, expected: 2 },
      { kind: "missing_evaluators", proposalId: "B", evaluators: 1, expected: 2 },
      { kind: "vote_disagrees", majorityVoteWinnerId: "C" },
    ]);
  });

  it("reports normal confidence when every evaluator scored and the vote agrees", () => {
    const scores = [...scoresFor("A", "p1", ["p2", "p3"], 8), ...scoresFor("B", "p2", ["p1", "p3"], 6), ...scoresFor("C", "p3", ["p1", "p2"], 7)];
    const votes = [
      { evaluatorParticipantId: "p1", ranking: ["C", "B"] },
      { evaluatorParticipantId: "p2", ranking: ["A", "C"] },
      { evaluatorParticipantId: "p3", ranking: ["A", "B"] },
    ];
    const result = aggregateVerdict(proposals, scores, [], votes, config, ["p1", "p2", "p3"]);
    expect(result.recommendedProposalId).toBe("A");
    expect(result).toMatchObject({ confidence: "normal", confidenceIssues: [] });
  });
});

describe("vote weights (#140)", () => {
  // p1 (strong) prefers B, p2 and p3 prefer A slightly: A wins with equal weights, B with p1 at 10.
  const scores = [
    ...scoresFor("A", "p1", ["p2", "p3"], 8),
    ...scoresFor("B", "p2", ["p1"], 10),
    ...scoresFor("B", "p2", ["p3"], 5),
    ...scoresFor("C", "p3", ["p1", "p2"], 5),
  ];
  const votes: VoteInput[] = [
    { evaluatorParticipantId: "p1", ranking: ["B", "C"] },
    { evaluatorParticipantId: "p2", ranking: ["A", "C"] },
    { evaluatorParticipantId: "p3", ranking: ["A", "B"] },
  ];

  it("gives exactly the unweighted result with equal weights", () => {
    const plain = aggregateVerdict(proposals, scores, [], votes, config);
    expect(aggregateVerdict(proposals, scores, [], votes, { ...config, evaluatorWeights: { p1: 4, p2: 4, p3: 4 } })).toEqual({
      ...plain,
      formula: expect.stringContaining("vote-weighted"),
    });
    expect(plain.recommendedProposalId).toBe("A");
  });

  it("lets a stronger model tip a close race and reports that the weights decided it", () => {
    const result = aggregateVerdict(proposals, scores, [], votes, { ...config, evaluatorWeights: { p1: 10, p2: 4, p3: 4 } });
    // B: (p1 10 × 10 + p3 5 × 4) / 14 = 8.57 > A 8; unweighted B is 7.5.
    expect(result.proposals.find((p) => p.proposalId === "B")!.total).toBe(8.57);
    expect(result.recommendedProposalId).toBe("B");
    expect(result.confidenceIssues).toContainEqual({
      kind: "weighting_changed_winner",
      weightedWinnerId: "B",
      unweightedWinnerId: "A",
      unweightedOutcome: "recommended",
    });
    expect(result.formula).toContain('"p1":10');
    // Borda points are weighted as well, relative to the mean weight (6): p1's first place counts 10 / 6.
    expect(result.proposals.find((p) => p.proposalId === "B")!.bordaPoints).toBe(1.67);
  });

  it("keeps the feasibility gate one evaluator, one check", () => {
    const checks: VoteInput[] = [
      { evaluatorParticipantId: "p1", ranking: ["B", "C"], requirementChecks: [{ proposalId: "B", meets: true }] },
      { evaluatorParticipantId: "p3", ranking: ["A", "B"], requirementChecks: [{ proposalId: "B", meets: false }] },
      { evaluatorParticipantId: "p2", ranking: ["A", "C"] },
    ];
    // A strong p1 does not outvote p3's unmet hard requirement: 1 of 2 failed – disputed, not a weighted majority.
    const result = aggregateVerdict(proposals, scores, [], checks, { ...config, evaluatorWeights: { p1: 10, p2: 1, p3: 1 } });
    expect(result.proposals.find((p) => p.proposalId === "B")!.requirementChecks).toEqual({ failed: 1, total: 2 });
  });

  it("clamps weights to 1–10 and never silences a model", () => {
    const low = aggregateVerdict(proposals, scores, [], votes, { ...config, evaluatorWeights: { p1: 0, p2: -3, p3: 1 } });
    expect(low).toEqual({ ...aggregateVerdict(proposals, scores, [], votes, config), formula: expect.any(String) });
  });
});

describe("instances of one model are one voice (user decision 08.11.26)", () => {
  // o1–o3: three Opus instances through three keys; g: GPT. Proposals by o1 (A) and g (B).
  const groups = { o1: "anthropic:claude-opus-5-5", o2: "anthropic:claude-opus-5-5", o3: "anthropic:claude-opus-5-5", g: "openai:gpt-5.4" };
  const two = [
    { proposalId: "A", authorParticipantId: "o1" },
    { proposalId: "B", authorParticipantId: "g" },
  ];
  const grouped = { ...config, evaluatorGroups: groups };

  it("an Opus instance never scores an Opus proposal, and counts once as an evaluator", () => {
    const scores = [...scoresFor("A", "o1", ["o2", "o3", "g"], (c) => (c === "security" ? 9 : 8)), ...scoresFor("B", "g", ["o1", "o2", "o3"], 6)];
    const result = aggregateVerdict(two, scores, [], [], grouped, ["o1", "o2", "o3", "g"]);
    const a = result.proposals.find((p) => p.proposalId === "A")!;
    const b = result.proposals.find((p) => p.proposalId === "B")!;
    // A: only GPT is foreign – one independent evaluator, one expected.
    expect(a).toMatchObject({ independentEvaluators: 1, expectedEvaluators: 1 });
    // B: three Opus instances are one independent evaluator.
    expect(b).toMatchObject({ independentEvaluators: 1, expectedEvaluators: 1, total: 6 });
    // Without groups (the behaviour before) the instances would count three times.
    expect(aggregateVerdict(two, scores, [], [], config, ["o1", "o2", "o3", "g"]).proposals.find((p) => p.proposalId === "B")!.independentEvaluators).toBe(3);
  });

  it("splits a group's weight among its instances: three Opus scores weigh like one GPT score", () => {
    const three = [...two, { proposalId: "C", authorParticipantId: "x" }];
    const scores = [
      ...scoresFor("C", "x", ["o1", "o2", "o3"], 9),
      ...scoresFor("C", "x", ["g"], 5),
      ...scoresFor("A", "o1", ["g", "x"], 5),
      ...scoresFor("B", "g", ["o1", "x"], 5),
    ];
    const c = aggregateVerdict(three, scores, [], [], { ...grouped, evaluatorGroups: { ...groups, x: "google:gemini" } }).proposals.find(
      (p) => p.proposalId === "C",
    )!;
    // (9 + 5) / 2 = 7, not (9 + 9 + 9 + 5) / 4 = 8.
    expect(c.total).toBe(7);
    expect(c.independentEvaluators).toBe(2);
  });
});
